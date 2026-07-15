import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SqliteListingStore } from "../src/listing-store.ts";
import { createApp } from "../src/server.ts";
import { parsePsbt } from "../src/psbt.ts";
import type { ListingRecord } from "../src/listing-types.ts";
import type { OrdOutput, OrdSat, OrdStatus } from "../src/types.ts";

interface VerifyNodeStub {
  status(): Promise<OrdStatus>;
  sat(number: number | bigint): Promise<OrdSat>;
}

function loadJsonFixture<T>(path: string): T {
  return JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8")) as T;
}

async function withServer(
  options: {
    ordOutputByOutpoint?: Record<string, OrdOutput>;
    verifyNodes?: VerifyNodeStub[];
    seedListings?: ListingRecord[];
  },
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const database = new DatabaseSync(":memory:");
  const store = new SqliteListingStore(database);

  for (const listing of options.seedListings ?? []) {
    store.insertListing(listing);
  }

  const app = createApp({
    database,
    listingStore: store,
    ordClient: {
      status: async () => {
        throw new Error("unused");
      },
      sat: async () => {
        throw new Error("unused");
      },
      output: async (outpoint: string) => {
        const output = options.ordOutputByOutpoint?.[outpoint];
        if (!output) {
          throw new Error(`Unexpected ord output request: ${outpoint}`);
        }

        return output;
      },
    },
    verifyOrdClients: options.verifyNodes,
    now: () => new Date("2026-07-13T00:00:00.000Z"),
    createListingId: () => "listing-session09",
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

function makeOrdStatus(): OrdStatus {
  return {
    address_index: false,
    blessed_inscriptions: 0,
    chain: "testnet4",
    cursed_inscriptions: 0,
    height: 143866,
    initial_sync_time: { secs: 0, nanos: 0 },
    inscription_index: true,
    inscriptions: 0,
    json_api: true,
    lost_sats: 0,
    minimum_rune_for_next_block: "A",
    rune_index: false,
    runes: 0,
    sat_index: true,
    started: "2026-07-13T00:00:00.000Z",
    transaction_index: true,
    unrecoverably_reorged: false,
    uptime: { secs: 1, nanos: 0 },
  };
}

test("GET /v1/verify/sat/{n} returns a 2-of-2 quorum result when nodes agree", async () => {
  const sat: OrdSat = {
    address: "tb1qverify",
    block: 100,
    charms: [],
    cycle: 0,
    decimal: "123.0",
    degree: "0",
    epoch: 0,
    inscriptions: [],
    name: "abc",
    number: 123,
    offset: 0,
    percentile: "0%",
    period: 0,
    rarity: "common",
    satpoint: "a".repeat(64) + ":0:0",
    timestamp: 0,
  };

  await withServer(
    {
      verifyNodes: [
        {
          status: async () => makeOrdStatus(),
          sat: async () => sat,
        },
        {
          status: async () => makeOrdStatus(),
          sat: async () => sat,
        },
      ],
    },
    async (baseUrl) => {
      const response = await fetch(new URL("/v1/verify/sat/123", baseUrl));

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        sat_number: number;
        satpoint: string;
        quorum: { required: number; agreed: number; total: number };
      };

      assert.equal(body.sat_number, 123);
      assert.equal(body.satpoint, sat.satpoint);
      assert.deepEqual(body.quorum, { required: 2, agreed: 2, total: 2 });
    },
  );
});

test("GET /v1/verify/sat/{n} rejects when quorum nodes disagree on satpoint", async () => {
  await withServer(
    {
      verifyNodes: [
        {
          status: async () => makeOrdStatus(),
          sat: async () => ({
            address: null,
            block: 1,
            charms: [],
            cycle: 0,
            decimal: "123.0",
            degree: "0",
            epoch: 0,
            inscriptions: [],
            name: "abc",
            number: 123,
            offset: 0,
            percentile: "0%",
            period: 0,
            rarity: "common",
            satpoint: "b".repeat(64) + ":0:0",
            timestamp: 0,
          }),
        },
        {
          status: async () => makeOrdStatus(),
          sat: async () => ({
            address: null,
            block: 1,
            charms: [],
            cycle: 0,
            decimal: "123.0",
            degree: "0",
            epoch: 0,
            inscriptions: [],
            name: "abc",
            number: 123,
            offset: 0,
            percentile: "0%",
            period: 0,
            rarity: "common",
            satpoint: "c".repeat(64) + ":0:0",
            timestamp: 0,
          }),
        },
      ],
    },
    async (baseUrl) => {
      const response = await fetch(new URL("/v1/verify/sat/123", baseUrl));

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /quorum/i);
    },
  );
});

test("Session 05 listing vector is accepted by POST /v1/listings and fill vector passes POST /v1/psbt/validate", async () => {
  const listingVector = loadJsonFixture<{
    asset_outpoint: string;
    seller_payment_address: string;
    listing_price_sats: number;
    psbt_base64: string;
    asset_value_sats: number;
  }>("../spec/psbt/vectors/listing-seller.json");

  const fillVector = loadJsonFixture<{
    signed_psbt_base64: string;
    input_order: Array<{ outpoint: string }>;
  }>("../spec/psbt/vectors/fill-buyer-2bump.json");

  const listedSatNumber = 777_777_777;

  await withServer(
    {
      ordOutputByOutpoint: {
        [listingVector.asset_outpoint]: {
          address: "tb1qasset",
          confirmations: 10,
          indexed: true,
          inscriptions: [],
          outpoint: listingVector.asset_outpoint,
          runes: {},
          sat_ranges: [[listedSatNumber, listedSatNumber + listingVector.asset_value_sats]],
          script_pubkey: "0014" + "11".repeat(20),
          spent: false,
          transaction: listingVector.asset_outpoint.split(":")[0] ?? "",
          value: listingVector.asset_value_sats,
        },
      },
    },
    async (baseUrl) => {
      const createResponse = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: listedSatNumber,
          outpoint: listingVector.asset_outpoint,
          price_sats: listingVector.listing_price_sats,
          seller_address: listingVector.seller_payment_address,
          signed_psbt: listingVector.psbt_base64,
        }),
      });

      assert.equal(createResponse.status, 201);

      const created = (await createResponse.json()) as { listing: { listing_id: string } };
      assert.equal(created.listing.listing_id, "listing-session09");

      const validateResponse = await fetch(new URL("/v1/psbt/validate", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          listing_id: "listing-session09",
          psbt_base64: fillVector.signed_psbt_base64,
        }),
      });

      assert.equal(validateResponse.status, 200);
      const validated = (await validateResponse.json()) as {
        valid: boolean;
        summary: { seller_input_index: number; buyer_input_count: number };
      };

      assert.equal(validated.valid, true);
      assert.equal(validated.summary.seller_input_index, 2);
      assert.equal(validated.summary.buyer_input_count, 3);
    },
  );
});

test("Session 05 invalid offset vector is rejected by POST /v1/listings", async () => {
  const invalidVector = loadJsonFixture<{
    outpoint: string;
    ord_output_json: OrdOutput;
    listed_sat_number: number;
  }>("../spec/psbt/vectors/invalid-offset-nonzero.json");

  const listingVector = loadJsonFixture<{
    listing_price_sats: number;
    seller_payment_address: string;
    psbt_base64: string;
  }>("../spec/psbt/vectors/listing-seller.json");

  await withServer(
    {
      ordOutputByOutpoint: {
        [invalidVector.outpoint]: {
          ...invalidVector.ord_output_json,
          address: "tb1qoffset",
          inscriptions: [],
          outpoint: invalidVector.outpoint,
          runes: {},
          script_pubkey: "0014" + "22".repeat(20),
          spent: false,
          transaction: invalidVector.outpoint.split(":")[0] ?? "",
          value: 4000,
        },
      },
    },
    async (baseUrl) => {
      const response = await fetch(new URL("/v1/listings", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          asset_type: "sat",
          sat_number: invalidVector.listed_sat_number,
          outpoint: invalidVector.outpoint,
          price_sats: listingVector.listing_price_sats,
          seller_address: listingVector.seller_payment_address,
          signed_psbt: listingVector.psbt_base64,
        }),
      });

      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /offset 0/i);
    },
  );
});

test("POST /v1/psbt/template returns a canonical 2-bump buyer-fill template for a stored listing", async () => {
  const listingVector = loadJsonFixture<{
    asset_outpoint: string;
    asset_value_sats: number;
    seller_payment_address: string;
    listing_price_sats: number;
    psbt_base64: string;
  }>("../spec/psbt/vectors/listing-seller.json");

  await withServer(
    {
      seedListings: [
        {
          listing_id: "listing-template",
          asset_type: "sat",
          sat_number: null,
          outpoint: listingVector.asset_outpoint,
          price_sats: listingVector.listing_price_sats,
          seller_address: listingVector.seller_payment_address,
          signed_psbt: listingVector.psbt_base64,
          created_at: "2026-07-13T00:00:00.000Z",
          expires_at: null,
          cancelled: false,
        },
      ],
    },
    async (baseUrl) => {
      const response = await fetch(new URL("/v1/psbt/template", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          listing_id: "listing-template",
          bump_inputs: [
            {
              outpoint: "d".repeat(64) + ":0",
              value_sats: 600,
              script_pubkey_hex: "0014" + "33".repeat(20),
            },
            {
              outpoint: "e".repeat(64) + ":1",
              value_sats: 600,
              script_pubkey_hex: "0014" + "44".repeat(20),
            },
          ],
          funding_inputs: [
            {
              outpoint: "f".repeat(64) + ":2",
              value_sats: 4000,
              script_pubkey_hex: "0014" + "55".repeat(20),
            },
          ],
          buyer_bump_script_pubkey_hex: "0014" + "66".repeat(20),
          buyer_asset_script_pubkey_hex: "0014" + "77".repeat(20),
          buyer_change_script_pubkey_hex: "0014" + "88".repeat(20),
          buyer_change_value_sats: 3000,
        }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        psbt_base64: string;
        summary: { input_outpoints: string[]; output_values: number[] };
      };

      assert.deepEqual(body.summary.input_outpoints, [
        "d".repeat(64) + ":0",
        "e".repeat(64) + ":1",
        listingVector.asset_outpoint,
        "f".repeat(64) + ":2",
      ]);
      assert.deepEqual(body.summary.output_values, [
        1200,
        listingVector.asset_value_sats,
        listingVector.listing_price_sats,
        3000,
      ]);

      const parsed = parsePsbt(body.psbt_base64);
      assert.equal(parsed.inputs[2]?.outpoint, listingVector.asset_outpoint);
      assert.deepEqual(
        parsed.outputs.map((output) => output.value),
        [1200, listingVector.asset_value_sats, listingVector.listing_price_sats, 3000],
      );
    },
  );
});
