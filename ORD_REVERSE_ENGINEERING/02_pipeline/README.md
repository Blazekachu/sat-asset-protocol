# Pipeline — ord 0.27.1 (Phase 2)

**Status:** ✅ Phase 2 complete — block arrival → DB commit traced with file:line citations
**Target:** ord 0.27.1 @ commit `1ad3f64`
**Focus files:** `src/index.rs`, `src/index/updater.rs`, `src/index/updater/inscription_updater.rs`, `src/index/reorg.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal (Sat Asset Protocol, not ord behavior)

---

## Documents

| # | File | Covers | Key source |
|---|------|--------|-----------|
| 01 | [01_startup.md](01_startup.md) | `Index::open`, schema gate, mode flags, `first_index_height`, `update()` entry | `index.rs:222-479`, `669-707` |
| 02 | [02_sync.md](02_sync.md) | `update_index` loop, block/txout fetchers, commit cadence | `updater.rs:44-310` |
| 03 | [03_block_processing.md](03_block_processing.md) | `index_block`, `index_utxo_entries`, tx ordering, lost sats | `updater.rs:312-728` |
| 04 | [04_transaction_processing.md](04_transaction_processing.md) | sat FIFO (`index_transaction_sats`), inscription assignment | `updater.rs:740-825`, `inscription_updater.rs` |
| 05 | [05_commit.md](05_commit.md) | `commit`, savepoints, reorg detect/rollback | `updater.rs:827-883`, `reorg.rs` |

---

## End-to-end flow

```
Index::open()                         index.rs:222   schema gate 34, freeze mode flags
    └── Index::update()               index.rs:669   resume = max(HEIGHT_TO_BLOCK_HEADER)+1
          └── Updater::update_index() updater.rs:44
                ├── fetch_blocks_from  updater.rs:156  in-order, sync_channel(32)
                ├── spawn_fetcher      updater.rs:241  missing prevouts (non-full-UTXO only)
                └── while rx.recv():   updater.rs:80
                      ├── index_block()            updater.rs:312
                      │     ├── detect_reorg        reorg.rs:25   (before any write)
                      │     ├── index_utxo_entries  updater.rs:404
                      │     │     ├── seed coinbase subsidy sats  updater.rs:536
                      │     │     ├── tx loop: non-coinbase → coinbase  updater.rs:545
                      │     │     │     ├── index_transaction_sats (FIFO)  updater.rs:740
                      │     │     │     └── inscription_updater           inscription_updater.rs:66
                      │     │     └── lost sats → OutPoint::null()  updater.rs:670
                      │     └── HEIGHT_TO_BLOCK_HEADER.insert; height++  updater.rs:391-393
                      └── [interval | savepoint] commit()  updater.rs:103-107
                            ├── utxo_cache → OUTPOINT_TO_UTXO_ENTRY  updater.rs:845
                            ├── → SEQUENCE_NUMBER_TO_SATPOINT        updater.rs:860
                            ├── wtx.commit()  ← DURABILITY POINT     updater.rs:874
                            └── update_savepoints()                  reorg.rs:110
```

---

## Core invariants (✅ Verified — see per-doc citations)

1. **Resume cursor** = `max(HEIGHT_TO_BLOCK_HEADER key) + 1` (`index.rs:674-680`).
2. **Blocks arrive strictly in ascending height** via bounded channel (`updater.rs:80`, `182`).
3. **Reorg detection precedes all block writes** (`updater.rs:320`).
4. **Tx order = non-coinbase first, coinbase last** → fee/lost-sat flow (`updater.rs:545-551`).
5. **Sat ranges assigned FIFO input→output**, oversized ranges split (`updater.rs:766-808`).
6. **Only non-common sat range starts** written to `SAT_TO_SATPOINT` (`updater.rs:784`).
7. **Fees → coinbase; coinbase leftovers → `OutPoint::null()` (lost)** (`updater.rs:609-634`, `819-822`).
8. **Inscriptions ride the same offset FIFO**; fee-riders carried via `flotsam`+`reward` (`inscription_updater.rs:278-348`).
9. **Sequence numbers monotonic, never reused** (`updater.rs:500-505`).
10. **Nothing durable until `wtx.commit()`**; whole batch shares one txn + `utxo_cache` (`updater.rs:874`).
11. **Special outpoints (`null`, unbound) merge-on-commit** (`updater.rs:846-850`).
12. **Savepoints (≤ `max_savepoints`, default 2) maintained near tip**; reorg restores oldest (`reorg.rs:110-146`, `54-77`).

---

## Exit criteria (met)

- [x] Each pipeline stage has file:line citations — 01–05.
- [x] FIFO invariants documented — `04_transaction_processing.md` Part C (10 items).
- [x] Reorg path outlined — `05_commit.md` §3–4 (✅ detect verified, 🟡 depth math inferred).

---

## Handoff

**Session:** Ord Auditor — Phase 2 pipeline documentation.

**History:**
- Session 1 (auto mode): created `01`–`05` + this README.
- Session 2 (Opus verification pass): re-traced every numeric default and startup citation against source; all confirmed accurate to the line. Applied precision fixes + substantive additions below.
- Session 3 (Ord Auditor re-verification): independent line-by-line audit of the three focus files + all supporting citations. **Zero discrepancies found** — every file:line in `01`–`05` matches `vendor/ord` @ `1ad3f64`. No content changes required; verification log below.

**Files touched (Session 2 — Opus):**
- `01_startup.md` — corrected "all 22 index tables" → "22 tables (`:321-342`)" with `STATISTIC_TO_COUNT` (`:345`) / `TRANSACTION_ID_TO_TRANSACTION` (lazy) precision note.
- `02_sync.md` — closed `bitcoin_rpc_limit` follow-up (default 12 → `settings.rs:346`); added §3.1 broadcast-channel `RecvError::Lagged` hazard + drain-assertion backstop.
- `04_transaction_processing.md` — added integer-division fee-truncation nuance (`inscription_updater.rs:264`); cited `unbound_outpoint()` def (`lib.rs:181-186`) vs `OutPoint::null()`.
- `05_commit.md` — added reorg-depth off-by-one precision (exclusive loop bound `reorg.rs:36`; deepest probed = `9..=18` at defaults).
- `README.md` — this handoff.

**Files touched (Session 3 — Ord Auditor):**
- `README.md` only — added Session 3 to History, the verification-log table above, and this note. `01`–`05` left byte-for-byte unchanged: audit found no inaccurate or missing citation, so editing them would add noise, not value.

**Verified-accurate (Session 2, no change needed):** `polling_interval=5s` (`server.rs:142`), `commit_interval=5000` (`settings.rs:356`), `savepoint_interval=10`/`max_savepoints=2` (`settings.rs:378-380`), full `Index::open` startup path (`index.rs:222-306`), `server.rs:160-182` sync entry.

**Session 3 verification log (reproducible — read the ranges below against `vendor/ord` @ `1ad3f64`):**

| Focus file | Ranges re-confirmed | Result |
|-----------|--------------------|--------|
| `src/index/updater.rs` | `update_index` `:44-154`, `fetch_blocks_from` `:156-194`, `get_block_with_retries` `:196-239`, `spawn_fetcher` `:241-310`, `index_block` `:312-402`, `index_utxo_entries` `:404-728`, `index_transaction_sats` `:740-825`, `commit` `:827-883` | ✅ all match |
| `src/index/reorg.rs` | `detect_reorg` `:25-52` (incl. exclusive loop bound `:36`, depth formula `:33-34`), `handle_reorg` `:54-77`, `is_savepoint_required` `:79-108`, `update_savepoints` `:110-146` | ✅ all match |
| `src/index/updater/inscription_updater.rs` | `index_inscriptions` `:66-350`, curse ladder `:149-191`, fee integer-division `:264`, coinbase flotsam sort `:268-279`, assign/carry/lose `:281-349`, `calculate_sat` `:352-370`, `update_inscription_location` `:372-610`, `push_inscription` `:607` | ✅ all match |
| supporting: `src/index.rs` | `open` `:222-224`, durability `:242-246`, schema gate `:279-297`, 22-table create `:321-342` (+`STATISTIC_TO_COUNT` `:345`, `TRANSACTION_ID_TO_TRANSACTION` absent = lazy), mode read-back `:437-445`, `first_index_height` `:450-458`, `have_full_utxo_index` `:486-488`, `is_special_outpoint` `:495-497`, `update()` `:669-707`, `begin_write` `:796-801` | ✅ all match |
| supporting: `src/subcommand/server.rs` | initial sync `:161`, background poll loop `:164-182`, `polling_interval` default `5s` `:142`, integration `100ms` `:176-177` | ✅ all match |
| supporting: `src/settings.rs` | `bitcoin_rpc_limit` `unwrap_or(12)` `:346`, `commit_interval` `unwrap_or(5000)` `:356`, `max_savepoints` `unwrap_or(2)` `:378`, `savepoint_interval` `unwrap_or(10)` `:380` | ✅ all match |

**Gate status:**
- No production code added to `src/` (docs-only). ✅
- No ADR changes (audit did not disprove any accepted ADR). ✅
- Tagging discipline applied (✅/🟡/🔴). ✅
- Phase 2 exit criteria met (above). ✅

**Open follow-ups (deferred to Phase 3 `03_algorithms/`):**
- `SatRange` 11-byte encoding, `Sat::common()` / rarity, `Height::subsidy()`/`starting_sat()` halving math.
- Charm bit layout + `ParsedEnvelope` parser internals.
- `UtxoEntryBuf::merged` byte-level merge semantics.
- `broadcast::RecvError::Lagged` handling (currently guarded only by drain assertion).
- Live testnet4 reorg reproduction to *measure* recoverable depth (arithmetic now resolved).

**Next session:** `02-auditor-query-paths.md` — map HTTP/CLI read paths to table reads (Phase 3 query engine); identify hot paths (`find` O(n) scan vs `rare_sat_satpoint` O(1)).
