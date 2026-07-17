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

// --- fixtures -------------------------------------------------------------

const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

const A_BUMP: TemplateInput = {
  outpoint: "a".repeat(64) + ":0",
  valueSats: 600,
  scriptPubkeyHex: p2wpkh("a1"),
};
const A_ASSET: TemplateInput = {
  outpoint: "b".repeat(64) + ":0",
  valueSats: 546,
  scriptPubkeyHex: p2wpkh("a2"),
};
const B_BUMP: TemplateInput = {
  outpoint: "c".repeat(64) + ":0",
  valueSats: 600,
  scriptPubkeyHex: p2wpkh("b1"),
};
const B_ASSET: TemplateInput = {
  outpoint: "d".repeat(64) + ":0",
  valueSats: 546,
  scriptPubkeyHex: p2wpkh("b2"),
};
const FEE_INPUT: TemplateInput = {
  outpoint: "e".repeat(64) + ":0",
  valueSats: 5000,
  scriptPubkeyHex: p2wpkh("ef"),
};

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

// Build a sat-for-sat PSBT matching the builder layout, with hand-injected
// partial sigs so tests can craft offer/accept/tampered fixtures.
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

  return Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]).toString(
    "base64",
  );
}

const CANONICAL_OUTPUTS: OutputSpec[] = [
  { valueSats: A_BUMP.valueSats, scriptPubkeyHex: A_CHANGE_SPK },
  { valueSats: A_ASSET.valueSats, scriptPubkeyHex: B_ORDINALS_SPK },
  { valueSats: B_BUMP.valueSats, scriptPubkeyHex: B_CHANGE_SPK },
  { valueSats: B_ASSET.valueSats, scriptPubkeyHex: A_ORDINALS_SPK },
  { valueSats: FEE_CHANGE_VALUE, scriptPubkeyHex: FEE_CHANGE_SPK },
];

// Offer PSBT: offerer (A) signs inputs [0],[1]; accepter inputs unsigned.
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

// Accept PSBT: all five inputs signed, byte-identical unsigned tx.
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

function makeOrdOutput(outpoint: string, satStart: number): OrdOutput {
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
    value: 546,
  };
}

async function withServer(
  ordOutputByOutpoint: Record<string, OrdOutput>,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const database = new DatabaseSync(":memory:");
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
    createOfferId: () => "offer-test-id",
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

function templateBody() {
  return {
    party_a: {
      bump_input: {
        outpoint: A_BUMP.outpoint,
        value_sats: A_BUMP.valueSats,
        script_pubkey_hex: A_BUMP.scriptPubkeyHex,
      },
      asset_input: {
        outpoint: A_ASSET.outpoint,
        value_sats: A_ASSET.valueSats,
        script_pubkey_hex: A_ASSET.scriptPubkeyHex,
      },
      change_script_pubkey_hex: A_CHANGE_SPK,
      counterparty_ordinals_script_pubkey_hex: B_ORDINALS_SPK,
    },
    party_b: {
      bump_input: {
        outpoint: B_BUMP.outpoint,
        value_sats: B_BUMP.valueSats,
        script_pubkey_hex: B_BUMP.scriptPubkeyHex,
      },
      asset_input: {
        outpoint: B_ASSET.outpoint,
        value_sats: B_ASSET.valueSats,
        script_pubkey_hex: B_ASSET.scriptPubkeyHex,
      },
      change_script_pubkey_hex: B_CHANGE_SPK,
      counterparty_ordinals_script_pubkey_hex: A_ORDINALS_SPK,
    },
    fee_funding_input: {
      outpoint: FEE_INPUT.outpoint,
      value_sats: FEE_INPUT.valueSats,
      script_pubkey_hex: FEE_INPUT.scriptPubkeyHex,
    },
    fee_payer_change_script_pubkey_hex: FEE_CHANGE_SPK,
    fee_payer_change_value_sats: FEE_CHANGE_VALUE,
  };
}

function createBody(offerPsbt: string) {
  return {
    offerer_sat_number: OFFERER_SAT,
    offerer_asset_outpoint: A_ASSET.outpoint,
    taker_sat_number: TAKER_SAT,
    taker_asset_outpoint: B_ASSET.outpoint,
    offer_psbt: offerPsbt,
  };
}

const offsetZeroOrdOutputs = (): Record<string, OrdOutput> => ({
  [A_ASSET.outpoint]: makeOrdOutput(A_ASSET.outpoint, OFFERER_SAT),
  [B_ASSET.outpoint]: makeOrdOutput(B_ASSET.outpoint, TAKER_SAT),
});

// --- tests ----------------------------------------------------------------

test("POST /v1/sat-for-sat/offers/template returns canonical input outpoints and output values", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(new URL("/v1/sat-for-sat/offers/template", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(templateBody()),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      psbt_base64: string;
      summary: { input_outpoints: string[]; output_values: number[] };
    };

    assert.deepEqual(body.summary.input_outpoints, [
      A_BUMP.outpoint,
      A_ASSET.outpoint,
      B_BUMP.outpoint,
      B_ASSET.outpoint,
      FEE_INPUT.outpoint,
    ]);
    assert.deepEqual(body.summary.output_values, [
      A_BUMP.valueSats,
      A_ASSET.valueSats,
      B_BUMP.valueSats,
      B_ASSET.valueSats,
      FEE_CHANGE_VALUE,
    ]);
    assert.ok(body.psbt_base64.length > 0);
  });
});

test("sat-for-sat offer round trip: create (201 open) -> get -> accept (200 accepted)", async () => {
  await withServer(offsetZeroOrdOutputs(), async (baseUrl) => {
    const offerPsbt = buildOfferPsbt();

    const createResponse = await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody(offerPsbt)),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      offer: { offer_id: string; status: string };
    };
    assert.equal(created.offer.offer_id, "offer-test-id");
    assert.equal(created.offer.status, "open");

    const getResponse = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id", baseUrl),
    );
    assert.equal(getResponse.status, 200);
    const fetched = (await getResponse.json()) as { offer: { status: string } };
    assert.equal(fetched.offer.status, "open");

    const acceptResponse = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt() }),
      },
    );
    assert.equal(acceptResponse.status, 200);
    const accepted = (await acceptResponse.json()) as {
      offer: { status: string; accept_psbt: string | null };
    };
    assert.equal(accepted.offer.status, "accepted");
    assert.ok(accepted.offer.accept_psbt);
  });
});

test("POST /v1/sat-for-sat/offers rejects when offerer asset is not at offset 0", async () => {
  const ordOutputs: Record<string, OrdOutput> = {
    // Offerer asset sat range does NOT start at OFFERER_SAT.
    [A_ASSET.outpoint]: makeOrdOutput(A_ASSET.outpoint, OFFERER_SAT + 100),
    [B_ASSET.outpoint]: makeOrdOutput(B_ASSET.outpoint, TAKER_SAT),
  };

  await withServer(ordOutputs, async (baseUrl) => {
    const response = await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody(buildOfferPsbt())),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /offset 0/i);
  });
});

test("POST accept rejects a tampered accept PSBT", async () => {
  await withServer(offsetZeroOrdOutputs(), async (baseUrl) => {
    const createResponse = await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody(buildOfferPsbt())),
    });
    assert.equal(createResponse.status, 201);

    const tamperedOutputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
    tamperedOutputs[4].valueSats = FEE_CHANGE_VALUE - 500;

    const acceptResponse = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt(tamperedOutputs) }),
      },
    );

    assert.equal(acceptResponse.status, 400);
    const body = (await acceptResponse.json()) as { error: string };
    assert.match(body.error, /does not match/i);
  });
});

test("POST accept rejects accepting an already-accepted offer", async () => {
  await withServer(offsetZeroOrdOutputs(), async (baseUrl) => {
    await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody(buildOfferPsbt())),
    });

    const first = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt() }),
      },
    );
    assert.equal(first.status, 200);

    const second = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt() }),
      },
    );
    assert.equal(second.status, 400);
    const body = (await second.json()) as { error: string };
    assert.match(body.error, /not open/i);
  });
});

test("GET /v1/sat-for-sat/offers/{id} returns 404 for an unknown id", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(
      new URL("/v1/sat-for-sat/offers/does-not-exist", baseUrl),
    );
    assert.equal(response.status, 404);
  });
});

test("POST /v1/sat-for-sat/offers/template returns 400 (not 500) for invalid script hex", async () => {
  await withServer({}, async (baseUrl) => {
    const body = templateBody();
    // Non-hex characters in a change script trigger a plain Error deep in the
    // PSBT/dust build path; the server must translate it to a 400 client error.
    body.party_a.change_script_pubkey_hex = "zzzznot-hex";

    const response = await fetch(new URL("/v1/sat-for-sat/offers/template", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 400);
  });
});

test("POST /v1/sat-for-sat/offers/template returns 400 (not 500) for unknown output script type", async () => {
  await withServer({}, async (baseUrl) => {
    const body = templateBody();
    // Valid hex but not a recognised script form -> classifyScript "unknown"
    // -> dustThresholdForScript throws a plain Error, which must map to 400.
    body.party_a.change_script_pubkey_hex = "abcdef";

    const response = await fetch(new URL("/v1/sat-for-sat/offers/template", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 400);
  });
});

// --- negotiation-lifecycle cells N2 (expiry) + N4 (cancellation) ----------
// The legacy single-shot offer is a concrete round whose nonce == offer_id, so
// it exercises the same accept / cancel / lazy-expiry CAS paths as a negotiated
// round. withServer's clock is fixed at 2026-07-15T00:00:00.000Z.

test("[N2] per-round expiry: accepting a round whose expires_at is in the past is rejected (400)", async () => {
  await withServer(offsetZeroOrdOutputs(), async (baseUrl) => {
    // Create an offer that already expired relative to the fixed clock.
    const createRes = await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...createBody(buildOfferPsbt()),
        expires_at: "2026-07-14T00:00:00.000Z",
      }),
    });
    assert.equal(createRes.status, 201);

    const acceptRes = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt(), nonce: "offer-test-id" }),
      },
    );
    assert.equal(acceptRes.status, 400);
    const body = (await acceptRes.json()) as { error: string };
    assert.match(body.error, /not open|expired/i);
  });
});

test("[N4] cancellation: a cancelled round cannot be accepted (400)", async () => {
  await withServer(offsetZeroOrdOutputs(), async (baseUrl) => {
    const createRes = await fetch(new URL("/v1/sat-for-sat/offers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody(buildOfferPsbt())),
    });
    assert.equal(createRes.status, 201);

    // Cancel the open round (legacy nonce == offer_id).
    const cancelRes = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/cancel", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce: "offer-test-id" }),
      },
    );
    assert.equal(cancelRes.status, 200);

    // Accepting the cancelled round is now rejected.
    const acceptRes = await fetch(
      new URL("/v1/sat-for-sat/offers/offer-test-id/accept", baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept_psbt: buildAcceptPsbt(), nonce: "offer-test-id" }),
      },
    );
    assert.equal(acceptRes.status, 400);
    const body = (await acceptRes.json()) as { error: string };
    assert.match(body.error, /not open|cancelled/i);
  });
});
