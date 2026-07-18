import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  inputHasSighashAllSignature,
  parsePsbt,
  PSBT_MAGIC,
  PsbtValidationError,
  type TemplateInput,
} from "../src/psbt.ts";
import {
  buildSatForSatOfferPsbt,
  validateSatForSatAcceptPsbt,
  validateSatForSatOfferPsbt,
  type SatForSatAssetSide,
} from "../src/sat-for-sat.ts";

// --- fixtures -------------------------------------------------------------

const p2wpkh = (fill: string): string => "0014" + fill.repeat(20);

const A_BUMP: TemplateInput = {
  outpoint: "a".repeat(64) + ":0",
  valueSats: 600,
  scriptPubkeyHex: p2wpkh("a1"),
};
const A_ASSET: TemplateInput = {
  outpoint: "b".repeat(64) + ":0",
  valueSats: 546,
  scriptPubkeyHex: p2wpkh("a2"),
};
const B_BUMP: TemplateInput = {
  outpoint: "c".repeat(64) + ":0",
  valueSats: 600,
  scriptPubkeyHex: p2wpkh("b1"),
};
const B_ASSET: TemplateInput = {
  outpoint: "d".repeat(64) + ":0",
  valueSats: 546,
  scriptPubkeyHex: p2wpkh("b2"),
};
const FEE_INPUT: TemplateInput = {
  outpoint: "e".repeat(64) + ":0",
  valueSats: 5000,
  scriptPubkeyHex: p2wpkh("ef"),
};

const A_CHANGE_SPK = p2wpkh("11");
const B_ORDINALS_SPK = p2wpkh("22");
const B_CHANGE_SPK = p2wpkh("33");
const A_ORDINALS_SPK = p2wpkh("44");
const FEE_CHANGE_SPK = p2wpkh("55");
const FEE_CHANGE_VALUE = 3000;

const PARTY_A: SatForSatAssetSide = {
  bumpInput: A_BUMP,
  assetInput: A_ASSET,
  changeScriptPubkeyHex: A_CHANGE_SPK,
  counterpartyOrdinalsScriptPubkeyHex: B_ORDINALS_SPK,
};
const PARTY_B: SatForSatAssetSide = {
  bumpInput: B_BUMP,
  assetInput: B_ASSET,
  changeScriptPubkeyHex: B_CHANGE_SPK,
  counterpartyOrdinalsScriptPubkeyHex: A_ORDINALS_SPK,
};

interface InputSpec {
  input: TemplateInput;
  sig?: SigSpec;
}

// A synthetic signature to inject into an input map.
type SigSpec =
  | { kind: "partial"; sighash: number }
  // Inject a raw PSBT_IN_PARTIAL_SIG (0x02) value verbatim — used to craft
  // empty/one-byte/malformed fake signatures.
  | { kind: "rawPartial"; value: Buffer }
  | { kind: "tap"; length: 64 | 65; sighash?: number }
  // Inject a raw PSBT_IN_TAP_KEY_SIG (0x13) value verbatim.
  | { kind: "rawTap"; value: Buffer };

interface OutputSpec {
  valueSats: number;
  scriptPubkeyHex: string;
}

// Build a sat-for-sat PSBT with the same layout the builder produces
// (global 0x00 unsigned tx, per-input witness_utxo + optional injected sig,
// empty output maps), but with hand-injected signatures so tests can craft
// signed/unsigned/tampered fixtures.
function buildSatForSatPsbt(inputs: InputSpec[], outputs: OutputSpec[]): string {
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
      // A plausible-DER ECDSA sig body followed by the sighash byte.
      const value = Buffer.concat([
        Buffer.from("3006020101020101", "hex"),
        Buffer.from([spec.sig.sighash]),
      ]);
      entries.push(encodeMapEntry(key, value));
    } else if (spec.sig?.kind === "rawPartial") {
      const pubkey = Buffer.from("02".repeat(33), "hex");
      const key = Buffer.concat([Buffer.from([0x02]), pubkey]);
      entries.push(encodeMapEntry(key, spec.sig.value));
    } else if (spec.sig?.kind === "tap") {
      const value = Buffer.alloc(spec.sig.length, 0x11);
      if (spec.sig.length === 65) {
        value[64] = spec.sig.sighash ?? 0x00;
      }
      entries.push(encodeMapEntry(Buffer.from([0x13]), value));
    } else if (spec.sig?.kind === "rawTap") {
      entries.push(encodeMapEntry(Buffer.from([0x13]), spec.sig.value));
    }

    return Buffer.concat([...entries, Buffer.from([0x00])]);
  });

  const outputMaps = outputs.map(() => Buffer.from([0x00]));

  return Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]).toString(
    "base64",
  );
}

const CANONICAL_INPUTS = (): InputSpec[] => [
  { input: A_BUMP },
  { input: A_ASSET },
  { input: B_BUMP },
  { input: B_ASSET },
  { input: FEE_INPUT },
];

const CANONICAL_OUTPUTS: OutputSpec[] = [
  { valueSats: A_BUMP.valueSats, scriptPubkeyHex: A_CHANGE_SPK },
  { valueSats: A_ASSET.valueSats, scriptPubkeyHex: B_ORDINALS_SPK },
  { valueSats: B_BUMP.valueSats, scriptPubkeyHex: B_CHANGE_SPK },
  { valueSats: B_ASSET.valueSats, scriptPubkeyHex: A_ORDINALS_SPK },
  { valueSats: FEE_CHANGE_VALUE, scriptPubkeyHex: FEE_CHANGE_SPK },
];

function buildOfferParams() {
  return {
    partyA: PARTY_A,
    partyB: PARTY_B,
    feeFundingInput: FEE_INPUT,
    feePayerChangeScriptPubkeyHex: FEE_CHANGE_SPK,
    feePayerChangeValueSats: FEE_CHANGE_VALUE,
  };
}

// --- builder --------------------------------------------------------------

test("buildSatForSatOfferPsbt emits 5 inputs in canonical order and 5 computed output values", () => {
  const result = buildSatForSatOfferPsbt(buildOfferParams());

  assert.deepEqual(result.inputOutpoints, [
    A_BUMP.outpoint,
    A_ASSET.outpoint,
    B_BUMP.outpoint,
    B_ASSET.outpoint,
    FEE_INPUT.outpoint,
  ]);

  assert.deepEqual(result.outputValues, [
    A_BUMP.valueSats,
    A_ASSET.valueSats,
    B_BUMP.valueSats,
    B_ASSET.valueSats,
    FEE_CHANGE_VALUE,
  ]);

  const parsed = parsePsbt(result.psbtBase64);
  assert.equal(parsed.inputs.length, 5);
  assert.equal(parsed.outputs.length, 5);

  const expectedWitness: TemplateInput[] = [A_BUMP, A_ASSET, B_BUMP, B_ASSET, FEE_INPUT];
  parsed.inputs.forEach((input, index) => {
    assert.equal(input.witnessUtxoValue, expectedWitness[index].valueSats);
    assert.equal(input.witnessUtxoScriptPubkeyHex, expectedWitness[index].scriptPubkeyHex);
    assert.equal(input.partialSigCount, 0);
  });
});

test("buildSatForSatOfferPsbt rejects a sub-dust computed output", () => {
  const params = buildOfferParams();
  params.feePayerChangeValueSats = 100; // below 294 P2WPKH dust threshold
  assert.throws(() => buildSatForSatOfferPsbt(params), /dust/i);
});

// --- offer validation -----------------------------------------------------

test("validateSatForSatOfferPsbt accepts offerer-signed [0],[1] (SIGHASH_ALL) with [2],[3] unsigned", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  const summary = validateSatForSatOfferPsbt(psbt, {
    offererAssetOutpoint: A_ASSET.outpoint,
    takerAssetOutpoint: B_ASSET.outpoint,
  });

  assert.deepEqual(summary.offererSignedInputs, [0, 1]);
  assert.equal(summary.buyerAssetOutputIndex, 1);
  assert.equal(summary.sellerAssetOutputIndex, 3);
});

test("validateSatForSatOfferPsbt accepts a Taproot key-sig (0x13, 64-byte -> SIGHASH_DEFAULT)", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "tap", length: 64 };
  inputs[1].sig = { kind: "tap", length: 64 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  const parsed = parsePsbt(psbt);
  assert.equal(parsed.inputs[0].partialSigCount, 1);
  assert.equal(parsed.inputs[0].sighashType, 0x00);

  const summary = validateSatForSatOfferPsbt(psbt, {
    offererAssetOutpoint: A_ASSET.outpoint,
    takerAssetOutpoint: B_ASSET.outpoint,
  });
  assert.deepEqual(summary.offererSignedInputs, [0, 1]);
});

test("validateSatForSatOfferPsbt rejects an offerer input signed with a non-SIGHASH_ALL sighash", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x02 }; // SIGHASH_NONE
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /SIGHASH_ALL/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects a pre-signed accepter input", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  inputs[2].sig = { kind: "partial", sighash: 0x01 }; // accepter input pre-signed
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /accepter input 2/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects wrong input ordering", () => {
  // Swap A_asset and B_bump positions so index 1 is no longer the offerer asset.
  const inputs: InputSpec[] = [
    { input: A_BUMP, sig: { kind: "partial", sighash: 0x01 } },
    { input: B_BUMP },
    { input: A_ASSET, sig: { kind: "partial", sighash: 0x01 } },
    { input: B_ASSET },
    { input: FEE_INPUT },
  ];
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /input 1/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects an offset-shifting output value (FIFO invariant)", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  // Bump output[0] to a value that does not equal A_bump input value.
  const outputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
  outputs[0].valueSats = 700;
  const psbt = buildSatForSatPsbt(inputs, outputs);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /offset 0/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects a sub-dust output", () => {
  // Craft input[0] value + output[0] value that satisfy the FIFO invariant but
  // are both below the P2WPKH dust threshold, so the dust check fires.
  const dustBump: TemplateInput = { ...A_BUMP, valueSats: 100 };
  const inputs: InputSpec[] = [
    { input: dustBump, sig: { kind: "partial", sighash: 0x01 } },
    { input: A_ASSET, sig: { kind: "partial", sighash: 0x01 } },
    { input: B_BUMP },
    { input: B_ASSET },
    { input: FEE_INPUT },
  ];
  const outputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
  outputs[0].valueSats = 100; // matches input[0] value (FIFO ok) but sub-dust
  const psbt = buildSatForSatPsbt(inputs, outputs);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    /dust/i,
  );
});

// --- accept validation ----------------------------------------------------

test("validateSatForSatAcceptPsbt accepts a fully-signed matching PSBT", () => {
  const offerInputs = CANONICAL_INPUTS();
  offerInputs[0].sig = { kind: "partial", sighash: 0x01 };
  offerInputs[1].sig = { kind: "partial", sighash: 0x01 };
  const offer = buildSatForSatPsbt(offerInputs, CANONICAL_OUTPUTS);

  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs.forEach((spec) => {
    spec.sig = { kind: "partial", sighash: 0x01 };
  });
  const accept = buildSatForSatPsbt(acceptInputs, CANONICAL_OUTPUTS);

  assert.deepEqual(validateSatForSatAcceptPsbt(accept, offer), { ready: true });
});

test("validateSatForSatAcceptPsbt rejects a tampered unsigned tx even if all inputs are signed", () => {
  const offerInputs = CANONICAL_INPUTS();
  offerInputs[0].sig = { kind: "partial", sighash: 0x01 };
  offerInputs[1].sig = { kind: "partial", sighash: 0x01 };
  const offer = buildSatForSatPsbt(offerInputs, CANONICAL_OUTPUTS);

  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs.forEach((spec) => {
    spec.sig = { kind: "partial", sighash: 0x01 };
  });
  // Tamper with output[4] value.
  const tamperedOutputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
  tamperedOutputs[4].valueSats = FEE_CHANGE_VALUE - 500;
  const tamperedAccept = buildSatForSatPsbt(acceptInputs, tamperedOutputs);

  assert.throws(
    () => validateSatForSatAcceptPsbt(tamperedAccept, offer),
    (error: unknown) =>
      error instanceof PsbtValidationError && /does not match/.test(error.message),
  );
});

test("validateSatForSatAcceptPsbt rejects an accept with an unsigned input", () => {
  const offer = buildSatForSatPsbt(
    [
      { input: A_BUMP, sig: { kind: "partial", sighash: 0x01 } },
      { input: A_ASSET, sig: { kind: "partial", sighash: 0x01 } },
      { input: B_BUMP },
      { input: B_ASSET },
      { input: FEE_INPUT },
    ],
    CANONICAL_OUTPUTS,
  );

  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs[0].sig = { kind: "partial", sighash: 0x01 };
  acceptInputs[1].sig = { kind: "partial", sighash: 0x01 };
  acceptInputs[2].sig = { kind: "partial", sighash: 0x01 };
  acceptInputs[3].sig = { kind: "partial", sighash: 0x01 };
  // input[4] left unsigned.
  const accept = buildSatForSatPsbt(acceptInputs, CANONICAL_OUTPUTS);

  assert.throws(
    () => validateSatForSatAcceptPsbt(accept, offer),
    (error: unknown) =>
      error instanceof PsbtValidationError && /input 4 must be signed/.test(error.message),
  );
});

test("fee-payer variant: offerer A signs [0,1,4] and validates", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  inputs[4].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  const summary = validateSatForSatOfferPsbt(psbt, {
    offererAssetOutpoint: A_ASSET.outpoint,
    takerAssetOutpoint: B_ASSET.outpoint,
    offererSignedInputs: [0, 1, 4],
  });
  assert.deepEqual(summary.offererSignedInputs, [0, 1, 4]);
});

// --- BLOCKING 1: malformed/fake signatures must be rejected ---------------

test("parsePsbt marks empty/one-byte partial sigs and empty tap sigs as not ALL-equivalent", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "rawPartial", value: Buffer.alloc(0) }; // empty
  inputs[1].sig = { kind: "rawPartial", value: Buffer.from([0x00]) }; // one-byte 0x00
  inputs[2].sig = { kind: "rawTap", value: Buffer.alloc(0) }; // empty tap
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  const parsed = parsePsbt(psbt);
  // They still register as present signature entries...
  assert.equal(parsed.inputs[0].partialSigCount, 1);
  assert.equal(parsed.inputs[1].partialSigCount, 1);
  assert.equal(parsed.inputs[2].partialSigCount, 1);
  // ...but none are structurally valid SIGHASH_ALL signatures.
  assert.equal(inputHasSighashAllSignature(parsed.inputs[0]), false);
  assert.equal(inputHasSighashAllSignature(parsed.inputs[1]), false);
  assert.equal(inputHasSighashAllSignature(parsed.inputs[2]), false);
});

test("validateSatForSatOfferPsbt rejects a one-byte 0x00 fake partial sig on an offerer input", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "rawPartial", value: Buffer.from([0x00]) }; // fake
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /input 1 must carry a valid/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects a 65-byte tap sig with an explicit 0x00 sighash byte", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "tap", length: 64 };
  // 65-byte tap sig must carry explicit 0x01; 0x00 as an explicit byte is invalid.
  const badTap = Buffer.alloc(65, 0x11);
  badTap[64] = 0x00;
  inputs[1].sig = { kind: "rawTap", value: badTap };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /input 1 must carry a valid/.test(error.message),
  );
});

test("validateSatForSatAcceptPsbt rejects an accept whose sigs are all one-byte 0x00 fakes", () => {
  const offerInputs = CANONICAL_INPUTS();
  offerInputs[0].sig = { kind: "partial", sighash: 0x01 };
  offerInputs[1].sig = { kind: "partial", sighash: 0x01 };
  const offer = buildSatForSatPsbt(offerInputs, CANONICAL_OUTPUTS);

  // All five "signatures" are one-byte 0x00 values — count as present but invalid.
  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs.forEach((spec) => {
    spec.sig = { kind: "rawPartial", value: Buffer.from([0x00]) };
  });
  const accept = buildSatForSatPsbt(acceptInputs, CANONICAL_OUTPUTS);

  assert.throws(
    () => validateSatForSatAcceptPsbt(accept, offer),
    (error: unknown) =>
      error instanceof PsbtValidationError && /must carry a valid/.test(error.message),
  );
});

test("validateSatForSatAcceptPsbt rejects an accept whose tap sigs are all empty", () => {
  const offerInputs = CANONICAL_INPUTS();
  offerInputs[0].sig = { kind: "partial", sighash: 0x01 };
  offerInputs[1].sig = { kind: "partial", sighash: 0x01 };
  const offer = buildSatForSatPsbt(offerInputs, CANONICAL_OUTPUTS);

  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs.forEach((spec) => {
    spec.sig = { kind: "rawTap", value: Buffer.alloc(0) };
  });
  const accept = buildSatForSatPsbt(acceptInputs, CANONICAL_OUTPUTS);

  assert.throws(
    () => validateSatForSatAcceptPsbt(accept, offer),
    (error: unknown) =>
      error instanceof PsbtValidationError && /must carry a valid/.test(error.message),
  );
});

test("validateSatForSatAcceptPsbt accepts 64-byte Taproot key sigs across all inputs", () => {
  const offerInputs = CANONICAL_INPUTS();
  offerInputs[0].sig = { kind: "partial", sighash: 0x01 };
  offerInputs[1].sig = { kind: "partial", sighash: 0x01 };
  const offer = buildSatForSatPsbt(offerInputs, CANONICAL_OUTPUTS);

  const acceptInputs = CANONICAL_INPUTS();
  acceptInputs.forEach((spec) => {
    spec.sig = { kind: "tap", length: 64 };
  });
  const accept = buildSatForSatPsbt(acceptInputs, CANONICAL_OUTPUTS);

  assert.deepEqual(validateSatForSatAcceptPsbt(accept, offer), { ready: true });
});

// --- BLOCKING 2: offerer_signed_inputs must always cover 0 and 1 ----------

test("validateSatForSatOfferPsbt rejects offerer_signed_inputs: [] (empty removes commitments)", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
        offererSignedInputs: [],
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /\[0,1\] or \[0,1,4\]/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects an offerer_signed_inputs set missing input 0 or 1", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  for (const bad of [[1], [0], [1, 4], [0, 4], [2, 3]]) {
    assert.throws(
      () =>
        validateSatForSatOfferPsbt(psbt, {
          offererAssetOutpoint: A_ASSET.outpoint,
          takerAssetOutpoint: B_ASSET.outpoint,
          offererSignedInputs: bad,
        }),
      (error: unknown) =>
        error instanceof PsbtValidationError && /\[0,1\] or \[0,1,4\]/.test(error.message),
      `expected rejection for offererSignedInputs=${JSON.stringify(bad)}`,
    );
  }
});

test("validateSatForSatOfferPsbt rejects duplicate / out-of-range offerer_signed_inputs", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  for (const bad of [[0, 1, 1], [0, 0, 1], [0, 1, 5], [0, 1, 2]]) {
    assert.throws(
      () =>
        validateSatForSatOfferPsbt(psbt, {
          offererAssetOutpoint: A_ASSET.outpoint,
          takerAssetOutpoint: B_ASSET.outpoint,
          offererSignedInputs: bad,
        }),
      (error: unknown) =>
        error instanceof PsbtValidationError && /\[0,1\] or \[0,1,4\]/.test(error.message),
      `expected rejection for offererSignedInputs=${JSON.stringify(bad)}`,
    );
  }
});

test("validateSatForSatOfferPsbt accepts [1,0] (unordered) as the canonical [0,1] set", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const psbt = buildSatForSatPsbt(inputs, CANONICAL_OUTPUTS);

  const summary = validateSatForSatOfferPsbt(psbt, {
    offererAssetOutpoint: A_ASSET.outpoint,
    takerAssetOutpoint: B_ASSET.outpoint,
    offererSignedInputs: [1, 0],
  });
  assert.deepEqual(summary.offererSignedInputs, [0, 1]);
});

// --- SHOULD-FIX 5: value conservation / non-negative fee ------------------

test("buildSatForSatOfferPsbt rejects a fee-payer change larger than the fee input", () => {
  const params = buildOfferParams();
  // FEE_INPUT is 5000; ask for change > input value.
  params.feePayerChangeValueSats = 6000;
  assert.throws(
    () => buildSatForSatOfferPsbt(params),
    (error: unknown) =>
      error instanceof PsbtValidationError && /exceeds fee-funding input/.test(error.message),
  );
});

test("buildSatForSatOfferPsbt rejects an offer whose total outputs exceed total inputs (negative fee)", () => {
  // Because outputs[0..3] are forced equal to inputs[0..3] (FIFO offset-0), the
  // only way total_out can exceed total_in is fee-payer change > fee input — the
  // exact negative-implied-fee condition. Both the per-output and aggregate
  // conservation guards catch it; the per-output guard fires first.
  const params = buildOfferParams();
  params.feeFundingInput = { ...FEE_INPUT, valueSats: 400 };
  params.feePayerChangeValueSats = 500; // > fee input => implied fee negative
  assert.throws(
    () => buildSatForSatOfferPsbt(params),
    (error: unknown) =>
      error instanceof PsbtValidationError &&
      /(exceeds fee-funding input|implied fee would be negative)/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects an offer whose fee-payer change exceeds the fee input", () => {
  const inputs = CANONICAL_INPUTS();
  inputs[0].sig = { kind: "partial", sighash: 0x01 };
  inputs[1].sig = { kind: "partial", sighash: 0x01 };
  const outputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
  outputs[4].valueSats = 6000; // > FEE_INPUT (5000)
  const psbt = buildSatForSatPsbt(inputs, outputs);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError && /exceeds fee-funding input/.test(error.message),
  );
});

test("validateSatForSatOfferPsbt rejects an offer whose outputs exceed inputs (negative fee)", () => {
  // Shrink the fee input so total out > total in. Because the FIFO invariant
  // forces outputs[0..3] == inputs[0..3], a negative implied fee is exactly
  // output[4] > input[4]; either the per-output or aggregate guard rejects it.
  const smallFee: TemplateInput = { ...FEE_INPUT, valueSats: 400 };
  const inputs: InputSpec[] = [
    { input: A_BUMP, sig: { kind: "partial", sighash: 0x01 } },
    { input: A_ASSET, sig: { kind: "partial", sighash: 0x01 } },
    { input: B_BUMP },
    { input: B_ASSET },
    { input: smallFee },
  ];
  const outputs = CANONICAL_OUTPUTS.map((o) => ({ ...o }));
  outputs[4].valueSats = 500; // > fee input (400) => total out > total in
  const psbt = buildSatForSatPsbt(inputs, outputs);

  assert.throws(
    () =>
      validateSatForSatOfferPsbt(psbt, {
        offererAssetOutpoint: A_ASSET.outpoint,
        takerAssetOutpoint: B_ASSET.outpoint,
      }),
    (error: unknown) =>
      error instanceof PsbtValidationError &&
      /(exceeds fee-funding input|implied fee would be negative)/.test(error.message),
  );
});
