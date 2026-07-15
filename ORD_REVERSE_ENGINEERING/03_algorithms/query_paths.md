# Query Engine — HTTP / CLI → redb Tables

**Target:** `ord` **0.27.1** (commit `1ad3f64…`, schema `34`)
**Phase:** 0b · Session 02 — *Query engine mapping*
**Status:** ✅ Verified from source · 🟡 Some flows inferred · 🔴 Sat Asset design notes

**Files audited:**
- `vendor/ord/src/index.rs` (read-side query methods)
- `vendor/ord/src/subcommand/server.rs` (HTTP handlers + route table)
- `vendor/ord/src/subcommand/find.rs` (CLI `find`)
- Cross-ref: [01_database/04_relationships.md](../01_database/04_relationships.md)

---

## 1. Executive Summary

Every read in `ord` resolves through one of **two shapes**:

1. **Point lookup** — `table.get(key)` — O(1)/O(log n) redb B-tree access.
2. **Full-table scan** — `table.iter()` — O(N) over every live UTXO.

The single most important performance fact for the Sat Asset verify API:

> ✅ `find(sat)` is an **O(UTXOs) full scan** of `OUTPOINT_TO_UTXO_ENTRY`.
> ✅ `rare_sat_satpoint(sat)` is an **O(1) point lookup** into `SAT_TO_SATPOINT` — but only exists for **rare (non-common) sats**.

The `/sat/{n}` JSON endpoint is designed to **avoid** the `find` scan entirely — it never calls `find()`. It derives location from the rare-sat index or from inscriptions. This is the pattern the Sat Asset verify layer must copy. See §5.

---

## 2. redb Tables Referenced (read side)

| Table | Access shape | Used by |
|-------|--------------|---------|
| `OUTPOINT_TO_UTXO_ENTRY` | `.get()` and `.iter()` | `list`, `find`, `find_range`, output info, sat balances, inscriptions-on-output |
| `SAT_TO_SATPOINT` | `.get()` (O(1)) | `rare_sat_satpoint`; `.range()` in `rare_sat_satpoints` |
| `SAT_TO_SEQUENCE_NUMBER` (multimap) | `.get()` | inscriptions-by-sat |
| `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | `.get()` | inscription entry / id resolution |
| `SEQUENCE_NUMBER_TO_SATPOINT` | `.get()` | inscription location |
| `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` | `.get()` | id → sequence |
| `SCRIPT_PUBKEY_TO_OUTPOINT` (multimap) | `.get()` | address → outputs |
| `RUNE_ID_TO_RUNE_ENTRY` / `RUNE_TO_RUNE_ID` | `.get()` | rune lookups (out of scope, noted) |

---

## 3. Core Read Methods (index.rs) — Cost Table

| Method | index.rs | Table(s) | Access | Cost | Notes |
|--------|----------|----------|--------|------|-------|
| `find(sat)` | `:1829` | `OUTPOINT_TO_UTXO_ENTRY` | `.iter()` + 11-byte range walk | 🔴 **O(UTXOs)** | Scans **every** live UTXO until sat range matches |
| `find_range(a,b)` | `:1859` | `OUTPOINT_TO_UTXO_ENTRY` | `.iter()` | 🔴 **O(UTXOs)** | Same scan, collects all overlaps |
| `list(outpoint)` | `:1913` | `OUTPOINT_TO_UTXO_ENTRY` | `.get()` | ✅ **O(1)** | Requires `index_sats`; returns `Vec<(start,end)>` |
| `rare_sat_satpoint(sat)` | `:941` | `SAT_TO_SATPOINT` | `.get()` | ✅ **O(1)** | Only populated for non-common sats |
| `rare_sat_satpoints()` | `:926` | `SAT_TO_SATPOINT` | `.range(0..)` | O(rare sats) | Full rare-sat dump |
| `get_inscription_ids_by_sat(sat)` | `:1456` | `SAT_TO_SEQUENCE_NUMBER` → `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | `.get()` | ✅ O(k) | k = inscriptions on that sat |
| `get_inscription_ids_by_sat_paginated` | `:1480` | same | `.get()` + skip/take | ✅ O(page) | Backs `/r/sat/{n}/{page}` |
| `get_inscription_id_by_sat_indexed` | `:1517` | same | `.get()` + nth | ✅ O(index) | Backs `/r/sat/{n}/at/{i}` |
| `get_inscription_satpoint_by_id(id)` | `:1574` | `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` → `SEQUENCE_NUMBER_TO_SATPOINT` | `.get()` | ✅ O(1) | Two point lookups |
| `get_inscription_entry(id)` | `:2379` | `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` → `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | `.get()` | ✅ O(1) | Metadata entry (incl. charms field) |
| `inscriptions_on_output(outpoint)` | `:2485` | `OUTPOINT_TO_UTXO_ENTRY` (embedded) → `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | `.get()` | ✅ O(m) | m = inscriptions embedded in the UtxoEntry |
| `get_address_info(addr)` | `:2518` | `SCRIPT_PUBKEY_TO_OUTPOINT` | `.get()` | ✅ O(outputs) | Requires `--index-addresses` |
| `get_sat_balances_for_outputs(v)` | `:2568` | `OUTPOINT_TO_UTXO_ENTRY` | `.get()` × n | ✅ O(n) | Sum of `total_value()` |
| `get_output_info(outpoint)` | `:2605` | `OUTPOINT_TO_UTXO_ENTRY` (+ RPC + runes + inscriptions) | `.get()` | ✅ O(1) core | Aggregator behind `/output` |

---

## 4. HTTP Endpoint → Handler → Table Map

Route table: `server.rs:209–332`.

### 4.1 `/sat/{sat}` — GET → `Server::sat` (`server.rs:727`)

```
/sat/{n}
  ├─ get_inscription_ids_by_sat(sat)     → SAT_TO_SEQUENCE_NUMBER
  │                                         → SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY
  ├─ rare_sat_satpoint(sat)              → SAT_TO_SATPOINT           (O(1), rare only)
  │     └─ fallback: get_inscription_satpoint_by_id(first_inscription)
  │                                         → INSCRIPTION_ID_TO_SEQUENCE_NUMBER
  │                                         → SEQUENCE_NUMBER_TO_SATPOINT
  ├─ block_time(sat.height())           → HEIGHT_TO_BLOCK_HEADER
  ├─ sat.charms()                       → computed (ordinals crate, no table)
  └─ address:  get_transaction(txid)    → bitcoind RPC (not redb)
```

✅ **Key finding:** `/sat/{n}` **never calls `find()`**. Satpoint resolution order is:
1. `SAT_TO_SATPOINT.get()` (O(1)) — succeeds only for rare sats.
2. else satpoint of the **first inscription** on the sat (two O(1) lookups).
3. else `satpoint = None` → JSON `"satpoint": null`.

🟡 **Implication:** For a **common, un-inscribed sat**, `/sat/{n}` returns `satpoint: null` and `address: null`. It does **not** fall back to the expensive `find()` scan. The full location scan is only available via the CLI (`ord find`) — see §6.

JSON response fields ↔ source:

| JSON field | Source | Table / origin |
|------------|--------|----------------|
| `number`,`name`,`degree`,`decimal`,`percentile`,`cycle`,`epoch`,`period`,`offset`,`rarity`,`block` | `Sat` math | computed (ordinals crate) |
| `charms` | `sat.charms()` | computed (sat-intrinsic only — see [charms.md](./charms.md)) |
| `inscriptions` | `get_inscription_ids_by_sat` | `SAT_TO_SEQUENCE_NUMBER` (+ entry) |
| `satpoint` | `rare_sat_satpoint` / inscription | `SAT_TO_SATPOINT` or `SEQUENCE_NUMBER_TO_SATPOINT` |
| `timestamp` | `block_time` | `HEIGHT_TO_BLOCK_HEADER` |
| `address` | RPC on satpoint txid | bitcoind (not redb) |

### 4.2 `/output/{outpoint}` — GET → `Server::output` (`server.rs:807`)

```
/output/{txid:vout}
  └─ get_output_info(outpoint)  (index.rs:2605)
       ├─ list(outpoint)                 → OUTPOINT_TO_UTXO_ENTRY.get()   (sat_ranges)
       ├─ contains_output / spent check  → OUTPOINT_TO_UTXO_ENTRY.get()
       ├─ get_inscriptions_for_output    → OUTPOINT_TO_UTXO_ENTRY (embedded)
       │                                   → SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY
       ├─ get_rune_balances_for_output   → OUTPOINT_TO_RUNE_BALANCES (--index-runes)
       └─ txout value / script           → bitcoind RPC (unspent) or tx info (spent)
```

✅ **Canonical entry point:** `/output/{outpoint}` → **`OUTPOINT_TO_UTXO_ENTRY`** via `list().get()` — a single O(1) key lookup for sat ranges. This is the table `04_relationships.md` calls the canonical UTXO → sats relationship.

🟡 If `--index-sats` is off, `list()` returns `None` → `sat_ranges` omitted; inscriptions still resolve.

### 4.3 `/satpoint/{satpoint}` — GET → `Server::satpoint` (`server.rs:837`)

Reverse lookup **satpoint → sat**, then `302` redirect to `/sat/{n}`.

```
/satpoint/{txid:vout:offset}
  └─ get_output_info(outpoint).sat_ranges   → OUTPOINT_TO_UTXO_ENTRY.get()  (O(1))
       └─ walk ranges, accumulate size until offset falls inside → sat
```

✅ O(1) table access + O(ranges-in-that-output) arithmetic. Requires `--index-sats` (errors `sat index required` if `sat_ranges` is `None`).

### 4.4 Recursive sat endpoints `/r/sat/{n}[...]` (`server.rs:314–332`)

| Route | Handler | Method (index.rs) | Table |
|-------|---------|-------------------|-------|
| `/r/sat/{n}` | `r::sat` | `get_inscription_ids_by_sat_paginated` `:1480` | `SAT_TO_SEQUENCE_NUMBER` |
| `/r/sat/{n}/{page}` | `r::sat_paginated` | same | same |
| `/r/sat/{n}/at/{i}` | `r::sat_at_index` | `get_inscription_id_by_sat_indexed` `:1517` | `SAT_TO_SEQUENCE_NUMBER` |

🟡 All `/r/sat/*` accept **integer sat number only** (confirmed in API spec §1.2). No `find` scan involved — pure multimap lookups.

### 4.5 Other sat/UTXO endpoints (summary)

| Endpoint | Handler | Primary table |
|----------|---------|---------------|
| `/output` (POST batch) → `/outputs` | `Server::outputs` `:867` | `OUTPOINT_TO_UTXO_ENTRY.get()` × n |
| `/outputs/{address}` | `outputs_address` `:261` | `SCRIPT_PUBKEY_TO_OUTPOINT` → `OUTPOINT_TO_UTXO_ENTRY` |
| `/address/{address}` | `Server::address` `:1173` | `SCRIPT_PUBKEY_TO_OUTPOINT` (+ balances, inscriptions) |
| `/ordinal/{sat}` | `Server::ordinal` `:803` | redirect → `/sat/{sat}` |

---

## 5. `find` (O(UTXOs)) vs `rare_sat_satpoint` (O(1)) — Deep Dive

### 5.1 `find(sat)` — the full scan (`index.rs:1829`)

```
for entry in OUTPOINT_TO_UTXO_ENTRY.iter():      ← EVERY live UTXO
    sat_ranges = utxo_entry.parse().sat_ranges()
    for chunk in sat_ranges.chunks_exact(11):    ← 11-byte packed (start,end)
        if start <= sat < end:
            return SatPoint{ outpoint, offset }
```

- Cost: **O(UTXOs × ranges-per-UTXO)** worst case, unindexed linear walk.
- Early guard: `if block_count <= sat.height(): return None` (unmined sat).
- No secondary index consulted — this is the exhaustive fallback.

### 5.2 `rare_sat_satpoint(sat)` — the point lookup (`index.rs:941`)

```
SAT_TO_SATPOINT.get(sat.n()) → Option<SatPoint>
```

- Cost: **O(1)** (redb B-tree get).
- **Only** rare/uncommon+ sats are keys — `SAT_TO_SATPOINT` is written per §04_relationships spend invariants only for moved *rare* sats. A common sat is **never** in this table.

### 5.3 Why the gap matters

| | `find` | `rare_sat_satpoint` |
|---|--------|---------------------|
| Coverage | **any** sat (common or rare) | rare/non-common only |
| Cost | O(UTXOs) scan | O(1) get |
| Table | `OUTPOINT_TO_UTXO_ENTRY.iter()` | `SAT_TO_SATPOINT.get()` |
| Exposed via HTTP? | ❌ **no** endpoint calls `find` | ✅ `/sat/{n}` |
| Exposed via CLI? | ✅ `ord find <sat>` | indirectly |

🔴 **Sat Asset consequence:** A production "where is sat N right now?" API over ord's HTTP surface **cannot** answer for arbitrary common sats without either (a) the sat being rare, (b) the sat carrying an inscription, or (c) running the O(UTXOs) `find` scan. The verify layer must not depend on `/sat/{n}.satpoint` being non-null for common sats.

---

## 6. CLI → same methods

| CLI | Subcommand file | Calls | Table |
|-----|-----------------|-------|-------|
| `ord find <sat>` | `find.rs:41` | `index.find(sat)` | `OUTPOINT_TO_UTXO_ENTRY.iter()` — **O(UTXOs)** |
| `ord find <sat> <end>` | `find.rs:34` | `index.find_range` | same scan |
| `ord list <outpoint>` | (list subcommand) | `index.list` | `OUTPOINT_TO_UTXO_ENTRY.get()` — O(1) |

✅ `find` **requires** `--index-sats` (`find.rs:27` bails otherwise). This is the only supported way to locate an arbitrary common sat.

---

## 7. Hot Paths for Sat Asset Verify API 🔴

Ranked by how the verify/settlement layer (API spec §4.3 `/v1/verify/*`) should hit ord:

| Verify need | Recommended ord path | Cost | Avoid |
|-------------|----------------------|------|-------|
| "Is sat N at outpoint X, offset 0?" | `/output/{X}` → walk `sat_ranges` | ✅ O(1) get | ❌ `/sat/{N}` (null for common), ❌ `ord find` |
| "Confirm asset still at listed outpoint" (`/v1/verify/listing`) | `/output/{outpoint}` — check `spent` + ranges | ✅ O(1) | full scan |
| "Sat → current outpoint" for **rare** sat | `/sat/{N}.satpoint` | ✅ O(1) | — |
| "Sat → current outpoint" for **common** sat | ⚠️ requires `ord find` scan **or** caller supplies candidate outpoint | 🔴 O(UTXOs) | building this into a hot request path |
| Inscriptions on a sat | `/r/sat/{N}` | ✅ O(k) | — |

**Design rule (reinforces API spec §5):** The verify API should take **outpoint as input** (from the listing/PSBT) and confirm the sat lives there via `/output/{outpoint}` — a single O(1) redb `get`. It should **never** reverse-search sat→location on the request path, because that degrades to `find`'s O(UTXOs) scan.

🔴 If a sat→location index for **common** sats is ever required at scale, that is a **new index** (event log / sat-history schema), not reuse of an ord table — consistent with [00_overview.md](../00_overview.md) and [05_sat_asset_notes/01_indexer_future.md](../05_sat_asset_notes/01_indexer_future.md).

---

## 8. Exit-Criteria Coverage

- [x] Every major sat/UTXO API endpoint mapped to tables (§4)
- [x] `find` O(UTXOs) vs `rare_sat_satpoint` O(1) documented (§5)
- [x] `/sat/{n}` JSON API → tables (§4.1)
- [x] `/output/{outpoint}` → `OUTPOINT_TO_UTXO_ENTRY` (§4.2)
- [x] Hot paths flagged for Sat Asset verify API (§7)

---

## 9. Open Follow-ups → Session 03

1. 🟡 Trace `get_inscriptions_for_output` embedded-vs-entry read exactly (used by `/output` & `get_output_info`).
2. 🟡 Confirm `/address` aggregation cost (inscriptions + runes join over all address outputs).
3. 🔴 Prototype the outpoint-first verify contract against local testnet4 node; benchmark `/output` O(1) vs `ord find` O(UTXOs) at realistic UTXO counts.
4. Rune query paths (`RUNE_*` tables) intentionally out of scope here — defer.

See [handoff](#handoff-to-session-03) at end of this directory's Session 02 set (also in [charms.md](./charms.md)).
