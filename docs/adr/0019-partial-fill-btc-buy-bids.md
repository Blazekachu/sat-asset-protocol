# ADR-0019: Partially-Fillable BTC Buy Bids

**Status:** Accepted  
**Date:** 2026-07-17  
**Deciders:** v3 complete offer matrix (Workstream D/C, RD7 — user-requested)  
**Research:** [v3-complete-offer-matrix plan](../../.plans/v3-complete-offer-matrix.md) (Task 10b, WS-D, Decisions #2045/#2046) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0006](./0006-canonical-two-bump-psbt.md) · [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md)

---

## Context

The protocol supports selling a specific sat for BTC ([ADR-0005](./0005-v1-psbt-sat-for-btc-only.md))
and bartering specific sats/ranges for other sats ([ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md),
[ADR-0018](./0018-bundle-and-range-barter.md)). RD7 adds the mirror of a seller listing: a **buy
bid**. A buyer advertises "I will pay a total of **T** sats of BTC for **N** sats matching predicate
**P** (or a specific range **R**)", and **multiple independent sellers each fill part of it** — e.g.
a first filler holding 1,000 of the wanted sats fills 1,000 and leaves the rest open, and a seller
whose wanted sats are spread across ~100 UTXOs submits one fill per UTXO.

This raises the same denomination question ADR-0014 answered for barter, but from the opposite side:
what settlement regime supports **partial, multi-party** fills, and can such a bid be a pre-signed
anyone-can-fill orderbook?

## Decision

Adopt **partially-fillable BTC buy bids** with the following four properties.

### 1. Denomination — a fungible BTC consideration is what permits partial + multi-party fills

The consideration a bid pays is **fungible BTC**, not a specific sat. As set out in the
"Two denominations" model, only a fungible-amount consideration can be left partially open, so a bid
can be split across many independent fillers. This is precisely why it differs from the
`SIGHASH_ALL` **sat-for-sat** path ([ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md)),
where both sides commit specific sats and the whole transaction must be fixed and co-signed — that
path is inherently all-or-nothing and point-to-point and **cannot** be partially filled.

### 2. Decision #2045 — fills are CO-SIGNED per-fill point-to-point settlements

A bid is **NOT** a pre-signed anyone-can-fill orderbook. A buyer-receives-sats bid **cannot be
safely pre-signed** with standard wallet sighash flags: the buyer cannot pre-commit their BTC
payment to an as-yet-unknown filler's sat without an escrow or covenant (a non-goal). So **each fill
is a co-signed, per-fill atomic settlement** — the bidder signs every fill. Discovery (matchmaking)
sits in front of settlement and is orthogonal to it: it only suggests counterparties; the bidder
still co-signs each fill point-to-point.

**Signing roles.** Each fill reuses the canonical 2-bump fill template
([ADR-0006](./0006-canonical-two-bump-psbt.md)) with **one seller input**:

- The **FILLER** signs their single sat UTXO (input index **2**) with
  `SIGHASH_SINGLE | ANYONECANPAY` (**0x83**) — committing to their BTC payout at output 2 while
  leaving the rest of the transaction open. This is exactly the industry listing signature the repo
  already validates (sighash 0x03/0x83).
- The **BIDDER** funds and signs the bump/funding inputs (indices 0, 1, 3+) with `SIGHASH_ALL`
  (Taproot default equivalent) and **finalizes** the exact transaction.
- A seller whose wanted sats sit across many UTXOs submits **one fill per UTXO** (one seller input
  per fill), each debiting the running remainder.

### 3. Decision #2046 — pricing / remainder model (flooring favors the bidder)

The bid carries a target count **N** and total BTC **T**, giving `unit_price = floor(T / N)`. Each
fill of `k` sats pays exactly `k × unit_price` and debits `remaining_quantity` by the **logical**
`k` (1 for a single sat; the delivered sub-range size for a range — derived from the delivered
asset, not from `want_spec`). The debit runs under a compare-and-swap so concurrent fills cannot
over-commit the remainder; the bid stays `open` until `remaining_quantity == 0` (→ `filled`) or
expiry.

**The flooring rounding INTENTIONALLY FAVORS THE BIDDER.** Total spent
`Σ (kᵢ × unit_price) ≤ T`, leaving a residual of up to `N − 1` sats **unspent**. This residual is
deliberately left on the table: **every** fill — including the last — must pay exactly
`k × unit_price`. We do **not** over-pay on the last fill to "use up" T, because output 2's price
check in `validateCanonicalTwoBumpFillPsbt` requires the exact `k × unit_price`; an over-pay would
fail validation.

### 4. Discovery is advisory + live-ord-dependent; predicate-bid discovery is caller-seeded

`findCandidateHolders(bid)` resolves candidate sats to their current holding UTXO/address via ord's
`GET /sat/{number}` (`satpoint`/`address`). Both fields are populated **only** when the ord node runs
with `--index-sats` **and** `--index-addresses`, so discovery is **live-ord-dependent** (same
dependency class as `tests/ord-live.test.ts`) and **advisory** — it only suggests counterparties.
Crucially, **ord cannot enumerate "all sats matching predicate P"**: for a **predicate bid** the
caller supplies candidate sat numbers, which are then predicate-checked and resolved (caller-seeded,
**not** exhaustive). Only a **specific-range bid** can enumerate its own candidate sats.

**Reserved-budget risk (and its recovery path).** `submitBidFill` debits `remaining_quantity` at
ledger state `reserved` — after PSBT validation but **before** on-chain confirmation. A
signed-but-never-broadcast (or pre-spend-invalidated) fill therefore temporarily **locks bid
budget**. This is mitigated, not prevented, by (a) an explicit `releaseBidFill` recovery path that
transitions the ledger row `reserved → released`, **credits the logical `filled_quantity` back** to
the remainder (reopening a `filled` bid if needed), and marks the child settlement row
`status='cancelled'`; and (b) short bid expiries. The ledger row is kept, not deleted, so history
stays auditable and a released range no longer counts toward overlap or the remainder.

## Rationale

- **Fungibility enables partial + multi-party fills.** A specific-sat consideration (ADR-0014) has
  no divisible amount to split; a BTC total does, so many independent fillers can each take a slice.
- **Co-signing is the only safe regime here.** Without escrow/covenant, a buyer cannot bind payment
  to an unknown future filler's sat, so anyone-can-fill is unsafe — the bidder must co-sign each fill.
- **`SIGHASH_SINGLE|ANYONECANPAY` on the filler input** lets the seller commit only to their sat and
  their payout while the bidder supplies and commits the rest with `SIGHASH_ALL`, reusing the proven
  2-bump fill template ([ADR-0006](./0006-canonical-two-bump-psbt.md)).
- **Flooring toward the bidder keeps the price check exact.** A uniform `unit_price` on every fill
  (including the last) keeps output 2's validation simple and prevents an over-pay from breaking it.
- **Caller-seeded predicate discovery is honest about ord's limits** — ord indexes sats it is asked
  about, it does not scan the chain for predicate membership.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Pre-signed anyone-can-fill bid (orderbook the buyer signs once) | Unsafe: a buyer-receives-sats bid cannot pre-commit payment to an as-yet-unknown filler's sat with standard wallet sighash flags — it would require an escrow or covenant (a non-goal). Hence co-signed per-fill (Decision #2045). |
| Fixed BTC amount with no target count N | No basis for a per-sat unit price, so there is no well-defined partial-fill remainder — a partial fill could not be priced or debited. |
| Per-sat price + open-ended max quantity | The Decision #2046 alternative — an unbounded max lets the bidder's total commitment drift and complicates remainder accounting; a fixed `N + T → floor(T/N)` bounds the spend and yields a clean, bidder-favorable remainder. **Not chosen.** |

## Consequences

### Positive
- Buyers can post a single bid that many independent sellers fill incrementally, in BTC.
- Each fill is atomic and non-custodial; no third party can hijack a fill (the bidder co-signs).
- The remainder ledger (`bid_fills`) detects double-counting/overlap and supports partial ranges.

### Negative
- A bid **cannot be filled while the bidder is offline** — every fill needs the bidder's co-signature.
- Reserved-budget lock: a reserved-but-unbroadcast fill temporarily consumes budget until
  `releaseBidFill` or expiry recovers it.
- Discovery is only as good as the live ord node's indexes and the caller's candidate seed set.

### Neutral
- Extends, does not supersede, [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) (BTC-denominated
  settlement) and reuses [ADR-0006](./0006-canonical-two-bump-psbt.md)'s fill template; it is a
  distinct denomination from the ADR-0014 sat-for-sat path.
- Bundle-for-BTC (matrix cell B2) remains out of scope (plan RD8): the fill path takes a single
  seller asset input.

## Compliance

- `OfferService#postBid` / `buildBidFill` / `submitBidFill` / `settleBidFill` / `releaseBidFill` /
  `cancelBid` implement the bid lifecycle; `src/psbt.ts` `validateBidFillPsbt` checks structure plus
  **structurally valid** signatures (filler input 2 ∈ {0x03, 0x83}; every bidder input SIGHASH_ALL).
- `src/listing-store.ts` `recordBidFill` / `settleBidFill` / `releaseBidFill` run under
  `BEGIN IMMEDIATE` compare-and-swap with the `bid_fills` ledger
  (`pending_build → reserved → settled/released`), rejecting over-commit and overlapping/duplicate
  fills.
- Tests (`tests/negotiation-model.test.ts`, `tests/listing-store-offers.test.ts`,
  `tests/negotiation-api.test.ts`, cells BD1–BD9) cover unit-price derivation, partial `k<N` fills,
  the logical-quantity-vs-UTXO-value distinction, completion → `filled`, over-fill / overlap /
  predicate rejection, concurrent over-commit (CAS), reserved→settled + release recovery, and
  live-ord discovery (stubbed, skipping null-`satpoint`, erroring when indexes are off).

## References

- [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) · [ADR-0006](./0006-canonical-two-bump-psbt.md) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0016](./0016-open-intent-point-to-point-settlement.md)
- [v3-complete-offer-matrix plan — WS-D (Tasks D1–D3), Decisions #2045/#2046](../../.plans/v3-complete-offer-matrix.md)
- [OFFER_MATRIX.md — "Two denominations: sat-for-BTC vs sat-for-sat"](../v2/OFFER_MATRIX.md)
- [ord#2706 — offer PSBT design](https://github.com/ordinals/ord/issues/2706)
