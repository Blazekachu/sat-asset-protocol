import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.ts";
import { OrdClient } from "../src/ord-client.ts";

test("GET /status passes against the local live testnet4 ord", async () => {
  const config = loadConfig();
  const client = new OrdClient(config.ordBaseUrl);

  const status = await client.status();

  assert.equal(status.chain, "testnet4");
  assert.equal(status.json_api, true);
  assert.equal(status.sat_index, true);
  assert.ok(typeof status.height === "number");
});
