# ADR-0018: Bundle (M×N) and Range Barter

**Status:** Accepted  
**Date:** 2026-07-17  
**Deciders:** v3 complete offer matrix (Workstream B/C, RD4)  
**Research:** [v3-complete-offer-matrix plan](../../.plans/v3-complete-offer-matrix.md) (Task 10, RD3/RD4) · [ADR-0006](./0006-canonical-two-bump-psbt.md) · [ADR-0007](./0007-utxo-listing-offset-zero-precondition.md) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)

---

## Context

[ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)'s mirrored 2-bump construction fixes
the sat-for-sat transaction at **5 inputs / 5 outputs**: one bump + one asset per side, plus a fee
leg. That handles exactly one sat traded for one sat. The "complete offer matrix" requires two
generalizations:

- **Bundles** — a party wants to trade *several* assets for *several* assets atomically ("my sats
  X₁, X₂ for your sats Y₁, Y₂, Y₃"), which the fixed 5-in/5-out template cannot express.
- **Ranges** — a contiguous span of sats held in a single UTXO must be tradeable as one asset,
  not decomposed into per-sat legs.

Each asset must still land at **offset 0** of its recipient's ordinals output
([ADR-0007](./0007-utxo-listing-offset-zero-precondition.md)), preserved by the FIFO bump
discipline of [ADR-0006](./0006-canonical-two-bump-psbt.md). The design question: **how do we
generalize the canonical template to M assets on one side and N on the other without losing
per-sat offset-0 identity, and without a new signing regime or consensus change?**

## Decision

**Generalize the fixed 5-in/5-out canonical PSBT to M×N asset legs — one bump UTXO per asset leg
on each side (so `#bumps === #assets`), per plan RD3 Option A.** The transaction interleaves, per
side, `[bump, asset]` pairs followed by a single fee-funding input:

```
Inputs:  [A_bump1, A_asset1, …, A_bumpM, A_assetM, B_bump1, B_asset1, …, B_bumpN, B_assetN, fee]
Outputs: per leg emit {change = bump.value} then {ordinals = asset.value}; final {fee_payer_change}
```

Total inputs/outputs = `2(M+N)+1`; bumps = `M+N`. Because each output value equals its paired input
value, `input index === output index` at every non-fee position, so each asset — sat **or** range —
lands at offset 0 of its counterparty's ordinals output, exactly as in ADR-0014. All inputs are
signed `SIGHASH_ALL`, so the whole bundle settles atomically or not at all.

**A range is treated as a single contiguous whole-UTXO asset.** The range's UTXO occupies one asset
leg; its ordinals output carries the full span value, so the whole range lands at offset 0. This
reuses the whole-UTXO / exact-span precondition of ADR-0007 — ranges and single sats validate
through the **identical** code path (ordinals output value == asset input value); sub-dust legs are
rejected in the builder.

**This reduces exactly to ADR-0014 at M=N=1**: 5 inputs / 5 outputs, asset outputs at indices 1 and
3 — zero breaking changes. The single-asset `src/sat-for-sat.ts` API becomes a thin adapter that
wraps each side as a one-leg bundle and delegates, producing byte-identical output at M=N=1.

## Rationale

- **Per-asset bumps preserve per-sat identity.** One bump before each asset input keeps the FIFO
  stream aligned so every individual asset (including each sat of a bundle) lands at offset 0
  ([ADR-0006](./0006-canonical-two-bump-psbt.md)/[ADR-0007](./0007-utxo-listing-offset-zero-precondition.md)).
- **Atomic by construction.** `SIGHASH_ALL` over all `2(M+N)+1` inputs makes a bundle all-or-nothing —
  the whole multi-asset swap commits together, the property ADR-0014 relies on.
- **Clean reduction, no breaking change.** Choosing one-bump-per-asset (RD3 Option A) means M=N=1 is
  literally today's template; the existing single-asset validators and tests port unchanged.
- **Ranges need no special settlement path.** A whole-UTXO range is just an asset leg whose value is
  the span, so bundle and range support share one builder and one validator.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Bundle = N separate single-asset offers | Non-atomic — each offer settles independently, so a party could receive some legs and not others; defeats the point of a bundle (same non-atomicity ADR-0010/0014 reject for sequential trades). |
| One fat UTXO per side (merge all assets into a single input/output) | Loses per-sat offset-0 identity — only the first sat of the merged output is at offset 0; the rest sit at non-zero offsets and cannot be individually custodied ([ADR-0007](./0007-utxo-listing-offset-zero-precondition.md)). |
| Merkle-committed or covenant-based bundle | Requires a Bitcoin consensus change (new opcodes / commitment rules) — an explicit non-goal across the protocol (ADR-0014). |
| One bump per *side* (not per asset) | Cheaper, but a different output layout that does **not** reduce cleanly to today's 5-in/5-out and needs bespoke change-consolidation (RD3 alternative, not chosen). |

## Consequences

### Positive
- Atomic M×N bundle barter and whole-range barter on L1 with standard `SIGHASH_ALL` PSBTs.
- Each asset retains offset-0 identity; ranges and sats validate through one path.
- M=N=1 is byte-identical to ADR-0014, so no existing behavior or test changes.

### Negative
- One bump UTXO per asset leg increases transaction size and bump-funding overhead for large
  bundles (the cost of preserving per-sat identity).
- Callers must supply `#bumps === #assets` build data per side up front.

### Neutral
- Extends, does not supersede, [ADR-0006](./0006-canonical-two-bump-psbt.md) (600-sat bump
  preserved) and [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) (M=N=1 specialization).
- Bundle-for-BTC (matrix cell B2) is out of scope (plan RD8); this ADR covers sat/range barter only.

## Compliance

- `src/sat-for-sat-bundle.ts` implements `buildSatForSatBundlePsbt`, `deriveBundleLayout`, and the
  general offer/accept validators; `src/sat-for-sat.ts` is reduced to an M=N=1 adapter.
- Tests in `tests/sat-for-sat-bundle.test.ts` assert `2(M+N)+1` interleaved layout, per-leg
  offset-0 (output value == input value), range legs validating identically to sats, sub-dust
  rejection, and byte-identical M=N=1 output vs the legacy builder; `tests/sat-for-sat.test.ts`
  passes unchanged as the adapter regression gate.

## References

- [ADR-0006](./0006-canonical-two-bump-psbt.md) · [ADR-0007](./0007-utxo-listing-offset-zero-precondition.md) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0015](./0015-dust-and-canonical-postage.md)
- [v3-complete-offer-matrix plan — WS-B Tasks 1–3, Task 10 (RD3/RD4)](../../.plans/v3-complete-offer-matrix.md)
- [ord#2706 — offer PSBT design](https://github.com/ordinals/ord/issues/2706)
