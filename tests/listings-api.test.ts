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

test("POST /v1/listings accepts a valid offset-0 listing and GET /v1/listings returns it", async () => {
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
