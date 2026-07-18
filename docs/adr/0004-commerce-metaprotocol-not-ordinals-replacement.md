# ADR-0004: Commerce Metaprotocol, Not Ordinals Replacement

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Protocol Boundary.md](../Protocol%20Boundary.md), [Indexer Landscape.md](../Indexer%20Landscape.md)

---

## Context

Bitcoin meta-protocols often drift into reimplementing lower layers. BRC-20 initially created indexer fragmentation before converging on OPI's ord-fork model ([UniSat 2024 update](https://unisat-wallet.medium.com/2024-01-unisat-development-progress-update-73cc543ee170)). Sat Asset Protocol could become "another marketplace" or "another indexer."

## Decision

**Sat Asset Protocol is a commerce metaprotocol** standardizing listings, offers, settlement PSBTs, collections, and attestations. It sits **above** ord. It does not replace ord, inscriptions, runes, or BRC-20.

## Rationale

- Mission statement: "not to replace Ordinals."
- Ord already owns indexing, explorer, wallet sat-control.
- Marketplaces already have listing DBs — protocol standardizes schema, not UI.
- Layering matches successful pattern: Bitcoin → ord (data) → BRC-20 module (interpretation) → marketplace (commerce). We replace only the last mile for **sats**.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Full ord fork with marketplace built in | Scope creep; upstream maintenance |
| Replace Magic Eden / UniSat | Adoption impossible; not a product goal |
| On-chain protocol (OP_RETURN listings) | Bloat; existing PSBT model works |

## Consequences

### Positive
- Incremental adoption by existing marketplaces.
- Clear contributor scope.

### Negative
- Must coordinate with ord releases and marketplace PSBT habits.

## Compliance

- README states non-replacement explicitly.
- No inscription encoding or indexing code in protocol repo.

## References

- [Marketplace Analysis.md](../Marketplace%20Analysis.md)
