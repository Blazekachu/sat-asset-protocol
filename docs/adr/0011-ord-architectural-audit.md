# ADR-0011: Ord Architectural Audit Before Custom Indexer

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [REVERSE_ENGINEERING.md](../../REVERSE_ENGINEERING.md), [ORD_REVERSE_ENGINEERING/](../../ORD_REVERSE_ENGINEERING/)

---

## Context

Prior design discussions proposed a rigorous **architectural audit** of `ord` before designing Sat Asset Protocol infrastructure — cataloging every redb table, tracing the indexing pipeline, and only then deciding what to keep, improve, or replace.

This coexists with ADR-0002 (delegate to ord for v1). The audit informs **understanding** and **future** decisions; it does not immediately authorize a custom sat indexer.

## Decision

**Maintain a living `ORD_REVERSE_ENGINEERING/` document set** pinned to a specific ord version (0.27.1), with all claims tagged ✅ Verified / 🟡 Inferred / 🔴 Design proposal per [REVERSE_ENGINEERING.md](../../REVERSE_ENGINEERING.md).

**Phase 1 (table inventory) is required** before any custom indexer ADR may supersede ADR-0002.

## Rationale

- Prevents guessing about ord schema (20 tables + 4 multimaps verified at `index.rs:58–81`).
- Confirms central insight: `OutPoint → SatRanges` is canonical; history is not stored.
- Ethical/engineering discipline: study implementation, don't accidentally conflate ord facts with our proposals.
- `NUMBER_TO_OFFER` discovered as ord's native PSBT store — relevant prior art for commerce layer.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Skip audit; trust high-level docs only | Missed `NUMBER_TO_OFFER`, wallet tables, schema version |
| Start custom indexer immediately | Violates ADR-0002; high reorg/FIFO risk |
| Rely on GitHub web UI only | Incomplete; chat correctly identified this limitation |

## Consequences

### Positive
- `vendor/ord` pinned checkout for reproducible citations
- Contributors understand **why** ADR-0002 exists

### Negative
- Ongoing maintenance when ord schema bumps (SCHEMA_VERSION 34 today)

### Neutral
- v1 still uses ord as read-only dependency

## Compliance

- `ORD_REVERSE_ENGINEERING/01_database/01_tables.md` kept current on ord version bumps
- New 🔴 proposals only in `05_sat_asset_notes/`
- Superseding ADR-0002 requires completed Phase 2 pipeline audit

## References

- [00_overview.md](../../ORD_REVERSE_ENGINEERING/00_overview.md)
- [01_tables.md](../../ORD_REVERSE_ENGINEERING/01_database/01_tables.md)
- [ORD_LICENSING_AND_ETHICS.md](../ORD_LICENSING_AND_ETHICS.md)
