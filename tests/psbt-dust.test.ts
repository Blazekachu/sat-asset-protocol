import assert from "node:assert/strict";
import test from "node:test";

import { DustValidationError } from "../src/dust.ts";
import {
  buildBuyerFillTemplatePsbt,
  PsbtValidationError,
  validateCanonicalTwoBumpFillPsbt,
  type TemplateInput,
} from "../src/psbt.ts";

function hexToReversedBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex").reverse();
}

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

// Hand-roll a canonical 2-bump fill PSBT (unsigned tx only) with the seller
// input at index 2 and caller-specified outputs, so we can craft sub-dust
// outputs independently of the builder.
function buildFillPsbt(
  sellerOutpoint: string,
  outputs: Array<{ valueSats: number; scriptPubkeyHex: string }>,
): string {
  const inputOutpoints = [
    "a".repeat(64) + ":0",
    "b".repeat(64) + ":1",
    sellerOutpoint,
    "c".repeat(64) + ":2",
  ];

  const parts: Buffer[] = [encodeUInt32LE(2), encodeVarInt(inputOutpoints.length)];
  for (const outpoint of inputOutpoints) {
    const [txid, voutText] = outpoint.split(":");
    parts.push(hexToReversedBuffer(txid));
    parts.push(encodeUInt32LE(Number(voutText)));
    parts.push(Buffer.from([0x00]));
    parts.push(encodeUInt32LE(0xfffffffd));
  }

  parts.push(encodeVarInt(outputs.length));
  for (const output of outputs) {
    parts.push(encodeUInt64LE(output.valueSats));
    const script = Buffer.from(output.scriptPubkeyHex, "hex");
    parts.push(encodeVarInt(script.length));
    parts.push(script);
  }
  parts.push(encodeUInt32LE(0));

  const unsignedTx = Buffer.concat(parts);
  const globalMap = Buffer.concat([
    encodeVarInt(1),
    Buffer.from([0x00]),
    encodeVarInt(unsignedTx.length),
    unsignedTx,
    Buffer.from([0x00]),
  ]);

  return Buffer.concat([Buffer.from("70736274ff", "hex"), globalMap]).toString("base64");
}

const P2WPKH = (fill: string) => "0014" + fill.repeat(20);
const SELLER_OUTPOINT = "1".repeat(64) + ":0";
const PRICE_SATS = 1000;

test("[M2][D1] validateCanonicalTwoBumpFillPsbt accepts the canonical 1200-sat passthrough with dust-safe outputs", () => {
  const psbt = buildFillPsbt(SELLER_OUTPOINT, [
    { valueSats: 1200, scriptPubkeyHex: P2WPKH("66") },
    { valueSats: 4000, scriptPubkeyHex: P2WPKH("77") },
    { valueSats: PRICE_SATS, scriptPubkeyHex: P2WPKH("88") },
    { valueSats: 3000, scriptPubkeyHex: P2WPKH("99") },
  ]);

  const result = validateCanonicalTwoBumpFillPsbt(psbt, SELLER_OUTPOINT, PRICE_SATS);
  assert.equal(result.sellerInputIndex, 2);
  assert.equal(result.buyerInputCount, 3);
});

test("[D2] validateCanonicalTwoBumpFillPsbt throws DustValidationError for a sub-dust output", () => {
  const psbt = buildFillPsbt(SELLER_OUTPOINT, [
    { valueSats: 1200, scriptPubkeyHex: P2WPKH("66") },
    { valueSats: 4000, scriptPubkeyHex: P2WPKH("77") },
    { valueSats: PRICE_SATS, scriptPubkeyHex: P2WPKH("88") },
    // 100 sats is below the 294-sat P2WPKH dust threshold at 3 sat/vB.
    { valueSats: 100, scriptPubkeyHex: P2WPKH("99") },
  ]);

  assert.throws(
    () => validateCanonicalTwoBumpFillPsbt(psbt, SELLER_OUTPOINT, PRICE_SATS),
    DustValidationError,
  );
});

test("validateCanonicalTwoBumpFillPsbt throws PsbtValidationError for a non-canonical passthrough", () => {
  const psbt = buildFillPsbt(SELLER_OUTPOINT, [
    { valueSats: 1500, scriptPubkeyHex: P2WPKH("66") },
    { valueSats: 4000, scriptPubkeyHex: P2WPKH("77") },
    { valueSats: PRICE_SATS, scriptPubkeyHex: P2WPKH("88") },
    { valueSats: 3000, scriptPubkeyHex: P2WPKH("99") },
  ]);

  assert.throws(
    () => validateCanonicalTwoBumpFillPsbt(psbt, SELLER_OUTPOINT, PRICE_SATS),
    PsbtValidationError,
  );
});

test("validateCanonicalTwoBumpFillPsbt honors a custom bumpSizeSats policy", () => {
  const psbt = buildFillPsbt(SELLER_OUTPOINT, [
    { valueSats: 1000, scriptPubkeyHex: P2WPKH("66") },
    { valueSats: 4000, scriptPubkeyHex: P2WPKH("77") },
    { valueSats: PRICE_SATS, scriptPubkeyHex: P2WPKH("88") },
    { valueSats: 3000, scriptPubkeyHex: P2WPKH("99") },
  ]);

  // With bumpSizeSats=500, output 0 must equal 1000; passes.
  const result = validateCanonicalTwoBumpFillPsbt(psbt, SELLER_OUTPOINT, PRICE_SATS, {
    bumpSizeSats: 500,
  });
  assert.equal(result.sellerInputIndex, 2);

  // Default bumpSizeSats (600 -> 1200 required) rejects the 1000 passthrough.
  assert.throws(
    () => validateCanonicalTwoBumpFillPsbt(psbt, SELLER_OUTPOINT, PRICE_SATS),
    PsbtValidationError,
  );
});

test("buildBuyerFillTemplatePsbt rejects a sub-dust output via DustValidationError", () => {
  const bumpInputs: TemplateInput[] = [
    { outpoint: "a".repeat(64) + ":0", valueSats: 600, scriptPubkeyHex: P2WPKH("33") },
    { outpoint: "b".repeat(64) + ":1", valueSats: 600, scriptPubkeyHex: P2WPKH("44") },
  ];
  const fundingInputs: TemplateInput[] = [
    { outpoint: "c".repeat(64) + ":2", valueSats: 4000, scriptPubkeyHex: P2WPKH("55") },
  ];

  assert.throws(
    () =>
      buildBuyerFillTemplatePsbt({
        sellerOutpoint: SELLER_OUTPOINT,
        sellerInputValueSats: 4000,
        sellerInputScriptPubkeyHex: P2WPKH("11"),
        listingPriceSats: PRICE_SATS,
        bumpInputs,
        fundingInputs,
        buyerBumpScriptPubkeyHex: P2WPKH("66"),
        buyerAssetScriptPubkeyHex: P2WPKH("77"),
        buyerChangeScriptPubkeyHex: P2WPKH("88"),
        // 100-sat change is below the P2WPKH dust threshold.
        buyerChangeValueSats: 100,
      }),
    DustValidationError,
  );
});
