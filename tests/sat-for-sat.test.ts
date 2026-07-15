import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
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
  | { kind: "tap"; length: 64 | 65; sighash?: number };

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
      // A synthetic DER-ish sig body followed by the sighash byte.
      const value = Buffer.concat([
        Buffer.from("3006020101020101", "hex"),
        Buffer.from([spec.sig.sighash]),
      ]);
      entries.push(encodeMapEntry(key, value));
    } else if (spec.sig?.kind === "tap") {
      const value = Buffer.alloc(spec.sig.length, 0x11);
      if (spec.sig.length === 65) {
        value[64] = spec.sig.sighash ?? 0x00;
      }
      entries.push(encodeMapEntry(Buffer.from([0x13]), value));
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
