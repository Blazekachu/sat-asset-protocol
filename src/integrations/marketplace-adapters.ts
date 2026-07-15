import type { CreateListingRequest } from "../listing-types.ts";

type UnknownRecord = Record<string, unknown>;

export interface AdapterOverrides {
  sat_number?: number;
  outpoint?: string;
  price_sats?: number;
  seller_address?: string;
  signed_psbt?: string;
  expires_at?: string | null;
}

export interface MarketplaceAdapterResult {
  listing: CreateListingRequest;
  source_fields: {
    sat_number: string;
    outpoint: string;
    price_sats: string;
    seller_address: string;
    signed_psbt: string;
    expires_at: string;
  };
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }

  return value;
}

function ensureInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`${field} must be an integer`);
}

function extractFirst(record: UnknownRecord, candidates: string[]): { value: unknown; key: string } {
  for (const key of candidates) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return { value, key };
    }
  }

  return { value: undefined, key: "override_only" };
}

function normalizeListing(
  source: UnknownRecord,
  overrides: AdapterOverrides | undefined,
  fieldCandidates: {
    sat_number: string[];
    outpoint: string[];
    price_sats: string[];
    seller_address: string[];
    signed_psbt: string[];
    expires_at: string[];
  },
): MarketplaceAdapterResult {
  const sat = overrides?.sat_number ?? extractFirst(source, fieldCandidates.sat_number).value;
  const outpoint = overrides?.outpoint ?? extractFirst(source, fieldCandidates.outpoint).value;
  const price = overrides?.price_sats ?? extractFirst(source, fieldCandidates.price_sats).value;
  const sellerAddress =
    overrides?.seller_address ?? extractFirst(source, fieldCandidates.seller_address).value;
  const signedPsbt =
    overrides?.signed_psbt ?? extractFirst(source, fieldCandidates.signed_psbt).value;
  const expiresAt = overrides?.expires_at ?? extractFirst(source, fieldCandidates.expires_at).value;

  const satSource = overrides?.sat_number !== undefined
    ? "overrides.sat_number"
    : extractFirst(source, fieldCandidates.sat_number).key;
  const outpointSource = overrides?.outpoint !== undefined
    ? "overrides.outpoint"
    : extractFirst(source, fieldCandidates.outpoint).key;
  const priceSource = overrides?.price_sats !== undefined
    ? "overrides.price_sats"
    : extractFirst(source, fieldCandidates.price_sats).key;
  const sellerAddressSource = overrides?.seller_address !== undefined
    ? "overrides.seller_address"
    : extractFirst(source, fieldCandidates.seller_address).key;
  const signedPsbtSource = overrides?.signed_psbt !== undefined
    ? "overrides.signed_psbt"
    : extractFirst(source, fieldCandidates.signed_psbt).key;
  const expiresAtSource = overrides?.expires_at !== undefined
    ? "overrides.expires_at"
    : extractFirst(source, fieldCandidates.expires_at).key;

  const listing: CreateListingRequest = {
    asset_type: "sat",
    sat_number: ensureInteger(sat, "sat_number"),
    outpoint: ensureString(outpoint, "outpoint"),
    price_sats: ensureInteger(price, "price_sats"),
    seller_address: ensureString(sellerAddress, "seller_address"),
    signed_psbt: ensureString(signedPsbt, "signed_psbt"),
    expires_at:
      expiresAt === undefined || expiresAt === null
        ? null
        : ensureString(expiresAt, "expires_at"),
  };

  return {
    listing,
    source_fields: {
      sat_number: satSource,
      outpoint: outpointSource,
      price_sats: priceSource,
      seller_address: sellerAddressSource,
      signed_psbt: signedPsbtSource,
      expires_at: expiresAtSource,
    },
  };
}

export function mapMagicEdenListingToCanonical(
  magicEdenPayload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(magicEdenPayload, overrides, {
    sat_number: ["satNumber", "sat_number", "sat", "listedSatNumber"],
    outpoint: ["assetOutpoint", "outpoint", "utxo", "utxoOutpoint"],
    price_sats: ["priceSats", "price_sats", "price", "listPriceSats"],
    seller_address: ["sellerPaymentAddress", "seller_address", "receiveAddress", "sellerAddress"],
    signed_psbt: ["signedPsbtBase64", "signed_psbt", "listingPsbtBase64", "psbtBase64", "psbt"],
    expires_at: ["expiresAt", "expires_at"],
  });
}

export function mapUniSatCreatePutOnToCanonical(
  unisatPayload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(unisatPayload, overrides, {
    sat_number: ["satNumber", "sat_number", "sat", "listedSatNumber"],
    outpoint: ["outpoint", "assetOutpoint", "utxo", "utxoOutpoint"],
    price_sats: ["price_sats", "priceSats", "price", "unitPriceSats"],
    seller_address: ["seller_address", "sellerPaymentAddress", "receiveAddress", "sellerAddress"],
    signed_psbt: ["signed_psbt", "signedPsbtBase64", "psbtBase64", "psbt", "signedListingPsbt"],
    expires_at: ["expires_at", "expiresAt", "expiredAt"],
  });
}
