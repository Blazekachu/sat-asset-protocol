# ADR-0009: Multi-Node ord Verification

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Verification Model.md](../Verification%20Model.md), [Risks.md](../Risks.md) R5

---

## Context

A single ord node could lie or drift (reorg, misconfiguration, wrong flags). BRC-20's indexer trust problem ([Spark research](https://www.spark.money/research/bitcoin-ordinals-brc20-evolution)) shows meta-protocols inherit indexer risk. Verification architecture must address Byzantine or faulty nodes.

## Decision

**Protocol verification queries ≥2 independent ord nodes** for sat location. Reject or flag on `satpoint` disagreement. Math-only checks (number, name, rarity) use `crates/ordinals` locally — no RPC needed.

Quorum: **2-of-2 must agree** for v1; 2-of-3 recommended for production.

## Rationale

- Independent ord nodes on same chain with same flags are deterministic ([Verification Model.md](../Verification%20Model.md)).
- Math checks are cheap and trustless.
- Multi-node catches misconfiguration (`--index-sats` off) and reorg stale state.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Single ord node | Single point of failure |
| Trust marketplace indexer | Not independently verifiable |
| Full chain re-walk per request | Too slow; duplicates ord |

## Consequences

### Positive
- Reproducible verification for independent implementations.
- Aligns with success criterion #5.

### Negative
- Operators must run or trust multiple ord endpoints.

## Compliance

- `/v1/verify/sat/{n}` implements cross-node check.
- Deployment docs list minimum ord version and flags.

## References

- [Verification Model.md](../Verification%20Model.md) §7
