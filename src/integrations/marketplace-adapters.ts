import type { CreateListingRequest, ListingAssetType } from "../listing-types.ts";

type UnknownRecord = Record<string, unknown>;

/**
 * Caller-supplied overrides. Any field set here takes precedence over the
 * marketplace payload and is recorded in `source_fields` as `overrides.<field>`.
 *
 * Overrides are the reliable, zero-code-change integration path: a marketplace
 * whose payload does not match any known alias can still be normalized by
 * supplying the canonical values directly (see `mapGenericListingToCanonical`
 * and `integrations/generic/README.md`).
 */
export interface AdapterOverrides {
  asset_type?: ListingAssetType;
  sat_number?: number;
  outpoint?: string;
  price_sats?: number;
  seller_address?: string;
  signed_psbt?: string;
  expires_at?: string | null;
  // Range listings (asset_type="range"). Per ADR-0007 + the D3 pre-isolation
  // constraint, a range listing sells the WHOLE UTXO's contiguous sat span,
  // not an arbitrary sub-range: sellers must isolate the range into its own
  // UTXO first (enforced by ListingService, not here — adapters are pure
  // mappers). See integrations/*/README.md.
  sat_range_start?: number;
  sat_range_size?: number;
  // Discovery hints (values, not keys). Canonical sat_name/rarity are still
  // derived by /v1/assets/* from sat_number; these are upstream-supplied
  // provenance only.
  sat_name?: string;
  rarity?: string;
}

/**
 * Result of mapping a marketplace LISTING payload into the canonical
 * `CreateListingRequest`.
 *
 * - `listing` — the canonical create-listing request.
 * - `source_fields` — provenance map recording the source KEY name each
 *   canonical field was pulled from (or `overrides.<field>` / `override_only`).
 * - `metadata` — actual discovery VALUES (`sat_name`, `rarity`) lifted from the
 *   payload, plus the source key each value came from. `source_fields` records
 *   only the key name, so `metadata` is where the resolved values live.
 */
export interface MarketplaceAdapterResult {
  listing: CreateListingRequest;
  source_fields: {
    asset_type: string;
    sat_number: string;
    outpoint: string;
    price_sats: string;
    seller_address: string;
    signed_psbt: string;
    expires_at: string;
    sat_range_start: string;
    sat_range_size: string;
  };
  metadata: {
    sat_name?: string;
    rarity?: string;
    sat_name_source?: string;
    rarity_source?: string;
  };
}

interface FieldCandidates {
  asset_type: string[];
  sat_number: string[];
  outpoint: string[];
  price_sats: string[];
  seller_address: string[];
  signed_psbt: string[];
  expires_at: string[];
  sat_range_start: string[];
  sat_range_size: string[];
  sat_name: string[];
  rarity: string[];
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

function resolve(
  source: UnknownRecord,
  overrideValue: unknown,
  overrideKey: string,
  candidates: string[],
): { value: unknown; source: string } {
  if (overrideValue !== undefined) {
    return { value: overrideValue, source: overrideKey };
  }

  const found = extractFirst(source, candidates);
  return { value: found.value, source: found.key };
}

function normalizeListing(
  source: UnknownRecord,
  overrides: AdapterOverrides | undefined,
  fieldCandidates: FieldCandidates,
): MarketplaceAdapterResult {
  const assetTypeResolved = resolve(
    source,
    overrides?.asset_type,
    "overrides.asset_type",
    fieldCandidates.asset_type,
  );
  const assetType: ListingAssetType =
    assetTypeResolved.value === "range" || assetTypeResolved.value === "utxo"
      ? assetTypeResolved.value
      : "sat";

  const sat = resolve(source, overrides?.sat_number, "overrides.sat_number", fieldCandidates.sat_number);
  const outpoint = resolve(source, overrides?.outpoint, "overrides.outpoint", fieldCandidates.outpoint);
  const price = resolve(source, overrides?.price_sats, "overrides.price_sats", fieldCandidates.price_sats);
  const sellerAddress = resolve(
    source,
    overrides?.seller_address,
    "overrides.seller_address",
    fieldCandidates.seller_address,
  );
  const signedPsbt = resolve(
    source,
    overrides?.signed_psbt,
    "overrides.signed_psbt",
    fieldCandidates.signed_psbt,
  );
  const expiresAt = resolve(source, overrides?.expires_at, "overrides.expires_at", fieldCandidates.expires_at);
  const rangeStart = resolve(
    source,
    overrides?.sat_range_start,
    "overrides.sat_range_start",
    fieldCandidates.sat_range_start,
  );
  const rangeSize = resolve(
    source,
    overrides?.sat_range_size,
    "overrides.sat_range_size",
    fieldCandidates.sat_range_size,
  );
  const satName = resolve(source, overrides?.sat_name, "overrides.sat_name", fieldCandidates.sat_name);
  const rarity = resolve(source, overrides?.rarity, "overrides.rarity", fieldCandidates.rarity);

  const listing: CreateListingRequest = {
    asset_type: assetType,
    sat_number: ensureInteger(sat.value, "sat_number"),
    outpoint: ensureString(outpoint.value, "outpoint"),
    price_sats: ensureInteger(price.value, "price_sats"),
    seller_address: ensureString(sellerAddress.value, "seller_address"),
    signed_psbt: ensureString(signedPsbt.value, "signed_psbt"),
    expires_at:
      expiresAt.value === undefined || expiresAt.value === null
        ? null
        : ensureString(expiresAt.value, "expires_at"),
  };

  // Range listings carry the whole UTXO's sat span (pre-isolation constraint,
  // ADR-0007 / D3). We map the declared range through verbatim; the chain-state
  // guarantee (range == full UTXO) is enforced by ListingService, not here.
  if (assetType === "range") {
    listing.sat_range_start = ensureInteger(rangeStart.value, "sat_range_start");
    listing.sat_range_size = ensureInteger(rangeSize.value, "sat_range_size");
  } else {
    if (rangeStart.value !== undefined) {
      listing.sat_range_start = ensureInteger(rangeStart.value, "sat_range_start");
    }
    if (rangeSize.value !== undefined) {
      listing.sat_range_size = ensureInteger(rangeSize.value, "sat_range_size");
    }
  }

  const metadata: MarketplaceAdapterResult["metadata"] = {};
  if (satName.value !== undefined && satName.value !== null) {
    metadata.sat_name = String(satName.value);
    metadata.sat_name_source = satName.source;
  }
  if (rarity.value !== undefined && rarity.value !== null) {
    metadata.rarity = String(rarity.value);
    metadata.rarity_source = rarity.source;
  }

  return {
    listing,
    source_fields: {
      asset_type: assetTypeResolved.value !== undefined ? assetTypeResolved.source : "default_sat",
      sat_number: sat.source,
      outpoint: outpoint.source,
      price_sats: price.source,
      seller_address: sellerAddress.source,
      signed_psbt: signedPsbt.source,
      expires_at: expiresAt.source,
      sat_range_start: rangeStart.source,
      sat_range_size: rangeSize.source,
    },
    metadata,
  };
}

// Common aliases shared across marketplaces — the superset used by the generic
// adapter and reused as the base for per-marketplace adapters.
const COMMON_CANDIDATES: FieldCandidates = {
  asset_type: ["asset_type", "assetType", "type", "listingType", "kind"],
  sat_number: ["satNumber", "sat_number", "sat", "listedSatNumber", "satoshi", "ordinal", "sat_ordinal"],
  outpoint: ["outpoint", "assetOutpoint", "utxo", "utxoOutpoint", "location", "satpoint", "output"],
  price_sats: ["priceSats", "price_sats", "price", "listPriceSats", "unitPriceSats", "amount", "priceInSats"],
  seller_address: [
    "sellerPaymentAddress",
    "seller_address",
    "receiveAddress",
    "sellerAddress",
    "sellerReceiveAddress",
    "payoutAddress",
    "address",
  ],
  signed_psbt: [
    "signedPsbtBase64",
    "signed_psbt",
    "listingPsbtBase64",
    "psbtBase64",
    "psbt",
    "signedListingPsbt",
    "sellerPsbt",
  ],
  expires_at: ["expiresAt", "expires_at", "expiredAt", "expiry", "expiration"],
  sat_range_start: [
    "sat_range_start",
    "satRangeStart",
    "rangeStart",
    "range_start",
    "startSat",
    "start",
    "rangeFrom",
  ],
  sat_range_size: [
    "sat_range_size",
    "satRangeSize",
    "rangeSize",
    "range_size",
    "size",
    "satCount",
    "rangeLength",
  ],
  sat_name: ["sat_name", "satName", "name", "satNameLabel", "ordinalName", "displayName"],
  rarity: ["rarity", "satRarity", "satribute", "satributes", "rareType", "rarityTier", "tier"],
};

/**
 * @deprecated Magic Eden's Bitcoin ordinals marketplace has closed. This
 * mapping is retained for reference/back-compat only. New integrations should
 * use {@link mapGenericListingToCanonical} (with {@link AdapterOverrides} where
 * needed), the marketplace-neutral integration path.
 */
export function mapMagicEdenListingToCanonical(
  magicEdenPayload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(magicEdenPayload, overrides, {
    ...COMMON_CANDIDATES,
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
    ...COMMON_CANDIDATES,
    sat_number: ["satNumber", "sat_number", "sat", "listedSatNumber"],
    outpoint: ["outpoint", "assetOutpoint", "utxo", "utxoOutpoint"],
    price_sats: ["price_sats", "priceSats", "price", "unitPriceSats"],
    seller_address: ["seller_address", "sellerPaymentAddress", "receiveAddress", "sellerAddress"],
    signed_psbt: ["signed_psbt", "signedPsbtBase64", "psbtBase64", "psbt", "signedListingPsbt"],
    expires_at: ["expires_at", "expiresAt", "expiredAt"],
  });
}

/**
 * ILLUSTRATIVE BEST-EFFORT mapping for Satflow-shaped listing payloads.
 *
 * Satflow's ordinals marketplace wound down (2025) and never published a
 * pinned rare-sat / range listing-payload schema, so these candidate aliases
 * are historical/hypothesized, NOT verified against a live API. Do not assume
 * live-API compatibility. For a reliable integration prefer
 * {@link mapGenericListingToCanonical} plus {@link AdapterOverrides}. See
 * `integrations/satflow/README.md` and `docs/Marketplace Analysis.md`.
 */
export function mapSatflowListingToCanonical(
  satflowPayload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(satflowPayload, overrides, {
    ...COMMON_CANDIDATES,
    asset_type: ["assetType", "asset_type", "listingType", "type", "kind"],
    sat_number: ["satNumber", "sat", "sat_number", "satoshi", "ordinal"],
    outpoint: ["location", "outpoint", "satpoint", "utxo", "output"],
    price_sats: ["priceSats", "price", "amount", "price_sats", "listPriceSats"],
    seller_address: ["sellerAddress", "receiveAddress", "seller_address", "payoutAddress"],
    signed_psbt: ["sellerPsbt", "psbt", "signedPsbtBase64", "psbtBase64", "signed_psbt"],
    expires_at: ["expiresAt", "expiry", "expires_at"],
    sat_range_start: ["rangeStart", "startSat", "satRangeStart", "sat_range_start", "start"],
    sat_range_size: ["rangeSize", "satCount", "satRangeSize", "sat_range_size", "size"],
    sat_name: ["satName", "name", "sat_name", "ordinalName"],
    rarity: ["rarity", "satribute", "satributes", "rareType"],
  });
}

/**
 * ILLUSTRATIVE BEST-EFFORT mapping for ord.net-shaped listing payloads.
 *
 * ord.net is user-named but has no publicly pinned listing-payload schema, so
 * these candidate aliases are hypothesized, NOT verified against a live API.
 * Do not assume live-API compatibility. For a reliable integration prefer
 * {@link mapGenericListingToCanonical} plus {@link AdapterOverrides}. See
 * `integrations/ord-net/README.md` and `docs/Marketplace Analysis.md`.
 */
export function mapOrdNetListingToCanonical(
  ordNetPayload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(ordNetPayload, overrides, {
    ...COMMON_CANDIDATES,
    asset_type: ["type", "assetType", "asset_type", "kind"],
    sat_number: ["sat", "satNumber", "ordinal", "sat_number", "satoshi"],
    outpoint: ["satpoint", "location", "outpoint", "output", "utxo"],
    price_sats: ["priceInSats", "priceSats", "price", "price_sats", "amount"],
    seller_address: ["sellerReceiveAddress", "sellerAddress", "address", "seller_address"],
    signed_psbt: ["psbt", "signedPsbtBase64", "psbtBase64", "signed_psbt", "sellerPsbt"],
    expires_at: ["expiration", "expiresAt", "expiry", "expires_at"],
    sat_range_start: ["rangeFrom", "rangeStart", "startSat", "sat_range_start", "start"],
    sat_range_size: ["rangeLength", "rangeSize", "satCount", "sat_range_size", "size"],
    sat_name: ["name", "satName", "displayName", "sat_name"],
    rarity: ["rarity", "rarityTier", "satribute", "tier"],
  });
}

/**
 * The core neutrality primitive: map ANY marketplace's listing payload using a
 * superset of common aliases across marketplaces, plus {@link AdapterOverrides}.
 *
 * An unlisted marketplace integrates with ZERO code changes by either matching
 * a common field name or supplying overrides for the canonical values. This is
 * the recommended, reliable integration path (see
 * `integrations/generic/README.md` and `integrations/README.md`). Adapters are
 * pure payload mappers — this function calls no external API.
 */
export function mapGenericListingToCanonical(
  payload: UnknownRecord,
  overrides?: AdapterOverrides,
): MarketplaceAdapterResult {
  return normalizeListing(payload, overrides, COMMON_CANDIDATES);
}
