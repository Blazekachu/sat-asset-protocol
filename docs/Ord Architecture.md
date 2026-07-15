# Ord Architecture

**Status:** Research complete (2026-07-07)  
**Scope:** `ord` v0.27.1 as indexed on testnet4 and documented on mainnet  
**Database:** [redb](https://docs.ordinals.com/guides/reindexing.html) (`index.redb`) — **not** RocksDB

---

## 1. Executive Summary

`ord` is a Rust indexer, explorer, and wallet that walks Bitcoin's main chain via `bitcoind` (requires `txindex=1`) and persists derived state in a single redb file. Sat indexing is **opt-in** (`--index-sats`) and stores **contiguous sat ranges per UTXO**, not individual sat rows. Sat numbers, names, rarity, and degrees are **computed deterministically** from pure math in `crates/ordinals` — they are not stored as primary keys except for rare-sat fast-path lookups.

**Evidence:** [ord README](https://github.com/ordinals/ord/blob/master/README.md), [BIP draft](https://github.com/ordinals/ord/blob/master/bip.mediawiki), [reindexing guide](https://docs.ordinals.com/guides/reindexing.html)

---

## 2. System Context

```
Bitcoin Core (txindex=1)
        │
        ▼
ord indexer (updater.rs — per-block FIFO)
        │
        ├── redb: OUTPOINT_TO_UTXO_ENTRY (sat ranges)
        ├── redb: SAT_TO_SATPOINT (non-common sats only)
        ├── redb: SAT_TO_SEQUENCE_NUMBER (inscription links)
        └── HTTP/CLI API
```

---

## 3. How Ord Indexes Sats

### 3.1 Theoretical Model (Ordinal Theory / BIP)

Sats are serially numbered `0 … SUPPLY−1` in mining order. Transfer across transactions follows **FIFO**: input sats flow to outputs in input order, then output order.

**Rules (from `bip.mediawiki`):**

1. Non-coinbase transactions are processed **before** the coinbase in each block.
2. Coinbase receives block subsidy plus fees from non-coinbase txs.
3. Underpaid subsidies do **not** shift future numbering.
4. Duplicate txid spends displace older UTXOs (pre-BIP34 coinbases).

**Citation:** [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki)

### 3.2 Implementation

**Source:** `src/index/updater.rs`

Per block:

1. Seed coinbase subsidy range: `Height(h).starting_sat()` through `starting_sat + subsidy(h)`.
2. For each non-coinbase tx: read input sat ranges from `OUTPOINT_TO_UTXO_ENTRY`, run `index_transaction_sats()` (FIFO), write output ranges.
3. For coinbase tx: assign accumulated `coinbase_inputs` (subsidy + fees).
4. Leftover sats (unassigned fees) → **lost sats** at `OutPoint::null()`.

**FIFO core:** `Updater::index_transaction_sats()` walks outputs, consuming input sat ranges in order. For each output value, it splits ranges as needed and appends 11-byte encoded ranges to the output's `UtxoEntry`.

---

## 4. Sat Numbering Storage

**Sats are not stored individually.** The number is a `u64` computed from height/subsidy math.

| Constant | Value | Source |
|----------|-------|--------|
| `Sat::SUPPLY` | `2_099_999_997_690_000` | `crates/ordinals/src/sat.rs` |
| First sat of height h | `Height(h).starting_sat()` | `crates/ordinals/src/height.rs` |
| Subsidy at height h | `50 * COIN_VALUE >> (h / 210_000)` | `crates/ordinals/src/epoch.rs` |

**What is stored:** ordered lists of half-open ranges `[start, end)` per UTXO in `OUTPOINT_TO_UTXO_ENTRY`.

---

## 5. Sat Name Generation

**Function:** `Sat::name()` in `crates/ordinals/src/sat.rs`

**Algorithm (base-26 bijective):**

```
x = SUPPLY - sat_number
while x > 0:
  name.push('a' + ((x - 1) % 26))
  x = (x - 1) / 26
return name reversed
```

**Verified examples (local testnet4 ord 0.27.1, 2026-07-07):**

| Sat Number | Name | Rarity |
|------------|------|--------|
| 0 | `nvtdijuwxlp` | mythic |
| 2099994106992659 | `satoshi` | common |

**Parse:** `Sat::from_str()` routes to `from_name()` if any lowercase letter is present.

**Citation:** `Sat::name()`, `Sat::from_name()`, tests in `sat.rs`; live API `GET /sat/{notation}`

---

## 6. Rarity Computation

**Enum:** `Common | Uncommon | Rare | Epic | Legendary | Mythic` (`crates/ordinals/src/rarity.rs`)

**Algorithm:** Derived from **degree** components (`hour`, `minute`, `second`, `third`):

| Condition | Rarity |
|-----------|--------|
| `hour=0 ∧ minute=0 ∧ second=0 ∧ third=0` | Mythic |
| `minute=0 ∧ second=0 ∧ third=0` | Legendary |
| `minute=0 ∧ third=0` | Epic |
| `second=0 ∧ third=0` | Rare |
| `third=0` | Uncommon |
| else | Common |

**Degree mapping** (`degree.rs`):

- `hour` = cycle (height / 6,930,000)
- `minute` = epoch offset within cycle
- `second` = period offset within epoch
- `third` = position within block subsidy

**Index optimization:** Only **non-common** sats are inserted into `SAT_TO_SATPOINT` during indexing (`!Sat(range.0).common()`).

**Fixed tier supplies:** `Rarity::supply()` — Mythic=1, Legendary=5, Epic=27, Rare=3432, Uncommon=6,926,535.

---

## 7. Range Representation

### 7.1 Semantic Model

- Ranges are **half-open** `[start, end)` — `end` is exclusive.
- A UTXO holds an ordered list of ranges whose sizes sum to output value.
- CLI: `ord list <outpoint>` → `Vec<(u64, u64)>`.

### 7.2 Encoding

**Type:** `SatRange = (u64, u64)` in `src/index/entry.rs`

**11-byte packed encoding:**

```
51-bit base (start)
33-bit delta (end - start)
n = base | (delta << 51) → first 11 LE bytes
```

Functions: `SatRange::load([u8; 11])`, `SatRange::store()`.

### 7.3 Query Functions (`src/index.rs`)

| Function | Behavior |
|----------|----------|
| `list(outpoint)` | Sat ranges for one UTXO |
| `find(sat)` | Linear scan of all UTXO entries |
| `find_range(start, end)` | All satpoints overlapping a range |
| `rare_sat_satpoint(sat)` | O(1) lookup in `SAT_TO_SATPOINT` |

---

## 8. Sat Location Tracking Across UTXOs

### 8.1 Data Flow

```
Spend input UTXO → read sat_ranges from OUTPOINT_TO_UTXO_ENTRY
FIFO-assign to outputs → write new sat_ranges per output
Delete spent outpoint on commit
Update SAT_TO_SATPOINT for rare sats at new locations
```

### 8.2 Locating a Sat

| Method | Requires | Complexity |
|--------|----------|------------|
| `rare_sat_satpoint(sat)` | `--index-sats` | O(1) via `SAT_TO_SATPOINT` |
| `find(sat)` | `--index-sats` | O(UTXOs) linear scan |
| Via inscription | `--index-inscriptions` | Fallback when rare lookup misses |

**SatPoint format:** `txid:vout:offset` — 44-byte consensus encoding in redb.

### 8.3 Special Outpoints

| Outpoint | Purpose |
|----------|---------|
| `OutPoint::null()` | Lost sats (unassigned fees) |
| `unbound_outpoint()` | Unbound inscriptions |

---

## 9. How Inscriptions Link to Sats

**Source:** `src/index/updater/inscription_updater.rs`

1. Parse envelopes from transaction witness (`ParsedEnvelope::from_transaction`).
2. Track floating inscriptions with cumulative input offset (FIFO position).
3. Assign to output by offset (respects `pointer` field).
4. Compute sat via `calculate_sat(input_sat_ranges, flotsam.offset)`.
5. If unbound: `sat = None` → `unbound_outpoint()`.

### Storage Links

| Link | Table / Field |
|------|---------------|
| Sat → inscription IDs | `SAT_TO_SEQUENCE_NUMBER` (multimap) |
| Inscription → sat at creation | `InscriptionEntry.sat: Option<u64>` |
| Inscription → current location | `SEQUENCE_NUMBER_TO_SATPOINT` |
| Output → inscriptions | `UtxoEntry` inscription list `(seq#, offset)` |

**Payload bytes are NOT stored in redb.** Content is fetched at serve time from Bitcoin Core via `getrawtransaction` (or `--index-transactions` cache).

**Citation:** [inscriptions docs](https://docs.ordinals.com/inscriptions.html), `index.rs` `get_inscription_by_id()`

---

## 10. Database Schema (redb)

**Schema version:** 34 (`SCHEMA_VERSION` in `src/index.rs`)

### Sat-Related Tables

| Table | Key | Value | Purpose |
|-------|-----|-------|---------|
| `OUTPOINT_TO_UTXO_ENTRY` | `OutPoint` (36 B) | `UtxoEntry` blob | Primary sat location index |
| `SAT_TO_SATPOINT` | `u64` | `SatPoint` (44 B) | Rare-sat fast path |
| `SAT_TO_SEQUENCE_NUMBER` | `u64` | `u32` | Inscriptions on a sat |
| `SEQUENCE_NUMBER_TO_SATPOINT` | `u32` | `SatPoint` | Current inscription location |
| `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | `u32` | `InscriptionEntry` | Metadata incl. optional `sat` |
| `STATISTIC_TO_COUNT` | `u64` | `u64` | Counters (`IndexSats`, `SatRanges`, `LostSats`) |

### UtxoEntry Blob Layout (`src/index/utxo_entry.rs`)

With `--index-sats`:
```
[varint: num_ranges][range₀][range₁]…   // each range = 11 bytes
[+ script_pubkey if --index-addresses]
[+ inscription list if --index-inscriptions]
```

---

## 11. Indexing Flags

| Flag | Effect |
|------|--------|
| `--index-sats` | Store sat ranges; enable `list`, `find`, `/sat` location |
| `--index-inscriptions` | Track inscriptions + sat links (default on) |
| `--no-index-inscriptions` | Disable inscription metadata indexing |
| `--index-addresses` | Script pubkey in UTXO entries |
| `--index-transactions` | Cache full serialized txs in ord DB |
| `--index-runes` | Rune balances/etchings |

**Critical:** `--index-sats` must be set on **first** index build. Changing flags later requires deleting `index.redb` and reindexing.

**Status check:** `GET /status` → `sat_index: true/false` (verified on local testnet4 ord 0.27.1).

---

## 12. Key Source File Index

| Name | Location | Role |
|------|----------|------|
| `Sat` | `crates/ordinals/src/sat.rs` | Newtype `u64` wrapper |
| `Sat::name()` | sat.rs | Base-26 name |
| `Height::starting_sat()` | height.rs | Block's first sat |
| `SatRange::store/load` | `src/index/entry.rs` | 11-byte range codec |
| `Updater::index_transaction_sats` | `src/index/updater.rs` | FIFO per-tx assignment |
| `Index::find` | `src/index.rs` | Locate any sat |
| `InscriptionUpdater::calculate_sat` | inscription_updater.rs | Offset → sat number |
| `Server::sat` | `src/subcommand/server.rs` | HTTP handler |

---

## 13. Implications for Sat Asset Protocol

1. **Reuse ord math** via `crates/ordinals` crate — do not reimplement FIFO or naming.
2. **UTXO-granular location** is the native query unit; single-sat trades require pre-isolation or range-aware PSBT construction.
3. **Rare-sat lookup is O(1)**; arbitrary-sat lookup is O(UTXOs) unless you build a supplemental index.
4. **Inscription linkage is optional** — marketplace for bare sats needs only `--index-sats`, not payload storage.

---

## 14. Citations

| Resource | URL |
|----------|-----|
| Repository | https://github.com/ordinals/ord |
| BIP (ordinal assignment) | https://github.com/ordinals/ord/blob/master/bip.mediawiki |
| API guide | https://docs.ordinals.com/guides/api.html |
| Reindexing / redb | https://docs.ordinals.com/guides/reindexing.html |
| Inscriptions | https://docs.ordinals.com/inscriptions.html |
| `--index-sats` requirement | https://github.com/ordinals/ord/issues/1782 |
