import assert from "node:assert/strict";
import test from "node:test";

import {
  mapMagicEdenListingToCanonical,
  mapUniSatCreatePutOnToCanonical,
} from "../src/integrations/marketplace-adapters.ts";

test("mapMagicEdenListingToCanonical maps known Magic Eden-shaped fields", () => {
  const result = mapMagicEdenListingToCanonical({
    satNumber: 777777777,
    assetOutpoint: "a".repeat(64) + ":0",
    priceSats: 15000,
    sellerPaymentAddress: "tb1qsellerme",
    signedPsbtBase64: "cHNidP8BAHECAAAAAQ==",
    expiresAt: "2026-08-01T00:00:00.000Z",
  });

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 777777777,
    outpoint: "a".repeat(64) + ":0",
    price_sats: 15000,
    seller_address: "tb1qsellerme",
    signed_psbt: "cHNidP8BAHECAAAAAQ==",
    expires_at: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(result.source_fields.price_sats, "priceSats");
  assert.equal(result.source_fields.signed_psbt, "signedPsbtBase64");
});

test("mapUniSatCreatePutOnToCanonical maps create_put_on-like fields", () => {
  const result = mapUniSatCreatePutOnToCanonical({
    sat_number: "888888888",
    outpoint: "b".repeat(64) + ":1",
    price: "21000",
    receiveAddress: "tb1qunisat",
    psbt: "cHNidP8BAHECAAAAAg==",
  });

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 888888888,
    outpoint: "b".repeat(64) + ":1",
    price_sats: 21000,
    seller_address: "tb1qunisat",
    signed_psbt: "cHNidP8BAHECAAAAAg==",
    expires_at: null,
  });
  assert.equal(result.source_fields.price_sats, "price");
  assert.equal(result.source_fields.seller_address, "receiveAddress");
});

test("adapter overrides can supply missing sat number", () => {
  const result = mapMagicEdenListingToCanonical(
    {
      assetOutpoint: "c".repeat(64) + ":2",
      priceSats: 22000,
      sellerPaymentAddress: "tb1qoverride",
      signedPsbtBase64: "cHNidP8BAHECAAAAQw==",
    },
    {
      sat_number: 999999999,
    },
  );

  assert.equal(result.listing.sat_number, 999999999);
  assert.equal(result.source_fields.sat_number, "overrides.sat_number");
});
