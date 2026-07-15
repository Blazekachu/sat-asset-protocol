import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SqliteListingStore } from "../src/listing-store.ts";
import { createApp } from "../src/server.ts";
import type { OrdOutput, OrdSat, OrdStatus } from "../src/types.ts";

interface VerifyNodeStub {
  status(): Promise<OrdStatus>;
  sat(number: number | bigint): Promise<OrdSat>;
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

async function withServer(
  options: {
    verifyNodes?: VerifyNodeStub[];
    ordOutputByOutpoint?: Record<string, OrdOutput>;
    seedCollections?: Array<{
      collection_id: string;
      name: string;
      predicate_type: string;
      predicate_params: Record<string, unknown>;
    }>;
  },
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const database = new DatabaseSync(":memory:");
  const store = new SqliteListingStore(database);

  for (const collection of options.seedCollections ?? []) {
    store.insertCollection(collection);
  }

  const app = createApp({
    database,
    listingStore: store,
    ordClient: {
      status: async () => makeOrdStatus(),
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

test("GET /v1/collections/{id}/verify/{sat_number} evaluates rarity and block_range predicates", async () => {
  await withServer(
    {
      seedCollections: [
        {
          collection_id: "rare-and-up",
          name: "Rare and up",
          predicate_type: "rarity",
          predicate_params: { min_rarity: "rare" },
        },
        {
          collection_id: "genesis-window",
          name: "Genesis window",
          predicate_type: "block_range",
          predicate_params: { start_height: 0, end_height: 1 },
        },
      ],
    },
    async (baseUrl) => {
      const rarityTrue = await fetch(new URL("/v1/collections/rare-and-up/verify/0", baseUrl));
      assert.equal(rarityTrue.status, 200);
      assert.deepEqual(await rarityTrue.json(), { verified: true });

      const rarityFalse = await fetch(new URL("/v1/collections/rare-and-up/verify/1", baseUrl));
      assert.equal(rarityFalse.status, 200);
      assert.deepEqual(await rarityFalse.json(), { verified: false });

      const blockRangeTrue = await fetch(new URL("/v1/collections/genesis-window/verify/0", baseUrl));
      assert.equal(blockRangeTrue.status, 200);
      assert.deepEqual(await blockRangeTrue.json(), { verified: true });

      const blockRangeFalse = await fetch(new URL("/v1/collections/genesis-window/verify/5000000000", baseUrl));
      assert.equal(blockRangeFalse.status, 200);
      assert.deepEqual(await blockRangeFalse.json(), { verified: false });
    },
  );
});

test("GET /v1/collections/{id}/assets returns paginated matches (stub scan window)", async () => {
  await withServer(
    {
      seedCollections: [
        {
          collection_id: "exact-sat",
          name: "Exact sat",
          predicate_type: "sat_number",
          predicate_params: { number: 3 },
        },
      ],
    },
    async (baseUrl) => {
      const response = await fetch(
        new URL("/v1/collections/exact-sat/assets?cursor=0&limit=10", baseUrl),
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        assets: Array<{ sat_number: number }>;
        page: { next_cursor: string | null };
        stub_scan_window?: { start_sat: string; scanned: number };
      };

      assert.deepEqual(body.assets, [{ sat_number: 3 }]);
      assert.equal(body.page.next_cursor, "10");
      assert.ok(body.stub_scan_window);
    },
  );
});

test("POST /v1/attestations accepts valid ed25519 signatures and rejects invalid signatures", async () => {
  const keyPair = generateKeyPairSync("ed25519");
  const issuerPubkeyBase64 = keyPair.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const canonicalPayload = JSON.stringify({
    subject_sat: "42",
    claim: "black_sat:test",
    expires_at: null,
  });
  const validSignature = sign(null, Buffer.from(canonicalPayload, "utf8"), keyPair.privateKey).toString(
    "base64",
  );

  await withServer({}, async (baseUrl) => {
    const validCreate = await fetch(new URL("/v1/attestations", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attestation_id: "att-1",
        subject_sat: 42,
        claim: "black_sat:test",
        issuer_pubkey: issuerPubkeyBase64,
        signature: validSignature,
        expires_at: null,
      }),
    });

    assert.equal(validCreate.status, 201);
    assert.equal((await validCreate.json() as { stored: boolean }).stored, true);

    const invalidCreate = await fetch(new URL("/v1/attestations", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attestation_id: "att-2",
        subject_sat: 42,
        claim: "black_sat:test",
        issuer_pubkey: issuerPubkeyBase64,
        signature: Buffer.from("bad-signature", "utf8").toString("base64"),
        expires_at: null,
      }),
    });

    assert.equal(invalidCreate.status, 400);
    const invalidBody = (await invalidCreate.json()) as { error: string };
    assert.match(invalidBody.error, /signature/i);
  });
});

test("GET /v1/attestations/{sat_number} returns stored attestations for that sat", async () => {
  const keyPair = generateKeyPairSync("ed25519");
  const issuerPubkeyBase64 = keyPair.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const payload = JSON.stringify({
    subject_sat: "99",
    claim: "institution_certified:test",
    expires_at: null,
  });
  const signature = sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");

  await withServer({}, async (baseUrl) => {
    const create = await fetch(new URL("/v1/attestations", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attestation_id: "att-get-1",
        subject_sat: 99,
        claim: "institution_certified:test",
        issuer_pubkey: issuerPubkeyBase64,
        signature,
        expires_at: null,
      }),
    });
    assert.equal(create.status, 201);

    const response = await fetch(new URL("/v1/attestations/99", baseUrl));
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      attestations: Array<{ attestation_id: string; subject_sat: number }>;
    };
    assert.equal(body.attestations.length, 1);
    assert.equal(body.attestations[0]?.attestation_id, "att-get-1");
    assert.equal(body.attestations[0]?.subject_sat, 99);
  });
});
