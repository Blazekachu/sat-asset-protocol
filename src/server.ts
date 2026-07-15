import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createAttestationRecord, verifyAttestationSignature } from "./attestations.ts";
import { evaluateCollectionPredicate, listCollectionAssetsPage } from "./collections.ts";
import { loadConfig, type ProtocolConfig } from "./config.ts";
import { DustValidationError } from "./dust.ts";
import { ListingService, ListingValidationError, type ListingOrdClient } from "./listing-service.ts";
import { SqliteListingStore } from "./listing-store.ts";
import type { CreateListingRequest, ListingStore } from "./listing-types.ts";
import {
  buildBuyerFillTemplatePsbt,
  parseListingPsbt,
  PsbtValidationError,
  validateCanonicalTwoBumpFillPsbt,
} from "./psbt.ts";
import type { OrdSat, OrdStatus } from "./types.ts";

interface VerifyOrdClient {
  status(): Promise<OrdStatus>;
  sat(number: number | bigint): Promise<OrdSat>;
}

interface TemplateInputPayload {
  outpoint: string;
  value_sats: number;
  script_pubkey_hex: string;
}

export interface AppDependencies {
  database?: DatabaseSync;
  listingStore?: ListingStore;
  ordClient: ListingOrdClient;
  verifyOrdClients?: VerifyOrdClient[];
  now?: () => Date;
  createListingId?: () => string;
  config?: ProtocolConfig;
}

interface AppInstance {
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function ensureInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ListingValidationError(`${fieldName} must be an integer`);
  }

  return value;
}

function parseOptionalIntQueryParam(url: URL, name: string): number | undefined {
  const text = url.searchParams.get(name);
  if (text === null || text.trim() === "") {
    return undefined;
  }

  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) {
    throw new ListingValidationError(`${name} query param must be an integer`);
  }

  return value;
}

function ensureNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ListingValidationError(`${fieldName} is required`);
  }

  return value;
}

function parseTemplateInputArray(value: unknown, fieldName: string): TemplateInputPayload[] {
  if (!Array.isArray(value)) {
    throw new ListingValidationError(`${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ListingValidationError(`${fieldName}[${index}] must be an object`);
    }

    const outpoint = ensureNonEmptyString(
      (entry as Record<string, unknown>).outpoint,
      `${fieldName}[${index}].outpoint`,
    );
    const valueSats = ensureInteger(
      (entry as Record<string, unknown>).value_sats,
      `${fieldName}[${index}].value_sats`,
    );
    const scriptPubkeyHex = ensureNonEmptyString(
      (entry as Record<string, unknown>).script_pubkey_hex,
      `${fieldName}[${index}].script_pubkey_hex`,
    );

    return {
      outpoint,
      value_sats: valueSats,
      script_pubkey_hex: scriptPubkeyHex,
    };
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ListingValidationError("Request body must be valid JSON");
  }
}

export function createApp(dependencies: AppDependencies): AppInstance {
  const listingStore =
    dependencies.listingStore ??
    (dependencies.database ? new SqliteListingStore(dependencies.database) : undefined);

  if (!listingStore) {
    throw new Error("createApp requires either database or listingStore");
  }

  const listingService = new ListingService({
    store: listingStore,
    ordClient: dependencies.ordClient,
    now: dependencies.now,
    createListingId: dependencies.createListingId,
  });
  const verifyOrdClients = dependencies.verifyOrdClients ?? [dependencies.ordClient as VerifyOrdClient];
  const now = dependencies.now ?? (() => new Date());
  const config = dependencies.config ?? loadConfig();
  const dustPolicy = {
    minRelayFeeSatPerVb: config.minRelayFeeSatPerVb,
    bumpSizeSats: config.bumpSizeSats,
  };

  return {
    handler: async (request, response) => {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      try {
        if (method === "POST" && url.pathname === "/v1/listings") {
          const body = (await readJsonBody(request)) as CreateListingRequest;
          const listing = await listingService.createListing(body);
          writeJson(response, 201, { listing });
          return;
        }

        if (method === "GET" && url.pathname === "/v1/listings") {
          const outpoint = url.searchParams.get("outpoint") ?? undefined;
          const sat_number = parseOptionalIntQueryParam(url, "sat_number");
          const sat_range_start = parseOptionalIntQueryParam(url, "sat_range_start");
          const sat_range_size = parseOptionalIntQueryParam(url, "sat_range_size");

          const assetTypeText = url.searchParams.get("asset_type");
          let asset_type: CreateListingRequest["asset_type"] | undefined;
          if (assetTypeText !== null && assetTypeText.trim() !== "") {
            if (
              assetTypeText !== "sat" &&
              assetTypeText !== "range" &&
              assetTypeText !== "utxo"
            ) {
              throw new ListingValidationError(
                `asset_type query param must be one of "sat", "range", "utxo"`,
              );
            }

            asset_type = assetTypeText;
          }

          const listings = listingService.listOpenListings({
            sat_number,
            outpoint,
            asset_type,
            sat_range_start,
            sat_range_size,
          });

          writeJson(response, 200, { listings });
          return;
        }

        if (method === "GET" && url.pathname.startsWith("/v1/verify/sat/")) {
          const satNumberText = url.pathname.replace("/v1/verify/sat/", "");
          if (!/^\d+$/.test(satNumberText)) {
            throw new ListingValidationError("sat number must be a non-negative integer");
          }

          if (verifyOrdClients.length < 2) {
            throw new ListingValidationError("verification requires at least 2 ord nodes");
          }

          const satNumber = Number.parseInt(satNumberText, 10);
          const satpoints: string[] = [];

          for (const client of verifyOrdClients) {
            const status = await client.status();
            if (!status.sat_index) {
              throw new ListingValidationError("ord node is missing --index-sats");
            }

            if (status.unrecoverably_reorged) {
              throw new ListingValidationError("ord node is unrecoverably reorged");
            }

            const sat = await client.sat(satNumber);
            if (!sat.satpoint) {
              throw new ListingValidationError("sat has no satpoint on at least one ord node");
            }

            satpoints.push(sat.satpoint);
          }

          const firstSatpoint = satpoints[0];
          const allAgree = satpoints.every((satpoint) => satpoint === firstSatpoint);
          if (!allAgree) {
            throw new ListingValidationError("ord quorum disagreement on satpoint");
          }

          writeJson(response, 200, {
            sat_number: satNumber,
            satpoint: firstSatpoint,
            quorum: {
              required: 2,
              agreed: 2,
              total: verifyOrdClients.length,
            },
          });
          return;
        }

        if (method === "GET" && url.pathname.startsWith("/v1/collections/")) {
          const verifyMatch = url.pathname.match(/^\/v1\/collections\/([^/]+)\/verify\/(\d+)$/);
          if (verifyMatch) {
            const collectionId = decodeURIComponent(verifyMatch[1] ?? "");
            const satNumber = BigInt(verifyMatch[2] ?? "0");
            const collection = listingStore.getCollection(collectionId);
            if (!collection) {
              writeJson(response, 404, { error: "collection not found" });
              return;
            }

            const verified = evaluateCollectionPredicate(collection, satNumber);
            const attestations = listingStore.listAttestationsBySat(Number(satNumber));
            writeJson(response, 200, {
              verified,
              ...(attestations.length > 0 ? { attested: true } : {}),
            });
            return;
          }

          const assetsMatch = url.pathname.match(/^\/v1\/collections\/([^/]+)\/assets$/);
          if (assetsMatch) {
            const collectionId = decodeURIComponent(assetsMatch[1] ?? "");
            const collection = listingStore.getCollection(collectionId);
            if (!collection) {
              writeJson(response, 404, { error: "collection not found" });
              return;
            }

            const cursorText = url.searchParams.get("cursor") ?? "0";
            const limitText = url.searchParams.get("limit") ?? "100";
            if (!/^\d+$/.test(cursorText)) {
              throw new ListingValidationError("cursor must be a non-negative integer");
            }

            const limit = Number.parseInt(limitText, 10);
            if (!Number.isInteger(limit) || limit < 0) {
              throw new ListingValidationError("limit must be a non-negative integer");
            }

            const page = listCollectionAssetsPage(collection, BigInt(cursorText), Math.min(limit, 10_000));
            writeJson(response, 200, {
              assets: page.assets,
              page: {
                next_cursor: page.nextCursor,
              },
              // Stub for Phase 2b: bounded scan instead of full index walk.
              stub_scan_window: {
                start_sat: page.scanStartSat,
                scanned: page.scanCount,
              },
            });
            return;
          }
        }

        if (method === "POST" && url.pathname === "/v1/attestations") {
          const body = (await readJsonBody(request)) as Record<string, unknown>;
          const attestationId = ensureNonEmptyString(body.attestation_id, "attestation_id");
          const subjectSat = ensureInteger(body.subject_sat, "subject_sat");
          const claim = ensureNonEmptyString(body.claim, "claim");
          const issuerPubkey = ensureNonEmptyString(body.issuer_pubkey, "issuer_pubkey");
          const signature = ensureNonEmptyString(body.signature, "signature");
          const expiresAtRaw = body.expires_at;
          const expiresAt =
            expiresAtRaw === null || expiresAtRaw === undefined
              ? null
              : ensureNonEmptyString(expiresAtRaw, "expires_at");

          const signatureValid = verifyAttestationSignature({
            subject_sat: subjectSat,
            claim,
            expires_at: expiresAt,
            issuer_pubkey: issuerPubkey,
            signature,
          });
          if (!signatureValid) {
            throw new ListingValidationError("invalid attestation signature");
          }

          listingStore.insertAttestation(
            createAttestationRecord({
              attestation_id: attestationId,
              subject_sat: subjectSat,
              claim,
              issuer_pubkey: issuerPubkey,
              signature,
              expires_at: expiresAt,
              created_at: now().toISOString(),
            }),
          );

          writeJson(response, 201, { stored: true });
          return;
        }

        if (method === "GET" && url.pathname.startsWith("/v1/attestations/")) {
          const satNumberText = url.pathname.replace("/v1/attestations/", "");
          if (!/^\d+$/.test(satNumberText)) {
            throw new ListingValidationError("sat number must be a non-negative integer");
          }

          const subjectSat = Number.parseInt(satNumberText, 10);
          const attestations = listingStore.listAttestationsBySat(subjectSat);
          writeJson(response, 200, { attestations });
          return;
        }

        if (method === "POST" && url.pathname === "/v1/psbt/validate") {
          const body = (await readJsonBody(request)) as Record<string, unknown>;
          const listingId = ensureNonEmptyString(body.listing_id, "listing_id");
          const psbtBase64 = ensureNonEmptyString(body.psbt_base64, "psbt_base64");
          const listing = listingStore.getListing(listingId);

          if (!listing || listing.cancelled) {
            throw new ListingValidationError("listing not found");
          }

          if (!listing.outpoint) {
            throw new ListingValidationError("listing outpoint is missing");
          }

          const validation = validateCanonicalTwoBumpFillPsbt(
            psbtBase64,
            listing.outpoint,
            listing.price_sats,
            dustPolicy,
          );

          writeJson(response, 200, {
            valid: true,
            summary: {
              seller_input_index: validation.sellerInputIndex,
              buyer_input_count: validation.buyerInputCount,
            },
          });
          return;
        }

        if (method === "POST" && url.pathname === "/v1/psbt/template") {
          const body = (await readJsonBody(request)) as Record<string, unknown>;
          const listingId = ensureNonEmptyString(body.listing_id, "listing_id");
          const bumpInputs = parseTemplateInputArray(body.bump_inputs, "bump_inputs");
          const fundingInputs = parseTemplateInputArray(body.funding_inputs, "funding_inputs");
          const buyerBumpScriptPubkeyHex = ensureNonEmptyString(
            body.buyer_bump_script_pubkey_hex,
            "buyer_bump_script_pubkey_hex",
          );
          const buyerAssetScriptPubkeyHex = ensureNonEmptyString(
            body.buyer_asset_script_pubkey_hex,
            "buyer_asset_script_pubkey_hex",
          );
          const buyerChangeScriptPubkeyHex = ensureNonEmptyString(
            body.buyer_change_script_pubkey_hex,
            "buyer_change_script_pubkey_hex",
          );
          const buyerChangeValueSats = ensureInteger(
            body.buyer_change_value_sats,
            "buyer_change_value_sats",
          );

          const listing = listingStore.getListing(listingId);
          if (!listing || listing.cancelled) {
            throw new ListingValidationError("listing not found");
          }

          if (!listing.outpoint) {
            throw new ListingValidationError("listing outpoint is missing");
          }

          const parsedListingPsbt = parseListingPsbt(listing.signed_psbt);
          if (
            parsedListingPsbt.input0WitnessUtxoValue === null ||
            parsedListingPsbt.input0WitnessUtxoScriptPubkeyHex === null
          ) {
            throw new ListingValidationError(
              "listing signed_psbt must include witness_utxo for seller input",
            );
          }

          const template = buildBuyerFillTemplatePsbt({
            sellerOutpoint: listing.outpoint,
            sellerInputValueSats: parsedListingPsbt.input0WitnessUtxoValue,
            sellerInputScriptPubkeyHex: parsedListingPsbt.input0WitnessUtxoScriptPubkeyHex,
            listingPriceSats: listing.price_sats,
            bumpInputs: bumpInputs.map((input) => ({
              outpoint: input.outpoint,
              valueSats: input.value_sats,
              scriptPubkeyHex: input.script_pubkey_hex,
            })),
            fundingInputs: fundingInputs.map((input) => ({
              outpoint: input.outpoint,
              valueSats: input.value_sats,
              scriptPubkeyHex: input.script_pubkey_hex,
            })),
            buyerBumpScriptPubkeyHex,
            buyerAssetScriptPubkeyHex,
            buyerChangeScriptPubkeyHex,
            buyerChangeValueSats,
          }, dustPolicy);

          writeJson(response, 200, {
            psbt_base64: template.psbtBase64,
            summary: {
              input_outpoints: template.inputOutpoints,
              output_values: template.outputValues,
            },
          });
          return;
        }

        writeJson(response, 404, { error: "Not found" });
      } catch (error) {
        if (
          error instanceof ListingValidationError ||
          error instanceof PsbtValidationError ||
          error instanceof DustValidationError
        ) {
          writeJson(response, 400, { error: error.message });
          return;
        }

        writeJson(response, 500, { error: "Internal server error" });
      }
    },
  };
}
