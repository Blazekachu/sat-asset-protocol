// General m×n sat-for-sat *bundle* offer/accept PSBT builder + validators
// (ADR-0014 / ADR-0018, RD3 Option A).
//
// A sat-for-sat bundle atomically trades party A's m assets for party B's n
// assets in a single non-custodial transaction. Every asset (a bare sat or a
// whole-UTXO ordinal range) travels through a mirrored per-asset 2-bump
// construction: each side contributes one ~600-sat bump UTXO immediately ahead
// of each of its asset UTXOs so that, in the FIFO sat-flow model, every traded
// asset lands at offset 0 of its counterparty's ordinals output. Every signer
// uses SIGHASH_ALL (or the Taproot-equivalent SIGHASH_DEFAULT), committing to
// the whole transaction so neither party can tamper with it after signing.
//
// Interleaved input stream (m offerer legs, then n taker legs, then fee):
//   [0]        A_bump1     A signs SIGHASH_ALL
//   [1]        A_asset1    A signs SIGHASH_ALL   (X1 @ offset 0)
//   ...
//   [2m-2]     A_bumpM     A signs SIGHASH_ALL
//   [2m-1]     A_assetM    A signs SIGHASH_ALL   (XM @ offset 0)
//   [2m]       B_bump1     B signs SIGHASH_ALL
//   [2m+1]     B_asset1    B signs SIGHASH_ALL   (Y1 @ offset 0)
//   ...
//   [2(m+n)-1] B_assetN    B signs SIGHASH_ALL
//   [2(m+n)]   fee_funding fee payer signs SIGHASH_ALL
//
// Outputs consume the FIFO stream by *exact passthrough*, so input index ===
// output index at every non-fee position: per leg emit {change = bump.value}
// then {ordinals = asset.value}, then a final {fee_payer_change}. Total
// inputs/outputs = 2(m+n)+1; bumps = m+n.
//
// At m=n=1 this reduces exactly to the legacy 5-in/5-out layout in
// src/sat-for-sat.ts (byte-identical output), which is why that module can be
// a thin adapter over this one.
//
// This module is unit/synthetic only; live testnet4 validation is the deferred
// spike tracked as an ADR-0014 follow-up.

import {
  assertOutputAboveDust,
  classifyScript,
  dustThresholdForScript,
} from "./dust.ts";
import {
  buildUnsignedTransaction,
  encodeMapEntry,
  encodeWitnessUtxoMap,
  estimateTxVBytes,
  inputHasSighashAllSignature,
  parsePsbt,
  PSBT_MAGIC,
  PsbtValidationError,
  unsignedTxBytes,
  type DustPolicy,
  type ParsedPsbt,
  type TemplateInput,
} from "./psbt.ts";

// Default min-relay fee (sat/vB) folded into the fee-band lower bound, matching
// the dust default. Kept local so this module has no cross-module state.
const DEFAULT_MIN_RELAY_FEE_SAT_PER_VB = 3;

/**
 * One asset leg of one side of a sat-for-sat bundle: a bump UTXO consumed
 * immediately ahead of the asset UTXO (so the traded asset lands at offset 0 of
 * the counterparty output), the asset UTXO holding the sat/range at offset 0,
 * this side's change scriptPubkey (receives the bump passthrough), and the
 * counterparty's ordinals scriptPubkey (receives this leg's asset). There is
 * deliberately NO caller-supplied change value: the builder computes it from
 * `bumpInput.valueSats` to preserve the FIFO offset-0 invariant.
 */
export interface SatForSatAssetLeg {
  bumpInput: TemplateInput;
  assetInput: TemplateInput; // pure postage (sat) or whole-range UTXO, offset-0
  changeScriptPubkeyHex: string; // owner receives the bump passthrough
  counterpartyOrdinalsScriptPubkeyHex: string; // counterparty receives asset @0
}

/** One side of a bundle: an ordered, non-empty list of asset legs. */
export interface SatForSatBundleSide {
  legs: SatForSatAssetLeg[]; // length >= 1
}

export interface BuildSatForSatBundleParams {
  offerer: SatForSatBundleSide; // A, m legs
  taker: SatForSatBundleSide; // B, n legs
  feeFundingInput: TemplateInput;
  feePayerChangeScriptPubkeyHex: string;
  feePayerChangeValueSats: number;
  dustPolicy?: DustPolicy;
}

export interface BuildSatForSatBundleResult {
  psbtBase64: string;
  inputOutpoints: string[];
  outputValues: number[];
  layout: SatForSatBundleLayout;
}

/**
 * Derived index map for a bundle with `offererLegCount` (m) offerer legs and
 * `takerLegCount` (n) taker legs. Every array holds absolute input/output
 * indexes into the interleaved 2(m+n)+1 stream. Asset output indexes equal the
 * corresponding asset input indexes (exact passthrough).
 */
export interface SatForSatBundleLayout {
  offererLegCount: number;
  takerLegCount: number;
  inputCount: number;
  offererAssetInputIndexes: number[];
  takerAssetInputIndexes: number[];
  offererSignedInputIndexes: number[];
  takerSignedInputIndexes: number[];
  feeInputIndex: number;
  offererAssetOutputIndexes: number[]; // == input indexes (passthrough)
  takerAssetOutputIndexes: number[]; // == input indexes (passthrough)
}

export interface ValidateSatForSatBundleOfferExpected {
  offererAssetOutpoints: string[];
  takerAssetOutpoints: string[];
  offererIsFeePayer?: boolean;
  dustPolicy?: DustPolicy;
}

export interface ValidateSatForSatBundleOfferSummary {
  layout: SatForSatBundleLayout;
  /** The resolved offerer-signed set actually enforced (incl. fee when payer). */
  offererSignedInputs: number[];
}

/**
 * Derive the full index map for an m×n bundle. Inputs are interleaved
 * [A_bump1, A_asset1, …, A_bumpM, A_assetM, B_bump1, B_asset1, …, B_bumpN,
 * B_assetN, fee]; outputs mirror inputs by exact passthrough. Asset inputs sit
 * at the odd offset within each 2-input leg. The offerer signs all of its own
 * bump+asset inputs (indexes 0..2m-1) and the taker signs all of its own
 * (2m..2(m+n)-1); the fee input belongs to whichever side pays (resolved by the
 * validators, not here).
 */
export function deriveBundleLayout(
  offererLegCount: number,
  takerLegCount: number,
): SatForSatBundleLayout {
  if (!Number.isInteger(offererLegCount) || offererLegCount < 1) {
    throw new PsbtValidationError(
      `sat-for-sat bundle offerer leg count must be an integer >= 1 (got ${offererLegCount})`,
    );
  }
  if (!Number.isInteger(takerLegCount) || takerLegCount < 1) {
    throw new PsbtValidationError(
      `sat-for-sat bundle taker leg count must be an integer >= 1 (got ${takerLegCount})`,
    );
  }

  const m = offererLegCount;
  const n = takerLegCount;
  const inputCount = 2 * (m + n) + 1;
  const feeInputIndex = inputCount - 1;

  const offererSignedInputIndexes: number[] = [];
  const offererAssetInputIndexes: number[] = [];
  for (let leg = 0; leg < m; leg += 1) {
    const bumpIndex = 2 * leg;
    const assetIndex = bumpIndex + 1;
    offererSignedInputIndexes.push(bumpIndex, assetIndex);
    offererAssetInputIndexes.push(assetIndex);
  }

  const takerSignedInputIndexes: number[] = [];
  const takerAssetInputIndexes: number[] = [];
  for (let leg = 0; leg < n; leg += 1) {
    const bumpIndex = 2 * m + 2 * leg;
    const assetIndex = bumpIndex + 1;
    takerSignedInputIndexes.push(bumpIndex, assetIndex);
    takerAssetInputIndexes.push(assetIndex);
  }

  return {
    offererLegCount: m,
    takerLegCount: n,
    inputCount,
    offererAssetInputIndexes,
    takerAssetInputIndexes,
    offererSignedInputIndexes,
    takerSignedInputIndexes,
    feeInputIndex,
    // Outputs mirror inputs by exact passthrough.
    offererAssetOutputIndexes: [...offererAssetInputIndexes],
    takerAssetOutputIndexes: [...takerAssetInputIndexes],
  };
}

/**
 * Assert the fee-band: the implied fee (sum(in) − sum(out)) divided by the
 * estimated vsize must be at least `minRelayFeeSatPerVb`, and — only when the
 * caller set `maxFeeRateSatPerVb` — at most that cap (RD6, opt-in).
 */
function assertFeeBand(
  inputs: Array<{ scriptPubkeyHex: string }>,
  outputs: Array<{ scriptPubkeyHex: string }>,
  totalIn: number,
  totalOut: number,
  dustPolicy: DustPolicy | undefined,
): void {
  const minRelayFeeSatPerVb =
    dustPolicy?.minRelayFeeSatPerVb ?? DEFAULT_MIN_RELAY_FEE_SAT_PER_VB;
  const fee = totalIn - totalOut;
  const vsize = estimateTxVBytes(inputs, outputs);
  const feeRate = fee / vsize;

  if (feeRate < minRelayFeeSatPerVb) {
    throw new PsbtValidationError(
      `sat-for-sat implied fee rate ${feeRate.toFixed(3)} sat/vB (fee ${fee} / vsize ${vsize}) below min relay fee ${minRelayFeeSatPerVb} sat/vB`,
    );
  }

  if (dustPolicy?.maxFeeRateSatPerVb !== undefined && feeRate > dustPolicy.maxFeeRateSatPerVb) {
    throw new PsbtValidationError(
      `sat-for-sat implied fee rate ${feeRate.toFixed(3)} sat/vB (fee ${fee} / vsize ${vsize}) exceeds max fee rate ${dustPolicy.maxFeeRateSatPerVb} sat/vB`,
    );
  }
}

/**
 * Build the unsigned sat-for-sat *bundle* offer PSBT for m offerer legs and n
 * taker legs. Every non-fee output value is fully computed from the paired
 * input value (only the fee-payer change is caller-supplied) because any
 * deviation would shift an asset off offset 0 in the counterparty output. Every
 * non-OP_RETURN output is asserted above its dust threshold, value conservation
 * is enforced, and the fee-band check runs (its `maxFeeRateSatPerVb` upper bound
 * only when the caller sets it).
 */
export function buildSatForSatBundlePsbt(
  params: BuildSatForSatBundleParams,
): BuildSatForSatBundleResult {
  const { offerer, taker } = params;

  if (offerer.legs.length < 1) {
    throw new PsbtValidationError("sat-for-sat bundle offerer must have >= 1 asset leg");
  }
  if (taker.legs.length < 1) {
    throw new PsbtValidationError("sat-for-sat bundle taker must have >= 1 asset leg");
  }

  const minRelayFeeSatPerVb = params.dustPolicy?.minRelayFeeSatPerVb;

  const layout = deriveBundleLayout(offerer.legs.length, taker.legs.length);

  // Interleave inputs: per leg emit [bump, asset]; offerer legs first, then
  // taker legs, then the single fee-funding input.
  const witnessInputs: TemplateInput[] = [];
  const outputs: Array<{ valueSats: number; scriptPubkeyHex: string }> = [];

  for (const leg of [...offerer.legs, ...taker.legs]) {
    witnessInputs.push(leg.bumpInput, leg.assetInput);
    // Passthrough: change = bump.value @ owner; ordinals = asset.value @ counterparty.
    outputs.push({ valueSats: leg.bumpInput.valueSats, scriptPubkeyHex: leg.changeScriptPubkeyHex });
    outputs.push({
      valueSats: leg.assetInput.valueSats,
      scriptPubkeyHex: leg.counterpartyOrdinalsScriptPubkeyHex,
    });
  }

  witnessInputs.push(params.feeFundingInput);
  outputs.push({
    valueSats: params.feePayerChangeValueSats,
    scriptPubkeyHex: params.feePayerChangeScriptPubkeyHex,
  });

  const inputOutpoints = witnessInputs.map((input) => input.outpoint);
  const outputValues = outputs.map((output) => output.valueSats);

  for (const output of outputs) {
    assertOutputAboveDust(output.scriptPubkeyHex, output.valueSats, minRelayFeeSatPerVb);
  }

  // Value conservation: the fee-payer change is caller-supplied, so it must not
  // exceed the fee-funding input and the transaction must leave a non-negative
  // implied miner fee. A negative fee is unbroadcastable.
  if (params.feePayerChangeValueSats > params.feeFundingInput.valueSats) {
    throw new PsbtValidationError(
      `fee_payer_change ${params.feePayerChangeValueSats} exceeds fee-funding input value ${params.feeFundingInput.valueSats}`,
    );
  }

  const totalIn = witnessInputs.reduce((sum, input) => sum + input.valueSats, 0);
  const totalOut = outputValues.reduce((sum, value) => sum + value, 0);
  if (totalOut > totalIn) {
    throw new PsbtValidationError(
      `sat-for-sat outputs (${totalOut}) exceed inputs (${totalIn}); implied fee would be negative`,
    );
  }

  assertFeeBand(witnessInputs, outputs, totalIn, totalOut, params.dustPolicy);

  const unsignedTransaction = buildUnsignedTransaction(inputOutpoints, outputs);

  const inputMaps: Buffer[] = witnessInputs
    .map((input) => encodeWitnessUtxoMap(input.valueSats, input.scriptPubkeyHex))
    .map((mapEntry) => Buffer.concat([mapEntry, Buffer.from([0x00])]));

  const outputMaps: Buffer[] = outputs.map(() => Buffer.from([0x00]));
  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTransaction),
    Buffer.from([0x00]),
  ]);

  const psbt = Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]);

  return {
    psbtBase64: psbt.toString("base64"),
    inputOutpoints,
    outputValues,
    layout,
  };
}

/**
 * Infer (m, n) from a parsed PSBT's input count. Requires
 * `inputCount === 2(m+n)+1` for integer m,n >= 1 that are consistent with the
 * `expected` asset-outpoint array lengths.
 */
function inferLayoutFromInputCount(
  inputCount: number,
  offererLegCount: number,
  takerLegCount: number,
): SatForSatBundleLayout {
  if (offererLegCount < 1 || takerLegCount < 1) {
    throw new PsbtValidationError(
      "sat-for-sat bundle offer must name >= 1 asset outpoint on each side",
    );
  }

  const expectedCount = 2 * (offererLegCount + takerLegCount) + 1;
  if (inputCount !== expectedCount) {
    throw new PsbtValidationError(
      `sat-for-sat bundle offer must have ${expectedCount} inputs for m=${offererLegCount} n=${takerLegCount} (got ${inputCount})`,
    );
  }

  return deriveBundleLayout(offererLegCount, takerLegCount);
}

/**
 * Assert every non-OP_RETURN parsed output value is at or above its dust
 * threshold. Reuses the same message shape as the legacy single-asset builder.
 */
function assertAllOutputsAboveDust(
  outputs: Array<{ value: number; scriptPubkeyHex: string }>,
  minRelayFeeSatPerVb: number | undefined,
): void {
  for (const output of outputs) {
    if (classifyScript(output.scriptPubkeyHex) === "op_return") {
      continue;
    }
    const threshold = dustThresholdForScript(output.scriptPubkeyHex, minRelayFeeSatPerVb);
    if (output.value < threshold) {
      throw new PsbtValidationError(
        `Sat-for-sat output value ${output.value} below dust threshold ${threshold}`,
      );
    }
  }
}

/**
 * Assert value conservation on a parsed bundle PSBT: every input carries a
 * witness_utxo value, sum(inputs) >= sum(outputs), and the fee-payer change
 * output does not exceed the fee-funding input value.
 */
function assertBundleValueConservation(parsed: ParsedPsbt, feeInputIndex: number): number {
  let totalIn = 0;
  for (let index = 0; index < parsed.inputs.length; index += 1) {
    const witnessValue = parsed.inputs[index].witnessUtxoValue;
    if (witnessValue === null) {
      throw new PsbtValidationError(
        `Sat-for-sat offer input ${index} missing witness_utxo value`,
      );
    }
    totalIn += witnessValue;
  }

  const feeInputValue = parsed.inputs[feeInputIndex].witnessUtxoValue ?? 0;
  const feeChangeValue = parsed.outputs[feeInputIndex].value;
  if (feeChangeValue > feeInputValue) {
    throw new PsbtValidationError(
      `Sat-for-sat fee-payer change ${feeChangeValue} exceeds fee-funding input value ${feeInputValue}`,
    );
  }

  const totalOut = parsed.outputs.reduce((sum, output) => sum + output.value, 0);
  if (totalOut > totalIn) {
    throw new PsbtValidationError(
      `Sat-for-sat outputs (${totalOut}) exceed inputs (${totalIn}); implied fee would be negative`,
    );
  }

  return totalIn;
}

/**
 * Validate a sat-for-sat *bundle* offer PSBT. m,n are inferred from the input
 * count and cross-checked against `expected` array lengths. Every asset input
 * outpoint must match the expected outpoint at its derived index; every non-fee
 * output value must equal its paired input value (FIFO offset-0 invariant); the
 * offerer-signed set (its own legs, plus the fee input when the offerer pays)
 * must all carry a structurally valid SIGHASH_ALL signature while every accepter
 * input (and the fee input when the accepter pays) stays unsigned. Dust, value
 * conservation, and the fee-band are enforced with the Task 1 helpers.
 */
export function validateSatForSatBundleOfferPsbt(
  offerPsbtBase64: string,
  expected: ValidateSatForSatBundleOfferExpected,
): ValidateSatForSatBundleOfferSummary {
  const parsed = parsePsbt(offerPsbtBase64);

  const offererLegCount = expected.offererAssetOutpoints.length;
  const takerLegCount = expected.takerAssetOutpoints.length;
  const layout = inferLayoutFromInputCount(
    parsed.inputs.length,
    offererLegCount,
    takerLegCount,
  );

  if (parsed.outputs.length !== layout.inputCount) {
    throw new PsbtValidationError(
      `Sat-for-sat bundle offer must have ${layout.inputCount} outputs (got ${parsed.outputs.length})`,
    );
  }

  // Asset input outpoints must match the expected outpoints at derived indexes.
  layout.offererAssetInputIndexes.forEach((inputIndex, leg) => {
    if (parsed.inputs[inputIndex].outpoint !== expected.offererAssetOutpoints[leg]) {
      throw new PsbtValidationError(
        `Sat-for-sat bundle offer input ${inputIndex} must be offerer asset outpoint ${expected.offererAssetOutpoints[leg]}`,
      );
    }
  });
  layout.takerAssetInputIndexes.forEach((inputIndex, leg) => {
    if (parsed.inputs[inputIndex].outpoint !== expected.takerAssetOutpoints[leg]) {
      throw new PsbtValidationError(
        `Sat-for-sat bundle offer input ${inputIndex} must be taker asset outpoint ${expected.takerAssetOutpoints[leg]}`,
      );
    }
  });

  // FIFO offset-0 invariant: every non-fee output value equals its paired input
  // witness value.
  for (let index = 0; index < layout.inputCount; index += 1) {
    if (index === layout.feeInputIndex) {
      continue;
    }
    const witnessValue = parsed.inputs[index].witnessUtxoValue;
    if (witnessValue === null) {
      throw new PsbtValidationError(
        `Sat-for-sat offer input ${index} missing witness_utxo value`,
      );
    }
    if (parsed.outputs[index].value !== witnessValue) {
      throw new PsbtValidationError(
        `Sat-for-sat offer output ${index} value ${parsed.outputs[index].value} must equal input ${index} value ${witnessValue} to preserve offset 0`,
      );
    }
  }

  // Offerer-signed set: own legs, plus the fee input when the offerer pays.
  const offererSignedInputs = [...layout.offererSignedInputIndexes];
  if (expected.offererIsFeePayer) {
    offererSignedInputs.push(layout.feeInputIndex);
  }

  for (const index of offererSignedInputs) {
    const input = parsed.inputs[index];
    if (!input) {
      throw new PsbtValidationError(
        `Sat-for-sat offer missing offerer-signed input ${index}`,
      );
    }
    if (input.partialSigCount <= 0) {
      throw new PsbtValidationError(
        `Sat-for-sat offer input ${index} must be signed by the offerer`,
      );
    }
    if (!inputHasSighashAllSignature(input)) {
      throw new PsbtValidationError(
        `Sat-for-sat offer input ${index} must carry a valid SIGHASH_ALL-equivalent signature`,
      );
    }
  }

  // Accepter inputs (and the fee input when the accepter pays) must be unsigned.
  const offererSignedSet = new Set(offererSignedInputs);
  for (let index = 0; index < layout.inputCount; index += 1) {
    if (offererSignedSet.has(index)) {
      continue;
    }
    if (parsed.inputs[index].partialSigCount > 0) {
      throw new PsbtValidationError(
        `Sat-for-sat offer accepter input ${index} must be unsigned`,
      );
    }
  }

  const minRelayFeeSatPerVb = expected.dustPolicy?.minRelayFeeSatPerVb;
  assertAllOutputsAboveDust(parsed.outputs, minRelayFeeSatPerVb);
  const totalIn = assertBundleValueConservation(parsed, layout.feeInputIndex);
  const totalOut = parsed.outputs.reduce((sum, output) => sum + output.value, 0);

  assertFeeBand(
    parsed.inputs.map((input) => ({
      scriptPubkeyHex: input.witnessUtxoScriptPubkeyHex ?? "",
    })),
    parsed.outputs,
    totalIn,
    totalOut,
    expected.dustPolicy,
  );

  return { layout, offererSignedInputs };
}

/**
 * Validate a fully-signed sat-for-sat bundle accept PSBT against the original
 * offer. The unsigned transaction bytes must be byte-identical (the
 * atomicity/tamper gate), and all 2(m+n)+1 inputs must now carry a
 * structurally valid SIGHASH_ALL-equivalent signature.
 */
export function validateSatForSatBundleAcceptPsbt(
  acceptPsbtBase64: string,
  offerPsbtBase64: string,
): { ready: true } {
  const offerBytes = unsignedTxBytes(offerPsbtBase64);
  const acceptBytes = unsignedTxBytes(acceptPsbtBase64);

  if (!acceptBytes.equals(offerBytes)) {
    throw new PsbtValidationError(
      "Sat-for-sat accept unsigned transaction does not match the offer (tampered or mismatched)",
    );
  }

  const parsed = parsePsbt(acceptPsbtBase64);

  for (let index = 0; index < parsed.inputs.length; index += 1) {
    const input = parsed.inputs[index];
    if (input.partialSigCount <= 0) {
      throw new PsbtValidationError(
        `Sat-for-sat accept input ${index} must be signed`,
      );
    }
    if (!inputHasSighashAllSignature(input)) {
      throw new PsbtValidationError(
        `Sat-for-sat accept input ${index} must carry a valid SIGHASH_ALL-equivalent signature`,
      );
    }
  }

  return { ready: true };
}
