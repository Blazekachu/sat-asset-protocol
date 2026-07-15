# ADR-0014: Sat-for-Sat via Offer/Accept (SIGHASH_ALL)

**Status:** Proposed  
**Date:** 2026-07-13  
**Deciders:** Phase 4 v2 spike (research/design only — not yet implemented)  
**Research:** [PSBT Settlement.md](../PSBT%20Settlement.md) §4, §7 · [../ORD_REVERSE_ENGINEERING/05_sat_asset_notes/02_commerce_vs_ord_offers.md](../../ORD_REVERSE_ENGINEERING/05_sat_asset_notes/02_commerce_vs_ord_offers.md) · [Open Questions.md](../Open%20Questions.md) Q11 · [SAT_FOR_SAT_SPIKE.md](../v2/SAT_FOR_SAT_SPIKE.md)

> **Numbering note:** The task brief requested "ADR-0013". That number is already taken by
> [ADR-0013 (Attestation signature scheme)](./0013-attestation-signature-scheme-ed25519.md),
> Accepted 2026-07-13. Per the sequential ADR convention in [README.md](./README.md), this
> decision is filed as **ADR-0014**.

---

## Context

[ADR-0010](./0010-sat-for-sat-deferred-v2.md) deferred sat-for-sat atomic barter to v2 and
stated that "v2 exploration starts with offer/accept PSBT prototype on testnet4."
[ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) scoped v1 to sat-for-BTC only.

The reason sat-for-sat cannot reuse the v1 **listing** model is byte-level, not incidental:

- v1 listings use `SIGHASH_SINGLE | ANYONECANPAY` (`0x83` / 131, see
  [Wallet Sighash Matrix.md](../Wallet%20Sighash%20Matrix.md)). This lets *anyone* fill a listing
  because the seller's signature commits only to **one output (a payment amount)** and its own input.
- A payment *amount* is fungible. A **specific sat identity** is not. `SIGHASH_SINGLE` has no way to
  commit "I will accept sat Y in exchange for my sat X." ([ord#2706](https://github.com/ordinals/ord/issues/2706#issuecomment-1823502804)).

The design question for v2: **is there a standard-PSBT construction that lets two parties atomically
swap two specific sats, with no custody, no consensus change, and no wallet modification?**

Prior art:

- [PSBT Settlement.md §4](../PSBT%20Settlement.md) documents an "offer/accept (bid)" flow where both
  parties sign the full transaction with `SIGHASH_ALL`.
- ord's `NUMBER_TO_OFFER` table stores serialized offer PSBTs (`index.rs:863-876`) — prior art for a
  minimal offer store, but no sat-identity metadata and no standardized shape. ord#2706 (open) tracks
  a standardized offer PSBT design; the protocol may need to lead this spec rather than wait.

## Decision

**Propose an offer/accept PSBT construction using `SIGHASH_ALL` on all inputs from both parties as
the v2 sat-for-sat atomic barter mechanism.** Adoption is **gated on a successful testnet4 spike**
([SAT_FOR_SAT_SPIKE.md](../v2/SAT_FOR_SAT_SPIKE.md)) and this ADR moving `Proposed → Accepted`.

The mechanism relies on the defining property of `SIGHASH_ALL`: **each signature commits to the
entire transaction — every input and every output.** Neither party can redirect the other's sat after
signing; any edit invalidates all signatures. This binds sat identity that `SIGHASH_SINGLE` cannot.

### Proposed canonical construction — "mirrored 2-bump" swap

Party **A** offers sat **X** (at offset 0 of `A_asset`) for party **B**'s sat **Y** (at offset 0 of
`B_asset`). Sat identity is preserved through ordinal-theory FIFO by placing a bump input before each
asset input so each recipient's ordinals output lands its acquired sat at **offset 0**.

```
Inputs (order matters — defines the FIFO sat stream):
  [0] A_bump   (~600 sats)          A signs SIGHASH_ALL
  [1] A_asset  (postage p_A, X@0)   A signs SIGHASH_ALL
  [2] B_bump   (~600 sats)          B signs SIGHASH_ALL
  [3] B_asset  (postage p_B, Y@0)   B signs SIGHASH_ALL
  [4] fee_funding (F)               fee payer signs SIGHASH_ALL

Outputs (order matters — consumes the FIFO stream in sequence):
  [0] A_change_addr : 600           (consumes A_bump; clears the stream head)
  [1] B_ordinals_addr : p_A         (sat X lands at offset 0) → B receives X
  [2] B_change_addr : 600           (consumes B_bump)
  [3] A_ordinals_addr : p_B         (sat Y lands at offset 0) → A receives Y
  [4] fee_payer_change : F - fee    (funding change; fee = network fee)
```

FIFO walk: output[0] consumes `A_bump`'s 600 sats, so the stream head is exactly at sat X → output[1]
receives X at offset 0. output[2] consumes `B_bump`, so output[3] receives Y at offset 0. `SIGHASH_ALL`
from all four asset/bump signers plus the fee payer makes the whole arrangement atomic and tamper-proof.

### Offer/accept protocol flow

1. **Offer (A):** A learns B's `B_asset` and `B_bump` outpoints (negotiated, off-band), builds the full
   PSBT above, signs inputs `[0]`, `[1]` (and `[4]` if A pays fees) with `SIGHASH_ALL`, and sends the
   partially-signed PSBT to B.
2. **Accept (B):** B independently verifies the outputs route X→B@0 and Y→A@0 with correct addresses/amounts,
   signs inputs `[2]`, `[3]`, finalizes, and broadcasts.
3. **Atomicity:** because every signature commits to all outputs, neither side can alter destinations,
   amounts, or ordering without invalidating the transaction.

### Key structural implication

`SIGHASH_ALL` requires each signer to commit to inputs they do **not** own. Therefore a sat-for-sat
offer is inherently **point-to-point / negotiated** (both parties' outpoints known at build time) — it is
**not** an open, anyone-can-fill orderbook listing like a v1 sat-for-BTC listing. This is a fundamental
difference, not a limitation to engineer away, and v2 API/UX must model offers as targeted, expiring bids.

## Rationale

- **Standard PSBT, no consensus change.** Uses only `SIGHASH_ALL` (BIP-174) — the sighash every wallet
  already supports for ordinary spends ([Wallet Sighash Matrix.md](../Wallet%20Sighash%20Matrix.md) §5).
- **Atomic & non-custodial.** All-or-nothing settlement; the coordinating service never holds keys.
- **Sat preservation is template-enforced**, consistent with [ADR-0006](./0006-canonical-two-bump-psbt.md)'s
  bump philosophy, extended symmetrically to both sides.
- **Alignment with ord.** Mirrors ord's `NUMBER_TO_OFFER` offer concept and gives the protocol a concrete
  shape to contribute back to ord#2706.

## Alternatives Considered

| Alternative | Why not (for the proposed v2 mechanism) |
|-------------|------------------------------------------|
| Listing PSBT (`SIGHASH_SINGLE \| ANYONECANPAY`) | Technically invalid for sat identity — commits to an amount, not a sat ([ord#2706](https://github.com/ordinals/ord/issues/2706)). |
| Two sequential sat-for-BTC trades | Not atomic; counterparty/market risk between legs (ADR-0010). |
| HTLC / DLC | Poor generic-wallet support; larger UX and scripting surface. |
| Lightning atomic swap (e.g. off-L1) | Different layer; out of L1 settlement scope. |
| `SIGHASH_ANYPREVOUT` | Not in Bitcoin Core; speculative soft-fork dependency. |
| Custom covenant opcode | Consensus change — explicit non-goal. |

## Consequences

### Positive
- Enables atomic sat-for-sat on L1 with existing wallets and no protocol-breaking dependencies.
- Reuses established FIFO/bump reasoning already proven for v1 fills.
- Produces a concrete offer-PSBT shape the protocol can standardize and propose upstream.

### Negative
- **Point-to-point only** — no open orderbook for barter; requires an offer-negotiation round trip.
- **Wallet risk (primary unknown):** wallets must sign a multi-party PSBT that contains **foreign inputs**.
  Some wallets refuse, mis-display, or over-restrict such signing. This is the make-or-break item for the spike.
- Fee attribution must be negotiated (who funds input `[4]`).
- Invalidation race: either party can pre-spend an input to void an open offer (same class as v1).
- Requires **new v2 API surface** (offer create/accept/verify) distinct from v1 listings.

### Neutral
- Does not change v1 behavior; v1 remains sat-for-BTC only until this ADR is Accepted.

## Compliance

- **This ADR is `Proposed`. Per [ADR-0010](./0010-sat-for-sat-deferred-v2.md) and the Phase 4 brief,
  no sat-for-sat code, endpoints, price/asset fields, or docs claiming support may merge into the v1 API
  until this ADR is `Accepted`.** Acceptance requires a passing testnet4 spike (see below).
- When accepted, this ADR **extends** (does not supersede) ADR-0005 and closes the v2 path opened by ADR-0010.
- Acceptance gate = the spike's **GO** criteria in [SAT_FOR_SAT_SPIKE.md](../v2/SAT_FOR_SAT_SPIKE.md) §7 are met
  (notably: ≥2 mainstream wallets sign the mirrored construction, and both sats verify at offset 0 post-broadcast).

## References

- [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) · [ADR-0006](./0006-canonical-two-bump-psbt.md) · [ADR-0010](./0010-sat-for-sat-deferred-v2.md)
- [PSBT Settlement.md](../PSBT%20Settlement.md) §4, §7
- [Wallet Sighash Matrix.md](../Wallet%20Sighash%20Matrix.md)
- [ord#2706 — offer PSBT design](https://github.com/ordinals/ord/issues/2706)
- [SAT_FOR_SAT_SPIKE.md](../v2/SAT_FOR_SAT_SPIKE.md)
