import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import test from "node:test";

import { SqliteListingStore } from "../src/listing-store.ts";
import { createApp } from "../src/server.ts";
import { rarityOfSat, satName } from "../src/collections.ts";
import type { ListingRecord, OfferRecord } from "../src/listing-types.ts";

// A well-known rare sat: the first sat of a block at a difficulty-adjustment
// boundary. Sat 0 is mythic; we use a plain common sat for the primary asset.
const SAT_A = 5_000_000_000; // block 1, offset 0 -> uncommon
const RANGE_START = 1_000_000_000;
const RANGE_SIZE = 1000;

function makeListing(overrides: Partial<ListingRecord> & { listing_id: string }): ListingRecord {
  return {
    asset_type: "sat",
    sat_number: null,
    outpoint: null,
    price_sats: 50000,
    seller_address: "tb1qseller000000000000000000000000000000000",
    signed_psbt: "cGxhY2Vob2xkZXI=",
    created_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    cancelled: false,
    sat_range_start: null,
    sat_range_size: null,
    ...overrides,
  };
}

function makeOffer(overrides: Partial<OfferRecord> & { offer_id: string }): OfferRecord {
  return {
    offerer_sat_number: 111,
    offerer_asset_outpoint: "a".repeat(64) + ":0",
    taker_sat_number: SAT_A,
    taker_asset_outpoint: "b".repeat(64) + ":0",
    offer_psbt: "cGxhY2Vob2xkZXI=",
    accept_psbt: null,
    status: "open",
    created_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    ...overrides,
  };
}

async function withServer(
  seed: (store: SqliteListingStore) => void,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const database = new DatabaseSync(":memory:");
  const store = new SqliteListingStore(database);
  seed(store);

  const app = createApp({
    database,
    listingStore: store,
    ordClient: {
      status: async () => {
        throw new Error("unused");
      },
      sat: async () => {
        throw new Error("no sat-capable client");
      },
      output: async () => {
        throw new Error("unused");
      },
    },
    now: () => new Date("2026-07-15T00:00:00.000Z"),
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

function seedAll(store: SqliteListingStore): void {
  store.insertListing(
    makeListing({
      listing_id: "sat-listing",
      asset_type: "sat",
      sat_number: SAT_A,
      outpoint: "c".repeat(64) + ":0",
    }),
  );
  store.insertListing(
    makeListing({
      listing_id: "range-listing",
      asset_type: "range",
      sat_number: RANGE_START,
      outpoint: "d".repeat(64) + ":0",
      sat_range_start: RANGE_START,
      sat_range_size: RANGE_SIZE,
    }),
  );
  store.insertOffer(makeOffer({ offer_id: "offer-1" }));
}

// --- tests ----------------------------------------------------------------

test("GET /v1/assets/{sat_number} returns derived name/rarity + open listings and offers", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(new URL(`/v1/assets/${SAT_A}`, baseUrl));
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      sat_number: number;
      sat_name: string;
      rarity: string;
      custody?: string;
      listings: Array<{ listing_id: string }>;
      offers: Array<{ offer_id: string }>;
    };

    assert.equal(body.sat_number, SAT_A);
    assert.equal(body.sat_name, satName(BigInt(SAT_A)));
    assert.equal(body.rarity, rarityOfSat(BigInt(SAT_A)));
    assert.equal(body.custody, undefined); // no sat-capable ord client (offline)
    assert.equal(body.listings.length, 1);
    assert.equal(body.listings[0]?.listing_id, "sat-listing");
    assert.equal(body.offers.length, 1);
    assert.equal(body.offers[0]?.offer_id, "offer-1");
  });
});

test("GET /v1/assets/range/{start}/{end} includes in-window and excludes out-of-window listings", async () => {
  await withServer(seedAll, async (baseUrl) => {
    // Window covers the range listing but not the sat listing (SAT_A).
    const response = await fetch(
      new URL(`/v1/assets/range/${RANGE_START - 10}/${RANGE_START + 10}`, baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      range: { start: number; end: number };
      listings: Array<{ listing_id: string }>;
    };

    assert.equal(body.range.start, RANGE_START - 10);
    const ids = body.listings.map((l) => l.listing_id);
    assert.ok(ids.includes("range-listing"));
    assert.ok(!ids.includes("sat-listing"));
  });
});

test("GET /v1/assets/range/{start}/{end} includes a sat listing whose sat falls in-window", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(
      new URL(`/v1/assets/range/${SAT_A - 1}/${SAT_A + 1}`, baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { listings: Array<{ listing_id: string }> };
    const ids = body.listings.map((l) => l.listing_id);
    assert.ok(ids.includes("sat-listing"));
    assert.ok(!ids.includes("range-listing"));
  });
});

test("GET /v1/assets/range/{start}/{end} with start >= end returns 400", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(new URL("/v1/assets/range/2000/2000", baseUrl));
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /less than/i);
  });
});

test("GET /v1/assets/search?name_prefix= filters by derived sat name", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const prefix = satName(BigInt(SAT_A)).slice(0, 3);
    const response = await fetch(
      new URL(`/v1/assets/search?name_prefix=${prefix}`, baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      assets: Array<{ listing_id: string; sat_name: string }>;
    };
    assert.ok(body.assets.every((a) => a.sat_name.startsWith(prefix)));
    assert.ok(body.assets.some((a) => a.listing_id === "sat-listing"));
  });
});

test("GET /v1/assets/search?rarity= filters by minimum rarity", async () => {
  await withServer(seedAll, async (baseUrl) => {
    // SAT_A is uncommon; a min rarity of "legendary" should exclude it.
    const response = await fetch(
      new URL("/v1/assets/search?rarity=legendary", baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { assets: Array<{ listing_id: string }> };
    const ids = body.assets.map((a) => a.listing_id);
    assert.ok(!ids.includes("sat-listing"));

    // A min rarity of "common" should include everything with a sat_number.
    const commonResponse = await fetch(
      new URL("/v1/assets/search?rarity=common", baseUrl),
    );
    const commonBody = (await commonResponse.json()) as {
      assets: Array<{ listing_id: string }>;
    };
    const commonIds = commonBody.assets.map((a) => a.listing_id);
    assert.ok(commonIds.includes("sat-listing"));
  });
});

test("GET /v1/assets/search?asset_type=range filters by asset type", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(
      new URL("/v1/assets/search?asset_type=range", baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      assets: Array<{ listing_id: string; asset_type: string }>;
    };
    assert.ok(body.assets.every((a) => a.asset_type === "range"));
    assert.ok(body.assets.some((a) => a.listing_id === "range-listing"));
  });
});

test("GET /v1/assets/search rejects a partial-string integer query param (123abc)", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(
      new URL("/v1/assets/search?sat_number=123abc", baseUrl),
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /sat_number/);
  });
});

test("GET /v1/assets/search rejects a negative integer query param", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(
      new URL("/v1/assets/search?sat_number=-5", baseUrl),
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /sat_number/);
  });
});

test("GET /v1/assets/search treats an empty integer query param as absent", async () => {
  await withServer(seedAll, async (baseUrl) => {
    // Empty sat_number should be ignored (undefined), returning all assets.
    const response = await fetch(
      new URL("/v1/assets/search?sat_number=", baseUrl),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { assets: Array<{ listing_id: string }> };
    assert.ok(body.assets.length >= 1);
  });
});

test("GET /v1/listings rejects a malformed sat_number query param", async () => {
  await withServer(seedAll, async (baseUrl) => {
    const response = await fetch(
      new URL("/v1/listings?sat_number=99x", baseUrl),
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /sat_number/);
  });
});
