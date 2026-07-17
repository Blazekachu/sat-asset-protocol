import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "../src/server.ts";
import type { OrdOutput } from "../src/types.ts";

function encodeVarInt(value: number): Buffer {
  if (value < 0xfd) {
    return Buffer.from([value]);
  }

  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer.writeUInt8(0xfd, 0);
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }

  throw new Error(`Unsupported varint value for test fixture: ${value}`);
}

function hexToReversedBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex").reverse();
}

function encodeUInt32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function encodeUInt64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function buildUnsignedTransaction(outpoint: string, outputValue: number): Buffer {
  const [txid, voutText] = outpoint.split(":");
  const vout = Number(voutText);

  const parts = [
    encodeUInt32LE(2),
    encodeVarInt(1),
    hexToReversedBuffer(txid),
    encodeUInt32LE(vout),
    Buffer.from([0x00]),
    encodeUInt32LE(0xfffffffd),
    encodeVarInt(1),
    encodeUInt64LE(outputValue),
    Buffer.from([0x00]),
    encodeUInt32LE(0),
  ];

  return Buffer.concat(parts);
}

function encodeMultiInputUnsignedTransaction(
  inputOutpoints: string[],
  outputs: Array<{ valueSats: number; scriptPubkeyHex: string }>,
): Buffer {
  const parts: Buffer[] = [encodeUInt32LE(2), encodeVarInt(inputOutpoints.length)];

  for (const outpoint of inputOutpoints) {
    const [txid, voutText] = outpoint.split(":");
    parts.push(hexToReversedBuffer(txid));
    parts.push(encodeUInt32LE(Number(voutText)));
    parts.push(Buffer.from([0x00]));
    parts.push(encodeUInt32LE(0xfffffffd));
  }

  parts.push(encodeVarInt(outputs.length));
  for (const output of outputs) {
    parts.push(encodeUInt64LE(output.valueSats));
    const script = Buffer.from(output.scriptPubkeyHex, "hex");
    parts.push(encodeVarInt(script.length));
    parts.push(script);
  }

  parts.push(encodeUInt32LE(0));
  return Buffer.concat(parts);
}

// Build a minimal canonical 2-bump fill PSBT (unsigned tx only) whose seller
// input sits at index 2 (matching `sellerOutpoint`). Outputs are provided by
// the caller so tests can craft sub-dust outputs.
function buildFillPsbt(
  sellerOutpoint: string,
  outputs: Array<{ valueSats: number; scriptPubkeyHex: string }>,
): string {
  const inputOutpoints = [
    "a".repeat(64) + ":0",
    "b".repeat(64) + ":1",
    sellerOutpoint,
    "c".repeat(64) + ":2",
  ];

  const unsignedTx = encodeMultiInputUnsignedTransaction(inputOutpoints, outputs);

  const globalMap = Buffer.concat([
    encodeVarInt(1),
    Buffer.from([0x00]),
    encodeVarInt(unsignedTx.length),
    unsignedTx,
    Buffer.from([0x00]),
  ]);

  return Buffer.concat([Buffer.from("70736274ff", "hex"), globalMap]).toString("base64");
}

function buildSignedListingPsbt(outpoint: string, priceSats: number): string {
  const unsignedTx = buildUnsignedTransaction(outpoint, priceSats);
  const partialSigKey = Buffer.concat([
    Buffer.from([0x02]),
    Buffer.from("02".repeat(33), "hex"),
  ]);
  const partialSigValue = Buffer.from("3006020101020101", "hex");
  const sighashTypeValue = encodeUInt32LE(0x03);

  const globalMap = Buffer.concat([
    encodeVarInt(1),
    Buffer.from([0x00]),
    encodeVarInt(unsignedTx.length),
    unsignedTx,
    Buffer.from([0x00]),
  ]);

  const inputMap = Buffer.concat([
    encodeVarInt(partialSigKey.length),
    partialSigKey,
    encodeVarInt(partialSigValue.length),
    partialSigValue,
    encodeVarInt(1),
    Buffer.from([0x03]),
    encodeVarInt(sighashTypeValue.length),
    sighashTypeValue,
    Buffer.from([0x00]),
  ]);

  const outputMap = Buffer.from([0x00]);

  return Buffer.concat([Buffer.from("70736274ff", "hex"), globalMap, inputMap, outputMap]).toString(
    "base64",
  );
}

async function withServer(
  ordOutput: OrdOutput,
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
        throw new Error("unused");
      },
      output: async (outpoint: string) => {
        assert.equal(outpoint, ordOutput.outpoint);
        return ordOutput;
      },
    },
    now: () => new Date("2026-07-12T16:00:00.000Z"),
    createListingId: () => "listing-test-id",
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

test("[M2][M5] POST /v1/listings accepts a valid offset-0 listing and GET /v1/listings returns it", async () => {
  const outpoint = "1111111111111111111111111111111111111111111111111111111111111111:0";

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346], [20000, 25000]],
      script_pubkey: "",
      spent: false,
      transaction: "1111111111111111111111111111111111111111111111111111111111111111",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: 50000,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as { listing: { listing_id: string } };
      assert.equal(created.listing.listing_id, "listing-test-id");

      const listResponse = await fetch(new URL("/v1/listings?sat_number=12345", baseUrl));
      assert.equal(listResponse.status, 200);

      const listed = (await listResponse.json()) as {
        listings: Array<{ outpoint: string; price_sats: number; cancelled: boolean }>;
      };

      assert.equal(listed.listings.length, 1);
      assert.equal(listed.listings[0]?.outpoint, outpoint);
      assert.equal(listed.listings[0]?.price_sats, 50000);
      assert.equal(listed.listings[0]?.cancelled, false);
    },
  );
});

test("POST /v1/listings rejects a sat that is not at offset 0", async () => {
  const outpoint = "2222222222222222222222222222222222222222222222222222222222222222:1";

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[10000, 12345], [12345, 13000]],
      script_pubkey: "",
      spent: false,
      transaction: "2222222222222222222222222222222222222222222222222222222222222222",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: 50000,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /offset 0/i);
    },
  );
});

test("POST /v1/psbt/validate rejects a fill PSBT with a sub-dust output", async () => {
  const outpoint = "3333333333333333333333333333333333333333333333333333333333333333:0";
  const priceSats = 1000;

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346]],
      script_pubkey: "",
      spent: false,
      transaction: "3333333333333333333333333333333333333333333333333333333333333333",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, priceSats);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: priceSats,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });
      assert.equal(createResponse.status, 201);

      // Output 3 (buyer change) is a P2WPKH worth 100 sats — below the 294-sat
      // P2WPKH dust threshold at the default 3 sat/vB fee rate.
      const p2wpkh = (fill: string) => "0014" + fill.repeat(20);
      const fillPsbt = buildFillPsbt(outpoint, [
        { valueSats: 1200, scriptPubkeyHex: p2wpkh("66") },
        { valueSats: 4000, scriptPubkeyHex: p2wpkh("77") },
        { valueSats: priceSats, scriptPubkeyHex: p2wpkh("88") },
        { valueSats: 100, scriptPubkeyHex: p2wpkh("99") },
      ]);

      const response = await fetch(new URL("/v1/psbt/validate", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: "listing-test-id",
          psbt_base64: fillPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /dust/i);
    },
  );
});

test("[M2] POST /v1/psbt/validate accepts a canonical fill PSBT with dust-safe outputs", async () => {
  const outpoint = "4444444444444444444444444444444444444444444444444444444444444444:0";
  const priceSats = 1000;

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346]],
      script_pubkey: "",
      spent: false,
      transaction: "4444444444444444444444444444444444444444444444444444444444444444",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, priceSats);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: priceSats,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });
      assert.equal(createResponse.status, 201);

      const p2wpkh = (fill: string) => "0014" + fill.repeat(20);
      const fillPsbt = buildFillPsbt(outpoint, [
        { valueSats: 1200, scriptPubkeyHex: p2wpkh("66") },
        { valueSats: 4000, scriptPubkeyHex: p2wpkh("77") },
        { valueSats: priceSats, scriptPubkeyHex: p2wpkh("88") },
        { valueSats: 3000, scriptPubkeyHex: p2wpkh("99") },
      ]);

      const response = await fetch(new URL("/v1/psbt/validate", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: "listing-test-id",
          psbt_base64: fillPsbt,
        }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        valid: boolean;
        summary: { seller_input_index: number; buyer_input_count: number };
      };
      assert.equal(body.valid, true);
      assert.equal(body.summary.seller_input_index, 2);
      assert.equal(body.summary.buyer_input_count, 3);
    },
  );
});

test("POST /v1/psbt/validate returns 400 (not 500) for a malformed PSBT", async () => {
  const outpoint = "5555555555555555555555555555555555555555555555555555555555555555:0";
  const priceSats = 1000;

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346]],
      script_pubkey: "",
      spent: false,
      transaction: "5555555555555555555555555555555555555555555555555555555555555555",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, priceSats);
      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: priceSats,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });
      assert.equal(createResponse.status, 201);

      // "not-a-psbt" lacks the PSBT magic prefix -> parse throws a plain Error.
      const response = await fetch(new URL("/v1/psbt/validate", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: "listing-test-id",
          psbt_base64: Buffer.from("not-a-psbt").toString("base64"),
        }),
      });

      assert.equal(response.status, 400);
    },
  );
});

test("POST /v1/psbt/template returns 400 (not 500) for a bad bump input outpoint", async () => {
  const outpoint = "6666666666666666666666666666666666666666666666666666666666666666:0";
  const priceSats = 1000;

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346]],
      script_pubkey: "",
      spent: false,
      transaction: "6666666666666666666666666666666666666666666666666666666666666666",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, priceSats);
      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: priceSats,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });
      assert.equal(createResponse.status, 201);

      const p2wpkh = (fill: string) => "0014" + fill.repeat(20);
      // "not-an-outpoint" fails the outpoint format check in buildUnsignedTransaction.
      const response = await fetch(new URL("/v1/psbt/template", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: "listing-test-id",
          bump_inputs: [
            { outpoint: "not-an-outpoint", value_sats: 600, script_pubkey_hex: p2wpkh("11") },
            { outpoint: "b".repeat(64) + ":1", value_sats: 600, script_pubkey_hex: p2wpkh("22") },
          ],
          funding_inputs: [
            { outpoint: "c".repeat(64) + ":2", value_sats: 5000, script_pubkey_hex: p2wpkh("33") },
          ],
          buyer_bump_script_pubkey_hex: p2wpkh("44"),
          buyer_asset_script_pubkey_hex: p2wpkh("55"),
          buyer_change_script_pubkey_hex: p2wpkh("66"),
          buyer_change_value_sats: 3000,
        }),
      });

      assert.equal(response.status, 400);
    },
  );
});

test("POST /v1/psbt/template returns 400 (not 500) for invalid buyer change script hex", async () => {
  const outpoint = "7777777777777777777777777777777777777777777777777777777777777777:0";
  const priceSats = 1000;

  await withServer(
    {
      address: "tb1qexample",
      confirmations: 5,
      indexed: true,
      inscriptions: [],
      outpoint,
      runes: {},
      sat_ranges: [[12345, 12346]],
      script_pubkey: "",
      spent: false,
      transaction: "7777777777777777777777777777777777777777777777777777777777777777",
      value: 5000,
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, priceSats);
      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          price_sats: priceSats,
          seller_address: "tb1qseller000000000000000000000000000000000",
          signed_psbt: signedPsbt,
        }),
      });
      assert.equal(createResponse.status, 201);

      const p2wpkh = (fill: string) => "0014" + fill.repeat(20);
      const response = await fetch(new URL("/v1/psbt/template", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: "listing-test-id",
          bump_inputs: [
            { outpoint: "a".repeat(64) + ":0", value_sats: 600, script_pubkey_hex: p2wpkh("11") },
            { outpoint: "b".repeat(64) + ":1", value_sats: 600, script_pubkey_hex: p2wpkh("22") },
          ],
          funding_inputs: [
            { outpoint: "c".repeat(64) + ":2", value_sats: 5000, script_pubkey_hex: p2wpkh("33") },
          ],
          buyer_bump_script_pubkey_hex: p2wpkh("44"),
          buyer_asset_script_pubkey_hex: p2wpkh("55"),
          // Odd-length / non-hex change script -> encodeScript throws a plain Error.
          buyer_change_script_pubkey_hex: "xyz",
          buyer_change_value_sats: 3000,
        }),
      });

      assert.equal(response.status, 400);
    },
  );
});
