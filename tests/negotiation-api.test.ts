import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import test from "node:test";

import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  PSBT_MAGIC,
  type TemplateInput,
} from "../src/psbt.ts";
import { createApp } from "../src/server.ts";
import type { OrdOutput } from "../src/types.ts";

// --- fixtures (mirrors offers-api.test.ts) --------------------------------

const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

const A_BUMP: TemplateInput = { outpoint: "a".repeat(64) + ":0", valueSats: 600, scriptPubkeyHex: p2wpkh("a1") };
const A_ASSET: TemplateInput = { outpoint: "b".repeat(64) + ":0", valueSats: 546, scriptPubkeyHex: p2wpkh("a2") };
const B_BUMP: TemplateInput = { outpoint: "c".repeat(64) + ":0", valueSats: 600, scriptPubkeyHex: p2wpkh("b1") };
const B_ASSET: TemplateInput = { outpoint: "d".repeat(64) + ":0", valueSats: 546, scriptPubkeyHex: p2wpkh("b2") };
const FEE_INPUT: TemplateInput = { outpoint: "e".repeat(64) + ":0", valueSats: 5000, scriptPubkeyHex: p2wpkh("ef") };

const A_CHANGE_SPK = p2wpkh("11");
const B_ORDINALS_SPK = p2wpkh("22");
const B_CHANGE_SPK = p2wpkh("33");
const A_ORDINALS_SPK = p2wpkh("44");
const FEE_CHANGE_SPK = p2wpkh("55");
const FEE_CHANGE_VALUE = 3000;

const OFFERER_SAT = 12345;
const TAKER_SAT = 67890;

interface SigSpec {
  sighash: number;
}
interface InputSpec {
  input: TemplateInput;
  sig?: SigSpec;
}
interface OutputSpec {
  valueSats: number;
  scriptPubkeyHex: string;
}

function buildSatForSatPsbt(inputs: InputSpec[], outputs: OutputSpec[]): string {
  const inputOutpoints = inputs.map((spec) => spec.input.outpoint);
  const unsignedTx = buildUnsignedTransaction(inputOutpoints, outputs);
  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTx),
    Buffer.from([0x00]),
  ]);
  const inputMaps = inputs.map((spec) => {
    const entries: Buffer[] = [
      encodeWitnessUtxoMap(spec.input.valueSats, spec.input.scriptPubkeyHex),
    ];
    if (spec.sig) {
      const pubkey = Buffer.from("02".repeat(33), "hex");
      const key = Buffer.concat([Buffer.from([0x02]), pubkey]);
      const value = Buffer.concat([
        Buffer.from("3006020101020101", "hex"),
        Buffer.from([spec.sig.sighash]),
      ]);
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

function buildAcceptPsbt(outputs: OutputSpec[] = CANONICAL_OUTPUTS): string {
  return buildSatForSatPsbt(
    [
      { input: A_BUMP, sig: { sighash: 0x01 } },
      { input: A_ASSET, sig: { sighash: 0x01 } },
      { input: B_BUMP, sig: { sighash: 0x01 } },
      { input: B_ASSET, sig: { sighash: 0x01 } },
      { input: FEE_INPUT, sig: { sighash: 0x01 } },
    ],
    outputs,
  );
}

function makeOrdOutput(outpoint: string, satStart: number, value = 546): OrdOutput {
  return {
    address: "tb1qexample",
    confirmations: 5,
    indexed: true,
    inscriptions: [],
    outpoint,
    runes: {},
    sat_ranges: [[satStart, satStart + 1]],
    script_pubkey: "",
    spent: false,
    transaction: outpoint.split(":")[0]!,
    value,
  };
}

// The give asset is A_ASSET (offerer, offset 0 at OFFERER_SAT); the taker asset
// is B_ASSET (offset 0 at TAKER_SAT). Bump + fee UTXOs resolve for /build.
const negotiationOrdOutputs = (): Record<string, OrdOutput> => ({
  [A_ASSET.outpoint]: makeOrdOutput(A_ASSET.outpoint, OFFERER_SAT),
  [B_ASSET.outpoint]: makeOrdOutput(B_ASSET.outpoint, TAKER_SAT),
  [A_BUMP.outpoint]: makeOrdOutput(A_BUMP.outpoint, 1000, 600),
  [B_BUMP.outpoint]: makeOrdOutput(B_BUMP.outpoint, 2000, 600),
  [FEE_INPUT.outpoint]: makeOrdOutput(FEE_INPUT.outpoint, 3000, 10000),
});

async function withServer(
  ordOutputByOutpoint: Record<string, OrdOutput>,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const database = new DatabaseSync(":memory:");
  let offerSeq = 0;
  let nonceSeq = 0;
  const app = createApp({
    database,
    ordClient: {
      status: async () => {
        throw new Error("unused");
      },
      sat: async () => {
        throw new Error("no sat-capable client");
      },
      output: async (outpoint: string) => {
        const output = ordOutputByOutpoint[outpoint];
        if (!output) {
          throw new Error(`Unexpected ord output request: ${outpoint}`);
        }
        return output;
      },
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    createOfferId: () => `offer-${++offerSeq}`,
    createNonce: () => `nonce-${++nonceSeq}`,
  });

  const server = createServer(app.handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  try {
    await run(new URL(`http://127.0.0.1:${address.port}/`));
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

// --- helpers to compose the negotiation flow ------------------------------

const giveAssetRef = () => ({
  asset_type: "sat" as const,
  asset_outpoint: A_ASSET.outpoint,
  sat_number: OFFERER_SAT,
});
const takerAssetRef = () => ({
  asset_type: "sat" as const,
  asset_outpoint: B_ASSET.outpoint,
  sat_number: TAKER_SAT,
});
const takerBuild = () => ({
  bump_outpoints: [B_BUMP.outpoint],
  change_script_pubkey_hex: B_CHANGE_SPK,
  ordinals_script_pubkey_hex: B_ORDINALS_SPK,
});
const offererBuild = () => ({
  bump_outpoints: [A_BUMP.outpoint],
  change_script_pubkey_hex: A_CHANGE_SPK,
  ordinals_script_pubkey_hex: A_ORDINALS_SPK,
});

async function postJson(baseUrl: URL, path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface OfferBody {
  offer_id: string;
  status: string;
  nonce: string;
  counter_index: number;
  negotiation_id: string;
}

async function postIntent(baseUrl: URL): Promise<OfferBody> {
  const res = await postJson(baseUrl, "/v1/sat-for-sat/intents", {
    give_assets: [giveAssetRef()],
    want_spec: { mode: "specific", assets: [takerAssetRef()] },
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { offer: OfferBody }).offer;
}

async function respond(baseUrl: URL, intentId: string): Promise<OfferBody> {
  const res = await postJson(baseUrl, `/v1/sat-for-sat/intents/${intentId}/respond`, {
    taker_assets: [takerAssetRef()],
    taker_build: takerBuild(),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { offer: OfferBody }).offer;
}

// --- tests ----------------------------------------------------------------

test("POST /v1/sat-for-sat/intents creates an open intent (201)", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    assert.equal(intent.status, "open");
    assert.ok(intent.nonce);
  });
});

test("GET /v1/sat-for-sat/intents lists the intent and honours candidate_sat filtering", async () => {
  const ordOutputs = negotiationOrdOutputs();
  await withServer(ordOutputs, async (baseUrl) => {
    // Post a predicate intent so candidate_sat matching is exercised.
    const res = await postJson(baseUrl, "/v1/sat-for-sat/intents", {
      give_assets: [giveAssetRef()],
      want_spec: {
        mode: "predicate",
        predicate: { type: "sat_range", params: { start: 0, end: 100000 } },
        count: 1,
      },
    });
    assert.equal(res.status, 201);

    const listRes = await fetch(new URL("/v1/sat-for-sat/intents", baseUrl));
    assert.equal(listRes.status, 200);
    const listed = (await listRes.json()) as { intents: OfferBody[] };
    assert.equal(listed.intents.length, 1);

    const included = (await (
      await fetch(new URL("/v1/sat-for-sat/intents?candidate_sat=50", baseUrl))
    ).json()) as { intents: OfferBody[] };
    assert.equal(included.intents.length, 1);

    const excluded = (await (
      await fetch(new URL("/v1/sat-for-sat/intents?candidate_sat=999999", baseUrl))
    ).json()) as { intents: OfferBody[] };
    assert.equal(excluded.intents.length, 0);
  });
});

test("POST respond returns a concrete round (201) and marks the intent countered", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);
    assert.equal(round.status, "open");
    assert.equal(round.counter_index, 1);
    assert.equal(round.negotiation_id, intent.negotiation_id);

    const intentAfter = (await (
      await fetch(new URL(`/v1/sat-for-sat/offers/${intent.offer_id}`, baseUrl))
    ).json()) as { offer: OfferBody };
    assert.equal(intentAfter.offer.status, "countered");
  });
});

test("POST build returns an unsigned single-asset PSBT (200)", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);
    const res = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/build`, {
      offerer_build: offererBuild(),
      fee_funding_outpoint: FEE_INPUT.outpoint,
      fee_payer_change_script_pubkey_hex: FEE_CHANGE_SPK,
      fee_payer_change_value_sats: FEE_CHANGE_VALUE,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { psbt_base64: string; summary: { input_outpoints: string[] } };
    assert.ok(body.psbt_base64.length > 0);
    assert.equal(body.summary.input_outpoints.length, 5);
  });
});

test("full round flow: intent -> respond -> sign -> accept -> settled", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);

    const signRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/sign`, {
      offer_psbt: buildOfferPsbt(),
      offerer_signed_inputs: [0, 1],
      nonce: round.nonce,
    });
    assert.equal(signRes.status, 200);
    const signed = ((await signRes.json()) as { offer: OfferBody }).offer;
    assert.equal(signed.status, "open");

    const acceptRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/accept`, {
      accept_psbt: buildAcceptPsbt(),
      nonce: round.nonce,
    });
    assert.equal(acceptRes.status, 200);
    const accepted = ((await acceptRes.json()) as { offer: OfferBody }).offer;
    assert.equal(accepted.status, "accepted");

    const settledRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/settled`, {
      txid: "f".repeat(64),
      nonce: round.nonce,
    });
    assert.equal(settledRes.status, 200);
    const settled = ((await settledRes.json()) as { offer: { status: string; settlement_txid: string } }).offer;
    assert.equal(settled.status, "settled");
    assert.equal(settled.settlement_txid, "f".repeat(64));
  });
});

test("POST sign rejects a stale nonce (400)", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);
    const res = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/sign`, {
      offer_psbt: buildOfferPsbt(),
      offerer_signed_inputs: [0, 1],
      nonce: "wrong-nonce",
    });
    assert.equal(res.status, 400);
  });
});

test("POST counter creates a new signed round (201) and supersedes the parent; tampered PSBT is rejected (400)", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);

    // Tampered PSBT: the offerer's required asset-input signatures are missing,
    // so re-validation on counter rejects it → 400.
    const unsignedOffer = buildSatForSatPsbt(
      [
        { input: A_BUMP },
        { input: A_ASSET },
        { input: B_BUMP },
        { input: B_ASSET },
        { input: FEE_INPUT },
      ],
      CANONICAL_OUTPUTS,
    );
    const badRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/counter`, {
      offer_psbt: unsignedOffer,
      offerer_signed_inputs: [0, 1],
      nonce: round.nonce,
    });
    assert.equal(badRes.status, 400);

    // Valid counter → 201 new round, parent countered.
    const res = await postJson(baseUrl, `/v1/sat-for-sat/offers/${round.offer_id}/counter`, {
      offer_psbt: buildOfferPsbt(),
      offerer_signed_inputs: [0, 1],
      nonce: round.nonce,
    });
    assert.equal(res.status, 201);
    const counter = ((await res.json()) as { offer: OfferBody }).offer;
    assert.equal(counter.counter_index, 2);
    assert.equal(counter.status, "open");

    const parentAfter = (await (
      await fetch(new URL(`/v1/sat-for-sat/offers/${round.offer_id}`, baseUrl))
    ).json()) as { offer: OfferBody };
    assert.equal(parentAfter.offer.status, "countered");
  });
});

test("POST cancel cancels an open round (200); cancel again -> 400", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const cancelRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${intent.offer_id}/cancel`, {
      nonce: intent.nonce,
    });
    assert.equal(cancelRes.status, 200);
    const cancelled = ((await cancelRes.json()) as { offer: OfferBody }).offer;
    assert.equal(cancelled.status, "cancelled");

    const againRes = await postJson(baseUrl, `/v1/sat-for-sat/offers/${intent.offer_id}/cancel`, {
      nonce: intent.nonce,
    });
    assert.equal(againRes.status, 400);
  });
});

test("GET /v1/sat-for-sat/negotiations/:id returns the thread ordered by counter_index", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const intent = await postIntent(baseUrl);
    const round = await respond(baseUrl, intent.offer_id);
    const res = await fetch(new URL(`/v1/sat-for-sat/negotiations/${intent.negotiation_id}`, baseUrl));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { negotiation_id: string; rounds: OfferBody[] };
    assert.deepEqual(
      body.rounds.map((r) => r.counter_index),
      [0, 1],
    );
    assert.equal(body.rounds[1].offer_id, round.offer_id);
  });
});

test("GET negotiations returns 404 for an unknown thread", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const res = await fetch(new URL("/v1/sat-for-sat/negotiations/does-not-exist", baseUrl));
    assert.equal(res.status, 404);
  });
});

test("backward-compat: legacy single-shot POST /v1/sat-for-sat/offers still returns 201 open", async () => {
  await withServer(negotiationOrdOutputs(), async (baseUrl) => {
    const res = await postJson(baseUrl, "/v1/sat-for-sat/offers", {
      offerer_sat_number: OFFERER_SAT,
      offerer_asset_outpoint: A_ASSET.outpoint,
      taker_sat_number: TAKER_SAT,
      taker_asset_outpoint: B_ASSET.outpoint,
      offer_psbt: buildOfferPsbt(),
    });
    assert.equal(res.status, 201);
    const created = ((await res.json()) as { offer: OfferBody }).offer;
    assert.equal(created.status, "open");
  });
});
