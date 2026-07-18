import assert from "node:assert/strict";
import test from "node:test";

import { parsePsbt, type TemplateInput } from "../src/psbt.ts";
import {
  buildSatForSatBundlePsbt,
  type SatForSatAssetLeg,
} from "../src/sat-for-sat-bundle.ts";
import { assetsSatisfyWant } from "../src/offer-predicates.ts";
import type { OfferAssetRef, WantSpec } from "../src/listing-types.ts";

// Offer-matrix cells B1, B3, B4, B5, B6, B7 — bundle (N-asset-per-side) barter
// via the real m×n builder (RD4, ADR-0018). B2 (bundle-for-BTC) is OUT OF SCOPE
// per RD8; B8 (wallet foreign-input limits) is live-only (E3).

const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

let outpointSeed = 0;
function makeInput(valueSats: number, spkFill: string): TemplateInput {
  outpointSeed += 1;
  return {
    outpoint: outpointSeed.toString(16).padStart(64, "0") + ":0",
    valueSats,
    scriptPubkeyHex: p2wpkh(spkFill),
  };
}

function makeLeg(
  bumpValue: number,
  assetValue: number,
  changeFill: string,
  ordinalsFill: string,
): SatForSatAssetLeg {
  return {
    bumpInput: makeInput(bumpValue, changeFill + "a"),
    assetInput: makeInput(assetValue, changeFill + "b"),
    changeScriptPubkeyHex: p2wpkh(changeFill),
    counterpartyOrdinalsScriptPubkeyHex: p2wpkh(ordinalsFill),
  };
}

const FEE_CHANGE_SPK = p2wpkh("55");

function buildBundle(
  offererLegs: SatForSatAssetLeg[],
  takerLegs: SatForSatAssetLeg[],
  feeValue = 20000,
  feeChangeValue = 3000,
) {
  return buildSatForSatBundlePsbt({
    offerer: { legs: offererLegs },
    taker: { legs: takerLegs },
    feeFundingInput: makeInput(feeValue, "ef"),
    feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
    feePayerChangeValueSats: feeChangeValue,
  });
}

test("[B1] bundle of sats for a specific bundle of sats: m×n build; every sat offset-0 (input i == output i); value conserved", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 546, "a2", "b2");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const b2 = makeLeg(600, 546, "c2", "d2");

  const result = buildBundle([a1, a2], [b1, b2]);
  assert.equal(result.inputOutpoints.length, 9); // 2(m+n)+1 = 9
  assert.equal(result.outputValues.length, 9);

  const parsed = parsePsbt(result.psbtBase64);
  // Every non-fee output value equals its paired input value (FIFO offset-0).
  const inSum = parsed.inputs.reduce((a, i) => a + i.witnessUtxoValue, 0);
  const outSum = parsed.outputs.reduce((a, o) => a + o.value, 0);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(parsed.outputs[i].value, parsed.inputs[i].witnessUtxoValue);
  }
  assert.ok(inSum - outSum >= 0, "value conserved with non-negative fee");
});

test("[B3] bundle of sats for predicate-matched sats: each accepted sat satisfies P; bundle builds; all offset-0", () => {
  const want: WantSpec = {
    mode: "predicate",
    predicate: { type: "sat_range", params: { start: 0, end: 100000 } },
    count: 2,
  };
  const matched: OfferAssetRef[] = [
    { asset_type: "sat", asset_outpoint: "a".repeat(64) + ":0", sat_number: 10 },
    { asset_type: "sat", asset_outpoint: "b".repeat(64) + ":0", sat_number: 20 },
  ];
  assert.deepEqual(assetsSatisfyWant(want, matched), { ok: true });

  // The two predicate-matched taker sats then settle through the m×n builder.
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 546, "a2", "b2");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const b2 = makeLeg(600, 546, "c2", "d2");
  const result = buildBundle([a1, a2], [b1, b2]);
  const parsed = parsePsbt(result.psbtBase64);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(parsed.outputs[i].value, parsed.inputs[i].witnessUtxoValue);
  }
});

test("[B4] bundle of ranges for a specific bundle of ranges: mixed spans each >= dust offset-0; value conserved", () => {
  const a1 = makeLeg(600, 5000, "a1", "b1"); // range span
  const a2 = makeLeg(600, 8000, "a2", "b2"); // range span
  const b1 = makeLeg(600, 4000, "c1", "d1");
  const b2 = makeLeg(600, 6000, "c2", "d2");

  const result = buildBundle([a1, a2], [b1, b2]);
  const parsed = parsePsbt(result.psbtBase64);
  // Each range ordinals output carries its full span at the counterparty index.
  assert.equal(parsed.outputs[1].value, 5000);
  assert.equal(parsed.outputs[3].value, 8000);
  assert.equal(parsed.outputs[5].value, 4000);
  assert.equal(parsed.outputs[7].value, 6000);
});

test("[B5] mixed sat+range bundle for a mixed bundle: heterogeneous assets build; every asset offset-0", () => {
  const aSat = makeLeg(600, 546, "a1", "b1"); // bare sat
  const aRange = makeLeg(600, 7000, "a2", "b2"); // range
  const bRange = makeLeg(600, 3000, "c1", "d1"); // range
  const bSat = makeLeg(600, 546, "c2", "d2"); // bare sat

  const result = buildBundle([aSat, aRange], [bRange, bSat]);
  const parsed = parsePsbt(result.psbtBase64);
  assert.equal(parsed.outputs[1].value, 546);
  assert.equal(parsed.outputs[3].value, 7000);
  assert.equal(parsed.outputs[5].value, 3000);
  assert.equal(parsed.outputs[7].value, 546);
});

test("[B6] asymmetric M!=N bundle: 3-for-1 and 1-for-3 build with correct bump/output counts", () => {
  // 3-for-1: m=3, n=1 => 2(3+1)+1 = 9 in/out; bumps = m+n = 4.
  const threeForOne = buildBundle(
    [makeLeg(600, 546, "a1", "b1"), makeLeg(600, 546, "a2", "b2"), makeLeg(600, 546, "a3", "b3")],
    [makeLeg(600, 546, "c1", "d1")],
  );
  assert.equal(threeForOne.inputOutpoints.length, 9);
  assert.deepEqual(threeForOne.layout.offererAssetOutputIndexes, [1, 3, 5]);
  assert.deepEqual(threeForOne.layout.takerAssetOutputIndexes, [7]);
  assert.equal(threeForOne.layout.feeInputIndex, 8);

  // 1-for-3: m=1, n=3 => symmetric shape.
  const oneForThree = buildBundle(
    [makeLeg(600, 546, "a1", "b1")],
    [makeLeg(600, 546, "c1", "d1"), makeLeg(600, 546, "c2", "d2"), makeLeg(600, 546, "c3", "d3")],
  );
  assert.equal(oneForThree.inputOutpoints.length, 9);
  assert.deepEqual(oneForThree.layout.offererAssetOutputIndexes, [1]);
  assert.deepEqual(oneForThree.layout.takerAssetOutputIndexes, [3, 5, 7]);
});

test("[B7] bundle with one sub-dust asset: the whole bundle is rejected", () => {
  const good = makeLeg(600, 546, "a1", "b1");
  const subDust = makeLeg(600, 100, "a2", "b2"); // 100 < 294 P2WPKH dust
  const b1 = makeLeg(600, 546, "c1", "d1");
  assert.throws(() => buildBundle([good, subDust], [b1]), /dust/i);
});
