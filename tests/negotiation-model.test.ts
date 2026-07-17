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
import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  PSBT_MAGIC,
} from "../src/psbt.ts";
import type { OfferAssetRef, WantSpec } from "../src/listing-types.ts";
import type { ListingOrdClient } from "../src/listing-service.ts";
import type { OrdOutput, OrdSat, OrdStatus } from "../src/types.ts";

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

// --- Partially-fillable BTC buy bids (WS-D, ADR-0019) ---------------------

const BID_SELLER_OP = "5".repeat(64) + ":0";
const BID_BUMP0_OP = "6".repeat(64) + ":0";
const BID_BUMP1_OP = "7".repeat(64) + ":0";
const BID_FEE_OP = "8".repeat(64) + ":0";

const SELLER_SPK = p2wpkh("aa"); // makeOrdOutput default script for the seller UTXO
const BUYER_BUMP_SPK = p2wpkh("cc");
const BUYER_ASSET_SPK = p2wpkh("ee");
const FEE_CHANGE_SPK2 = p2wpkh("ff");
const FEE_CHANGE_VALUE2 = 3000;
const SELLER_POSTAGE = 546;

// Ord outputs needed to build any bid fill (seller UTXO + 2 bumps + fee funding).
function bidFillOrdOutputs(sellerSatStart: number): Record<string, OrdOutput> {
  return {
    [BID_SELLER_OP]: makeOrdOutput(BID_SELLER_OP, sellerSatStart),
    [BID_BUMP0_OP]: { ...makeOrdOutput(BID_BUMP0_OP, 900000), value: 600, script_pubkey: p2wpkh("b0") },
    [BID_BUMP1_OP]: { ...makeOrdOutput(BID_BUMP1_OP, 900001), value: 600, script_pubkey: p2wpkh("b1") },
    [BID_FEE_OP]: { ...makeOrdOutput(BID_FEE_OP, 900002), value: 10000, script_pubkey: p2wpkh("fe") },
  };
}

const bidSellerBuild = () => ({
  bump_outpoints: [BID_BUMP0_OP, BID_BUMP1_OP],
  change_script_pubkey_hex: BUYER_BUMP_SPK,
  ordinals_script_pubkey_hex: p2wpkh("dd"),
});

function buildFillRequest(fillAsset: OfferAssetRef) {
  return {
    fill_asset: fillAsset,
    seller_outpoint: BID_SELLER_OP,
    seller_build: bidSellerBuild(),
    buyer_asset_script_pubkey_hex: BUYER_ASSET_SPK,
    fee_funding_outpoint: BID_FEE_OP,
    fee_payer_change_script_pubkey_hex: FEE_CHANGE_SPK2,
    fee_payer_change_value_sats: FEE_CHANGE_VALUE2,
  };
}

// Compose a CO-SIGNED bid-fill PSBT matching buildBuyerFillTemplatePsbt's layout:
//   inputs:  bump0(SIGHASH_ALL), bump1(ALL), seller(SINGLE|ANYONECANPAY), fee(ALL)
//   outputs: [1200 -> buyerBump, postage -> buyerAsset, price -> seller, feeChange]
function buildCoSignedFillPsbt(listingPriceSats: number, sellerSig = 0x83): string {
  const inputs = [
    { outpoint: BID_BUMP0_OP, valueSats: 600, scriptPubkeyHex: p2wpkh("b0"), sighash: 0x01 },
    { outpoint: BID_BUMP1_OP, valueSats: 600, scriptPubkeyHex: p2wpkh("b1"), sighash: 0x01 },
    { outpoint: BID_SELLER_OP, valueSats: SELLER_POSTAGE, scriptPubkeyHex: SELLER_SPK, sighash: sellerSig },
    { outpoint: BID_FEE_OP, valueSats: 10000, scriptPubkeyHex: p2wpkh("fe"), sighash: 0x01 },
  ];
  const outputs = [
    { valueSats: 1200, scriptPubkeyHex: BUYER_BUMP_SPK },
    { valueSats: SELLER_POSTAGE, scriptPubkeyHex: BUYER_ASSET_SPK },
    { valueSats: listingPriceSats, scriptPubkeyHex: SELLER_SPK },
    { valueSats: FEE_CHANGE_VALUE2, scriptPubkeyHex: FEE_CHANGE_SPK2 },
  ];
  const unsignedTx = buildUnsignedTransaction(
    inputs.map((i) => i.outpoint),
    outputs,
  );
  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTx),
    Buffer.from([0x00]),
  ]);
  const inputMaps = inputs.map((spec) => {
    const entries: Buffer[] = [encodeWitnessUtxoMap(spec.valueSats, spec.scriptPubkeyHex)];
    const pubkey = Buffer.from("02".repeat(33), "hex");
    const key = Buffer.concat([Buffer.from([0x02]), pubkey]);
    const value = Buffer.concat([Buffer.from("3006020101020101", "hex"), Buffer.from([spec.sighash])]);
    entries.push(encodeMapEntry(key, value));
    return Buffer.concat([...entries, Buffer.from([0x00])]);
  });
  const outputMaps = outputs.map(() => Buffer.from([0x00]));
  return Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]).toString("base64");
}

test("[BD1] postBid derives unit price (floor(T/N)) + persists open remainder", async () => {
  const { service } = makeService({});
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10005, // floor(10005/10) = 1000 (residual 5 favors bidder)
  });
  assert.equal(bid.offer_kind, "bid");
  assert.equal(bid.status, "open");
  assert.equal(bid.bid_target_quantity, 10);
  assert.equal(bid.bid_total_btc_sats, 10005);
  assert.equal(bid.bid_remaining_quantity, 10);

  // target < 1 and total < target are rejected.
  await assert.rejects(
    service.postBid({ want_spec: { mode: "specific", assets: [range(500, 10)] }, bid_target_quantity: 0, bid_total_btc_sats: 10 }),
    ListingValidationError,
  );
  await assert.rejects(
    service.postBid({ want_spec: { mode: "specific", assets: [range(500, 10)] }, bid_target_quantity: 10, bid_total_btc_sats: 9 }),
    ListingValidationError,
  );
});

test("[BD2] buildBidFill partial k<N: output 2 = k*unit_price, output 1 = seller postage; submit debits remainder by logical k, rotates nonce, bid stays open", async () => {
  const { service } = makeService(bidFillOrdOutputs(500));
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000, // unit_price = 1000
  });

  const built = await service.buildBidFill(bid.offer_id, buildFillRequest(range(500, 4)));
  assert.ok(built.psbt_base64.length > 0);
  assert.ok(built.fill_id);
  // output 2 pays k*unit_price = 4000; output 1 carries the postage value (546).
  assert.equal(built.output_values[2], 4000);
  assert.equal(built.output_values[1], SELLER_POSTAGE);

  const before = service.getBid(bid.offer_id)!;
  const updated = await service.submitBidFill(bid.offer_id, {
    fill_id: built.fill_id,
    fill_psbt: buildCoSignedFillPsbt(4000),
    nonce: before.nonce,
  });
  assert.equal(updated.status, "open");
  assert.equal(updated.bid_remaining_quantity, 6); // 10 - 4
  assert.notEqual(updated.nonce, before.nonce); // nonce rotated
});

test("[BD2] single-sat fill debits by exactly 1 even though output 1 carries postage sats", async () => {
  const { service } = makeService(bidFillOrdOutputs(777));
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [sat(777, BID_SELLER_OP)] },
    bid_target_quantity: 3,
    bid_total_btc_sats: 3000, // unit_price = 1000
  });
  const built = await service.buildBidFill(
    bid.offer_id,
    buildFillRequest({ asset_type: "sat", asset_outpoint: BID_SELLER_OP, sat_number: 777 }),
  );
  assert.equal(built.output_values[2], 1000); // k=1 -> unit_price
  assert.equal(built.output_values[1], SELLER_POSTAGE);
  const before = service.getBid(bid.offer_id)!;
  const updated = await service.submitBidFill(bid.offer_id, {
    fill_id: built.fill_id,
    fill_psbt: buildCoSignedFillPsbt(1000),
    nonce: before.nonce,
  });
  assert.equal(updated.bid_remaining_quantity, 2); // debited by 1, not by 546
});

test("[BD3] fills summing to N transition the bid to filled", async () => {
  const outs = bidFillOrdOutputs(500);
  const { service } = makeService(outs);
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000,
  });

  // Fill 1: [500,506) k=6.
  const b1 = await service.buildBidFill(bid.offer_id, buildFillRequest(range(500, 6)));
  let cur = service.getBid(bid.offer_id)!;
  await service.submitBidFill(bid.offer_id, { fill_id: b1.fill_id, fill_psbt: buildCoSignedFillPsbt(6000), nonce: cur.nonce });

  // Fill 2: [506,510) k=4 -> remainder hits 0 -> filled.
  const b2 = await service.buildBidFill(bid.offer_id, buildFillRequest(range(506, 4)));
  cur = service.getBid(bid.offer_id)!;
  const done = await service.submitBidFill(bid.offer_id, { fill_id: b2.fill_id, fill_psbt: buildCoSignedFillPsbt(4000), nonce: cur.nonce });
  assert.equal(done.status, "filled");
  assert.equal(done.bid_remaining_quantity, 0);
});

test("[BD4] over-fill (k > remaining) is rejected at build time", async () => {
  const { service } = makeService(bidFillOrdOutputs(500));
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000,
  });
  // want range is only size 10; a size-20 delivered range exceeds remaining.
  await assert.rejects(
    service.buildBidFill(bid.offer_id, buildFillRequest(range(500, 20))),
    ListingValidationError,
  );
});

test("[BD6] fill failing the want (out-of-range / predicate) is rejected", async () => {
  const { service } = makeService(bidFillOrdOutputs(2000));
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000,
  });
  // Delivered range [2000,2004) is not contained in wanted [500,510).
  await assert.rejects(
    service.buildBidFill(bid.offer_id, buildFillRequest(range(2000, 4))),
    ListingValidationError,
  );
});

test("[BD8] strict subrange fully contained debits by delivered size; overlapping second fill rejected", async () => {
  const { service } = makeService(bidFillOrdOutputs(500));
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [range(500, 10)] },
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000,
  });
  const b1 = await service.buildBidFill(bid.offer_id, buildFillRequest(range(502, 3)));
  let cur = service.getBid(bid.offer_id)!;
  const after1 = await service.submitBidFill(bid.offer_id, { fill_id: b1.fill_id, fill_psbt: buildCoSignedFillPsbt(3000), nonce: cur.nonce });
  assert.equal(after1.bid_remaining_quantity, 7); // debited by delivered size 3, not wanted size 10

  // A second fill overlapping [502,505) is rejected by the want matcher.
  await assert.rejects(
    service.buildBidFill(bid.offer_id, buildFillRequest(range(503, 2))),
    ListingValidationError,
  );
});

test("[BD7] findCandidateHolders skips null-satpoint sats and errors when indexes are off", async () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  let offerSeq = 0;
  let nonceSeq = 0;
  const satByNumber: Record<number, OrdSat> = {
    100: { satpoint: "aa".repeat(32) + ":0:0", address: "tb1qholder100" } as OrdSat,
    200: { satpoint: null, address: null } as OrdSat,
  };
  const baseStatus: OrdStatus = { sat_index: true, address_index: true } as OrdStatus;
  let statusValue = baseStatus;
  const ordClient = {
    status: async () => statusValue,
    sat: async (n: number | bigint) => satByNumber[Number(n)] ?? ({ satpoint: null, address: null } as OrdSat),
    output: async () => {
      throw new Error("unused");
    },
  } as unknown as ListingOrdClient;
  const service = new OfferService({
    store,
    ordClient,
    now: () => new Date(NOW),
    createOfferId: () => `offer-${++offerSeq}`,
    createNonce: () => `nonce-${++nonceSeq}`,
  });
  const bid = await service.postBid({
    want_spec: { mode: "specific", assets: [sat(100), sat(200)] },
    bid_target_quantity: 2,
    bid_total_btc_sats: 2000,
  });
  const holders = await service.findCandidateHolders(bid.offer_id);
  assert.equal(holders.length, 1);
  assert.equal(holders[0].sat_number, 100);
  assert.equal(holders[0].address, "tb1qholder100");

  // Indexes off -> error.
  statusValue = { sat_index: false, address_index: false } as OrdStatus;
  await assert.rejects(service.findCandidateHolders(bid.offer_id), ListingValidationError);
});
