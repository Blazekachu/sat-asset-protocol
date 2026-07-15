# ADR-0007: UTXO Listing with Offset-0 Precondition

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Marketplace Analysis.md](../Marketplace%20Analysis.md), [Wallet Compatibility.md](../Wallet%20Compatibility.md)

---

## Context

Marketplaces trade **whole UTXOs**, not individual sats. A rare sat inside a mixed UTXO cannot be sold without pre-isolation. Only `ord` has sat-control ([collecting guide](https://docs.ordinals.com/guides/collecting.html)). Listing validation could be permissive (any UTXO) or strict (target sat at offset 0).

## Decision

**Listings must satisfy an offset-0 precondition:** the listed sat (or primary sat of a range) must be at **offset 0** in the seller's input UTXO sat ranges. Protocol rejects listings where `ord list(outpoint)` shows target sat at non-zero offset.

Sellers pre-isolate via `ord wallet send`, Sating Transfer Sats, or Satonomy before listing.

## Rationale

- Magisat/Sating require UTXO isolation before listing.
- Buyer PSBT template (ADR-0006) assumes asset at output offset 0.
- Without precondition, buyer may receive UTXO where target sat is not first — custody ambiguity.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| List any UTXO containing sat | Buyer cannot verify receipt without extra split |
| Protocol performs auto-split | Requires wallet keys; out of scope |
| Offset-agnostic listing | Breaks 2-bump template semantics |

## Consequences

### Positive
- Deterministic buyer custody post-settlement.
- Aligns with rare-sat marketplace practice.

### Negative
- Extra pre-listing tx for sellers (fee + UX friction).

## Compliance

- `POST /v1/listings` calls ord to verify offset-0.
- Documentation links pre-isolation tools.

## References

- https://docs.sating.io/how-to-use-sating/sat-marketplace/prepare-your-listing
- https://magisat.io/tutorials/basics
