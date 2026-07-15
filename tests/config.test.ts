import assert from "node:assert/strict";
import test from "node:test";

import { configEnv, loadConfig } from "../src/config.ts";

test("loadConfig uses localhost ord defaults when env vars are absent", () => {
  const config = loadConfig({});

  assert.equal(config.ordBaseUrl.toString(), "http://127.0.0.1:8080/");
  assert.deepEqual(
    config.quorumNodeUrls.map((url) => url.toString()),
    ["http://127.0.0.1:8080/"],
  );
});

test("loadConfig parses comma-separated quorum node URLs", () => {
  const config = loadConfig({
    [configEnv.ordBaseUrlEnv]: "http://127.0.0.1:8081",
    [configEnv.quorumNodeUrlsEnv]: "http://127.0.0.1:8081, http://127.0.0.1:8082",
  });

  assert.equal(config.ordBaseUrl.toString(), "http://127.0.0.1:8081/");
  assert.deepEqual(
    config.quorumNodeUrls.map((url) => url.toString()),
    ["http://127.0.0.1:8081/", "http://127.0.0.1:8082/"],
  );
});
