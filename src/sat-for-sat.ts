// Sat-for-sat single-asset offer/accept PSBT builder + validators (ADR-0014).
//
// This module is now a THIN ADAPTER over the general m×n bundle builder in
// src/sat-for-sat-bundle.ts. The historical single-asset swap is exactly the
// m=n=1 specialization of a bundle: party A trades one sat X for party B's one
// sat Y in a mirrored 2-bump construction. Delegating keeps the byte layout
// identical to the bundle builder at m=n=1 (and therefore identical to the
// original hand-written single-asset builder) while eliminating duplicated PSBT
// construction logic. The exported types and return shapes are unchanged, so
// existing callers/tests need no edits.
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
  buildSatForSatBundlePsbt,
  validateSatForSatBundleAcceptPsbt,
  validateSatForSatBundleOfferPsbt,
  type SatForSatAssetLeg,
} from "./sat-for-sat-bundle.ts";
import {
  PsbtValidationError,
  type DustPolicy,
  type TemplateInput,
} from "./psbt.ts";

// Re-export the bundle types so callers wanting the general m×n API can import
// from either module.
export type {
  SatForSatAssetLeg,
  SatForSatBundleSide,
  SatForSatBundleLayout,
  BuildSatForSatBundleParams,
  BuildSatForSatBundleResult,
} from "./sat-for-sat-bundle.ts";

/**
 * One side of a sat-for-sat swap: a bump UTXO consumed ahead of the asset UTXO
 * (so the traded sat lands at offset 0 of the counterparty output), the asset
 * UTXO holding the sat at offset 0, this side's change scriptPubkey (receives
 * the bump passthrough), and the counterparty's ordinals scriptPubkey (receives
 * this side's asset). Note there is deliberately NO caller-supplied change
 * value: the builder computes it from `bumpInput.valueSats` to preserve the
 * FIFO offset-0 invariant.
 *
 * Structurally identical to a single bundle {@link SatForSatAssetLeg}; the
 * single-asset swap is the m=n=1 bundle specialization.
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

/** Map a single swap side to the equivalent one-element bundle side leg. */
function sideToLeg(side: SatForSatAssetSide): SatForSatAssetLeg {
  return {
    bumpInput: side.bumpInput,
    assetInput: side.assetInput,
    changeScriptPubkeyHex: side.changeScriptPubkeyHex,
    counterpartyOrdinalsScriptPubkeyHex: side.counterpartyOrdinalsScriptPubkeyHex,
  };
}

/**
 * Build the unsigned sat-for-sat offer PSBT. Delegates to the general bundle
 * builder with one leg per side (m=n=1), producing byte-identical output to the
 * historical single-asset builder. The `dustPolicy` is threaded through with
 * its `maxFeeRateSatPerVb` left as supplied by the caller (undefined by default,
 * per RD6, so existing PSBTs are never newly rejected by the fee-band cap).
 */
export function buildSatForSatOfferPsbt(
  params: BuildSatForSatOfferParams,
): BuildSatForSatOfferResult {
  const result = buildSatForSatBundlePsbt({
    offerer: { legs: [sideToLeg(params.partyA)] },
    taker: { legs: [sideToLeg(params.partyB)] },
    feeFundingInput: params.feeFundingInput,
    feePayerChangeScriptPubkeyHex: params.feePayerChangeScriptPubkeyHex,
    feePayerChangeValueSats: params.feePayerChangeValueSats,
    dustPolicy: params.dustPolicy,
  });

  return {
    psbtBase64: result.psbtBase64,
    inputOutpoints: result.inputOutpoints,
    outputValues: result.outputValues,
  };
}

/**
 * Validate a sat-for-sat offer PSBT (m=n=1 bundle). Delegates to the general
 * bundle validator with single-element expected-outpoint arrays and keeps the
 * legacy return shape `{ offererSignedInputs, buyerAssetOutputIndex: 1,
 * sellerAssetOutputIndex: 3 }`.
 */
export function validateSatForSatOfferPsbt(
  offerPsbtBase64: string,
  expected: ValidateSatForSatOfferExpected,
): ValidateSatForSatOfferSummary {
  const offererSignedInputs = normalizeOffererSignedInputs(expected.offererSignedInputs);
  const offererIsFeePayer = offererSignedInputs.length === 3;

  const summary = validateSatForSatBundleOfferPsbt(offerPsbtBase64, {
    offererAssetOutpoints: [expected.offererAssetOutpoint],
    takerAssetOutpoints: [expected.takerAssetOutpoint],
    offererIsFeePayer,
  });

  return {
    offererSignedInputs: summary.offererSignedInputs,
    buyerAssetOutputIndex: 1,
    sellerAssetOutputIndex: 3,
  };
}

/**
 * The offerer must ALWAYS commit to their bump + asset inputs (`0` and `1`).
 * The only allowed sets are exactly `[0,1]` (accepter is fee payer) or
 * `[0,1,4]` (offerer is fee payer) — the m=n=1 derived signed sets. Anything
 * else — an empty array, missing `0`/`1`, duplicates, out-of-range indices, or
 * arbitrary alternatives — is rejected so a caller cannot suppress the required
 * offerer commitments.
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
 * Validate a fully-signed sat-for-sat accept PSBT against the original offer.
 * Delegates to the general bundle accept validator: the unsigned transaction
 * bytes must be byte-identical (the atomicity/tamper gate), and all five inputs
 * must now carry a SIGHASH_ALL-equivalent signature.
 */
export function validateSatForSatAcceptPsbt(
  acceptPsbtBase64: string,
  offerPsbtBase64: string,
): { ready: true } {
  return validateSatForSatBundleAcceptPsbt(acceptPsbtBase64, offerPsbtBase64);
}
