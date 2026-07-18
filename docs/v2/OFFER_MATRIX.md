# v3 Complete Offer Matrix

**Canonical source.** This document is the authoritative list of the trade
shapes the marketplace supports and the offline/live tests that cover them. It
MUST NOT drift from the plan's "Complete test matrix" section, and the guard in
`tests/offer-matrix-coverage.test.ts` fails the suite if any in-scope cell has
no tagged test under `tests/`.

Related decision records: ADR-0005/0006/0007 (sat-for-BTC listings + canonical
two-bump fill + offset-0), ADR-0014 (sat-for-sat SIGHASH_ALL), ADR-0015 (dust +
canonical postage), ADR-0016 (open intent + point-to-point settlement),
ADR-0017 (counter-offers / negotiation thread), ADR-0018 (bundle + range
barter), ADR-0019 (partially-fillable BTC buy bids).

---

## Two denominations: sat-for-BTC vs sat-for-sat (the mental model this matrix serves)

Ordinal theory makes every sat **non-fungible** — identifiable by an absolute
ordinal number and a Rodarmor name, with provenance (mining block, rarity,
epoch). But BTC-as-money is **fungible** — one sat of payment is interchangeable
with any other. The marketplace must serve both mindsets, and the two are
*different trade denominations backed by different signing regimes*:

- **sat-for-BTC** — one side cares about a **specific identifiable asset** (a
  sat/range/inscription); the other side is paying **fungible money** and does
  not care *which* payment sats it spends. This is a **price** trade. It is
  expressed with `SIGHASH_SINGLE | ANYONECANPAY`: the asset owner signs an input
  committing only to *its* input and a single payment **output amount** (output
  0 = price), leaving the rest of the transaction open. Anyone can then complete
  it by adding their own funding inputs/outputs without invalidating the owner's
  signature — an **anyone-can-fill listing** (ADR-0005/0006). Because the
  counter-consideration is a fungible amount, this is the only regime that
  supports open, anyone-can-fill order flow and (Workstream D) partial fills.
- **sat-for-sat** — **both** sides care about **specific identifiable assets**:
  "I give THIS sat, and I want THAT sat." There is no fungible-amount output to
  leave open; the trade only makes sense when *both* parties' exact UTXOs are
  fixed at signing. This requires `SIGHASH_ALL` (every signature commits to the
  **whole** transaction — all inputs and outputs), which makes it inherently
  **point-to-point**: the two concrete parties must both sign the same finalized
  tx (ADR-0014). It **cannot** be an anyone-can-fill orderbook, because a third
  party adding an input would invalidate every existing signature.
  `SIGHASH_SINGLE` cannot express sat-for-sat at all — it commits to an amount,
  not to "I accept THAT specific sat."

Both denominations serve **buyers and sellers**: an ordinal-theory believer may
want to *sell* a specific sat/range for BTC, *buy* a specific sat/range with BTC
(Workstream D), *barter* a specific sat/range for another specific/predicate-matched
sat/range (sat-for-sat intents, Workstreams A/B), or post either as a
**discoverable advertisement** so a counterparty finds them. The "intent" (open,
unsigned advertisement) + point-to-point settlement model in Workstream A is
precisely what lets a specific-sat *want* be posted publicly even though its
settlement can never be anyone-can-fill.

---

## Complete test matrix

**Legend:** **Offline** = deterministic `tests/*.test.ts` exercising the real
exports. **Live** = testnet4 + ord readback (see `LIVE_VALIDATION_v3.md`).
Consideration columns: BTC (sat-for-BTC listing/fill, ADR-0005/0006/0007),
Specific sat(s) (sat-for-sat, ADR-0014), Predicate-matched sat(s) (ADR-0008
predicate — RD1, in scope only if kept).

Cells whose **Offline test** column names a file are covered by the offline
coverage guard. Cells marked live-only (no offline test file — e.g. **B8**) are
documented here for completeness but are **not** required by the offline guard.
**Bundle-for-BTC (cell B2) is OUT OF SCOPE per RD8** — the bundle builder is
sat-for-sat/range only and the BTC fill path supports a single seller asset
input; B2 is therefore absent from the tables and from the coverage test.

### Single-asset offers

| Cell | Offered | Consideration | Offline test | Live? | Assertion |
|------|---------|---------------|--------------|-------|-----------|
| M1 | single sat | specific sat | `sat-for-sat.test.ts` | yes | mirrored 2-bump builds; both sats offset-0; validator passes; on-chain readback intact |
| M2 | single sat | BTC | `listings-api.test.ts`, `psbt-dust.test.ts` | optional | listing + buyer fill builds/validates |
| M3 | single sat | predicate-matched sat | `sat-for-sat.test.ts` (+intent) | yes | intent accepts any sat satisfying P; settlement binds the matched sat; offset-0 (RD1) |
| M4 | single range | specific sat | `range-listings.test.ts`, `sat-for-sat.test.ts` | yes | range (contiguous ≥dust) ↔ specific sat; both offset-0; value kept |
| M5 | single range | BTC | `range-listings.test.ts`, `listings-api.test.ts` | optional | range listing + BTC fill builds/validates |
| M6 | single range | predicate-matched sat | `range-listings.test.ts` (+intent) | yes | range ↔ predicate-matched sat; offset-0 (RD1) |
| M7 | single sat | specific range | `sat-for-sat.test.ts` | yes | size-mismatch builds; each side keeps value; sub-dust rejected |
| M8 | single range | specific range | `range-listings.test.ts` | yes | range ⇄ range; both contiguous offset-0; value conserved |

### Bundle offers (N-asset-per-side) — RD4

| Cell | Offered | Consideration | Offline test | Live? | Assertion |
|------|---------|---------------|--------------|-------|-----------|
| B1 | bundle of sats | specific bundle of sats | `bundle-barter.test.ts` | yes | M×N build; every sat offset-0; atomic; value conserved |
| B3 | bundle of sats | predicate-matched sats | `bundle-barter.test.ts` | yes | each accepted sat satisfies P; all offset-0 (RD1) |
| B4 | bundle of ranges | specific bundle of ranges | `bundle-barter.test.ts` | yes | mixed ranges each contiguous ≥dust offset-0; value conserved |
| B5 | mixed sat+range bundle | mixed bundle | `bundle-barter.test.ts` | yes | heterogeneous bundle builds; every asset offset-0 |
| B6 | asymmetric M≠N bundle | specific | `bundle-barter.test.ts` | no | 3-for-1 / 1-for-3 builds; bumps/outputs count correct |
| B7 | bundle with one sub-dust asset | any | `bundle-barter.test.ts` | no | whole bundle rejected |
| B8 | bundle vs wallet foreign-input limits | specific | E3 live | yes | records per-wallet max foreign-input tolerance (live-only; not in the offline guard) |

> **B2 (bundle-for-BTC) is OUT OF SCOPE per RD8.**

### Negotiation lifecycle

| Cell | Scenario | Offline test | Live? | Assertion |
|------|----------|--------------|-------|-----------|
| N1 | counter chain (supersede, counter_index) | `negotiation-thread.test.ts` | no | new object per round; parent `countered`; superseded-round accept rejected |
| N2 | per-round expiry | `negotiation-thread.test.ts`, `offers-api.test.ts` | no | `now>expires_at` → accept rejected |
| N3 | nonce/replay | `negotiation-thread.test.ts` | no | stale-round PSBT under new nonce rejected |
| N4 | cancellation | `offers-api.test.ts` | no | cancelled round cannot be accepted |
| N5 | invalidation race (pre-spent input) | `negotiation-thread.test.ts` | partial | offer non-acceptable; race surfaced not prevented |

### Partially-fillable BTC buy bids (WS-D) — RD7

Consideration is fungible BTC (payment amount), so unlike sat-for-sat these
support partial + multi-party fills. Each fill is co-signed per-fill (not
pre-signed anyone-can-fill).

| Cell | Scenario | Offline test | Live? | Assertion |
|------|----------|--------------|-------|-----------|
| BD1 | post bid (target N + total T) | `negotiation-model.test.ts`, `negotiation-api.test.ts` | no | `unit_price=floor(T/N)`; `remaining=N`; status `open` |
| BD2 | single partial fill (k < N) | `negotiation-model.test.ts` | no | fill pays `k×unit_price`; remainder `N−k`; bid stays `open` |
| BD3 | fills accumulate to N | `negotiation-model.test.ts` | no | last fill flips `filled`; remainder 0 |
| BD4 | over-fill rejection | `negotiation-model.test.ts` | no | `k > remaining` rejected before build; remainder unchanged |
| BD5 | concurrent over-commit (CAS) | `listing-store-offers.test.ts` | no | two fills, same nonce → second CAS fails; remainder debited once |
| BD6 | predicate/range mismatch fill | `negotiation-model.test.ts` | no | seller sats failing `want_spec` rejected |
| BD7 | holder discovery (advisory, live-ord) | `negotiation-model.test.ts` (stub) | partial | resolves `satpoint`/`address`; skips null; errors when `sat_index`/`address_index` off |
| BD8 | partial subrange fill + overlap/duplicate rejection | `negotiation-model.test.ts`, `listing-store-offers.test.ts` | no | seller UTXO fully contained in a wanted range fills its own `k`; a second fill overlapping/duplicating a ledger range rejected inside the txn (ledger unchanged) |
| BD9 | reserved→settled + release recovery | `listing-store-offers.test.ts` | no | `recordBidFill` transitions `pending_build→reserved`; `settleBidFill` flips `reserved→settled`; `releaseBidFill` sets ledger `reserved→released` + child settlement row `cancelled`, credits remainder back, reopens a `filled` bid |

### Dust boundary + value conservation

| Cell | Scenario | Offline test | Live? | Assertion |
|------|----------|--------------|-------|-----------|
| D1 | 1-sat → 330/546 postage + bump | `psbt-dust.test.ts`, `sat-for-sat.test.ts` | yes | pads to canonical postage; builds; offset-0 preserved |
| D2 | sub-dust rejection (329, 200-range) | `psbt-dust.test.ts`, `dust.test.ts` | no | rejected before build |
| D3 | dust boundary exactness | `dust.test.ts` | no | `value==threshold` passes; `-1` throws (P2TR 330, P2WPKH 294, P2PKH 546, P2SH 540) |
| D4 | range < dust vs ≥ dust | `range-listings.test.ts` | yes | <330 rejected; ≥330 builds |
| V1 | value conservation (fee ≥ 0) | `sat-for-sat.test.ts` | yes | zero + positive implied fee builds |
| V2 | negative-fee guard | `sat-for-sat.test.ts` | no | fee-payer change > funding rejected |

The BTC column (M2/M5) ties the single-asset v1 sat-for-BTC listing path into
the v3 matrix, covering the full `{BTC, specific-sat, predicate-sat}`
consideration axis for single assets. Buyer-initiated, partially-fillable BTC
bids are covered by the BD cells (WS-D, RD7). Bundle-for-BTC (B2) remains out of
scope (RD8).

---

## Offline coverage guard

`tests/offer-matrix-coverage.test.ts` greps every `tests/*.test.ts` for cell-ID
tags of the form `[M1]`, `[BD2]`, etc., and fails if any **offline-tested**
in-scope cell has zero tagged tests anywhere under `tests/`. The required set is:

- Single-asset: **M1–M8**
- Bundle: **B1, B3–B8** *(B2 excluded — RD8; B8 is documented but live-only, so
  it is excluded from the offline guard's required set)*
- Negotiation: **N1–N5**
- Bids: **BD1–BD9**
- Dust / value: **D1–D4, V1–V2**

A cell may be satisfied by a tag in any test file, and a single cell may be split
across two files — it is one-test-per-cell-**minimum**, not one-cell-per-file.
