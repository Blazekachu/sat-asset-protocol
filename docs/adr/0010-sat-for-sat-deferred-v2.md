# ADR-0010: Sat-for-Sat Deferred to v2

> **Update (2026-07-15):** the sat-for-sat deferral is now closed — implemented in v2 per [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) (Accepted). Superseded in part.

**Status:** Accepted (superseded in part by ADR-0014)  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [PSBT Settlement.md](../PSBT%20Settlement.md), [Open Questions.md](../Open%20Questions.md) Q11

---

## Context

Mission mentions sat-for-sat trading. PSBT analysis proves listing PSBTs cannot bind payment to a specific sat identity. Offer/accept with `SIGHASH_ALL`, HTLC, DLC, or Lightning swaps are alternatives — none standardized for wallets.

## Decision

**Defer sat-for-sat atomic settlement to v2.** v1 documentation and APIs must not imply sat-for-sat is supported. v2 exploration starts with offer/accept PSBT prototype on testnet4.

## Rationale

- Honest scoping prevents unsafe implementations.
- v1 delivers value: open listing schema + verification for sat-for-BTC.
- [ord#2706](https://github.com/ordinals/ord/issues/2706) remains open — protocol may need to lead v2 spec.

## Alternatives Considered

| Alternative | Why Rejected for now |
|-------------|----------------------|
| Sequential double sale | Not atomic |
| `SIGHASH_ANYPREVOUT` | Not in Bitcoin Core |
| Custom covenant opcode | Consensus change |

## Consequences

### Positive
- v1 ships faster with proven settlement.

### Negative
- Sat barter users wait for v2.

## Compliance

- v1 OpenAPI has no sat-for-sat price fields.
- v2 requires new ADR superseding ADR-0005 or extending it.

## References

- [Open Questions.md](../Open%20Questions.md)
- [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md)
