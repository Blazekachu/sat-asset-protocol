import assert from "node:assert/strict";
import test from "node:test";

import {
  mapGenericListingToCanonical,
  mapMagicEdenListingToCanonical,
  mapOrdNetListingToCanonical,
  mapSatflowListingToCanonical,
  mapUniSatCreatePutOnToCanonical,
} from "../src/integrations/marketplace-adapters.ts";

test("mapMagicEdenListingToCanonical maps known Magic Eden-shaped fields (deprecated but functional)", () => {
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
  assert.deepEqual(result.metadata, {});
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
  assert.deepEqual(result.metadata, {});
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

test("mapUniSatCreatePutOnToCanonical maps a range listing (whole-UTXO sat span)", () => {
  const result = mapUniSatCreatePutOnToCanonical({
    asset_type: "range",
    sat_number: 1000,
    outpoint: "d".repeat(64) + ":0",
    price_sats: 50000,
    seller_address: "tb1qrangeseller",
    signed_psbt: "cHNidP8BAHECAAAARA==",
    sat_range_start: 1000,
    sat_range_size: 1000,
  });

  assert.deepEqual(result.listing, {
    asset_type: "range",
    sat_number: 1000,
    outpoint: "d".repeat(64) + ":0",
    price_sats: 50000,
    seller_address: "tb1qrangeseller",
    signed_psbt: "cHNidP8BAHECAAAARA==",
    expires_at: null,
    sat_range_start: 1000,
    sat_range_size: 1000,
  });
  assert.equal(result.source_fields.asset_type, "asset_type");
  assert.equal(result.source_fields.sat_range_start, "sat_range_start");
  assert.equal(result.source_fields.sat_range_size, "sat_range_size");
});

test("mapSatflowListingToCanonical maps a payload of common/historical aliases (best-effort)", () => {
  const result = mapSatflowListingToCanonical({
    sat: 500000000,
    location: "e".repeat(64) + ":0",
    price: 30000,
    sellerAddress: "tb1qsatflow",
    sellerPsbt: "cHNidP8BAHECAAAARQ==",
  });

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 500000000,
    outpoint: "e".repeat(64) + ":0",
    price_sats: 30000,
    seller_address: "tb1qsatflow",
    signed_psbt: "cHNidP8BAHECAAAARQ==",
    expires_at: null,
  });
  assert.equal(result.source_fields.outpoint, "location");
  assert.equal(result.source_fields.seller_address, "sellerAddress");
});

test("mapOrdNetListingToCanonical maps a payload of common/hypothesized aliases (best-effort)", () => {
  const result = mapOrdNetListingToCanonical({
    ordinal: 600000000,
    satpoint: "f".repeat(64) + ":0",
    priceInSats: 40000,
    sellerReceiveAddress: "tb1qordnet",
    psbt: "cHNidP8BAHECAAAARg==",
  });

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 600000000,
    outpoint: "f".repeat(64) + ":0",
    price_sats: 40000,
    seller_address: "tb1qordnet",
    signed_psbt: "cHNidP8BAHECAAAARg==",
    expires_at: null,
  });
  assert.equal(result.source_fields.sat_number, "ordinal");
  assert.equal(result.source_fields.outpoint, "satpoint");
  assert.equal(result.source_fields.price_sats, "priceInSats");
});

test("mapGenericListingToCanonical maps a never-seen field-name payload via overrides", () => {
  const result = mapGenericListingToCanonical(
    {
      // None of these keys are known aliases.
      whateverSatField: 123456789,
      randomOutpointKey: "g".repeat(64) + ":3",
      customPriceKey: 12345,
      weirdAddrKey: "tb1qcustom",
      opaquePsbtBlob: "cHNidP8BAHECAAAARw==",
    },
    {
      sat_number: 123456789,
      outpoint: "g".repeat(64) + ":3",
      price_sats: 12345,
      seller_address: "tb1qcustom",
      signed_psbt: "cHNidP8BAHECAAAARw==",
    },
  );

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 123456789,
    outpoint: "g".repeat(64) + ":3",
    price_sats: 12345,
    seller_address: "tb1qcustom",
    signed_psbt: "cHNidP8BAHECAAAARw==",
    expires_at: null,
  });
  assert.equal(result.source_fields.sat_number, "overrides.sat_number");
  assert.equal(result.source_fields.outpoint, "overrides.outpoint");
  assert.equal(result.source_fields.signed_psbt, "overrides.signed_psbt");
});

test("mapGenericListingToCanonical maps a payload via common aliases with zero code changes", () => {
  const result = mapGenericListingToCanonical({
    satoshi: 700000000,
    location: "h".repeat(64) + ":2",
    amount: 9000,
    payoutAddress: "tb1qgeneric",
    sellerPsbt: "cHNidP8BAHECAAAASA==",
  });

  assert.deepEqual(result.listing, {
    asset_type: "sat",
    sat_number: 700000000,
    outpoint: "h".repeat(64) + ":2",
    price_sats: 9000,
    seller_address: "tb1qgeneric",
    signed_psbt: "cHNidP8BAHECAAAASA==",
    expires_at: null,
  });
  assert.equal(result.source_fields.sat_number, "satoshi");
  assert.equal(result.source_fields.price_sats, "amount");
  assert.equal(result.source_fields.seller_address, "payoutAddress");
});

test("rare/named-sat payload surfaces actual rarity/sat_name VALUES in metadata", () => {
  const result = mapGenericListingToCanonical({
    satNumber: 5000000000,
    outpoint: "i".repeat(64) + ":0",
    price: 250000,
    sellerAddress: "tb1qrare",
    psbt: "cHNidP8BAHECAAAASQ==",
    rarity: "epic",
    satName: "nvtdijuwxlo",
  });

  assert.equal(result.metadata.rarity, "epic");
  assert.equal(result.metadata.rarity_source, "rarity");
  assert.equal(result.metadata.sat_name, "nvtdijuwxlo");
  assert.equal(result.metadata.sat_name_source, "satName");
  // Provenance map records the source KEY, metadata records the VALUE.
  assert.equal(result.source_fields.sat_number, "satNumber");
});
