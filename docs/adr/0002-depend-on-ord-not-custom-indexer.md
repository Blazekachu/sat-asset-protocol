# ADR-0002: Depend on ord, Not a Custom Sat Indexer

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Ord Architecture.md](../Ord%20Architecture.md), [Storage Analysis.md](../Storage%20Analysis.md), [Indexer Landscape.md](../Indexer%20Landscape.md)

---

## Context

Sat location (which UTXO holds a sat, at what offset) requires walking the chain with FIFO rules and persisting sat ranges per UTXO. We could:

1. Run `ord` with `--index-sats` and query it.
2. Build a custom sat indexer (reimplement `OUTPOINT_TO_UTXO_ENTRY` logic).
3. Rely on third-party marketplace indexers (Magic Eden, UniSat).

The BRC-20 ecosystem lesson ([UniSat 2024 update](https://unisat-wallet.medium.com/2024-01-unisat-development-progress-update-73cc543ee170), [OPI](https://github.com/brc20-devs/brc20-swap-indexer)) is that **meta-protocols should extend a reference base indexer**, not replace it.

## Decision

**Sat Asset Protocol delegates sat location and range queries to `ord` (or a byte-compatible fork).** The protocol layer stores only commerce state (listings, offers, attestations). It does **not** maintain a parallel sat index.

Use `crates/ordinals` for math-only fields; use `ord` HTTP/CLI for location queries.

## Rationale

- Reimplementing FIFO indexing duplicates `src/index/updater.rs` (~thousands of lines) with high bug risk.
- `ord` with `--index-sats` already stores 11-byte ranges in redb ([Ord Architecture.md](../Ord%20Architecture.md)).
- Custom indexer would still require Bitcoin Core + txindex — no disk savings.
- Third-party indexers are proprietary and may disagree on satpoints ([ord#2815](https://github.com/ordinals/ord/issues/2815)).

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Custom sat indexer | Duplicates ord; violates guiding principle #2 |
| Marketplace indexer as SoT | Not independently verifiable; vendor lock-in |
| Light client (headers only) | Cannot verify sat location without full chain walk |
| OPI-style ord fork + module | Valid for future scale; v1 adds complexity without need |

## Consequences

### Positive
- Smallest correct architecture; research boundary validated.
- Operators can use existing ord deployment patterns (ordstuff snapshots, testnet4 stack).

### Negative
- Runtime dependency on ord availability and `--index-sats` flag.
- ~150–230 GB ord index for mainnet sat indexing (without `--index-transactions`).

### Neutral
- Protocol DB stays small (listings only).

## Compliance

- `/v1/verify/sat/*` must query configured ord node(s), not local sat tables.
- Deployment docs must specify `ord --index-sats` minimum.
- No `sat_ranges` table in protocol schema.

## References

- [Protocol Boundary.md](../Protocol%20Boundary.md) §2.2
- https://github.com/brc20-devs/brc20-swap-indexer (OPI modular pattern)
