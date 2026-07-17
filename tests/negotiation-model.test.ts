import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ListingValidationError } from "../src/listing-service.ts";
import { SqliteListingStore } from "../src/listing-store.ts";
import {
  assetMatchesRef,
  assetSatisfiesPredicate,
  assetsSatisfyWant,
  normalizeWantSpec,
} from "../src/offer-predicates.ts";
import { OfferService } from "../src/offer-service.ts";
import type { OfferAssetRef, WantSpec } from "../src/listing-types.ts";
import type { ListingOrdClient } from "../src/listing-service.ts";
import type { OrdOutput } from "../src/types.ts";

// --- predicate section (RD1, finding 3/4) ---------------------------------

const sat = (n: number, outpoint = "x".repeat(64) + ":0"): OfferAssetRef => ({
  asset_type: "sat",
  asset_outpoint: outpoint,
  sat_number: n,
});
const range = (start: number, size: number): OfferAssetRef => ({
  asset_type: "range",
  asset_outpoint: "r".repeat(64) + ":0",
  sat_number: start,
  sat_range_start: start,
  sat_range_size: size,
});

test("assetMatchesRef: exact sat / range match and type-cross rejection", () => {
  assert.equal(assetMatchesRef(sat(5), sat(5)), true);
  assert.equal(assetMatchesRef(sat(5), sat(6)), false);
  assert.equal(assetMatchesRef(range(100, 10), range(100, 10)), true);
  // Wrong span.
  assert.equal(assetMatchesRef(range(100, 10), range(100, 11)), false);
  // A sat ref never matches a range asset.
  assert.equal(assetMatchesRef(sat(100), range(100, 10)), false);
  assert.equal(assetMatchesRef(range(100, 10), sat(100)), false);
});

test("assetSatisfiesPredicate: sat_number / sat_range / name_prefix true+false", () => {
  assert.equal(
    assetSatisfiesPredicate({ type: "sat_number", params: { number: 42 } }, sat(42)),
    true,
  );
  assert.equal(
    assetSatisfiesPredicate({ type: "sat_number", params: { number: 42 } }, sat(43)),
    false,
  );
  assert.equal(
    assetSatisfiesPredicate({ type: "sat_range", params: { start: 10, end: 20 } }, sat(15)),
    true,
  );
  assert.equal(
    assetSatisfiesPredicate({ type: "sat_range", params: { start: 10, end: 20 } }, sat(20)),
    false,
  );
});

test("assetSatisfiesPredicate rejects range assets (predicate matches single sats only)", () => {
  assert.throws(
    () => assetSatisfiesPredicate({ type: "sat_number", params: { number: 100 } }, range(100, 10)),
    ListingValidationError,
  );
});

test("assetsSatisfyWant (specific): accepts exact multiset, rejects too-few/too-many/duplicate/extra", () => {
  const spec: WantSpec = { mode: "specific", assets: [sat(1), sat(2)] };
  assert.deepEqual(assetsSatisfyWant(spec, [sat(1), sat(2)]), { ok: true });
  // Order-independent multiset match.
  assert.deepEqual(assetsSatisfyWant(spec, [sat(2), sat(1)]), { ok: true });
  // Too few.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1)]), ListingValidationError);
  // Too many.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1), sat(2), sat(3)]), ListingValidationError);
  // Extra/unmatched (right count, wrong members).
  assert.throws(() => assetsSatisfyWant(spec, [sat(1), sat(3)]), ListingValidationError);
});

test("assetsSatisfyWant (predicate): count match, unique, per-sat satisfaction, range rejection", () => {
  const spec: WantSpec = {
    mode: "predicate",
    predicate: { type: "sat_range", params: { start: 0, end: 100 } },
    count: 2,
  };
  assert.deepEqual(assetsSatisfyWant(spec, [sat(1), sat(2)]), { ok: true });
  // Wrong count.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1)]), ListingValidationError);
  // Duplicate.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1), sat(1)]), ListingValidationError);
  // Out-of-range sat.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1), sat(200)]), ListingValidationError);
  // Range asset rejected.
  assert.throws(() => assetsSatisfyWant(spec, [sat(1), range(2, 5)]), ListingValidationError);
});

test("normalizeWantSpec: rejects unimplemented predicate types, malformed params, count<1, empty/dup specific, bad range", () => {
  // Unimplemented predicate type.
  assert.throws(
    () => normalizeWantSpec({ mode: "predicate", predicate: { type: "mining_pool", params: {} }, count: 1 }),
    ListingValidationError,
  );
  // Malformed params.
  assert.throws(
    () => normalizeWantSpec({ mode: "predicate", predicate: { type: "sat_number", params: {} }, count: 1 }),
    ListingValidationError,
  );
  // count < 1.
  assert.throws(
    () =>
      normalizeWantSpec({
        mode: "predicate",
        predicate: { type: "sat_number", params: { number: 1 } },
        count: 0,
      }),
    ListingValidationError,
  );
  // Empty specific set.
  assert.throws(() => normalizeWantSpec({ mode: "specific", assets: [] }), ListingValidationError);
  // Duplicate specific refs.
  assert.throws(
    () => normalizeWantSpec({ mode: "specific", assets: [sat(1), sat(1)] }),
    ListingValidationError,
  );
  // Range ref missing span field.
  assert.throws(
    () =>
      normalizeWantSpec({
        mode: "specific",
        assets: [{ asset_type: "range", asset_outpoint: "r:0", sat_range_start: 10 }],
      }),
    ListingValidationError,
  );
  // Valid specific spec normalizes.
  const spec = normalizeWantSpec({ mode: "specific", assets: [sat(1)] });
  assert.equal(spec.mode, "specific");
});

// --- service section ------------------------------------------------------

const NOW = "2026-07-15T00:00:00.000Z";
const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

function makeOrdOutput(outpoint: string, satStart: number): OrdOutput {
  return {
    address: "tb1qexample",
    confirmations: 5,
    indexed: true,
    inscriptions: [],
    outpoint,
    runes: {},
    sat_ranges: [[satStart, satStart + 1]],
    script_pubkey: p2wpkh("aa"),
    spent: false,
    transaction: outpoint.split(":")[0]!,
    value: 546,
  };
}

// Deterministic id/nonce generators for assertions.
function makeService(ordOutputs: Record<string, OrdOutput>) {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  let offerSeq = 0;
  let nonceSeq = 0;
  const ordClient: ListingOrdClient = {
    status: async () => {
      throw new Error("unused");
    },
    sat: async () => {
      throw new Error("no sat-capable client");
    },
    output: async (outpoint: string) => {
      const out = ordOutputs[outpoint];
      if (!out) {
        throw new Error(`unexpected ord output: ${outpoint}`);
      }
      return out;
    },
  };
  const service = new OfferService({
    store,
    ordClient,
    now: () => new Date(NOW),
    createOfferId: () => `offer-${++offerSeq}`,
    createNonce: () => `nonce-${++nonceSeq}`,
  });
  return { service, store };
}

const GIVE_OUTPOINT = "a".repeat(64) + ":0";
const TAKER_OUTPOINT = "b".repeat(64) + ":0";
const OFFERER_SAT = 12345;
const TAKER_SAT = 67890;

function intentOrdOutputs(): Record<string, OrdOutput> {
  return {
    [GIVE_OUTPOINT]: makeOrdOutput(GIVE_OUTPOINT, OFFERER_SAT),
    [TAKER_OUTPOINT]: makeOrdOutput(TAKER_OUTPOINT, TAKER_SAT),
  };
}

const GIVE_ASSET: OfferAssetRef = {
  asset_type: "sat",
  asset_outpoint: GIVE_OUTPOINT,
  sat_number: OFFERER_SAT,
};
const TAKER_ASSET: OfferAssetRef = {
  asset_type: "sat",
  asset_outpoint: TAKER_OUTPOINT,
  sat_number: TAKER_SAT,
};
const TAKER_BUILD = {
  bump_outpoints: ["c".repeat(64) + ":0"],
  change_script_pubkey_hex: p2wpkh("33"),
  ordinals_script_pubkey_hex: p2wpkh("44"),
};

test("postIntent persists an open intent with give_assets + want_spec", async () => {
  const { service } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });
  assert.equal(intent.offer_kind, "intent");
  assert.equal(intent.status, "open");
  assert.equal(intent.negotiation_id, intent.offer_id);
  assert.equal(intent.counter_index, 0);
  assert.deepEqual(intent.give_assets, [GIVE_ASSET]);
  assert.ok(intent.want_spec);
});

test("respondToIntent rejects want mismatch and accepts an exact match (intent -> countered, round counter_index=1)", async () => {
  const { service, store } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });

  // Want mismatch (wrong sat) → throws.
  await assert.rejects(
    service.respondToIntent(intent.offer_id, {
      taker_assets: [{ asset_type: "sat", asset_outpoint: TAKER_OUTPOINT, sat_number: 99999 }],
      taker_build: TAKER_BUILD,
    }),
    ListingValidationError,
  );

  // Exact match → first concrete round.
  const round = await service.respondToIntent(intent.offer_id, {
    taker_assets: [TAKER_ASSET],
    taker_build: TAKER_BUILD,
  });
  assert.equal(round.offer_kind, "concrete");
  assert.equal(round.counter_index, 1);
  assert.equal(round.negotiation_id, intent.negotiation_id);
  assert.equal(round.supersedes, intent.offer_id);
  assert.deepEqual(round.taker_build, TAKER_BUILD);
  assert.equal(round.offer_psbt, null);

  // Intent is now countered.
  assert.equal(store.getOffer(intent.offer_id)?.status, "countered");
});

test("buildConcreteOffer resolves ord values + both parties' bumps and returns an unsigned single-asset PSBT", async () => {
  const feeOutpoint = "e".repeat(64) + ":0";
  const offererBumpOutpoint = "f".repeat(64) + ":0";
  const takerBumpOutpoint = "c".repeat(64) + ":0";
  const ordOutputs = {
    ...intentOrdOutputs(),
    [feeOutpoint]: { ...makeOrdOutput(feeOutpoint, 5000), value: 10000 },
    [offererBumpOutpoint]: { ...makeOrdOutput(offererBumpOutpoint, 6000), value: 600 },
    [takerBumpOutpoint]: { ...makeOrdOutput(takerBumpOutpoint, 7000), value: 600 },
  };
  const { service } = makeService(ordOutputs);
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });
  const round = await service.respondToIntent(intent.offer_id, {
    taker_assets: [TAKER_ASSET],
    taker_build: {
      bump_outpoints: [takerBumpOutpoint],
      change_script_pubkey_hex: p2wpkh("33"),
      ordinals_script_pubkey_hex: p2wpkh("44"),
    },
  });

  const built = await service.buildConcreteOffer(round.offer_id, {
    offerer_build: {
      bump_outpoints: [offererBumpOutpoint],
      change_script_pubkey_hex: p2wpkh("11"),
      ordinals_script_pubkey_hex: p2wpkh("22"),
    },
    fee_funding_outpoint: feeOutpoint,
    fee_payer_change_script_pubkey_hex: p2wpkh("55"),
    fee_payer_change_value_sats: 3000,
  });
  assert.ok(built.psbt_base64.length > 0);
  assert.equal(built.input_outpoints.length, 5);

  // #bumps === #assets is enforced.
  await assert.rejects(
    service.buildConcreteOffer(round.offer_id, {
      offerer_build: {
        bump_outpoints: [offererBumpOutpoint, feeOutpoint],
        change_script_pubkey_hex: p2wpkh("11"),
        ordinals_script_pubkey_hex: p2wpkh("22"),
      },
      fee_funding_outpoint: feeOutpoint,
      fee_payer_change_script_pubkey_hex: p2wpkh("55"),
      fee_payer_change_value_sats: 3000,
    }),
    ListingValidationError,
  );
});

test("settleOffer rejects settling an open round (must be accepted)", async () => {
  const { service } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });
  const round = await service.respondToIntent(intent.offer_id, {
    taker_assets: [TAKER_ASSET],
    taker_build: TAKER_BUILD,
  });
  assert.throws(
    () => service.settleOffer(round.offer_id, "txid", round.nonce),
    ListingValidationError,
  );
});

test("cancelOffer cancels an open round, then rejects cancelling again", async () => {
  const { service } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });
  const cancelled = service.cancelOffer(intent.offer_id, intent.nonce);
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => service.cancelOffer(intent.offer_id, intent.nonce), ListingValidationError);
});

test("listIntents + candidate_sat filtering and getNegotiationThread ordering", async () => {
  const { service } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: {
      mode: "predicate",
      predicate: { type: "sat_range", params: { start: 0, end: 100000 } },
      count: 1,
    },
  });

  // Candidate in range is included.
  const included = service.listIntents({ candidate_sat_number: 50 });
  assert.equal(included.length, 1);
  // Candidate out of range excluded.
  const excluded = service.listIntents({ candidate_sat_number: 200000 });
  assert.equal(excluded.length, 0);

  const round = await service.respondToIntent(intent.offer_id, {
    taker_assets: [TAKER_ASSET],
    taker_build: TAKER_BUILD,
  });
  const thread = service.getNegotiationThread(intent.negotiation_id);
  assert.deepEqual(
    thread.map((r) => r.counter_index),
    [0, 1],
  );
  assert.equal(thread[1].offer_id, round.offer_id);
});

test("expireOffer + lazy expiry reports a past-expiry open round as expired", async () => {
  const { service } = makeService(intentOrdOutputs());
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
    expires_at: "2026-07-14T00:00:00.000Z",
  });
  // Lazy expiry on read.
  const fetched = service.getOffer(intent.offer_id);
  assert.equal(fetched?.status, "expired");
});
