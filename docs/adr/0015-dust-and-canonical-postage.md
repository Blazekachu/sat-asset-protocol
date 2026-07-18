# ADR-0015: Per-script-type dust thresholds and canonical postage

**Status:** Accepted  
**Date:** 2026-07-15  
**Deciders:** Protocol maintainers  
**Research:** [PSBT Settlement.md §6.1](../PSBT%20Settlement.md), [Open Questions.md Q8/Q9](../Open%20Questions.md), [PROTOCOL_SPEC_v1.md OPEN-1](../PROTOCOL_SPEC_v1.md)

---

## Context

The v1 PSBT settlement flow produces outputs (asset postage, payment, bump
passthrough, change) whose values must clear the network's dust relay policy or
the transaction will be rejected. Two decisions were left open:

- **Dust threshold** — how to compute the minimum spendable value per output.
  Bitcoin Core's `GetDustThreshold` (policy/policy.cpp) derives it per script
  type from the vbytes needed to spend the output plus the serialized txout
  size, multiplied by the dust relay fee rate (default `DUST_RELAY_TX_FEE` =
  3000 sat/kvB = 3 sat/vB).
- **Canonical postage** — `PSBT Settlement.md §6.1` and `Open Questions.md` Q9
  left asset postage as "330 (inscription convention) vs 546 (dust) — TBD",
  and Q8 asked for the canonical bump UTXO size. `PROTOCOL_SPEC_v1.md` OPEN-1
  tracked the same gap.

## Decision

1. **Per-script-type dust** computed with the Bitcoin Core formula
   `Math.ceil((spendVBytes + txoutBytes) * minRelayFeeSatPerVb)`, where the
   min-relay fee rate is **configurable** (`SAT_ASSET_MIN_RELAY_FEE_SAT_PER_VB`)
   and defaults to **3 sat/vB (3000 sat/kvB)**. At the default rate this yields
   the canonical thresholds P2PKH 546, P2SH 540, P2WPKH 294, P2WSH 330,
   P2TR 330. OP_RETURN outputs are exempt (threshold 0); unknown script types
   are rejected.
2. **Canonical postage constants**, all configurable via env with these
   defaults: **bare-sat postage 546** (`SAT_ASSET_BARE_SAT_POSTAGE_SATS`),
   **inscribed postage 330** (`SAT_ASSET_INSCRIBED_POSTAGE_SATS`), and **bump
   size 600** (`SAT_ASSET_BUMP_SIZE_SATS`).

The single source of truth for the per-type byte constants is
`SCRIPT_DUST_BYTES` in `src/dust.ts`.

## Rationale

- Reusing Core's derivation means outputs the protocol builds are relayable by
  default nodes without a bespoke dust model. A configurable fee rate lets
  operators track mempool policy changes without a code change.
- Bare sats (non-inscription) need a P2PKH-safe floor, so 546 (the P2PKH dust
  threshold at 3 sat/vB) is the conservative canonical choice. Inscribed sats
  ride the established 330-sat inscription-postage convention.
- The 600-sat bump preserves ADR-0006's canonical 2-bump template exactly.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Single flat dust value (e.g. 546 for all outputs) | Over-charges segwit/taproot outputs (real threshold 294/330) and ignores relay policy per type. |
| Hardcoded, non-configurable fee rate | Cannot track future changes to `DUST_RELAY_TX_FEE` without a release. |
| 330 postage for bare sats | Below the P2PKH dust threshold (546); a bare sat in a P2PKH output could be non-relayable. |

## Consequences

### Positive
- Outputs are relayable under default node policy; per-type thresholds avoid
  over- or under-charging.
- Postage/bump are canonical and configurable; OPEN-1 / Q8 / Q9 resolved.

### Negative
- The per-type byte constants are approximations of typical spend sizes; exotic
  scripts classify as "unknown" and are rejected rather than estimated.

### Neutral
- Does **not** supersede ADR-0006: the 600-sat bump is preserved unchanged.

## Compliance

- `src/dust.ts` (`classifyScript`, `dustThresholdForScript`,
  `assertOutputAboveDust`, `SCRIPT_DUST_BYTES`) with unit tests in
  `tests/dust.test.ts` asserting the canonical thresholds (546/540/294/330/330),
  OP_RETURN exemption, boundary behavior, and fee-rate scaling.
- `src/config.ts` exposes the four constants with defaults, validated by
  `tests/config.test.ts`.

## References

- Bitcoin Core `GetDustThreshold` (policy/policy.cpp), `DUST_RELAY_TX_FEE`.
- [PSBT Settlement.md §6.1](../PSBT%20Settlement.md)
- [Open Questions.md Q8/Q9](../Open%20Questions.md)
- [PROTOCOL_SPEC_v1.md OPEN-1](../PROTOCOL_SPEC_v1.md)
- ADR-0006 (canonical 2-bump PSBT template — 600-sat bump preserved)
