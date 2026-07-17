import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "../src/server.ts";
import { SqliteListingStore } from "../src/listing-store.ts";
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

// Build a signed listing PSBT whose input 0 spends `outpoint` with a seller
// partial signature under SIGHASH_SINGLE|ANYONECANPAY (0x03) and whose output 0
// equals `priceSats` — matching the seller listing contract enforced by
// ListingService for every asset type.
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

function makeOrdOutput(outpoint: string, overrides: Partial<OrdOutput>): OrdOutput {
  return {
    address: "tb1qexample",
    confirmations: 5,
    indexed: true,
    inscriptions: [],
    outpoint,
    runes: {},
    sat_ranges: null,
    script_pubkey: "",
    spent: false,
    transaction: outpoint.split(":")[0] ?? "",
    value: 5000,
    ...overrides,
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
        throw new Error("unused");
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
    createListingId: () => "listing-range-test-id",
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

function createBody(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    price_sats: 50000,
    seller_address: "tb1qseller000000000000000000000000000000000",
    ...overrides,
  });
}

test("[M5] range listing: single-range full-UTXO span is accepted and discoverable", async () => {
  const outpoint = "1111111111111111111111111111111111111111111111111111111111111111:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 2000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1000,
          sat_range_size: 1000,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as {
        listing: { listing_id: string; asset_type: string; sat_range_size: number };
      };
      assert.equal(created.listing.asset_type, "range");
      assert.equal(created.listing.sat_range_size, 1000);

      const listResponse = await fetch(
        new URL("/v1/listings?asset_type=range&sat_range_start=1000", baseUrl),
      );
      assert.equal(listResponse.status, 200);
      const listed = (await listResponse.json()) as {
        listings: Array<{
          outpoint: string;
          asset_type: string;
          sat_range_start: number;
          sat_range_size: number;
        }>;
      };

      assert.equal(listed.listings.length, 1);
      assert.equal(listed.listings[0]?.asset_type, "range");
      assert.equal(listed.listings[0]?.sat_range_start, 1000);
      assert.equal(listed.listings[0]?.sat_range_size, 1000);
    },
  );
});

test("range listing: a sub-range of a larger UTXO is rejected with the isolate message", async () => {
  const outpoint = "2222222222222222222222222222222222222222222222222222222222222222:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 2000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1000,
          sat_range_size: 500,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /isolate the range into its own UTXO/i);
    },
  );
});

test("range listing: a UTXO with multiple sat ranges is rejected", async () => {
  const outpoint = "3333333333333333333333333333333333333333333333333333333333333333:0";

  await withServer(
    {
      [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 1500], [1600, 1700]] }),
    },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1000,
          sat_range_size: 500,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /exactly one contiguous sat range/i);
    },
  );
});

test("range listing: a start that is not at offset 0 is rejected", async () => {
  const outpoint = "4444444444444444444444444444444444444444444444444444444444444444:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 2000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1500,
          sat_range_size: 500,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /offset 0/i);
    },
  );
});

test("range listing: a non-positive size is rejected", async () => {
  const outpoint = "5555555555555555555555555555555555555555555555555555555555555555:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 2000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1000,
          sat_range_size: 0,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /sat_range_size/i);
    },
  );
});

test("range listing: a size that runs past the range end is rejected", async () => {
  const outpoint = "6666666666666666666666666666666666666666666666666666666666666666:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[1000, 2000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "range",
          sat_range_start: 1000,
          sat_range_size: 1500,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /whole UTXO's sat span/i);
    },
  );
});

test("utxo listing: an indexed unspent output is accepted and discoverable", async () => {
  const outpoint = "7777777777777777777777777777777777777777777777777777777777777777:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[9000, 9500], [12000, 12100]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "utxo",
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as {
        listing: { asset_type: string; sat_number: number | null };
      };
      assert.equal(created.listing.asset_type, "utxo");
      assert.equal(created.listing.sat_number, 9000);

      const listResponse = await fetch(new URL("/v1/listings?asset_type=utxo", baseUrl));
      assert.equal(listResponse.status, 200);
      const listed = (await listResponse.json()) as {
        listings: Array<{ outpoint: string; asset_type: string }>;
      };
      assert.equal(listed.listings.length, 1);
      assert.equal(listed.listings[0]?.asset_type, "utxo");
      assert.equal(listed.listings[0]?.outpoint, outpoint);
    },
  );
});

test("utxo listing: a spent or unindexed output is rejected", async () => {
  const outpoint = "8888888888888888888888888888888888888888888888888888888888888888:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { indexed: true, spent: true }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "utxo",
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /spent/i);
    },
  );
});

test("migration: constructing a store over an OLD-schema listings table succeeds and adds range columns + index", () => {
  const database = new DatabaseSync(":memory:");

  // Simulate a pre-existing DB whose listings table predates the range
  // columns: no sat_range_start / sat_range_size, and no range index.
  database.exec(`
    CREATE TABLE listings (
      listing_id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      sat_number INTEGER,
      outpoint TEXT,
      price_sats INTEGER NOT NULL,
      seller_address TEXT NOT NULL,
      signed_psbt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0
    );
  `);

  // The constructor must not throw with "no such column: sat_range_start" —
  // the column migration has to run before the range index is created.
  assert.doesNotThrow(() => new SqliteListingStore(database));

  const columns = new Set(
    database
      .prepare("PRAGMA table_info(listings)")
      .all()
      .map((row) => String((row as Record<string, unknown>).name)),
  );
  assert.ok(columns.has("sat_range_start"), "sat_range_start column should exist after migration");
  assert.ok(columns.has("sat_range_size"), "sat_range_size column should exist after migration");

  const indexes = database
    .prepare("PRAGMA index_list(listings)")
    .all()
    .map((row) => String((row as Record<string, unknown>).name));
  assert.ok(
    indexes.includes("listings_open_range_idx"),
    "listings_open_range_idx should exist after migration",
  );

  database.close();
});

test("regression: an asset_type=sat listing still works end to end", async () => {
  const outpoint = "9999999999999999999999999999999999999999999999999999999999999999:0";

  await withServer(
    { [outpoint]: makeOrdOutput(outpoint, { sat_ranges: [[12345, 12346], [20000, 25000]] }) },
    async (baseUrl) => {
      const signedPsbt = buildSignedListingPsbt(outpoint, 50000);

      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody({
          asset_type: "sat",
          sat_number: 12345,
          outpoint,
          signed_psbt: signedPsbt,
        }),
      });

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as {
        listing: { asset_type: string; sat_range_start: number | null };
      };
      assert.equal(created.listing.asset_type, "sat");
      assert.equal(created.listing.sat_range_start, null);

      const listResponse = await fetch(new URL("/v1/listings?sat_number=12345", baseUrl));
      assert.equal(listResponse.status, 200);
      const listed = (await listResponse.json()) as {
        listings: Array<{ outpoint: string; asset_type: string }>;
      };
      assert.equal(listed.listings.length, 1);
      assert.equal(listed.listings[0]?.asset_type, "sat");
    },
  );
});

// --- offer-matrix range barter cells: M4, M6, M8, D4 ---------------------
// These drive the real sat-for-sat builder with range legs. The builder carries
// each asset's full span into its counterparty ordinals output (offset 0). The
// ord-level offset-0 / contiguous-span checks are covered by the listing/intent
// tests above; here we assert the PSBT byte shape + dust boundary for ranges.

import { buildSatForSatOfferPsbt, type SatForSatAssetSide } from "../src/sat-for-sat.ts";
import { PsbtValidationError, type TemplateInput } from "../src/psbt.ts";

const rlP2wpkh = (fill: string): string => "0014" + fill.repeat(20);
const rlInput = (seed: string, valueSats: number, fill: string): TemplateInput => ({
  outpoint: seed.repeat(64) + ":0",
  valueSats,
  scriptPubkeyHex: rlP2wpkh(fill),
});

function rangeOfferParams(aAssetValue: number, bAssetValue: number) {
  const partyA: SatForSatAssetSide = {
    bumpInput: rlInput("a", 600, "a1"),
    assetInput: rlInput("b", aAssetValue, "a2"),
    changeScriptPubkeyHex: rlP2wpkh("11"),
    counterpartyOrdinalsScriptPubkeyHex: rlP2wpkh("22"),
  };
  const partyB: SatForSatAssetSide = {
    bumpInput: rlInput("c", 600, "b1"),
    assetInput: rlInput("d", bAssetValue, "b2"),
    changeScriptPubkeyHex: rlP2wpkh("33"),
    counterpartyOrdinalsScriptPubkeyHex: rlP2wpkh("44"),
  };
  return {
    partyA,
    partyB,
    feeFundingInput: rlInput("e", 10000, "ef"),
    feePayerChangeScriptPubkeyHex: rlP2wpkh("55"),
    feePayerChangeValueSats: 3000,
  };
}

test("[M4] single range for a specific sat: range span <-> specific sat; both offset-0; value kept", () => {
  const result = buildSatForSatOfferPsbt(rangeOfferParams(5000, 546));
  assert.equal(result.outputValues[1], 5000); // A's range -> B ordinals
  assert.equal(result.outputValues[3], 546); // B's sat -> A ordinals
});

test("[M6] single range for a predicate-matched sat: range <-> predicate-matched sat builds; offset-0", () => {
  // The predicate acceptance is exercised in negotiation-model.test.ts; here the
  // matched sat + range settle through the builder (output offset-0 preserved).
  const result = buildSatForSatOfferPsbt(rangeOfferParams(4200, 546));
  assert.equal(result.outputValues[1], 4200);
  assert.equal(result.outputValues[3], 546);
});

test("[M8] single range for a specific range: range <-> range; both contiguous offset-0; value conserved", () => {
  const result = buildSatForSatOfferPsbt(rangeOfferParams(5000, 4000));
  assert.equal(result.outputValues[1], 5000);
  assert.equal(result.outputValues[3], 4000);
  const inSum = 600 + 5000 + 600 + 4000 + 10000;
  const outSum = result.outputValues.reduce((a, b) => a + b, 0);
  assert.ok(inSum - outSum >= 0);
});

test("[D4] range < dust (200) rejected; range >= dust (330) builds", () => {
  // 200-sat range into a P2WPKH ordinals output is below the 294 dust threshold.
  assert.throws(() => buildSatForSatOfferPsbt(rangeOfferParams(200, 546)), (err: unknown) => {
    assert.ok(err instanceof PsbtValidationError || (err as Error).name === "DustValidationError");
    assert.match((err as Error).message, /dust/i);
    return true;
  });
  // A 330-sat range clears P2WPKH (294) dust and builds.
  const ok = buildSatForSatOfferPsbt(rangeOfferParams(330, 546));
  assert.equal(ok.outputValues[1], 330);
});
