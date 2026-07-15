# Table Inventory — ord 0.27.1

**Status:** ✅ Verified from source  
**Declared in:** `vendor/ord/src/index.rs:58–81` (+ wallet tables in `wallet.rs:30–31`)  
**Schema version:** 34

---

## Summary

| Kind | Count | Location |
|------|-------|----------|
| `define_table!` | 20 | `src/index.rs` |
| `define_multimap_table!` | 4 | `src/index.rs` |
| Wallet-only tables | 2 | `src/wallet.rs` (separate wallet DB) |

**Database engine:** redb (not RocksDB).

---

## Index Tables (`index.redb`)

### Sat indexing (`--index-sats`)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `OUTPOINT_TO_UTXO_ENTRY` | table | `&OutPointValue` (36 B) | `&UtxoEntry` | `updater.rs` `index_transaction_sats`, block commit | `find()`, `list()`, `find_range()`, `/output`, `/sat` | **Canonical sat location** — compressed sat ranges per UTXO |
| `SAT_TO_SATPOINT` | table | `u64` (sat number) | `&SatPointValue` (44 B) | `updater.rs` (non-common sats only) | `rare_sat_satpoint()`, `/sat` fast path | Secondary index for rare sats |
| `STATISTIC_TO_COUNT` | table | `u64` | `u64` | `updater.rs`, schema init | `index info`, status | Counters: `IndexSats`, `SatRanges`, `LostSats`, etc. |

**Sat Asset reuse:** Query via ord API — do not duplicate (ADR-0002).

---

### Inscription indexing (default on; `--no-index-inscriptions` off)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `SAT_TO_SEQUENCE_NUMBER` | multimap | `u64` | `u32` | `inscription_updater.rs` | `get_inscription_ids_by_sat()`, `/r/sat/*` | Sat → inscription(s) |
| `SEQUENCE_NUMBER_TO_SATPOINT` | table | `u32` | `&SatPointValue` | `inscription_updater.rs`, spend path | `get_inscription_satpoint_by_id()` | Current inscription location |
| `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | table | `u32` | `InscriptionEntryValue` | `inscription_updater.rs` | `get_inscription_by_id()`, explorer | Metadata (no payload bytes) |
| `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` | table | `InscriptionIdValue` | `u32` | `inscription_updater.rs` | ID → entry lookups | Inscription ID index |
| `INSCRIPTION_NUMBER_TO_SEQUENCE_NUMBER` | table | `i32` | `u32` | `inscription_updater.rs` | Number → sequence | Negative = cursed |
| `HEIGHT_TO_LAST_SEQUENCE_NUMBER` | table | `u32` | `u32` | `inscription_updater.rs` | Pagination cursors | Per-block inscription ordering |
| `HOME_INSCRIPTIONS` | table | `u32` | `InscriptionIdValue` | `inscription_updater.rs` | `get_home_inscriptions()` | Featured inscriptions |
| `SEQUENCE_NUMBER_TO_CHILDREN` | multimap | `u32` | `u32` | `inscription_updater.rs` | Parent/child APIs | Provenance graph |
| `LATEST_CHILD_SEQUENCE_NUMBER_TO_COLLECTION_SEQUENCE_NUMBER` | multimap | `u32` | `u32` | `inscription_updater.rs` | Collection APIs | Collection membership |
| `COLLECTION_SEQUENCE_NUMBER_TO_LATEST_CHILD_SEQUENCE_NUMBER` | table | `u32` | `u32` | `inscription_updater.rs` | `get_collections_paginated()` | Collection head |
| `GALLERY_SEQUENCE_NUMBERS` | table | `u32` | `()` | `inscription_updater.rs` | `get_galleries_paginated()` | Gallery index |

**Sat Asset reuse:** Optional `inscription_ids` in schema only; no inscription tables in protocol DB.

---

### Address indexing (`--index-addresses`)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `SCRIPT_PUBKEY_TO_OUTPOINT` | multimap | `&[u8]` (script pubkey) | `OutPointValue` | `updater.rs` on UTXO create/spend | `/address`, `/outputs/{address}` | Address → UTXOs |

---

### Rune indexing (`--index-runes`)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `OUTPOINT_TO_RUNE_BALANCES` | table | `&OutPointValue` | `&[u8]` | `updater.rs` rune path | `get_rune_balances_for_output()` | Rune piles per UTXO |
| `RUNE_ID_TO_RUNE_ENTRY` | table | `RuneIdValue` | `RuneEntryValue` | `updater.rs` | `get_rune_by_id()` | Rune metadata |
| `RUNE_TO_RUNE_ID` | table | `u128` | `RuneIdValue` | `updater.rs` | `get_rune_by_number()` | Rune name → ID |
| `SEQUENCE_NUMBER_TO_RUNE_ID` | table | `u32` | `RuneIdValue` | `updater.rs` | Etching order | Rune reveal sequence |
| `TRANSACTION_ID_TO_RUNE` | table | `&TxidValue` | `u128` | `updater.rs` | `get_etching()` | Tx → etched rune |

**Sat Asset reuse:** Orthogonal — rune trading out of scope v1.

---

### Block / chain metadata

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `HEIGHT_TO_BLOCK_HEADER` | table | `u32` | `&HeaderValue` (80 B) | `updater.rs` | `get_block_by_height()`, reorg | Block headers cache |
| `WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP` | table | `u32` | `u128` | `updater.rs` | `index info` | Write txn timing / savepoints |

---

### Transaction cache (`--index-transactions`)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `TRANSACTION_ID_TO_TRANSACTION` | table | `&TxidValue` | `&[u8]` | `updater.rs` | `get_transaction()` | Full serialized tx cache |

**Sat Asset reuse:** Do not enable for marketplace nodes (ADR-0003; ~+176 GB).

---

### Wallet offers (in `index.redb`)

| Table | Type | Key | Value | Primary writer | Primary readers | Purpose |
|-------|------|-----|-------|----------------|-----------------|---------|
| `NUMBER_TO_OFFER` | table | `u64` | `&[u8]` (serialized PSBT) | `insert_offer()` `index.rs:863` | `get_offers()` `index.rs:850` | ord wallet offer storage |

**Note:** This is ord's **native offer PSBT** store — related to [ord#2706](https://github.com/ordinals/ord/issues/2706). Sat Asset Protocol defines its own listing schema (ADR-0005); may study this table as prior art.

---

## Wallet Database Tables (`wallet.rs` — separate from index)

| Table | Key | Value | Purpose |
|-------|-----|-------|---------|
| `RUNE_TO_ETCHING` | `u128` | `EtchingEntryValue` | Wallet rune etching state |
| `STATISTICS` | `u64` | `u64` | Wallet statistics |

✅ Verified: `wallet.rs:30–31`. Separate redb file from `index.redb`.

---

## Statistic Keys (`STATISTIC_TO_COUNT`)

✅ Verified: `index.rs:84–102`

| Enum | Value | Meaning |
|------|-------|---------|
| `Schema` | 0 | Schema version |
| `BlessedInscriptions` | 1 | … |
| `IndexSats` | 7 | `--index-sats` enabled |
| `IndexTransactions` | 8 | `--index-transactions` enabled |
| `LostSats` | 10 | Lost sat count |
| `SatRanges` | 14 | Total sat ranges stored |
| … | | See source for full list |

---

## Table Classification

| Category | Tables | Regenerable? | Required for sat marketplace |
|----------|--------|--------------|------------------------------|
| **Canonical** | `OUTPOINT_TO_UTXO_ENTRY` | Reindex from chain | Yes (via ord) |
| **Secondary index** | `SAT_TO_SATPOINT` | Reindex | Optional (perf for rare sats) |
| **Inscription** | `SAT_TO_SEQUENCE_NUMBER`, `SEQUENCE_NUMBER_*`, `INSCRIPTION_*` | Reindex | No (bare sats) |
| **Address** | `SCRIPT_PUBKEY_TO_OUTPOINT` | Reindex | Optional (owner display) |
| **Rune** | `OUTPOINT_TO_RUNE_*`, `RUNE_*` | Reindex | No |
| **Cache** | `TRANSACTION_ID_TO_TRANSACTION`, `HEIGHT_TO_BLOCK_HEADER` | Reindex | No |
| **Commerce (ord)** | `NUMBER_TO_OFFER` | N/A | Study only |

---

## Source Line References

```
vendor/ord/src/index.rs:58-81   — all index table definitions
vendor/ord/src/index.rs:56      — SCHEMA_VERSION = 34
vendor/ord/src/index/updater.rs:425-432 — block processing opens all tables
vendor/ord/src/index.rs:1829    — find() scans OUTPOINT_TO_UTXO_ENTRY
vendor/ord/src/index.rs:1913    — list() reads OUTPOINT_TO_UTXO_ENTRY
vendor/ord/src/wallet.rs:30-31  — wallet-only tables
```

---

## Sat Asset Protocol — Per-Table Reuse Matrix

| ord table | Sat Asset v1 | Notes |
|-----------|--------------|-------|
| `OUTPOINT_TO_UTXO_ENTRY` | **Query via ord** | ADR-0002 |
| `SAT_TO_SATPOINT` | **Query via ord** | Rare sat fast path |
| `NUMBER_TO_OFFER` | **Study, don't copy** | Different listing schema |
| All inscription tables | **Skip** | ADR-0003 |
| `TRANSACTION_ID_TO_TRANSACTION` | **Skip** | ADR-0003 |

🔴 Future (post-v1): If custom indexer built, start from this inventory — see [05_sat_asset_notes/](../05_sat_asset_notes/).
