# Table Relationships — ord 0.27.1

**Status:** ✅ Verified structure · 🟡 Some edge paths inferred

---

## Dependency Graph (indexing pipeline)

```
Bitcoin Block (via bitcoind RPC)
        │
        ▼
HEIGHT_TO_BLOCK_HEADER
        │
        ▼
Per-tx processing (updater.rs)
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
OUTPOINT_TO_UTXO_ENTRY              INSCRIPTION_ID_TO_SEQUENCE_NUMBER
 (sat ranges, inscriptions               │
  embedded in UtxoEntry)                 ▼
        │                    SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY
        │                                │
        ├──────────────► SAT_TO_SATPOINT (rare sats only)
        │                                │
        ├──────────────► SAT_TO_SEQUENCE_NUMBER
        │                                │
        │                                ▼
        │                    SEQUENCE_NUMBER_TO_SATPOINT
        │
        ├──────────────► SCRIPT_PUBKEY_TO_OUTPOINT (--index-addresses)
        │
        └──────────────► OUTPOINT_TO_RUNE_BALANCES (--index-runes)
```

---

## Query Paths (read side)

### Find any sat location

```
sat u64 ──► find() ──► scan OUTPOINT_TO_UTXO_ENTRY (O(UTXOs))
              │
              └──► or SAT_TO_SATPOINT (O(1) if rare)
```

✅ `index.rs:1829`, `index.rs:941`

### List sat ranges in UTXO

```
outpoint ──► list() ──► OUTPOINT_TO_UTXO_ENTRY.get()
```

✅ `index.rs:1913`

### Inscriptions on sat

```
sat u64 ──► SAT_TO_SEQUENCE_NUMBER ──► sequence numbers
              └──► SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY
              └──► SEQUENCE_NUMBER_TO_SATPOINT
```

### Address holdings

```
address ──► SCRIPT_PUBKEY_TO_OUTPOINT ──► outpoints
              └──► OUTPOINT_TO_UTXO_ENTRY (sat ranges)
```

---

## Canonical vs Secondary

| Relationship | Canonical | Secondary |
|--------------|-----------|-----------|
| UTXO → sats | `OUTPOINT_TO_UTXO_ENTRY` | — |
| Sat → location (rare) | derivable from canonical | `SAT_TO_SATPOINT` |
| Inscription → location | `SEQUENCE_NUMBER_TO_SATPOINT` | also embedded in `UtxoEntry` |
| Sat → inscriptions | `SAT_TO_SEQUENCE_NUMBER` | — |
| Address → UTXOs | `SCRIPT_PUBKEY_TO_OUTPOINT` | — |

**Regeneration:** Secondary indexes are reproducible from canonical + chain replay.

---

## Spend / Reorg Invariants (🟡)

On input spend:
1. Read `OUTPOINT_TO_UTXO_ENTRY` for input outpoint
2. FIFO-assign sat ranges to outputs
3. Delete spent `OUTPOINT_TO_UTXO_ENTRY` key
4. Update `SAT_TO_SATPOINT` for moved rare sats
5. Update inscription locations in `SEQUENCE_NUMBER_TO_SATPOINT`

On reorg: `reorg.rs` rolls back via height / savepoints.

**Follow-up:** Trace exact reorg table rollback in Phase 2 pipeline doc.

---

## Sat Asset Protocol Relationship

```
ord tables (read-only)
        │
        ▼
Protocol verifies: outpoint + offset-0 + sat_number consistency
        │
        ▼
Protocol tables (listings, offers, attestations) — separate DB
```

🔴 **Design proposal:** No foreign keys between protocol DB and ord redb. Verification is runtime join via API.

---

## Insight: History vs Current State

ord stores **current UTXO → sat ranges** only. Spent UTXO entries are **deleted**.

🔴 Sat Asset Protocol v2+ idea: event log of sat transfers would be a **new** schema — not an ord table reuse.

See [05_sat_asset_notes/01_indexer_future.md](../05_sat_asset_notes/01_indexer_future.md).
