# ADR-0008: Collection Predicates and Attestations

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Minimal Schema.md](../Minimal%20Schema.md), [Verification Model.md](../Verification%20Model.md)

---

## Context

Sat groupings include Rodarmor rarity (in ord), Black Sats (Magic Eden/Magisat), mining pool claims, and institution certifications. These definitions **conflict across indexers** ([ord#2815](https://github.com/ordinals/ord/issues/2815)). The protocol could mandate one taxonomy or support extensibility.

## Decision

**Collections are predicate-based views over `sat_number`.**

- **Rodarmor predicates** (rarity, block range, epoch, name prefix): verifiable via `crates/ordinals`.
- **Non-consensus predicates** (Black Sats, pool origin, institutional claims): require **signed attestations** with issuer pubkey; protocol stores and verifies signatures but does not adjudicate truth.

## Rationale

- Matches BRC-20 lesson: base layer (ord) + interpretive layer (module/attestation) ([Indexer Landscape.md](../Indexer%20Landscape.md)).
- Avoids fork war over satribute definitions.
- Enables institution-certified and user-defined collections without consensus changes.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Mandate Rodarmor only | Excludes Black Sats market |
| Embed ME/Magisat taxonomies in protocol | Vendor lock-in; not independently verifiable |
| On-chain collection registry | Cost; unnecessary for v1 |

## Consequences

### Positive
- Extensible identity (number, name, range, rarity, future predicates).
- Clear trust model for non-math claims.

### Negative
- Users must evaluate attestation issuer trust.

## Compliance

- Collection membership API separates `verified: true` (math) vs `attested: true` (signature valid).
- Attestation schema in [Minimal Schema.md](../Minimal%20Schema.md).

## References

- [ord#2815](https://github.com/ordinals/ord/issues/2815)
- https://simplehash.com/blog/how-to-query-rare-sats
