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

test("loadConfig uses dust/postage defaults when env vars are absent", () => {
  const config = loadConfig({});

  assert.equal(config.minRelayFeeSatPerVb, 3);
  assert.equal(config.bareSatPostageSats, 546);
  assert.equal(config.inscribedPostageSats, 330);
  assert.equal(config.bumpSizeSats, 600);
});

test("loadConfig parses dust/postage overrides from env", () => {
  const config = loadConfig({
    [configEnv.minRelayFeeSatPerVbEnv]: "6",
    [configEnv.bareSatPostageSatsEnv]: "1000",
    [configEnv.inscribedPostageSatsEnv]: "400",
    [configEnv.bumpSizeSatsEnv]: "700",
  });

  assert.equal(config.minRelayFeeSatPerVb, 6);
  assert.equal(config.bareSatPostageSats, 1000);
  assert.equal(config.inscribedPostageSats, 400);
  assert.equal(config.bumpSizeSats, 700);
});

test("loadConfig rejects non-integer dust/postage values", () => {
  assert.throws(
    () => loadConfig({ [configEnv.minRelayFeeSatPerVbEnv]: "3.5" }),
    /Invalid SAT_ASSET_MIN_RELAY_FEE_SAT_PER_VB/,
  );
  assert.throws(
    () => loadConfig({ [configEnv.bareSatPostageSatsEnv]: "abc" }),
    /Invalid SAT_ASSET_BARE_SAT_POSTAGE_SATS/,
  );
});

test("loadConfig rejects zero and negative dust/postage values", () => {
  assert.throws(
    () => loadConfig({ [configEnv.inscribedPostageSatsEnv]: "0" }),
    /Invalid SAT_ASSET_INSCRIBED_POSTAGE_SATS/,
  );
  assert.throws(
    () => loadConfig({ [configEnv.bumpSizeSatsEnv]: "-5" }),
    /Invalid SAT_ASSET_BUMP_SIZE_SATS/,
  );
});
