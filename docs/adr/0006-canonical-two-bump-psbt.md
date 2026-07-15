# ADR-0006: Canonical 2-Bump PSBT Template

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [PSBT Settlement.md](../PSBT%20Settlement.md), [Risks.md](../Risks.md) R1

---

## Context

Marketplaces use inconsistent buyer-side PSBT constructions: 0, 1, 2, or 3 "bump" UTXOs to preserve inscription/sat offset ([ord#2706](https://github.com/ordinals/ord/issues/2706)). Incompatible templates prevent cross-marketplace listing portability.

## Decision

**Adopt the 2-bump canonical fill template** documented in [PSBT Settlement.md](../PSBT%20Settlement.md) §3 Phase B as the protocol standard. `/v1/psbt/validate` and `/v1/psbt/template` enforce this shape.

Bump size default: **600 sats** each (configurable per fee environment).

## Rationale

- 2-bump is the most documented industry pattern in ord#2706.
- 0-bump leaves asset at non-zero offset → post-trade split required.
- Standardization enables listing PSBTs to be filled by any protocol-compliant buyer.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| 0-bump | Poor sat preservation; extra split tx |
| 3-bump | Used by some venues; higher cost; no clear advantage |
| Marketplace-specific profiles | Defeats interoperability goal |

## Consequences

### Positive
- Cross-marketplace PSBT compatibility target.
- Validation rules are machine-checkable.

### Negative
- Marketplaces must adapt or provide translation layer.
- First-time buyers need bump UTXOs (wallet prep tx).

## Compliance

- PSBT validator rejects non-canonical output ordering.
- Test vectors in `tests/psbt/` (when implemented).

## References

- [PSBT Settlement.md](../PSBT%20Settlement.md)
- https://mempool.space/tx/556156e855f1603342c2236c5168b4b3752a102089792d11a7feee69438668d9
