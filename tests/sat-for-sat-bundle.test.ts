import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  parsePsbt,
  PSBT_MAGIC,
  PsbtValidationError,
  type DustPolicy,
  type TemplateInput,
} from "../src/psbt.ts";
import {
  buildSatForSatBundlePsbt,
  deriveBundleLayout,
  validateSatForSatBundleAcceptPsbt,
  validateSatForSatBundleOfferPsbt,
  type SatForSatAssetLeg,
} from "../src/sat-for-sat-bundle.ts";

// --- fixtures -------------------------------------------------------------

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

// --- signature-injection helper (mirrors tests/sat-for-sat.test.ts) --------

interface InputSpec {
  input: TemplateInput;
  sig?: { kind: "partial"; sighash: number };
}

interface OutputSpec {
  valueSats: number;
  scriptPubkeyHex: string;
}

function buildSignedPsbt(inputs: InputSpec[], outputs: OutputSpec[]): string {
  const inputOutpoints = inputs.map((spec) => spec.input.outpoint);
  const unsignedTx = buildUnsignedTransaction(inputOutpoints, outputs);

  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTx),
    Buffer.from([0x00]),
  ]);

  const inputMaps = inputs.map((spec) => {
    const entries: Buffer[] = [
      encodeWitnessUtxoMap(spec.input.valueSats, spec.input.scriptPubkeyHex),
    ];
    if (spec.sig?.kind === "partial") {
      const pubkey = Buffer.from("02".repeat(33), "hex");
      const key = Buffer.concat([Buffer.from([0x02]), pubkey]);
      const value = Buffer.concat([
        Buffer.from("3006020101020101", "hex"),
        Buffer.from([spec.sig.sighash]),
      ]);
      entries.push(encodeMapEntry(key, value));
    }
    return Buffer.concat([...entries, Buffer.from([0x00])]);
  });

  const outputMaps = outputs.map(() => Buffer.from([0x00]));
  return Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]).toString(
    "base64",
  );
}

// Reconstruct the interleaved input/output specs a bundle produces so tests can
// craft signed/tampered fixtures with full control over per-input signatures.
function bundleStreams(
  offererLegs: SatForSatAssetLeg[],
  takerLegs: SatForSatAssetLeg[],
  feeInput: TemplateInput,
  feeChangeValue: number,
): { inputs: TemplateInput[]; outputs: OutputSpec[] } {
  const inputs: TemplateInput[] = [];
  const outputs: OutputSpec[] = [];
  for (const leg of [...offererLegs, ...takerLegs]) {
    inputs.push(leg.bumpInput, leg.assetInput);
    outputs.push({ valueSats: leg.bumpInput.valueSats, scriptPubkeyHex: leg.changeScriptPubkeyHex });
    outputs.push({
      valueSats: leg.assetInput.valueSats,
      scriptPubkeyHex: leg.counterpartyOrdinalsScriptPubkeyHex,
    });
  }
  inputs.push(feeInput);
  outputs.push({ valueSats: feeChangeValue, scriptPubkeyHex: FEE_CHANGE_SPK });
  return { inputs, outputs };
}

// --- builder: m=2, n=1 ----------------------------------------------------

test("buildSatForSatBundlePsbt m=2,n=1 emits 7 in/7 out in interleaved order with passthrough values", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(9000, "ef");

  const result = buildSatForSatBundlePsbt({
    offerer: { legs: [a1, a2] },
    taker: { legs: [b1] },
    feeFundingInput: fee,
    feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
    feePayerChangeValueSats: 3000,
  });

  // 2(m+n)+1 = 7.
  assert.equal(result.inputOutpoints.length, 7);
  assert.equal(result.outputValues.length, 7);

  assert.deepEqual(result.inputOutpoints, [
    a1.bumpInput.outpoint,
    a1.assetInput.outpoint,
    a2.bumpInput.outpoint,
    a2.assetInput.outpoint,
    b1.bumpInput.outpoint,
    b1.assetInput.outpoint,
    fee.outpoint,
  ]);

  assert.deepEqual(result.outputValues, [600, 546, 600, 700, 600, 800, 3000]);

  // Layout: A-asset outputs at 1,3 (→B); B-asset output at 5 (→A); fee at 6.
  assert.deepEqual(result.layout.offererAssetOutputIndexes, [1, 3]);
  assert.deepEqual(result.layout.takerAssetOutputIndexes, [5]);
  assert.equal(result.layout.feeInputIndex, 6);

  const parsed = parsePsbt(result.psbtBase64);
  assert.equal(parsed.inputs.length, 7);
  assert.equal(parsed.outputs.length, 7);
  // Every non-fee output value == paired input value; unsigned.
  for (let i = 0; i < 6; i += 1) {
    assert.equal(parsed.outputs[i].value, parsed.inputs[i].witnessUtxoValue);
    assert.equal(parsed.inputs[i].partialSigCount, 0);
  }
});

// --- builder: m=2, n=2 ----------------------------------------------------

test("buildSatForSatBundlePsbt m=2,n=2 emits 9 in/9 out with bumps at 0,2,4,6 and fee at 8", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 546, "a2", "b2");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const b2 = makeLeg(600, 546, "c2", "d2");
  const fee = makeInput(9000, "ef");

  const result = buildSatForSatBundlePsbt({
    offerer: { legs: [a1, a2] },
    taker: { legs: [b1, b2] },
    feeFundingInput: fee,
    feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
    feePayerChangeValueSats: 3000,
  });

  assert.equal(result.inputOutpoints.length, 9);
  assert.equal(result.outputValues.length, 9);
  assert.deepEqual(result.layout.offererAssetInputIndexes, [1, 3]);
  assert.deepEqual(result.layout.takerAssetInputIndexes, [5, 7]);
  assert.equal(result.layout.feeInputIndex, 8);

  const parsed = parsePsbt(result.psbtBase64);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(parsed.outputs[i].value, parsed.inputs[i].witnessUtxoValue);
  }
});

// --- range leg ------------------------------------------------------------

test("buildSatForSatBundlePsbt supports a range leg (asset value == span) and passes dust", () => {
  const rangeLeg = makeLeg(600, 5000, "a1", "b1"); // 5000-sat range span
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");

  const result = buildSatForSatBundlePsbt({
    offerer: { legs: [rangeLeg] },
    taker: { legs: [b1] },
    feeFundingInput: fee,
    feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
    feePayerChangeValueSats: 3000,
  });

  const parsed = parsePsbt(result.psbtBase64);
  // Ordinals output for the range = its span (5000) at counterparty index 1.
  assert.equal(parsed.outputs[1].value, 5000);
});

// --- sub-dust rejection ---------------------------------------------------

test("buildSatForSatBundlePsbt rejects a sub-dust ordinals output (100 into P2WPKH)", () => {
  const dustLeg = makeLeg(600, 100, "a1", "b1"); // 100 < 294 P2WPKH dust
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");

  assert.throws(
    () =>
      buildSatForSatBundlePsbt({
        offerer: { legs: [dustLeg] },
        taker: { legs: [b1] },
        feeFundingInput: fee,
        feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
        feePayerChangeValueSats: 3000,
      }),
    /dust/i,
  );
});

// --- negative-fee conservation --------------------------------------------

test("buildSatForSatBundlePsbt rejects negative implied fee (conservation error)", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(600, "ef"); // tiny fee input

  assert.throws(
    () =>
      buildSatForSatBundlePsbt({
        offerer: { legs: [a1] },
        taker: { legs: [b1] },
        feeFundingInput: fee,
        feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
        // change > fee input triggers the exceeds-fee-funding conservation error
        feePayerChangeValueSats: 5000,
      }),
    /exceeds fee-funding input value/,
  );
});

test("buildSatForSatBundlePsbt rejects outputs exceeding inputs (implied fee negative)", () => {
  // change == fee input value but bumps/assets leave sum(out) > sum(in) once the
  // fee input is fully consumed by change: force it via equal-value legs where
  // change eats the whole fee input, so fee = 0 but below min-relay fee band.
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");

  // change equals the fee input value -> implied fee 0 -> below min relay band.
  assert.throws(
    () =>
      buildSatForSatBundlePsbt({
        offerer: { legs: [a1] },
        taker: { legs: [b1] },
        feeFundingInput: fee,
        feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
        feePayerChangeValueSats: 5000,
      }),
    /below min relay fee/,
  );
});

// --- fee-band: maxFeeRateSatPerVb -----------------------------------------

test("fee-band: a fee implying > maxFeeRateSatPerVb throws when the cap is set", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(1_000_000, "ef"); // huge fee input

  const dustPolicy: DustPolicy = { maxFeeRateSatPerVb: 100 };

  assert.throws(
    () =>
      buildSatForSatBundlePsbt({
        offerer: { legs: [a1] },
        taker: { legs: [b1] },
        feeFundingInput: fee,
        feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
        feePayerChangeValueSats: 3000, // ~996k fee over ~500 vB -> ~1990 sat/vB
        dustPolicy,
      }),
    /exceeds max fee rate/,
  );
});

test("fee-band: the same high fee does NOT throw when maxFeeRateSatPerVb is unset (RD6 guard)", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(1_000_000, "ef");

  assert.doesNotThrow(() =>
    buildSatForSatBundlePsbt({
      offerer: { legs: [a1] },
      taker: { legs: [b1] },
      feeFundingInput: fee,
      feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
      feePayerChangeValueSats: 3000,
      // dustPolicy omitted -> maxFeeRateSatPerVb undefined
    }),
  );
});

test("fee-band: a normal fee passes when maxFeeRateSatPerVb is set", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");

  assert.doesNotThrow(() =>
    buildSatForSatBundlePsbt({
      offerer: { legs: [a1] },
      taker: { legs: [b1] },
      feeFundingInput: fee,
      feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
      feePayerChangeValueSats: 3000,
      dustPolicy: { maxFeeRateSatPerVb: 100 },
    }),
  );
});

// --- deriveBundleLayout exact index arrays --------------------------------

test("deriveBundleLayout returns exact index arrays for (1,1),(2,1),(2,2)", () => {
  const l11 = deriveBundleLayout(1, 1);
  assert.equal(l11.inputCount, 5);
  assert.deepEqual(l11.offererAssetInputIndexes, [1]);
  assert.deepEqual(l11.takerAssetInputIndexes, [3]);
  assert.deepEqual(l11.offererSignedInputIndexes, [0, 1]);
  assert.deepEqual(l11.takerSignedInputIndexes, [2, 3]);
  assert.equal(l11.feeInputIndex, 4);

  const l21 = deriveBundleLayout(2, 1);
  assert.equal(l21.inputCount, 7);
  assert.deepEqual(l21.offererAssetInputIndexes, [1, 3]);
  assert.deepEqual(l21.takerAssetInputIndexes, [5]);
  assert.deepEqual(l21.offererSignedInputIndexes, [0, 1, 2, 3]);
  assert.deepEqual(l21.takerSignedInputIndexes, [4, 5]);
  assert.equal(l21.feeInputIndex, 6);

  const l22 = deriveBundleLayout(2, 2);
  assert.equal(l22.inputCount, 9);
  assert.deepEqual(l22.offererAssetInputIndexes, [1, 3]);
  assert.deepEqual(l22.takerAssetInputIndexes, [5, 7]);
  assert.deepEqual(l22.offererSignedInputIndexes, [0, 1, 2, 3]);
  assert.deepEqual(l22.takerSignedInputIndexes, [4, 5, 6, 7]);
  assert.equal(l22.feeInputIndex, 8);
});

test("deriveBundleLayout rejects leg counts < 1", () => {
  assert.throws(() => deriveBundleLayout(0, 1), PsbtValidationError);
  assert.throws(() => deriveBundleLayout(1, 0), PsbtValidationError);
});

// --- offer validation (m=2,n=1) -------------------------------------------

function signedOfferM2N1(): {
  psbt: string;
  offererAssetOutpoints: string[];
  takerAssetOutpoints: string[];
  legs: { a1: SatForSatAssetLeg; a2: SatForSatAssetLeg; b1: SatForSatAssetLeg; fee: TemplateInput };
} {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(9000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1], fee, 3000);

  const specs: InputSpec[] = inputs.map((input, index) => ({
    input,
    // Offerer signs its own legs [0,1,2,3]; accepter [4,5] + fee unsigned.
    sig: index <= 3 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));

  return {
    psbt: buildSignedPsbt(specs, outputs),
    offererAssetOutpoints: [a1.assetInput.outpoint, a2.assetInput.outpoint],
    takerAssetOutpoints: [b1.assetInput.outpoint],
    legs: { a1, a2, b1, fee },
  };
}

test("validateSatForSatBundleOfferPsbt accepts a valid m=2,n=1 offer with derived indexes", () => {
  const { psbt, offererAssetOutpoints, takerAssetOutpoints } = signedOfferM2N1();
  const summary = validateSatForSatBundleOfferPsbt(psbt, {
    offererAssetOutpoints,
    takerAssetOutpoints,
  });
  assert.deepEqual(summary.offererSignedInputs, [0, 1, 2, 3]);
  assert.deepEqual(summary.layout.offererAssetInputIndexes, [1, 3]);
  assert.deepEqual(summary.layout.takerAssetInputIndexes, [5]);
});

test("validateSatForSatBundleOfferPsbt rejects wrong asset ordering", () => {
  const { psbt, offererAssetOutpoints, takerAssetOutpoints } = signedOfferM2N1();
  // Swap the two offerer expected outpoints so index 1 no longer matches.
  assert.throws(
    () =>
      validateSatForSatBundleOfferPsbt(psbt, {
        offererAssetOutpoints: [offererAssetOutpoints[1], offererAssetOutpoints[0]],
        takerAssetOutpoints,
      }),
    (e: unknown) => e instanceof PsbtValidationError && /input 1/.test(e.message),
  );
});

test("validateSatForSatBundleOfferPsbt rejects an offset-shifting output value", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1], fee, 3000);
  outputs[1].valueSats = 999; // shift the first A-asset output off its input value

  const specs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig: index <= 3 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const psbt = buildSignedPsbt(specs, outputs);

  assert.throws(
    () =>
      validateSatForSatBundleOfferPsbt(psbt, {
        offererAssetOutpoints: [a1.assetInput.outpoint, a2.assetInput.outpoint],
        takerAssetOutpoints: [b1.assetInput.outpoint],
      }),
    /offset 0/,
  );
});

test("validateSatForSatBundleOfferPsbt rejects a pre-signed accepter input", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1], fee, 3000);

  const specs: InputSpec[] = inputs.map((input, index) => ({
    input,
    // Sign offerer legs AND accepter input 4 (pre-signed accepter bump).
    sig: index <= 4 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const psbt = buildSignedPsbt(specs, outputs);

  assert.throws(
    () =>
      validateSatForSatBundleOfferPsbt(psbt, {
        offererAssetOutpoints: [a1.assetInput.outpoint, a2.assetInput.outpoint],
        takerAssetOutpoints: [b1.assetInput.outpoint],
      }),
    (e: unknown) => e instanceof PsbtValidationError && /accepter input 4/.test(e.message),
  );
});

test("validateSatForSatBundleOfferPsbt rejects a non-SIGHASH_ALL offerer sig", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1], fee, 3000);

  const specs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig:
      index <= 3
        ? { kind: "partial" as const, sighash: index === 3 ? 0x02 : 0x01 }
        : undefined,
  }));
  const psbt = buildSignedPsbt(specs, outputs);

  assert.throws(
    () =>
      validateSatForSatBundleOfferPsbt(psbt, {
        offererAssetOutpoints: [a1.assetInput.outpoint, a2.assetInput.outpoint],
        takerAssetOutpoints: [b1.assetInput.outpoint],
      }),
    /input 3 must carry a valid SIGHASH_ALL/,
  );
});

test("validateSatForSatBundleOfferPsbt rejects a wrong input count for the expected m,n", () => {
  const { psbt, takerAssetOutpoints } = signedOfferM2N1();
  // Claim m=1 (one offerer outpoint) against a 7-input PSBT.
  assert.throws(
    () =>
      validateSatForSatBundleOfferPsbt(psbt, {
        offererAssetOutpoints: ["deadbeef"],
        takerAssetOutpoints,
      }),
    /must have .* inputs/,
  );
});

test("validateSatForSatBundleOfferPsbt fee-payer variant: offerer signs its legs + fee", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 700, "a2", "b2");
  const b1 = makeLeg(600, 800, "c1", "d1");
  const fee = makeInput(9000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1], fee, 3000);

  // Offerer signs [0,1,2,3] AND the fee input [6]; accepter [4,5] unsigned.
  const specs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig:
      index <= 3 || index === 6 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const psbt = buildSignedPsbt(specs, outputs);

  const summary = validateSatForSatBundleOfferPsbt(psbt, {
    offererAssetOutpoints: [a1.assetInput.outpoint, a2.assetInput.outpoint],
    takerAssetOutpoints: [b1.assetInput.outpoint],
    offererIsFeePayer: true,
  });
  assert.deepEqual(summary.offererSignedInputs, [0, 1, 2, 3, 6]);
});

// --- accept validation (m=2,n=2) ------------------------------------------

test("validateSatForSatBundleAcceptPsbt accepts a fully-signed m=2,n=2 accept", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const a2 = makeLeg(600, 546, "a2", "b2");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const b2 = makeLeg(600, 546, "c2", "d2");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1, a2], [b1, b2], fee, 3000);

  const offerSpecs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig: index <= 3 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const offer = buildSignedPsbt(offerSpecs, outputs);

  const acceptSpecs: InputSpec[] = inputs.map((input) => ({
    input,
    sig: { kind: "partial" as const, sighash: 0x01 },
  }));
  const accept = buildSignedPsbt(acceptSpecs, outputs);

  assert.deepEqual(validateSatForSatBundleAcceptPsbt(accept, offer), { ready: true });
});

test("validateSatForSatBundleAcceptPsbt rejects a tampered unsigned tx", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1], [b1], fee, 3000);

  const offerSpecs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig: index <= 1 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const offer = buildSignedPsbt(offerSpecs, outputs);

  const tampered = outputs.map((o) => ({ ...o }));
  tampered[tampered.length - 1].valueSats = 2500;
  const acceptSpecs: InputSpec[] = inputs.map((input) => ({
    input,
    sig: { kind: "partial" as const, sighash: 0x01 },
  }));
  const accept = buildSignedPsbt(acceptSpecs, tampered);

  assert.throws(
    () => validateSatForSatBundleAcceptPsbt(accept, offer),
    /does not match/,
  );
});

test("validateSatForSatBundleAcceptPsbt rejects an unsigned input", () => {
  const a1 = makeLeg(600, 546, "a1", "b1");
  const b1 = makeLeg(600, 546, "c1", "d1");
  const fee = makeInput(5000, "ef");
  const { inputs, outputs } = bundleStreams([a1], [b1], fee, 3000);

  const offerSpecs: InputSpec[] = inputs.map((input, index) => ({
    input,
    sig: index <= 1 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const offer = buildSignedPsbt(offerSpecs, outputs);

  const acceptSpecs: InputSpec[] = inputs.map((input, index) => ({
    input,
    // Leave the fee input (index 4) unsigned.
    sig: index < 4 ? { kind: "partial" as const, sighash: 0x01 } : undefined,
  }));
  const accept = buildSignedPsbt(acceptSpecs, outputs);

  assert.throws(
    () => validateSatForSatBundleAcceptPsbt(accept, offer),
    /input 4 must be signed/,
  );
});
