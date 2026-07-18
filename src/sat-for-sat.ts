// Sat-for-sat offer/accept PSBT builder + validators (ADR-0014).
//
// A "sat-for-sat" swap atomically trades party A's sat X for party B's sat Y in
// a single non-custodial transaction using a mirrored 2-bump construction. Each
// side contributes a ~600-sat bump UTXO ahead of its asset UTXO so that, in the
// FIFO sat-flow model, the traded sat lands at offset 0 of the counterparty's
// ordinals output. Every signer uses SIGHASH_ALL (or the Taproot-equivalent
// SIGHASH_DEFAULT), committing to the whole transaction so neither party can
// tamper with it after signing.
//
//   Inputs (FIFO stream order):
//     [0] A_bump   (~600)              A signs SIGHASH_ALL
//     [1] A_asset  (postage p_A, X@0)  A signs SIGHASH_ALL
//     [2] B_bump   (~600)              B signs SIGHASH_ALL
//     [3] B_asset  (postage p_B, Y@0)  B signs SIGHASH_ALL
//     [4] fee_funding (F)              fee payer signs SIGHASH_ALL
//   Outputs (consume FIFO stream):
//     [0] A_change  : A_bump.value          [1] B_ordinals : p_A  (X -> B @0)
//     [2] B_change  : B_bump.value          [3] A_ordinals : p_B  (Y -> A @0)
//     [4] fee_payer_change : F - fee
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
  inputHasSighashAllSignature,
  parsePsbt,
  PSBT_MAGIC,
  PsbtValidationError,
  unsignedTxBytes,
  type DustPolicy,
  type ParsedPsbt,
  type TemplateInput,
} from "./psbt.ts";

/**
 * One side of a sat-for-sat swap: a bump UTXO consumed ahead of the asset UTXO
 * (so the traded sat lands at offset 0 of the counterparty output), the asset
 * UTXO holding the sat at offset 0, this side's change scriptPubkey (receives
 * the bump passthrough), and the counterparty's ordinals scriptPubkey (receives
 * this side's asset). Note there is deliberately NO caller-supplied change
 * value: the builder computes it from `bumpInput.valueSats` to preserve the
 * FIFO offset-0 invariant.
 */
export interface SatForSatAssetSide {
  bumpInput: TemplateInput;
  assetInput: TemplateInput;
  changeScriptPubkeyHex: string;
  counterpartyOrdinalsScriptPubkeyHex: string;
}

export interface BuildSatForSatOfferParams {
  partyA: SatForSatAssetSide;
  partyB: SatForSatAssetSide;
  feeFundingInput: TemplateInput;
  feePayerChangeScriptPubkeyHex: string;
  feePayerChangeValueSats: number;
  dustPolicy?: DustPolicy;
}

export interface BuildSatForSatOfferResult {
  psbtBase64: string;
  inputOutpoints: string[];
  outputValues: number[];
}

export interface ValidateSatForSatOfferExpected {
  offererAssetOutpoint: string;
  takerAssetOutpoint: string;
  offererSignedInputs?: number[];
}

export interface ValidateSatForSatOfferSummary {
  offererSignedInputs: number[];
  buyerAssetOutputIndex: 1;
  sellerAssetOutputIndex: 3;
}

/**
 * Build the unsigned sat-for-sat offer PSBT. The five output values are fully
 * computed from the input values (only the fee-payer change is caller-supplied)
 * because any deviation would shift X/Y off offset 0 in the counterparty
 * output. Every non-OP_RETURN output is asserted above its dust threshold.
 */
export function buildSatForSatOfferPsbt(
  params: BuildSatForSatOfferParams,
): BuildSatForSatOfferResult {
  const minRelayFeeSatPerVb = params.dustPolicy?.minRelayFeeSatPerVb;

  const { partyA, partyB } = params;

  const inputOutpoints = [
    partyA.bumpInput.outpoint,
    partyA.assetInput.outpoint,
    partyB.bumpInput.outpoint,
    partyB.assetInput.outpoint,
    params.feeFundingInput.outpoint,
  ];

  // FIFO offset-0 correctness forces the first four output values.
  const outputValues = [
    partyA.bumpInput.valueSats,
    partyA.assetInput.valueSats,
    partyB.bumpInput.valueSats,
    partyB.assetInput.valueSats,
    params.feePayerChangeValueSats,
  ];

  const outputs = [
    { valueSats: partyA.bumpInput.valueSats, scriptPubkeyHex: partyA.changeScriptPubkeyHex },
    {
      valueSats: partyA.assetInput.valueSats,
      scriptPubkeyHex: partyA.counterpartyOrdinalsScriptPubkeyHex,
    },
    { valueSats: partyB.bumpInput.valueSats, scriptPubkeyHex: partyB.changeScriptPubkeyHex },
    {
      valueSats: partyB.assetInput.valueSats,
      scriptPubkeyHex: partyB.counterpartyOrdinalsScriptPubkeyHex,
    },
    {
      valueSats: params.feePayerChangeValueSats,
      scriptPubkeyHex: params.feePayerChangeScriptPubkeyHex,
    },
  ];

  for (const output of outputs) {
    assertOutputAboveDust(output.scriptPubkeyHex, output.valueSats, minRelayFeeSatPerVb);
  }

  const witnessInputs: TemplateInput[] = [
    partyA.bumpInput,
    partyA.assetInput,
    partyB.bumpInput,
    partyB.assetInput,
    params.feeFundingInput,
  ];

  // Value conservation: the fee-payer change (output[4]) is caller-supplied, so
  // it must not exceed the fee-funding input and the transaction must leave a
  // non-negative implied miner fee. A negative fee is unbroadcastable.
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
  };
}

const CANONICAL_INPUT_COUNT = 5;
const CANONICAL_OUTPUT_COUNT = 5;

/**
 * Validate a sat-for-sat offer PSBT. Everything derivable from the PSBT is
 * checked here (5 inputs/5 outputs, asset outpoint positions, FIFO offset-0
 * value invariants, per-input sighash/partial-sig state, dust); `expected`
 * carries only the cross-checks that cannot be read from the PSBT.
 */
export function validateSatForSatOfferPsbt(
  offerPsbtBase64: string,
  expected: ValidateSatForSatOfferExpected,
): ValidateSatForSatOfferSummary {
  const parsed = parsePsbt(offerPsbtBase64);

  if (parsed.inputs.length !== CANONICAL_INPUT_COUNT) {
    throw new PsbtValidationError(
      `Sat-for-sat offer must have exactly ${CANONICAL_INPUT_COUNT} inputs`,
    );
  }

  if (parsed.outputs.length !== CANONICAL_OUTPUT_COUNT) {
    throw new PsbtValidationError(
      `Sat-for-sat offer must have exactly ${CANONICAL_OUTPUT_COUNT} outputs`,
    );
  }

  if (parsed.inputs[1].outpoint !== expected.offererAssetOutpoint) {
    throw new PsbtValidationError(
      "Sat-for-sat offer input 1 must be the offerer asset outpoint",
    );
  }

  if (parsed.inputs[3].outpoint !== expected.takerAssetOutpoint) {
    throw new PsbtValidationError(
      "Sat-for-sat offer input 3 must be the taker asset outpoint",
    );
  }

  // FIFO offset-0 invariants (HARD rules). Each preceding stream output must
  // consume exactly the value of the preceding input so X/Y land at offset 0.
  const bumpAssetChecks: Array<[number, string]> = [
    [0, "A_bump"],
    [1, "A_asset"],
    [2, "B_bump"],
    [3, "B_asset"],
  ];
  for (const [index, label] of bumpAssetChecks) {
    const witnessValue = parsed.inputs[index].witnessUtxoValue;
    if (witnessValue === null) {
      throw new PsbtValidationError(
        `Sat-for-sat offer input ${index} (${label}) missing witness_utxo value`,
      );
    }
    if (parsed.outputs[index].value !== witnessValue) {
      throw new PsbtValidationError(
        `Sat-for-sat offer output ${index} value ${parsed.outputs[index].value} must equal input ${index} (${label}) value ${witnessValue} to preserve offset 0`,
      );
    }
  }

  const offererSignedInputs = normalizeOffererSignedInputs(expected.offererSignedInputs);

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

  // Accepter inputs [2] and [3] must still be unsigned in an offer PSBT.
  for (const index of [2, 3]) {
    if (parsed.inputs[index].partialSigCount > 0) {
      throw new PsbtValidationError(
        `Sat-for-sat offer accepter input ${index} must be unsigned`,
      );
    }
  }

  assertAllOutputsAboveDust(parsed.outputs);
  assertValueConservation(parsed);

  return {
    offererSignedInputs,
    buyerAssetOutputIndex: 1,
    sellerAssetOutputIndex: 3,
  };
}

/**
 * The offerer must ALWAYS commit to their bump + asset inputs (`0` and `1`).
 * The only allowed sets are exactly `[0,1]` (accepter is fee payer) or
 * `[0,1,4]` (offerer is fee payer). Anything else — an empty array, missing
 * `0`/`1`, duplicates, out-of-range indices, or arbitrary alternatives — is
 * rejected so a caller cannot suppress the required offerer commitments.
 */
function normalizeOffererSignedInputs(requested: number[] | undefined): number[] {
  if (requested === undefined) {
    return [0, 1];
  }

  const sorted = [...requested].sort((a, b) => a - b);
  const isBaseSet = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 1;
  const isFeePayerSet =
    sorted.length === 3 && sorted[0] === 0 && sorted[1] === 1 && sorted[2] === 4;

  if (!isBaseSet && !isFeePayerSet) {
    throw new PsbtValidationError(
      "offerer_signed_inputs must be exactly [0,1] or [0,1,4] (offerer must always sign inputs 0 and 1)",
    );
  }

  return sorted;
}

/**
 * Assert value conservation: sum(inputs) >= sum(outputs) (implied miner fee is
 * non-negative) and output[4] (fee-payer change) does not exceed input[4]'s
 * witness_utxo value. All five inputs must carry witness_utxo values.
 */
function assertValueConservation(parsed: ParsedPsbt): void {
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

  const feeInputValue = parsed.inputs[4].witnessUtxoValue ?? 0;
  const feeChangeValue = parsed.outputs[4].value;
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
}

/**
 * Validate a fully-signed sat-for-sat accept PSBT against the original offer.
 * The unsigned transaction bytes must be byte-identical (the atomicity/tamper
 * gate), and all five inputs must now carry a SIGHASH_ALL-equivalent signature.
 */
export function validateSatForSatAcceptPsbt(
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

  if (parsed.inputs.length !== CANONICAL_INPUT_COUNT) {
    throw new PsbtValidationError(
      `Sat-for-sat accept must have exactly ${CANONICAL_INPUT_COUNT} inputs`,
    );
  }

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

function assertAllOutputsAboveDust(
  outputs: Array<{ value: number; scriptPubkeyHex: string }>,
): void {
  for (const output of outputs) {
    if (classifyScript(output.scriptPubkeyHex) === "op_return") {
      continue;
    }
    const threshold = dustThresholdForScript(output.scriptPubkeyHex);
    if (output.value < threshold) {
      throw new PsbtValidationError(
        `Sat-for-sat output value ${output.value} below dust threshold ${threshold}`,
      );
    }
  }
}
