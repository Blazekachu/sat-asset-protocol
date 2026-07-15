import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createAttestationRecord, verifyAttestationSignature } from "./attestations.ts";
import {
  evaluateCollectionPredicate,
  listCollectionAssetsPage,
  rarityOfSat,
  satName,
} from "./collections.ts";
import { loadConfig, type ProtocolConfig } from "./config.ts";
import { DustValidationError } from "./dust.ts";
import { ListingService, ListingValidationError, type ListingOrdClient } from "./listing-service.ts";
import { SqliteListingStore } from "./listing-store.ts";
import type { CreateListingRequest, CreateOfferRequest, ListingStore } from "./listing-types.ts";
import { OfferNotFoundError, OfferService } from "./offer-service.ts";
import {
  buildBuyerFillTemplatePsbt,
  parseListingPsbt,
  PsbtValidationError,
  validateCanonicalTwoBumpFillPsbt,
} from "./psbt.ts";
import { buildSatForSatOfferPsbt, type SatForSatAssetSide } from "./sat-for-sat.ts";
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
  createOfferId?: () => string;
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

function parseTemplateInput(value: unknown, fieldName: string): TemplateInputPayload {
  if (!value || typeof value !== "object") {
    throw new ListingValidationError(`${fieldName} must be an object`);
  }

  const outpoint = ensureNonEmptyString(
    (value as Record<string, unknown>).outpoint,
    `${fieldName}.outpoint`,
  );
  const valueSats = ensureInteger(
    (value as Record<string, unknown>).value_sats,
    `${fieldName}.value_sats`,
  );
  const scriptPubkeyHex = ensureNonEmptyString(
    (value as Record<string, unknown>).script_pubkey_hex,
    `${fieldName}.script_pubkey_hex`,
  );

  return { outpoint, value_sats: valueSats, script_pubkey_hex: scriptPubkeyHex };
}

function parseSatForSatSide(value: unknown, fieldName: string): SatForSatAssetSide {
  if (!value || typeof value !== "object") {
    throw new ListingValidationError(`${fieldName} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const bumpInput = parseTemplateInput(record.bump_input, `${fieldName}.bump_input`);
  const assetInput = parseTemplateInput(record.asset_input, `${fieldName}.asset_input`);
  const changeScriptPubkeyHex = ensureNonEmptyString(
    record.change_script_pubkey_hex,
    `${fieldName}.change_script_pubkey_hex`,
  );
  const counterpartyOrdinalsScriptPubkeyHex = ensureNonEmptyString(
    record.counterparty_ordinals_script_pubkey_hex,
    `${fieldName}.counterparty_ordinals_script_pubkey_hex`,
  );

  return {
    bumpInput: {
      outpoint: bumpInput.outpoint,
      valueSats: bumpInput.value_sats,
      scriptPubkeyHex: bumpInput.script_pubkey_hex,
    },
    assetInput: {
      outpoint: assetInput.outpoint,
      valueSats: assetInput.value_sats,
      scriptPubkeyHex: assetInput.script_pubkey_hex,
    },
    changeScriptPubkeyHex,
    counterpartyOrdinalsScriptPubkeyHex,
  };
}

// Rarity ordering, mirroring collections.ts's private rarityRank, used to
// filter/annotate discovery results by minimum rarity.
const RARITY_RANK: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

interface AnnotatedListing {
  listing_id: string;
  asset_type: CreateListingRequest["asset_type"];
  sat_number: number | null;
  sat_name: string | null;
  rarity: keyof typeof RARITY_RANK | null;
  outpoint: string | null;
  price_sats: number;
  seller_address: string;
  signed_psbt: string;
  created_at: string;
  expires_at: string | null;
  cancelled: boolean;
  sat_range_start: number | null;
  sat_range_size: number | null;
}

function annotateListing(listing: {
  listing_id: string;
  asset_type: CreateListingRequest["asset_type"];
  sat_number: number | null;
  outpoint: string | null;
  price_sats: number;
  seller_address: string;
  signed_psbt: string;
  created_at: string;
  expires_at: string | null;
  cancelled: boolean;
  sat_range_start: number | null;
  sat_range_size: number | null;
}): AnnotatedListing {
  const sat_name = listing.sat_number === null ? null : satName(BigInt(listing.sat_number));
  const rarity =
    listing.sat_number === null
      ? null
      : (rarityOfSat(BigInt(listing.sat_number)) as keyof typeof RARITY_RANK);

  return { ...listing, sat_name, rarity };
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
  const offerService = new OfferService({
    store: listingStore,
    ordClient: dependencies.ordClient,
    now: dependencies.now,
    createOfferId: dependencies.createOfferId,
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

        if (method === "POST" && url.pathname === "/v1/sat-for-sat/offers/template") {
          const body = (await readJsonBody(request)) as Record<string, unknown>;
          const partyA = parseSatForSatSide(body.party_a, "party_a");
          const partyB = parseSatForSatSide(body.party_b, "party_b");
          const feeFundingInput = parseTemplateInput(body.fee_funding_input, "fee_funding_input");
          const feePayerChangeScriptPubkeyHex = ensureNonEmptyString(
            body.fee_payer_change_script_pubkey_hex,
            "fee_payer_change_script_pubkey_hex",
          );
          const feePayerChangeValueSats = ensureInteger(
            body.fee_payer_change_value_sats,
            "fee_payer_change_value_sats",
          );

          const template = buildSatForSatOfferPsbt({
            partyA,
            partyB,
            feeFundingInput: {
              outpoint: feeFundingInput.outpoint,
              valueSats: feeFundingInput.value_sats,
              scriptPubkeyHex: feeFundingInput.script_pubkey_hex,
            },
            feePayerChangeScriptPubkeyHex,
            feePayerChangeValueSats,
            dustPolicy,
          });

          writeJson(response, 200, {
            psbt_base64: template.psbtBase64,
            summary: {
              input_outpoints: template.inputOutpoints,
              output_values: template.outputValues,
            },
          });
          return;
        }

        if (method === "POST" && url.pathname === "/v1/sat-for-sat/offers") {
          const body = (await readJsonBody(request)) as CreateOfferRequest;
          const offer = await offerService.createOffer(body);
          writeJson(response, 201, { offer });
          return;
        }

        {
          const acceptMatch = url.pathname.match(
            /^\/v1\/sat-for-sat\/offers\/([^/]+)\/accept$/,
          );
          if (method === "POST" && acceptMatch) {
            const offerId = decodeURIComponent(acceptMatch[1] ?? "");
            const body = (await readJsonBody(request)) as Record<string, unknown>;
            const acceptPsbt = ensureNonEmptyString(body.accept_psbt, "accept_psbt");
            const offer = await offerService.acceptOffer(offerId, acceptPsbt);
            writeJson(response, 200, { offer });
            return;
          }

          const offerMatch = url.pathname.match(/^\/v1\/sat-for-sat\/offers\/([^/]+)$/);
          if (method === "GET" && offerMatch) {
            const offerId = decodeURIComponent(offerMatch[1] ?? "");
            const offer = offerService.getOffer(offerId);
            if (!offer) {
              writeJson(response, 404, { error: "offer not found" });
              return;
            }

            writeJson(response, 200, { offer });
            return;
          }
        }

        if (method === "GET" && url.pathname === "/v1/assets/search") {
          const namePrefix = url.searchParams.get("name_prefix") ?? undefined;
          const minRarity = url.searchParams.get("rarity") ?? undefined;
          const satNumberFilter = parseOptionalIntQueryParam(url, "sat_number");

          const assetTypeText = url.searchParams.get("asset_type");
          let assetTypeFilter: CreateListingRequest["asset_type"] | undefined;
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

            assetTypeFilter = assetTypeText;
          }

          if (minRarity !== undefined && !(minRarity.toLowerCase() in RARITY_RANK)) {
            throw new ListingValidationError("rarity query param is invalid");
          }

          const minRarityRank =
            minRarity === undefined ? null : RARITY_RANK[minRarity.toLowerCase()];

          const assets = listingService
            .listOpenListings()
            .map((listing) => annotateListing(listing))
            .filter((asset) => {
              if (assetTypeFilter !== undefined && asset.asset_type !== assetTypeFilter) {
                return false;
              }

              if (satNumberFilter !== undefined && asset.sat_number !== satNumberFilter) {
                return false;
              }

              if (namePrefix !== undefined && namePrefix !== "") {
                if (asset.sat_name === null || !asset.sat_name.startsWith(namePrefix)) {
                  return false;
                }
              }

              if (minRarityRank !== null) {
                if (asset.rarity === null || RARITY_RANK[asset.rarity] < minRarityRank) {
                  return false;
                }
              }

              return true;
            });

          writeJson(response, 200, { assets });
          return;
        }

        {
          const rangeMatch = url.pathname.match(/^\/v1\/assets\/range\/(\d+)\/(\d+)$/);
          if (method === "GET" && rangeMatch) {
            const start = Number.parseInt(rangeMatch[1] ?? "0", 10);
            const end = Number.parseInt(rangeMatch[2] ?? "0", 10);
            if (start >= end) {
              throw new ListingValidationError("range start must be less than end");
            }

            const listings = listingService.listOpenListings().filter((listing) => {
              if (listing.asset_type === "sat") {
                return (
                  listing.sat_number !== null &&
                  listing.sat_number >= start &&
                  listing.sat_number < end
                );
              }

              if (listing.asset_type === "range") {
                if (listing.sat_range_start === null || listing.sat_range_size === null) {
                  return false;
                }

                const rangeStart = listing.sat_range_start;
                const rangeEnd = listing.sat_range_start + listing.sat_range_size;
                // Overlap of [rangeStart, rangeEnd) with [start, end).
                return rangeStart < end && start < rangeEnd;
              }

              return false;
            });

            writeJson(response, 200, { range: { start, end }, listings });
            return;
          }
        }

        {
          const assetMatch = url.pathname.match(/^\/v1\/assets\/(\d+)$/);
          if (method === "GET" && assetMatch) {
            const satNumber = Number.parseInt(assetMatch[1] ?? "0", 10);
            const satBigInt = BigInt(assetMatch[1] ?? "0");
            const sat_name = satName(satBigInt);
            const rarity = rarityOfSat(satBigInt);

            const listings = listingService.listOpenListings({ sat_number: satNumber });
            const offers = offerService.listOffers({
              taker_sat_number: satNumber,
              status: "open",
            });

            // Custody satpoint is optional: include it only if a sat-capable
            // ord client resolves it. Works offline (no verify node) too.
            let custody: string | undefined;
            for (const client of verifyOrdClients) {
              try {
                const sat = await client.sat(satNumber);
                if (sat.satpoint) {
                  custody = sat.satpoint;
                  break;
                }
              } catch {
                // No sat-capable client available; leave custody undefined.
              }
            }

            writeJson(response, 200, {
              sat_number: satNumber,
              sat_name,
              rarity,
              ...(custody !== undefined ? { custody } : {}),
              listings,
              offers,
            });
            return;
          }
        }

        writeJson(response, 404, { error: "Not found" });
      } catch (error) {
        if (error instanceof OfferNotFoundError) {
          writeJson(response, 404, { error: error.message });
          return;
        }

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
