// Dust classification and per-script-type dust thresholds.
//
// Bitcoin Core computes a per-output dust threshold in `GetDustThreshold`
// (policy/policy.cpp) as roughly:
//
//   dustThreshold = (serializedTxoutBytes + spendVBytes) * dustRelayFeeRate
//
// where `spendVBytes` is the virtual size required to *spend* an output of
// that script type as a transaction input (including its share of the
// witness), and `serializedTxoutBytes` is the size of the txout itself
// (8-byte value + serialized scriptPubkey). Core's default
// `DUST_RELAY_TX_FEE` is 3000 sat/kvB, i.e. 3 sat/vB — that is the `3` folded
// into the default `minRelayFeeSatPerVb` here, NOT an extra ×3 multiplier.

export type ScriptType =
  | "p2pkh"
  | "p2sh"
  | "p2wpkh"
  | "p2wsh"
  | "p2tr"
  | "op_return"
  | "unknown";

export interface ScriptDustBytes {
  /** Virtual bytes to spend an output of this type as an input. */
  spendVBytes: number;
  /** Serialized txout size (8-byte value + length-prefixed scriptPubkey). */
  txoutBytes: number;
}

// Single source of truth for the per-type byte constants used by the Core
// GetDustThreshold derivation. Values match Bitcoin Core's policy constants:
//
//   P2PKH  : spend 148 vB (legacy input), txout 34 B  -> 182 vB -> 546 @3 sat/vB
//   P2SH   : spend 148 vB (legacy-sized), txout 32 B  -> 180 vB -> 540 @3 sat/vB
//   P2WPKH : spend  67 vB (segwit input), txout 31 B  ->  98 vB -> 294 @3 sat/vB
//   P2WSH  : spend  67 vB (segwit input), txout 43 B  -> 110 vB -> 330 @3 sat/vB
//   P2TR   : spend  67 vB (keyspend),     txout 43 B  -> 110 vB -> 330 @3 sat/vB
export const SCRIPT_DUST_BYTES: Record<
  Exclude<ScriptType, "op_return" | "unknown">,
  ScriptDustBytes
> = {
  // P2PKH: legacy input ~148 vB to spend; txout = 8 value + 1 len + 25 script.
  p2pkh: { spendVBytes: 148, txoutBytes: 34 },
  // P2SH: legacy-sized input ~148 vB to spend; txout = 8 value + 1 len + 23 script.
  p2sh: { spendVBytes: 148, txoutBytes: 32 },
  // P2WPKH: segwit input ~67 vB to spend; txout = 8 value + 1 len + 22 script.
  p2wpkh: { spendVBytes: 67, txoutBytes: 31 },
  // P2WSH: segwit input ~67 vB to spend; txout = 8 value + 1 len + 34 script.
  p2wsh: { spendVBytes: 67, txoutBytes: 43 },
  // P2TR: taproot keyspend input ~67 vB to spend; txout = 8 value + 1 len + 34 script.
  p2tr: { spendVBytes: 67, txoutBytes: 43 },
};

/**
 * Raised when an output value falls below the dust threshold for its script
 * type. Exported so callers/servers can map it to an HTTP 400 without
 * importing listing-service concerns.
 */
export class DustValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DustValidationError";
  }
}

function assertValidHex(scriptPubkeyHex: string): void {
  if (!/^[0-9a-fA-F]*$/.test(scriptPubkeyHex) || scriptPubkeyHex.length % 2 !== 0) {
    throw new Error(`Invalid script pubkey hex: ${scriptPubkeyHex}`);
  }
}

/**
 * Classify a RAW scriptPubkey hex string (no length prefix) by prefix/length.
 * Returns "unknown" for anything that does not match a standard form.
 */
export function classifyScript(scriptPubkeyHex: string): ScriptType {
  assertValidHex(scriptPubkeyHex);

  const hex = scriptPubkeyHex.toLowerCase();
  const byteLength = hex.length / 2;

  // OP_RETURN: starts with 0x6a.
  if (hex.startsWith("6a")) {
    return "op_return";
  }

  // P2PKH: 76a914 {20-byte hash} 88ac -> 25 bytes.
  if (byteLength === 25 && hex.startsWith("76a914") && hex.endsWith("88ac")) {
    return "p2pkh";
  }

  // P2SH: a914 {20-byte hash} 87 -> 23 bytes.
  if (byteLength === 23 && hex.startsWith("a914") && hex.endsWith("87")) {
    return "p2sh";
  }

  // P2WPKH: 0014 {20-byte program} -> 22 bytes.
  if (byteLength === 22 && hex.startsWith("0014")) {
    return "p2wpkh";
  }

  // P2WSH: 0020 {32-byte program} -> 34 bytes.
  if (byteLength === 34 && hex.startsWith("0020")) {
    return "p2wsh";
  }

  // P2TR: 5120 {32-byte program} -> 34 bytes.
  if (byteLength === 34 && hex.startsWith("5120")) {
    return "p2tr";
  }

  return "unknown";
}

/**
 * Dust threshold (in sats) for an output with the given raw scriptPubkey hex.
 *
 * OP_RETURN outputs are exempt (threshold 0). Unknown scripts throw. For
 * spendable types the threshold is:
 *
 *   Math.ceil((spendVBytes + txoutBytes) * minRelayFeeSatPerVb)
 *
 * At the default fee rate of 3 sat/vB this reproduces the canonical Core
 * thresholds: P2PKH 546, P2SH 540, P2WPKH 294, P2WSH 330, P2TR 330.
 */
export function dustThresholdForScript(
  scriptPubkeyHex: string,
  minRelayFeeSatPerVb = 3,
): number {
  const scriptType = classifyScript(scriptPubkeyHex);

  if (scriptType === "op_return") {
    return 0;
  }

  if (scriptType === "unknown") {
    throw new Error(
      `Cannot compute dust threshold for unknown script type: ${scriptPubkeyHex}`,
    );
  }

  const { spendVBytes, txoutBytes } = SCRIPT_DUST_BYTES[scriptType];
  return Math.ceil((spendVBytes + txoutBytes) * minRelayFeeSatPerVb);
}

/**
 * Assert that an output value is at or above the dust threshold for its script
 * type. OP_RETURN outputs are exempt. Throws {@link DustValidationError} when
 * the value is below the threshold.
 */
export function assertOutputAboveDust(
  scriptPubkeyHex: string,
  valueSats: number,
  minRelayFeeSatPerVb = 3,
): void {
  const scriptType = classifyScript(scriptPubkeyHex);

  if (scriptType === "op_return") {
    return;
  }

  const threshold = dustThresholdForScript(scriptPubkeyHex, minRelayFeeSatPerVb);
  if (valueSats < threshold) {
    throw new DustValidationError(
      `output value ${valueSats} below dust threshold ${threshold} for ${scriptType}`,
    );
  }
}
