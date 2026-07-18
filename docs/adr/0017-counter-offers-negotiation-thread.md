# ADR-0017: Counter-Offers as New Objects in a Negotiation Thread

**Status:** Accepted  
**Date:** 2026-07-17  
**Deciders:** v3 complete offer matrix (Workstream A/C)  
**Research:** [v3-complete-offer-matrix plan](../../.plans/v3-complete-offer-matrix.md) (Task 9) · [ADR-0016](./0016-open-intent-point-to-point-settlement.md) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)

---

## Context

The two-phase model in [ADR-0016](./0016-open-intent-point-to-point-settlement.md) produces a
concrete settlement round: a `SIGHASH_ALL` PSBT signed by the offerer and awaiting the taker.
Real barter rarely settles on the first round — a party wants to change which sats are exchanged,
adjust the fee-funding leg, or extend the expiry. We need a **counter-offer** mechanism.

Because settlement uses `SIGHASH_ALL` (every signature commits to the whole transaction —
[ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)), a counter is not a small edit: any
change to inputs or outputs invalidates every existing signature. The design question is **how to
represent a counter** so that:

- each round's signatures stay valid and independently verifiable,
- the full history (who proposed what, and when) is auditable,
- every round is re-validated end-to-end, not trusted because a prior round was valid, and
- a stale or superseded round can never be actioned by a replayed message.

## Decision

**A counter-offer is a NEW offer object appended to a negotiation thread — never an in-place
edit.** Each round is an independent row linked to the thread by `negotiation_id`, with
`parent_offer_id` (the round being countered), `supersedes` (same), and a monotonically
increasing `counter_index`. Each round carries its **own** `expires_at` and its **own** `nonce`.

- **Superseding is atomic.** Inserting the child round and marking the parent `countered` happen
  in one SQL transaction (`supersedeWithCounter`): `BEGIN IMMEDIATE` → INSERT child →
  compare-and-swap parent `status='countered' WHERE nonce=? AND status='open'` → `COMMIT`; any
  failure `ROLLBACK`s so the thread can never have a countered parent with no active child.
- **Every round is re-validated end-to-end.** The supplied PSBT is re-run through the full
  ADR-0014 validator (single or bundle), and every asset is re-checked for offset-0 / range span
  on every counter — no round inherits trust from its parent.
- **Per-round nonce gates every state change.** The nonce is returned to the party who must act
  next and is required (with the exact expected source status) on `submit`, `counter`, `accept`,
  `cancel`, and `settle`. A message replayed under a superseded round's nonce fails the
  compare-and-swap atomically.

**The invalidation race is acknowledged, not prevented.** Either party can pre-spend a UTXO
committed to an open round, silently voiding it. The protocol does not try to lock or escrow those
inputs (that would require custody or a consensus change — explicit non-goals). Instead a
pre-spent round surfaces as an **unbroadcastable offer** at build/validate/accept time (ord reports
the input spent or absent), and the risk is **mitigated by short per-round expiries** rather than
eliminated. This is the same invalidation class already documented in ADR-0014.

## Rationale

- **Append-only preserves signatures and audit trail.** Because a counter is a new object, each
  round keeps the exact `SIGHASH_ALL` signatures that were valid for *its* transaction; nothing is
  mutated out from under a signature, and the whole thread is a replayable history.
- **End-to-end re-validation is safe by construction.** Trusting a parent round's validity would
  let a subtly tampered counter through; re-running the full validator on each round closes that.
- **Consistent with ADR-0016.** A concrete round and a counter round are the same object shape;
  responding to an intent and countering a round both go through `supersedeWithCounter`, so neither
  can orphan a parent.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Edit the PSBT in place (mutate the existing round's transaction) | Any change to inputs/outputs breaks every existing `SIGHASH_ALL` signature ([ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)); the round would have to be re-signed from scratch anyway, and the prior signed state is lost. |
| Mutable single row + version counter | Loses the per-round signatures and the audit trail — you cannot prove what was signed at version *k* once version *k+1* overwrites it; also races on the version bump without per-round nonces. |
| Off-chain-only chat / free-text negotiation | No machine re-validation: the protocol cannot verify that an agreed counter corresponds to a valid, offset-0-preserving, `SIGHASH_ALL` settlement PSBT before it is broadcast. |

## Consequences

### Positive
- Full, auditable negotiation history; each round independently verifiable and settleable.
- Per-round nonce + status compare-and-swap prevents replay and stale-round actioning.
- Atomic supersede guarantees no orphaned `countered` parent.

### Negative
- More rows per negotiation than an in-place model (one per round) — acceptable for auditability.
- The invalidation race remains possible (pre-spend voids an open round); mitigated by short
  expiries and surfaced as unbroadcastable, not prevented.

### Neutral
- Extends, does not supersede, [ADR-0016](./0016-open-intent-point-to-point-settlement.md); the
  first concrete round in a thread is produced by `respondToIntent`, subsequent rounds by
  `counterOffer`, both through the same atomic path.

## Compliance

- `OfferService#counterOffer` / `respondToIntent` route through `store.supersedeWithCounter`
  (atomic INSERT child + CAS parent `open→countered`); transition-specific CAS methods
  (`updateOfferPsbt`, `updateOfferAccept`, `cancelOpenOffer`, `settleAcceptedOffer`, `expireOffer`)
  each guard on nonce + exact source status.
- Tests in `tests/negotiation-model.test.ts` / `tests/negotiation-thread.test.ts` assert the
  counter chain (`counter_index++`, parent `countered`, accepting a superseded round rejected),
  per-round expiry, nonce/replay rejection, atomic-supersede rollback, and the invalidation-race
  case (mock ord returns spent/absent → non-acceptable, surfaced not prevented).

## References

- [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0016](./0016-open-intent-point-to-point-settlement.md)
- [v3-complete-offer-matrix plan — Task 9, Task 12 (cells N1–N5)](../../.plans/v3-complete-offer-matrix.md)
