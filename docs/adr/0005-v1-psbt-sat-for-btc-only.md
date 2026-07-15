# ADR-0005: v1 PSBT — Sat-for-BTC Only

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [PSBT Settlement.md](../PSBT%20Settlement.md), [Wallet Compatibility.md](../Wallet%20Compatibility.md)

---

## Context

Protocol goals mention sat-for-sat and sat-for-BTC. PSBT research shows `SIGHASH_SINGLE | ANYONECANPAY` listing PSBTs commit to a **payment amount**, not a specific sat ordinal ([ord#2706](https://github.com/ordinals/ord/issues/2706#issuecomment-1823502804)). Wallets support listing PSBTs today without modification.

## Decision

**v1 standardizes sat-for-BTC (and UTXO-for-BTC) settlement only**, using industry listing PSBTs. Sat-for-sat atomic barter is **out of scope for v1**.

## Rationale

- All major marketplaces (Magic Eden, UniSat, Ordinals Wallet) use sell/buy PSBT for BTC denomination.
- `signPsbt` with `sighashTypes: [0x03]` works in UniSat, Xverse, Leather today.
- Sat-for-sat requires offer/accept (`SIGHASH_ALL`) or off-chain swap — no standard exists.

## Alternatives Considered

| Alternative | Why Rejected for v1 |
|-------------|---------------------|
| Sat-for-sat via listing PSBT | Technically invalid |
| Delay entire protocol until sat-for-sat solved | Blocks useful sat-for-BTC standard |
| Two sequential BTC trades for barter | Not atomic; document as v2 pattern |

## Consequences

### Positive
- Ships with existing wallet and marketplace infra.
- Clear security model (proven PSBT pattern).

### Negative
- Marketing must not claim sat-for-sat in v1.

## Compliance

- v1 API: `POST /v1/listings` price field is BTC sats only.
- ADR-0010 tracks v2 sat-for-sat path.

## References

- https://ordinalswallet.com/learn/how-psbt-settlement-works
- [ord#2706](https://github.com/ordinals/ord/issues/2706)
