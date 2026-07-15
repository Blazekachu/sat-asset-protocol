# Indexer Future — ord audit notes

**Tag:** 🔴 Design proposal  
**Status:** Deferred past v1 (ADR-0002)

---

## Observation (✅ Verified)

ord's canonical state is:

```
OutPoint → SatRanges (current UTXO set only)
```

Spent entries are **deleted** from `OUTPOINT_TO_UTXO_ENTRY`. There is no native sat transfer history table.

---

## Implication

Applications needing **sat provenance timeline** (every transfer) cannot get it from ord alone — must:

1. Replay chain (expensive), or
2. Build event log indexer (new schema), or
3. Subscribe to blocks and append events (streaming indexer)

---

## Sat Asset Protocol v1

**Does not need transfer history** for listings. Needs only:

- Current `satpoint` (ord `find` / `list`)
- Listing validity (UTXO unspent)

---

## v2+ Option (if ADR-0002 superseded)

🔴 Proposed architecture:

```
ord (current state) ──► optional event log DB
                              │
                              ▼
                        sat transfer history
                        marketplace analytics
                        collection velocity metrics
```

Design principles if built:

- Still use `crates/ordinals` for math — never fork FIFO
- Event log append-only; current state derivable
- CC0-1.0 ord code may be studied; implement from understanding (see licensing doc)

---

## Comparison to BRC-20 / OPI

BRC-20 modules append **balance change events** on top of ord fork ([OPI](https://github.com/brc20-devs/brc20-swap-indexer)).

Sat history log would be analogous but for **sat movement events** — no token interpretation.

---

## Decision gate

Supersede ADR-0002 only if:

1. ord query latency unacceptable at scale
2. History API is core product requirement
3. Team can maintain indexer with reorg correctness

Until then: **query ord**.
