import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ListingValidationError } from "../src/listing-service.ts";
import { SqliteListingStore } from "../src/listing-store.ts";
import { OfferService } from "../src/offer-service.ts";
import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  PSBT_MAGIC,
  type TemplateInput,
} from "../src/psbt.ts";
import type { OfferAssetRef } from "../src/listing-types.ts";
import type { ListingOrdClient } from "../src/listing-service.ts";
import type { OrdOutput } from "../src/types.ts";

// Offer-matrix negotiation-lifecycle cells N1, N2, N3, N5 (N4 lives in
// offers-api.test.ts). Drives the real OfferService negotiation thread against
// an in-memory store + a stub ord client, with a MUTABLE clock so per-round
// expiry can be exercised deterministically.

const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

const A_BUMP: TemplateInput = { outpoint: "a".repeat(64) + ":0", valueSats: 600, scriptPubkeyHex: p2wpkh("a1") };
const A_ASSET: TemplateInput = { outpoint: "b".repeat(64) + ":0", valueSats: 546, scriptPubkeyHex: p2wpkh("a2") };
const B_BUMP: TemplateInput = { outpoint: "c".repeat(64) + ":0", valueSats: 600, scriptPubkeyHex: p2wpkh("b1") };
const B_ASSET: TemplateInput = { outpoint: "d".repeat(64) + ":0", valueSats: 546, scriptPubkeyHex: p2wpkh("b2") };
const FEE_INPUT: TemplateInput = { outpoint: "e".repeat(64) + ":0", valueSats: 10000, scriptPubkeyHex: p2wpkh("ef") };

const A_CHANGE_SPK = p2wpkh("11");
const B_ORDINALS_SPK = p2wpkh("22");
const B_CHANGE_SPK = p2wpkh("33");
const A_ORDINALS_SPK = p2wpkh("44");
const FEE_CHANGE_SPK = p2wpkh("55");
const FEE_CHANGE_VALUE = 3000;

const OFFERER_SAT = 12345;
const TAKER_SAT = 67890;

interface InputSpec {
  input: TemplateInput;
  sig?: { sighash: number };
}
interface OutputSpec {
  valueSats: number;
  scriptPubkeyHex: string;
}

function buildSatForSatPsbt(inputs: InputSpec[], outputs: OutputSpec[]): string {
  const unsignedTx = buildUnsignedTransaction(
    inputs.map((s) => s.input.outpoint),
    outputs,
  );
  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTx),
    Buffer.from([0x00]),
  ]);
  const inputMaps = inputs.map((spec) => {
    const entries: Buffer[] = [encodeWitnessUtxoMap(spec.input.valueSats, spec.input.scriptPubkeyHex)];
    if (spec.sig) {
      const pubkey = Buffer.from("02".repeat(33), "hex");
      const key = Buffer.concat([Buffer.from([0x02]), pubkey]);
      const value = Buffer.concat([Buffer.from("3006020101020101", "hex"), Buffer.from([spec.sig.sighash])]);
      entries.push(encodeMapEntry(key, value));
    }
    return Buffer.concat([...entries, Buffer.from([0x00])]);
  });
  const outputMaps = outputs.map(() => Buffer.from([0x00]));
  return Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]).toString("base64");
}

const CANONICAL_OUTPUTS: OutputSpec[] = [
  { valueSats: A_BUMP.valueSats, scriptPubkeyHex: A_CHANGE_SPK },
  { valueSats: A_ASSET.valueSats, scriptPubkeyHex: B_ORDINALS_SPK },
  { valueSats: B_BUMP.valueSats, scriptPubkeyHex: B_CHANGE_SPK },
  { valueSats: B_ASSET.valueSats, scriptPubkeyHex: A_ORDINALS_SPK },
  { valueSats: FEE_CHANGE_VALUE, scriptPubkeyHex: FEE_CHANGE_SPK },
];

// Offerer (A) signs inputs [0],[1] SIGHASH_ALL; accepter inputs unsigned.
function buildOfferPsbt(): string {
  return buildSatForSatPsbt(
    [
      { input: A_BUMP, sig: { sighash: 0x01 } },
      { input: A_ASSET, sig: { sighash: 0x01 } },
      { input: B_BUMP },
      { input: B_ASSET },
      { input: FEE_INPUT },
    ],
    CANONICAL_OUTPUTS,
  );
}

// All five inputs signed, byte-identical unsigned tx.
function buildAcceptPsbt(): string {
  return buildSatForSatPsbt(
    [
      { input: A_BUMP, sig: { sighash: 0x01 } },
      { input: A_ASSET, sig: { sighash: 0x01 } },
      { input: B_BUMP, sig: { sighash: 0x01 } },
      { input: B_ASSET, sig: { sighash: 0x01 } },
      { input: FEE_INPUT, sig: { sighash: 0x01 } },
    ],
    CANONICAL_OUTPUTS,
  );
}

function makeOrdOutput(outpoint: string, satStart: number, value = 546, spent = false): OrdOutput {
  return {
    address: "tb1qexample",
    confirmations: 5,
    indexed: true,
    inscriptions: [],
    outpoint,
    runes: {},
    sat_ranges: [[satStart, satStart + 1]],
    script_pubkey: "",
    spent,
    transaction: outpoint.split(":")[0]!,
    value,
  };
}

function ordOutputs(overrides: Record<string, OrdOutput> = {}): Record<string, OrdOutput> {
  return {
    [A_ASSET.outpoint]: makeOrdOutput(A_ASSET.outpoint, OFFERER_SAT),
    [B_ASSET.outpoint]: makeOrdOutput(B_ASSET.outpoint, TAKER_SAT),
    [A_BUMP.outpoint]: makeOrdOutput(A_BUMP.outpoint, 1000, 600),
    [B_BUMP.outpoint]: makeOrdOutput(B_BUMP.outpoint, 2000, 600),
    [FEE_INPUT.outpoint]: makeOrdOutput(FEE_INPUT.outpoint, 3000, 10000),
    ...overrides,
  };
}

interface Clock {
  set(iso: string): void;
}

function makeService(outputs: Record<string, OrdOutput>): {
  service: OfferService;
  store: SqliteListingStore;
  clock: Clock;
} {
  const store = new SqliteListingStore(new DatabaseSync(":memory:"));
  let nowIso = "2026-07-15T00:00:00.000Z";
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
      const out = outputs[outpoint];
      if (!out) {
        throw new Error(`unexpected ord output: ${outpoint}`);
      }
      return out;
    },
  };
  const service = new OfferService({
    store,
    ordClient,
    now: () => new Date(nowIso),
    createOfferId: () => `offer-${++offerSeq}`,
    createNonce: () => `nonce-${++nonceSeq}`,
  });
  return { service, store, clock: { set: (iso) => (nowIso = iso) } };
}

const GIVE_ASSET: OfferAssetRef = { asset_type: "sat", asset_outpoint: A_ASSET.outpoint, sat_number: OFFERER_SAT };
const TAKER_ASSET: OfferAssetRef = { asset_type: "sat", asset_outpoint: B_ASSET.outpoint, sat_number: TAKER_SAT };
const takerBuild = () => ({
  bump_outpoints: [B_BUMP.outpoint],
  change_script_pubkey_hex: B_CHANGE_SPK,
  ordinals_script_pubkey_hex: A_ORDINALS_SPK,
});

// Post an intent and produce the first concrete, offerer-signed round.
async function openSignedRound(service: OfferService, expiresAt?: string) {
  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  });
  const round = await service.respondToIntent(intent.offer_id, {
    taker_assets: [TAKER_ASSET],
    taker_build: takerBuild(),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  });
  const signed = await service.submitConcreteOfferPsbt(round.offer_id, {
    offer_psbt: buildOfferPsbt(),
    offerer_signed_inputs: [0, 1],
    nonce: round.nonce,
  });
  return { intent, round: signed };
}

test("[N1] counter chain: new object per round, counter_index++, parent countered, accepting a superseded round is rejected", async () => {
  const { service, store } = makeService(ordOutputs());
  const { round } = await openSignedRound(service);
  assert.equal(round.counter_index, 1);

  // Counter the round -> new object with counter_index 2; parent -> countered.
  const child = await service.counterOffer(round.offer_id, {
    offer_psbt: buildOfferPsbt(),
    offerer_signed_inputs: [0, 1],
    nonce: round.nonce,
  });
  assert.notEqual(child.offer_id, round.offer_id);
  assert.equal(child.counter_index, 2);
  assert.equal(child.supersedes, round.offer_id);
  assert.equal(store.getOffer(round.offer_id)?.status, "countered");

  // Accepting the superseded (countered) parent round is rejected.
  await assert.rejects(
    service.acceptOffer(round.offer_id, buildAcceptPsbt(), round.nonce),
    (err: unknown) => err instanceof ListingValidationError && /not open|status=countered/.test((err as Error).message),
  );
});

test("[N2] per-round expiry: an accept after now > expires_at is rejected (round lazily expired)", async () => {
  const { service, clock } = makeService(ordOutputs());
  // Set up the round while it is still live (before its expiry).
  clock.set("2026-07-13T00:00:00.000Z");
  const { round } = await openSignedRound(service, "2026-07-14T00:00:00.000Z");
  assert.equal(round.status, "open");

  // Advance the clock past the round's expiry; accept must now be rejected.
  clock.set("2026-07-16T00:00:00.000Z");
  await assert.rejects(
    service.acceptOffer(round.offer_id, buildAcceptPsbt(), round.nonce),
    (err: unknown) => err instanceof ListingValidationError && /not open|expired/.test((err as Error).message),
  );
});

test("[N3] nonce/replay: a stale-round accept replayed under the wrong (rotated) nonce is rejected", async () => {
  const { service } = makeService(ordOutputs());
  const { round } = await openSignedRound(service);
  const staleNonce = round.nonce;

  // A counter rotates the negotiation's active nonce; the stale round is now
  // superseded and its captured nonce can no longer drive an accept.
  await service.counterOffer(round.offer_id, {
    offer_psbt: buildOfferPsbt(),
    offerer_signed_inputs: [0, 1],
    nonce: round.nonce,
  });

  // Replaying the stale round's accept PSBT under its stale nonce is rejected.
  await assert.rejects(
    service.acceptOffer(round.offer_id, buildAcceptPsbt(), staleNonce),
    ListingValidationError,
  );
});

test("[N5] invalidation race: a pre-spent committed input surfaces as a non-buildable/non-acceptable offer (race surfaced, not prevented)", async () => {
  // The taker asset UTXO has been spent out from under the round before the
  // concrete offer is built. Re-resolving it against ord surfaces the race.
  const spentOutputs = ordOutputs({
    [B_ASSET.outpoint]: makeOrdOutput(B_ASSET.outpoint, TAKER_SAT, 546, /* spent */ true),
  });
  const { service } = makeService(spentOutputs);

  const intent = await service.postIntent({
    give_assets: [GIVE_ASSET],
    want_spec: { mode: "specific", assets: [TAKER_ASSET] },
  });
  // respondToIntent re-resolves both assets; the spent taker input is rejected.
  await assert.rejects(
    service.respondToIntent(intent.offer_id, {
      taker_assets: [TAKER_ASSET],
      taker_build: takerBuild(),
    }),
    (err: unknown) => err instanceof ListingValidationError && /spent|unspent|indexed/i.test((err as Error).message),
  );
});
