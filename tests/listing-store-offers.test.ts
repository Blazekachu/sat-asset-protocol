import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SqliteListingStore } from "../src/listing-store.ts";
import type {
  BidFillRecord,
  OfferAssetRef,
  OfferRecord,
  SideBuildData,
  WantSpec,
} from "../src/listing-types.ts";

// --- helpers --------------------------------------------------------------

const NOW = "2026-07-15T00:00:00.000Z";

function makeIntent(overrides: Partial<OfferRecord> & { offer_id: string }): OfferRecord {
  const wantSpec: WantSpec = {
    mode: "predicate",
    predicate: { type: "rarity", params: { min_rarity: "uncommon" } },
    count: 1,
  };
  const giveAssets: OfferAssetRef[] = [
    { asset_type: "sat", asset_outpoint: "a".repeat(64) + ":0", sat_number: 111 },
  ];
  return {
    offer_id: overrides.offer_id,
    offerer_sat_number: 111,
    offerer_asset_outpoint: "a".repeat(64) + ":0",
    taker_sat_number: null,
    taker_asset_outpoint: null,
    offer_psbt: null,
    accept_psbt: null,
    status: "open",
    created_at: NOW,
    expires_at: null,
    offer_kind: "intent",
    negotiation_id: overrides.offer_id,
    parent_offer_id: null,
    counter_index: 0,
    supersedes: null,
    nonce: "nonce-" + overrides.offer_id,
    give_assets: giveAssets,
    want_spec: wantSpec,
    taker_assets: null,
    taker_build: null,
    settlement_txid: null,
    bid_target_quantity: null,
    bid_total_btc_sats: null,
    bid_remaining_quantity: null,
    ...overrides,
  };
}

const TAKER_BUILD: SideBuildData = {
  bump_outpoints: ["c".repeat(64) + ":0"],
  change_script_pubkey_hex: "0014" + "33".repeat(20),
  ordinals_script_pubkey_hex: "0014" + "44".repeat(20),
};

function makeConcreteRound(
  overrides: Partial<OfferRecord> & { offer_id: string; negotiation_id: string },
): OfferRecord {
  const takerAssets: OfferAssetRef[] = [
    { asset_type: "sat", asset_outpoint: "b".repeat(64) + ":0", sat_number: 222 },
  ];
  return {
    offer_id: overrides.offer_id,
    offerer_sat_number: 111,
    offerer_asset_outpoint: "a".repeat(64) + ":0",
    taker_sat_number: 222,
    taker_asset_outpoint: "b".repeat(64) + ":0",
    offer_psbt: null,
    accept_psbt: null,
    status: "open",
    created_at: NOW,
    expires_at: null,
    offer_kind: "concrete",
    negotiation_id: overrides.negotiation_id,
    parent_offer_id: null,
    counter_index: 1,
    supersedes: null,
    nonce: "nonce-" + overrides.offer_id,
    give_assets: [
      { asset_type: "sat", asset_outpoint: "a".repeat(64) + ":0", sat_number: 111 },
    ],
    want_spec: null,
    taker_assets: takerAssets,
    taker_build: TAKER_BUILD,
    settlement_txid: null,
    bid_target_quantity: null,
    bid_total_btc_sats: null,
    bid_remaining_quantity: null,
    ...overrides,
  };
}

// --- tests ----------------------------------------------------------------

test("N1: intent + concrete round-trip preserves JSON columns (give/want/taker/taker_build)", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));

  const intent = makeIntent({ offer_id: "intent-1" });
  store.insertOffer(intent);
  const loadedIntent = store.getOffer("intent-1");
  assert.ok(loadedIntent);
  assert.equal(loadedIntent.offer_kind, "intent");
  assert.deepEqual(loadedIntent.give_assets, intent.give_assets);
  assert.deepEqual(loadedIntent.want_spec, intent.want_spec);
  assert.equal(loadedIntent.taker_assets, null);
  assert.equal(loadedIntent.offer_psbt, null);

  const round = makeConcreteRound({ offer_id: "round-1", negotiation_id: "intent-1" });
  store.insertOffer(round);
  const loadedRound = store.getOffer("round-1");
  assert.ok(loadedRound);
  assert.deepEqual(loadedRound.taker_assets, round.taker_assets);
  assert.deepEqual(loadedRound.taker_build, TAKER_BUILD);
  assert.deepEqual(loadedRound.give_assets, round.give_assets);
});

test("migration idempotency: legacy offers rows are read as concrete offers with new columns", () => {
  const database = new DatabaseSync(":memory:");
  // Build the OLD-schema offers table with a legacy row before wrapping in the store.
  database.exec(`
    CREATE TABLE offers (
      offer_id TEXT PRIMARY KEY,
      offerer_sat_number INTEGER NOT NULL,
      offerer_asset_outpoint TEXT NOT NULL,
      taker_sat_number INTEGER NOT NULL,
      taker_asset_outpoint TEXT NOT NULL,
      offer_psbt TEXT NOT NULL,
      accept_psbt TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      expires_at TEXT
    );
    INSERT INTO offers (
      offer_id, offerer_sat_number, offerer_asset_outpoint,
      taker_sat_number, taker_asset_outpoint, offer_psbt, accept_psbt,
      status, created_at, expires_at
    ) VALUES (
      'legacy-1', 111, 'aa:0', 222, 'bb:0', 'cGxhY2Vob2xkZXI=', NULL,
      'open', '${NOW}', NULL
    );
  `);

  const store = new SqliteListingStore(database);
  const legacy = store.getOffer("legacy-1");
  assert.ok(legacy);
  assert.equal(legacy.offer_kind, "concrete");
  assert.equal(legacy.negotiation_id, "legacy-1");
  assert.equal(legacy.counter_index, 0);
  assert.equal(legacy.nonce, "legacy-1");
  assert.equal(legacy.give_assets, null);
  assert.equal(legacy.settlement_txid, null);
  assert.equal(legacy.taker_sat_number, 222);

  // Second construction is a no-op (idempotent) and still reads the row.
  const store2 = new SqliteListingStore(database);
  assert.ok(store2.getOffer("legacy-1"));
});

test("listNegotiationThread orders rounds by counter_index ascending", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeIntent({ offer_id: "intent-2", negotiation_id: "intent-2" }));
  store.insertOffer(
    makeConcreteRound({ offer_id: "round-c", negotiation_id: "intent-2", counter_index: 3 }),
  );
  store.insertOffer(
    makeConcreteRound({ offer_id: "round-b", negotiation_id: "intent-2", counter_index: 2 }),
  );
  store.insertOffer(
    makeConcreteRound({ offer_id: "round-a", negotiation_id: "intent-2", counter_index: 1 }),
  );

  const thread = store.listNegotiationThread("intent-2");
  assert.deepEqual(
    thread.map((round) => round.counter_index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    thread.map((round) => round.offer_id),
    ["intent-2", "round-a", "round-b", "round-c"],
  );
});

test("getOfferByNonce returns the matching round", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeConcreteRound({ offer_id: "round-n", negotiation_id: "neg-n" }));
  const found = store.getOfferByNonce("nonce-round-n");
  assert.ok(found);
  assert.equal(found.offer_id, "round-n");
  assert.equal(store.getOfferByNonce("does-not-exist"), null);
});

test("supersedeWithCounter atomically inserts the child and CASes the parent to countered", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  const intent = makeIntent({ offer_id: "intent-3" });
  store.insertOffer(intent);

  const child = makeConcreteRound({
    offer_id: "child-3",
    negotiation_id: "intent-3",
    parent_offer_id: "intent-3",
    supersedes: "intent-3",
  });
  const inserted = store.supersedeWithCounter("intent-3", intent.nonce, child);
  assert.equal(inserted.offer_id, "child-3");
  assert.equal(store.getOffer("intent-3")?.status, "countered");
  assert.equal(store.getOffer("child-3")?.status, "open");
});

test("supersedeWithCounter rolls back (no orphaned child, parent stays open) on a nonce mismatch", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeIntent({ offer_id: "intent-4" }));

  const child = makeConcreteRound({
    offer_id: "child-4",
    negotiation_id: "intent-4",
    parent_offer_id: "intent-4",
  });
  assert.throws(() => store.supersedeWithCounter("intent-4", "wrong-nonce", child));

  // Parent unchanged, child never persisted.
  assert.equal(store.getOffer("intent-4")?.status, "open");
  assert.equal(store.getOffer("child-4"), null);
});

test("N2: updateOfferPsbt CAS succeeds on open+unsigned round, null on wrong nonce and when already signed", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeConcreteRound({ offer_id: "psbt-1", negotiation_id: "neg-p" }));

  // Wrong nonce → null.
  assert.equal(store.updateOfferPsbt("psbt-1", "PSBT", "wrong-nonce"), null);

  // Correct nonce, open + unsigned → row.
  const updated = store.updateOfferPsbt("psbt-1", "PSBT", "nonce-psbt-1");
  assert.ok(updated);
  assert.equal(updated.offer_psbt, "PSBT");

  // Already signed (offer_psbt IS NOT NULL) → null.
  assert.equal(store.updateOfferPsbt("psbt-1", "PSBT2", "nonce-psbt-1"), null);
});

test("N3: updateOfferAccept requires a signed round; null when offer_psbt IS NULL", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeConcreteRound({ offer_id: "acc-1", negotiation_id: "neg-a" }));

  // Unsigned round (offer_psbt IS NULL) → null.
  assert.equal(store.updateOfferAccept("acc-1", "ACCEPT", "nonce-acc-1"), null);

  // Sign it, then accept succeeds.
  store.updateOfferPsbt("acc-1", "PSBT", "nonce-acc-1");
  const accepted = store.updateOfferAccept("acc-1", "ACCEPT", "nonce-acc-1");
  assert.ok(accepted);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.accept_psbt, "ACCEPT");
});

test("N4: settleAcceptedOffer only settles an accepted round (no-op on open)", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeConcreteRound({ offer_id: "set-1", negotiation_id: "neg-s" }));

  // Open round → cannot settle.
  assert.equal(store.settleAcceptedOffer("set-1", "txid", "nonce-set-1"), null);

  // Bring to accepted, then settle.
  store.updateOfferPsbt("set-1", "PSBT", "nonce-set-1");
  store.updateOfferAccept("set-1", "ACCEPT", "nonce-set-1");
  const settled = store.settleAcceptedOffer("set-1", "txid-abc", "nonce-set-1");
  assert.ok(settled);
  assert.equal(settled.status, "settled");
  assert.equal(settled.settlement_txid, "txid-abc");

  // Wrong nonce would also miss.
  store.insertOffer(makeConcreteRound({ offer_id: "set-2", negotiation_id: "neg-s2" }));
  store.updateOfferPsbt("set-2", "PSBT", "nonce-set-2");
  store.updateOfferAccept("set-2", "ACCEPT", "nonce-set-2");
  assert.equal(store.settleAcceptedOffer("set-2", "txid", "wrong-nonce"), null);
});

test("N5: cancelOpenOffer only cancels an open round with a matching nonce", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(makeConcreteRound({ offer_id: "can-1", negotiation_id: "neg-c" }));

  // Wrong nonce → null.
  assert.equal(store.cancelOpenOffer("can-1", "wrong-nonce"), null);

  const cancelled = store.cancelOpenOffer("can-1", "nonce-can-1");
  assert.ok(cancelled);
  assert.equal(cancelled.status, "cancelled");

  // Already cancelled → null.
  assert.equal(store.cancelOpenOffer("can-1", "nonce-can-1"), null);
});

test("expireOffer only expires an open, past-expiry round", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  store.insertOffer(
    makeConcreteRound({
      offer_id: "exp-1",
      negotiation_id: "neg-e",
      expires_at: "2026-07-14T00:00:00.000Z",
    }),
  );
  store.insertOffer(
    makeConcreteRound({
      offer_id: "exp-2",
      negotiation_id: "neg-e2",
      expires_at: "2026-08-01T00:00:00.000Z",
    }),
  );

  // Past expiry, now = 2026-07-15 → expired.
  const expired = store.expireOffer("exp-1", NOW);
  assert.ok(expired);
  assert.equal(expired.status, "expired");

  // Future expiry → null (not yet expired).
  assert.equal(store.expireOffer("exp-2", NOW), null);
});

// --- Partially-fillable BTC buy bids ledger (WS-D, ADR-0019) -------------

function makeBid(overrides: Partial<OfferRecord> & { offer_id: string }): OfferRecord {
  const wantSpec: WantSpec = { mode: "specific", assets: [
    { asset_type: "range", asset_outpoint: "r".repeat(64) + ":0", sat_number: 500, sat_range_start: 500, sat_range_size: 10 },
  ] };
  return {
    offer_id: overrides.offer_id,
    offerer_sat_number: 0,
    offerer_asset_outpoint: overrides.offer_id,
    taker_sat_number: null,
    taker_asset_outpoint: null,
    offer_psbt: null,
    accept_psbt: null,
    status: "open",
    created_at: NOW,
    expires_at: null,
    offer_kind: "bid",
    negotiation_id: overrides.offer_id,
    parent_offer_id: null,
    counter_index: 0,
    supersedes: null,
    nonce: "nonce-" + overrides.offer_id,
    give_assets: null,
    want_spec: wantSpec,
    taker_assets: null,
    taker_build: null,
    settlement_txid: null,
    bid_target_quantity: 10,
    bid_total_btc_sats: 10000,
    bid_remaining_quantity: 10,
    ...overrides,
  };
}

function pendingFill(fillId: string, bidId: string, fillOfferId: string, rangeStart: number, rangeSize: number): BidFillRecord {
  return {
    fill_id: fillId,
    bid_id: bidId,
    fill_offer_id: fillOfferId,
    filled_sat_number: null,
    filled_range_start: rangeStart,
    filled_range_size: rangeSize,
    filled_quantity: rangeSize,
    seller_outpoint: "s".repeat(64) + ":" + rangeStart,
    seller_utxo_value_sats: 546,
    buyer_asset_script_pubkey_hex: "0014" + "ee".repeat(20),
    price_sats: rangeSize * 1000,
    state: "pending_build",
    created_at: NOW,
  };
}

// A child settlement OfferRecord (concrete, accepted) inserted by recordBidFill.
function childFillRow(fillOfferId: string, bidId: string, ref: OfferAssetRef): OfferRecord {
  return {
    offer_id: fillOfferId,
    offerer_sat_number: 0,
    offerer_asset_outpoint: fillOfferId,
    taker_sat_number: null,
    taker_asset_outpoint: null,
    offer_psbt: "psbt",
    accept_psbt: null,
    status: "accepted",
    created_at: NOW,
    expires_at: null,
    offer_kind: "concrete",
    negotiation_id: bidId,
    parent_offer_id: bidId,
    counter_index: 0,
    supersedes: null,
    nonce: "n-" + fillOfferId,
    give_assets: null,
    want_spec: null,
    taker_assets: [ref],
    taker_build: null,
    settlement_txid: null,
    bid_target_quantity: null,
    bid_total_btc_sats: null,
    bid_remaining_quantity: null,
  };
}

const rangeRef = (start: number, size: number): OfferAssetRef => ({
  asset_type: "range",
  asset_outpoint: "s".repeat(64) + ":" + start,
  sat_number: start,
  sat_range_start: start,
  sat_range_size: size,
});

test("[BD5] concurrent over-commit: second recordBidFill with the same starting nonce fails CAS; remainder debited once", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  const bid = makeBid({ offer_id: "bid-1" });
  store.insertOffer(bid);

  store.insertPendingBidFill(pendingFill("f1", "bid-1", "child-1", 500, 6));
  store.insertPendingBidFill(pendingFill("f2", "bid-1", "child-2", 506, 6));

  // First fill succeeds and rotates the nonce.
  const after1 = store.recordBidFill("bid-1", "f1", bid.nonce, childFillRow("child-1", "bid-1", rangeRef(500, 6)), 6, rangeRef(500, 6));
  assert.equal(after1.bid_remaining_quantity, 4);
  assert.notEqual(after1.nonce, bid.nonce);

  // Second fill reuses the STALE starting nonce -> CAS fails, ledger unchanged.
  assert.throws(
    () => store.recordBidFill("bid-1", "f2", bid.nonce, childFillRow("child-2", "bid-1", rangeRef(506, 6)), 6, rangeRef(506, 6)),
    /CAS failed|nonce/,
  );
  const cur = store.getOffer("bid-1")!;
  assert.equal(cur.bid_remaining_quantity, 4); // debited once only
  assert.equal(store.getBidFill("f2")!.state, "pending_build"); // untouched
  assert.equal(store.getOffer("child-2"), null); // no child inserted
});

test("[BD8] duplicate/overlapping recordBidFill is rejected inside the transaction; ledger unchanged", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  const bid = makeBid({ offer_id: "bid-2" });
  store.insertOffer(bid);
  store.insertPendingBidFill(pendingFill("f1", "bid-2", "child-1", 500, 4));
  store.insertPendingBidFill(pendingFill("f2", "bid-2", "child-2", 502, 4)); // overlaps [500,504)

  const cur = store.getOffer("bid-2")!;
  store.recordBidFill("bid-2", "f1", cur.nonce, childFillRow("child-1", "bid-2", rangeRef(500, 4)), 4, rangeRef(500, 4));
  const afterFirst = store.getOffer("bid-2")!;

  assert.throws(
    () => store.recordBidFill("bid-2", "f2", afterFirst.nonce, childFillRow("child-2", "bid-2", rangeRef(502, 4)), 4, rangeRef(502, 4)),
    /overlap/,
  );
  const final = store.getOffer("bid-2")!;
  assert.equal(final.bid_remaining_quantity, 6); // only the first fill applied
  assert.equal(store.getBidFill("f2")!.state, "pending_build");
});

test("[BD9] reserved -> settled and reserved -> release lifecycle credits remainder + cancels child", () => {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  const bid = makeBid({ offer_id: "bid-3", bid_target_quantity: 10, bid_remaining_quantity: 10, bid_total_btc_sats: 10000 });
  store.insertOffer(bid);
  store.insertPendingBidFill(pendingFill("f1", "bid-3", "child-1", 500, 10));

  // record -> reserved (bid becomes filled at remainder 0).
  const recorded = store.recordBidFill("bid-3", "f1", bid.nonce, childFillRow("child-1", "bid-3", rangeRef(500, 10)), 10, rangeRef(500, 10));
  assert.equal(store.getBidFill("f1")!.state, "reserved");
  assert.equal(recorded.status, "filled");
  assert.equal(recorded.bid_remaining_quantity, 0);

  // settle a reserved fill.
  const settled = store.settleBidFill("bid-3", "f1", "txid-abc", recorded.nonce);
  assert.equal(store.getBidFill("f1")!.state, "settled");
  assert.equal(store.getOffer("child-1")!.status, "settled");
  assert.equal(store.getOffer("child-1")!.settlement_txid, "txid-abc");
  assert.ok(settled);

  // Now test release on a fresh reserved fill (different bid).
  const bid4 = makeBid({ offer_id: "bid-4", bid_target_quantity: 10, bid_remaining_quantity: 10, bid_total_btc_sats: 10000 });
  store.insertOffer(bid4);
  store.insertPendingBidFill(pendingFill("g1", "bid-4", "child-g1", 500, 10));
  const rec4 = store.recordBidFill("bid-4", "g1", bid4.nonce, childFillRow("child-g1", "bid-4", rangeRef(500, 10)), 10, rangeRef(500, 10));
  assert.equal(rec4.status, "filled");

  const released = store.releaseBidFill("bid-4", "g1", rec4.nonce);
  assert.equal(store.getBidFill("g1")!.state, "released");
  assert.equal(store.getOffer("child-g1")!.status, "cancelled");
  assert.equal(released.bid_remaining_quantity, 10); // credited back
  assert.equal(released.status, "open"); // reopened from filled
});
