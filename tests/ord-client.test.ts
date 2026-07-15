import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { OrdClient } from "../src/ord-client.ts";

async function withJsonServer(
  routes: Record<string, unknown>,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const requests: Array<{ path?: string; accept?: string }> = [];

  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? undefined,
      accept: request.headers.accept,
    });

    const payload = request.url ? routes[request.url] : undefined;
    if (payload === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  try {
    await run(new URL(`http://127.0.0.1:${address.port}/`));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.equal(request.accept, "application/json");
  }
}

test("OrdClient.status parses ord status JSON", async () => {
  await withJsonServer(
    {
      "/status": {
        address_index: true,
        blessed_inscriptions: 283243,
        chain: "testnet4",
        cursed_inscriptions: 0,
        height: 143866,
        initial_sync_time: { secs: 0, nanos: 0 },
        inscription_index: true,
        inscriptions: 283243,
        json_api: true,
        lost_sats: 25002546925,
        minimum_rune_for_next_block: "UGPG",
        rune_index: true,
        runes: 23753,
        sat_index: true,
        started: "2026-07-12T14:16:08.779812500Z",
        transaction_index: true,
        unrecoverably_reorged: false,
        uptime: { secs: 7296, nanos: 876031900 },
      },
    },
    async (baseUrl) => {
      const client = new OrdClient(baseUrl);
      const status = await client.status();

      assert.equal(status.chain, "testnet4");
      assert.equal(status.height, 143866);
      assert.equal(status.sat_index, true);
      assert.equal(status.json_api, true);
    },
  );
});

test("OrdClient.sat parses sat JSON", async () => {
  await withJsonServer(
    {
      "/sat/0": {
        address: null,
        block: 0,
        charms: ["coin", "mythic", "palindrome"],
        cycle: 0,
        decimal: "0.0",
        degree: "0°0′0″0‴",
        epoch: 0,
        inscriptions: [],
        name: "nvtdijuwxlp",
        number: 0,
        offset: 0,
        percentile: "0%",
        period: 0,
        rarity: "mythic",
        satpoint: "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0:0",
        timestamp: 1714777860,
      },
    },
    async (baseUrl) => {
      const client = new OrdClient(baseUrl);
      const sat = await client.sat(0);

      assert.equal(sat.number, 0);
      assert.equal(sat.name, "nvtdijuwxlp");
      assert.equal(sat.rarity, "mythic");
      assert.equal(
        sat.satpoint,
        "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0:0",
      );
    },
  );
});

test("OrdClient.output parses output JSON", async () => {
  await withJsonServer(
    {
      "/output/7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0": {
        address: null,
        confirmations: 143867,
        indexed: true,
        inscriptions: [],
        outpoint: "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0",
        runes: {},
        sat_ranges: [[0, 5000000000]],
        script_pubkey:
          "21000000000000000000000000000000000000000000000000000000000000000000ac",
        spent: false,
        transaction: "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e",
        value: 5000000000,
      },
    },
    async (baseUrl) => {
      const client = new OrdClient(baseUrl);
      const output = await client.output(
        "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0",
      );

      assert.equal(output.outpoint, "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0");
      assert.equal(output.value, 5000000000);
      assert.deepEqual(output.sat_ranges, [[0, 5000000000]]);
      assert.equal(output.spent, false);
    },
  );
});
