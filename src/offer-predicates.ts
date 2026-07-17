// Sat-for-sat "want" predicate + asset-reference matching (WS-A, RD1).
//
// A sat-for-sat intent advertises what the maker gives and what they want. The
// want side is either an enumerated set of specific sats/ranges (`mode:
// "specific"`) or a math-verifiable predicate with a required cardinality
// (`mode: "predicate"`). This module normalizes/validates want specs and asset
// references and provides the authoritative multiset matcher used by
// `respondToIntent`.
//
// Predicate consideration is deliberately restricted to "any N *sats*
// satisfying P": a range's per-sat membership is not evaluated, so a range
// asset is rejected against a predicate (finding 4). Only the predicate types
// `evaluateCollectionPredicate` actually implements are accepted; the
// declared-but-unimplemented types are rejected up-front (finding: RD1).

import { evaluateCollectionPredicate } from "./collections.ts";
import { ListingValidationError } from "./listing-service.ts";
import type {
  CollectionPredicateType,
  CollectionRecord,
  OfferAssetRef,
  WantPredicate,
  WantSpec,
} from "./listing-types.ts";

// Predicate types `evaluateCollectionPredicate` implements. The remaining
// declared types (mining_pool/historical_event/institution_certified/
// user_defined) are rejected by `normalizeWantPredicate`.
const IMPLEMENTED_PREDICATE_TYPES: ReadonlySet<CollectionPredicateType> = new Set([
  "sat_number",
  "sat_range",
  "block_range",
  "epoch",
  "rarity",
  "name_prefix",
]);

function ensureInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ListingValidationError(`${field} must be an integer`);
  }
  return value;
}

/**
 * Validate a single {@link OfferAssetRef}: asset_type + required sat/range
 * fields, and (for ranges) a positive whole-UTXO span. Does NOT hit ord — the
 * offset-0/live-span checks live in the service layer.
 */
export function normalizeAssetRef(input: unknown, field: string): OfferAssetRef {
  if (!input || typeof input !== "object") {
    throw new ListingValidationError(`${field} must be an object`);
  }

  const raw = input as Record<string, unknown>;
  const assetType = raw.asset_type;
  if (assetType !== "sat" && assetType !== "range") {
    throw new ListingValidationError(`${field}.asset_type must be "sat" or "range"`);
  }

  const outpoint =
    raw.asset_outpoint === null || raw.asset_outpoint === undefined
      ? null
      : String(raw.asset_outpoint);

  if (assetType === "sat") {
    const satNumber = ensureInt(raw.sat_number, `${field}.sat_number`);
    if (satNumber < 0) {
      throw new ListingValidationError(`${field}.sat_number must be >= 0`);
    }
    return { asset_type: "sat", asset_outpoint: outpoint, sat_number: satNumber };
  }

  const rangeStart = ensureInt(raw.sat_range_start, `${field}.sat_range_start`);
  const rangeSize = ensureInt(raw.sat_range_size, `${field}.sat_range_size`);
  if (rangeStart < 0) {
    throw new ListingValidationError(`${field}.sat_range_start must be >= 0`);
  }
  if (rangeSize < 1) {
    throw new ListingValidationError(`${field}.sat_range_size must be >= 1`);
  }
  return {
    asset_type: "range",
    asset_outpoint: outpoint,
    sat_number: rangeStart,
    sat_range_start: rangeStart,
    sat_range_size: rangeSize,
  };
}

/** Dedupe key: sat_number for sats, start:size for ranges. */
function assetRefKey(ref: OfferAssetRef): string {
  if (ref.asset_type === "range") {
    return `range:${ref.sat_range_start}:${ref.sat_range_size}`;
  }
  return `sat:${ref.sat_number}`;
}

/**
 * Validate a {@link WantPredicate}: `type` must be an implemented
 * {@link CollectionPredicateType}; `params` are shallow-validated per type
 * (field names mirror collections.ts). Rejects the unimplemented types.
 */
export function normalizeWantPredicate(input: unknown): WantPredicate {
  if (!input || typeof input !== "object") {
    throw new ListingValidationError("want_spec.predicate must be an object");
  }

  const raw = input as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== "string" || !IMPLEMENTED_PREDICATE_TYPES.has(type as CollectionPredicateType)) {
    throw new ListingValidationError(
      `want_spec.predicate.type must be one of ${[...IMPLEMENTED_PREDICATE_TYPES].join(", ")}`,
    );
  }

  const params = raw.params;
  if (!params || typeof params !== "object") {
    throw new ListingValidationError("want_spec.predicate.params must be an object");
  }

  const p = params as Record<string, unknown>;
  const requireIntish = (name: string): void => {
    const v = p[name];
    const ok =
      (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
      (typeof v === "string" && /^\d+$/.test(v));
    if (!ok) {
      throw new ListingValidationError(
        `want_spec.predicate.params.${name} must be a non-negative integer`,
      );
    }
  };
  const requireNonEmptyString = (name: string): void => {
    if (typeof p[name] !== "string" || (p[name] as string).length === 0) {
      throw new ListingValidationError(
        `want_spec.predicate.params.${name} must be a non-empty string`,
      );
    }
  };

  switch (type as CollectionPredicateType) {
    case "sat_number":
      requireIntish("number");
      break;
    case "sat_range":
      requireIntish("start");
      requireIntish("end");
      break;
    case "block_range":
      requireIntish("start_height");
      requireIntish("end_height");
      break;
    case "epoch":
      requireIntish("epoch");
      break;
    case "rarity":
      requireNonEmptyString("min_rarity");
      break;
    case "name_prefix":
      requireNonEmptyString("prefix");
      break;
    default:
      // Unreachable: guarded by IMPLEMENTED_PREDICATE_TYPES above.
      throw new ListingValidationError("want_spec.predicate.type is not supported");
  }

  return { type: type as CollectionPredicateType, params: { ...p } };
}

/**
 * Normalize + validate a {@link WantSpec}. For `mode:"specific"` each ref is
 * validated and the set must be non-empty with no duplicate refs. For
 * `mode:"predicate"` the predicate is validated and `count` must be an integer
 * >= 1.
 */
export function normalizeWantSpec(input: unknown): WantSpec {
  if (!input || typeof input !== "object") {
    throw new ListingValidationError("want_spec must be an object");
  }

  const raw = input as Record<string, unknown>;
  const mode = raw.mode;

  if (mode === "specific") {
    if (!Array.isArray(raw.assets) || raw.assets.length === 0) {
      throw new ListingValidationError("want_spec.assets must be a non-empty array");
    }
    const assets = raw.assets.map((entry, index) =>
      normalizeAssetRef(entry, `want_spec.assets[${index}]`),
    );
    const seen = new Set<string>();
    for (const ref of assets) {
      const key = assetRefKey(ref);
      if (seen.has(key)) {
        throw new ListingValidationError("want_spec.assets must not contain duplicate refs");
      }
      seen.add(key);
    }
    return { mode: "specific", assets };
  }

  if (mode === "predicate") {
    const predicate = normalizeWantPredicate(raw.predicate);
    const count = ensureInt(raw.count, "want_spec.count");
    if (count < 1) {
      throw new ListingValidationError("want_spec.count must be >= 1");
    }
    return { mode: "predicate", predicate, count };
  }

  throw new ListingValidationError('want_spec.mode must be "specific" or "predicate"');
}

/**
 * Exact match of an asset against a specific reference: sat_number equality for
 * sats, start+size equality for ranges. A sat ref never matches a range asset
 * and vice versa.
 */
export function assetMatchesRef(ref: OfferAssetRef, asset: OfferAssetRef): boolean {
  if (ref.asset_type !== asset.asset_type) {
    return false;
  }
  if (ref.asset_type === "range") {
    return (
      ref.sat_range_start === asset.sat_range_start &&
      ref.sat_range_size === asset.sat_range_size
    );
  }
  return ref.sat_number === asset.sat_number;
}

/**
 * True when a single sat asset satisfies the predicate. Rejects
 * `asset_type="range"` with a {@link ListingValidationError} (finding 4:
 * predicate consideration is "any N *sats* satisfying P"; a range's per-sat
 * membership is not evaluated).
 */
export function assetSatisfiesPredicate(
  predicate: WantPredicate,
  asset: OfferAssetRef,
): boolean {
  if (asset.asset_type === "range") {
    throw new ListingValidationError(
      "predicate want does not accept range assets (predicate matches single sats only)",
    );
  }
  const satNumber = ensureInt(asset.sat_number, "asset.sat_number");
  const record: CollectionRecord = {
    collection_id: "ephemeral",
    name: "ephemeral",
    predicate_type: predicate.type,
    predicate_params: predicate.params,
  };
  return evaluateCollectionPredicate(record, BigInt(satNumber));
}

/**
 * The half-open sat span `[start, end)` covered by an asset reference: a single
 * sat occupies `[n, n+1)`; a range occupies `[start, start+size)`. Used by the
 * bid-fill containment/overlap checks (WS-D, ADR-0019).
 */
export function assetRefSpan(ref: OfferAssetRef): { start: number; end: number } {
  if (ref.asset_type === "range") {
    const start = ref.sat_range_start ?? ref.sat_number ?? 0;
    const size = ref.sat_range_size ?? 1;
    return { start, end: start + size };
  }
  const start = ref.sat_number ?? 0;
  return { start, end: start + 1 };
}

/** True when two asset references' sat spans overlap (half-open intervals). */
export function assetSpansOverlap(a: OfferAssetRef, b: OfferAssetRef): boolean {
  const sa = assetRefSpan(a);
  const sb = assetRefSpan(b);
  return sa.start < sb.end && sb.start < sa.end;
}

/**
 * Bid-fill want matcher (WS-D, ADR-0019) — distinct from the exact-match
 * {@link assetsSatisfyWant}, because a fill may deliver a *subset* of a wanted
 * range and fills accumulate. Returns `{ ok: true }` or throws
 * {@link ListingValidationError}.
 *
 * - `mode:"specific"`: `sellerAsset` must be FULLY CONTAINED within one wanted
 *   range/ref (`start >= wanted_start AND start+size <= wanted_start+wanted_size`).
 * - `mode:"predicate"`: `sellerAsset` must satisfy the predicate per sat (range
 *   assets are rejected by {@link assetSatisfiesPredicate}).
 *
 * In both modes the fill must NOT overlap any range already recorded in
 * `alreadyFilled` (the bid's reserved/settled fill ledger).
 */
export function bidFillMatchesWant(
  spec: WantSpec,
  sellerAsset: OfferAssetRef,
  alreadyFilled: OfferAssetRef[],
): { ok: true } {
  for (const filled of alreadyFilled) {
    if (assetSpansOverlap(sellerAsset, filled)) {
      throw new ListingValidationError(
        "bid fill overlaps a sat/range already filled on this bid",
      );
    }
  }

  if (spec.mode === "specific") {
    const seller = assetRefSpan(sellerAsset);
    const contained = spec.assets.some((wanted) => {
      const w = assetRefSpan(wanted);
      return seller.start >= w.start && seller.end <= w.end;
    });
    if (!contained) {
      throw new ListingValidationError(
        "bid fill asset is not fully contained within any wanted range/ref",
      );
    }
    return { ok: true };
  }

  // predicate mode — assetSatisfiesPredicate rejects range assets itself.
  if (!assetSatisfiesPredicate(spec.predicate, sellerAsset)) {
    throw new ListingValidationError(
      "bid fill asset does not satisfy the bid predicate",
    );
  }
  return { ok: true };
}

/**
 * Authoritative want check used by `respondToIntent`. Returns `{ ok: true }`
 * or throws {@link ListingValidationError} with the specific reason.
 *
 * - `mode:"specific"`: `takerAssets` must be an exact multiset match of
 *   `spec.assets` — same length, greedy one-to-one pairing over
 *   {@link assetMatchesRef}, no extras, no asset matched twice.
 * - `mode:"predicate"`: `takerAssets.length === spec.count`, all refs unique,
 *   and every asset passes {@link assetSatisfiesPredicate} (rejects ranges).
 */
export function assetsSatisfyWant(
  spec: WantSpec,
  takerAssets: OfferAssetRef[],
): { ok: true } {
  if (spec.mode === "specific") {
    if (takerAssets.length < spec.assets.length) {
      throw new ListingValidationError(
        `want mismatch: expected ${spec.assets.length} asset(s), got ${takerAssets.length} (too few)`,
      );
    }
    if (takerAssets.length > spec.assets.length) {
      throw new ListingValidationError(
        `want mismatch: expected ${spec.assets.length} asset(s), got ${takerAssets.length} (too many)`,
      );
    }

    const consumed = new Array<boolean>(takerAssets.length).fill(false);
    for (const ref of spec.assets) {
      const matchIndex = takerAssets.findIndex(
        (asset, index) => !consumed[index] && assetMatchesRef(ref, asset),
      );
      if (matchIndex === -1) {
        throw new ListingValidationError(
          "want mismatch: a requested asset is not present in the taker assets",
        );
      }
      consumed[matchIndex] = true;
    }
    return { ok: true };
  }

  // predicate mode
  if (takerAssets.length !== spec.count) {
    throw new ListingValidationError(
      `want mismatch: predicate want requires exactly ${spec.count} asset(s), got ${takerAssets.length}`,
    );
  }

  const seen = new Set<string>();
  for (const asset of takerAssets) {
    const key = assetRefKey(asset);
    if (seen.has(key)) {
      throw new ListingValidationError("want mismatch: taker assets must be unique");
    }
    seen.add(key);
    if (!assetSatisfiesPredicate(spec.predicate, asset)) {
      throw new ListingValidationError(
        "want mismatch: a taker asset does not satisfy the predicate",
      );
    }
  }
  return { ok: true };
}
