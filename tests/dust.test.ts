import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOutputAboveDust,
  classifyScript,
  dustThresholdForScript,
  DustValidationError,
  SCRIPT_DUST_BYTES,
} from "../src/dust.ts";

// Sample raw scriptPubkey hex for each standard form.
const P2PKH = `76a914${"11".repeat(20)}88ac`;
const P2SH = `a914${"22".repeat(20)}87`;
const P2WPKH = `0014${"33".repeat(20)}`;
const P2WSH = `0020${"44".repeat(32)}`;
const P2TR = `5120${"55".repeat(32)}`;
const OP_RETURN = `6a${"deadbeef"}`;

test("classifyScript identifies each standard script type", () => {
  assert.equal(classifyScript(P2PKH), "p2pkh");
  assert.equal(classifyScript(P2SH), "p2sh");
  assert.equal(classifyScript(P2WPKH), "p2wpkh");
  assert.equal(classifyScript(P2WSH), "p2wsh");
  assert.equal(classifyScript(P2TR), "p2tr");
  assert.equal(classifyScript(OP_RETURN), "op_return");
});

test("each script type maps to its canonical dust threshold at default fee 3", () => {
  assert.equal(dustThresholdForScript(P2PKH), 546);
  assert.equal(dustThresholdForScript(P2SH), 540);
  assert.equal(dustThresholdForScript(P2WPKH), 294);
  assert.equal(dustThresholdForScript(P2WSH), 330);
  assert.equal(dustThresholdForScript(P2TR), 330);
});

test("SCRIPT_DUST_BYTES is the source of truth reproducing canonical thresholds", () => {
  assert.equal((SCRIPT_DUST_BYTES.p2pkh.spendVBytes + SCRIPT_DUST_BYTES.p2pkh.txoutBytes) * 3, 546);
  assert.equal((SCRIPT_DUST_BYTES.p2sh.spendVBytes + SCRIPT_DUST_BYTES.p2sh.txoutBytes) * 3, 540);
  assert.equal((SCRIPT_DUST_BYTES.p2wpkh.spendVBytes + SCRIPT_DUST_BYTES.p2wpkh.txoutBytes) * 3, 294);
  assert.equal((SCRIPT_DUST_BYTES.p2wsh.spendVBytes + SCRIPT_DUST_BYTES.p2wsh.txoutBytes) * 3, 330);
  assert.equal((SCRIPT_DUST_BYTES.p2tr.spendVBytes + SCRIPT_DUST_BYTES.p2tr.txoutBytes) * 3, 330);
});

test("OP_RETURN has zero threshold and assertOutputAboveDust never throws for it", () => {
  assert.equal(dustThresholdForScript(OP_RETURN), 0);
  assert.doesNotThrow(() => assertOutputAboveDust(OP_RETURN, 0));
  assert.doesNotThrow(() => assertOutputAboveDust(OP_RETURN, 1));
});

test("[D3] assertOutputAboveDust boundary: value == threshold passes, threshold-1 throws", () => {
  // P2TR 330, P2WPKH 294, P2PKH 546, P2SH 540 — value==threshold passes, -1 throws.
  const boundaries: Array<[string, number, string]> = [
    [P2TR, 330, "p2tr"],
    [P2WPKH, 294, "p2wpkh"],
    [P2PKH, 546, "p2pkh"],
    [P2SH, 540, "p2sh"],
  ];
  for (const [script, threshold, label] of boundaries) {
    assert.doesNotThrow(() => assertOutputAboveDust(script, threshold), `${label} == threshold`);
    assert.throws(
      () => assertOutputAboveDust(script, threshold - 1),
      (err: unknown) => {
        assert.ok(err instanceof DustValidationError);
        assert.match((err as Error).message, new RegExp(`below dust threshold ${threshold} for ${label}`));
        return true;
      },
      `${label} threshold-1`,
    );
  }

  assert.doesNotThrow(() => assertOutputAboveDust(P2TR, 330));

  assert.throws(
    () => assertOutputAboveDust(P2TR, 329),
    (err: unknown) => {
      assert.ok(err instanceof DustValidationError);
      assert.match(
        (err as Error).message,
        /output value 329 below dust threshold 330 for p2tr/,
      );
      return true;
    },
  );
});

test("custom fee rate scales thresholds (feeRate 6 doubles)", () => {
  assert.equal(dustThresholdForScript(P2PKH, 6), 1092);
  assert.equal(dustThresholdForScript(P2TR, 6), 660);
  assert.equal(dustThresholdForScript(P2WPKH, 6), 588);
});

test("non-standard/garbage script classifies as unknown and throws for threshold", () => {
  const garbage = "deadbeef";
  assert.equal(classifyScript(garbage), "unknown");
  assert.throws(() => dustThresholdForScript(garbage), /unknown script type/);
});

test("odd-length or invalid hex is rejected", () => {
  assert.throws(() => classifyScript("abc"), /Invalid script pubkey hex/);
  assert.throws(() => classifyScript("zz"), /Invalid script pubkey hex/);
});
