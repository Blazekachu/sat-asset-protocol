# 02.05 — Commit, savepoints & reorg

**Target:** ord 0.27.1 @ `1ad3f64`
**Scope:** `Updater::commit` (cache → DB), savepoint lifecycle, reorg detection + rollback
**Focus files:** `src/index/updater.rs`, `src/index/reorg.rs`, `src/index.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal

---

## 1. `commit` — flush the batch to redb

✅ Verified `src/index/updater.rs:827-883`. Called from the sync loop at the commit interval / savepoint boundary and at tail (`02_sync.md` §4.2, §4.4).

### 1.1 Drain `utxo_cache` → `OUTPOINT_TO_UTXO_ENTRY`

✅ Verified `src/index/updater.rs:840-867`:

```840:867:vendor/ord/src/index/updater.rs
    {
      let mut outpoint_to_utxo_entry = wtx.open_table(OUTPOINT_TO_UTXO_ENTRY)?;
      let mut script_pubkey_to_outpoint = wtx.open_multimap_table(SCRIPT_PUBKEY_TO_OUTPOINT)?;
      let mut sequence_number_to_satpoint = wtx.open_table(SEQUENCE_NUMBER_TO_SATPOINT)?;

      for (outpoint, mut utxo_entry) in utxo_cache {
        if Index::is_special_outpoint(outpoint)
          && let Some(old_entry) = outpoint_to_utxo_entry.get(&outpoint.store())?
        {
          utxo_entry = UtxoEntryBuf::merged(old_entry.value(), &utxo_entry, self.index);
        }

        outpoint_to_utxo_entry.insert(&outpoint.store(), utxo_entry.as_ref())?;

        let utxo_entry = utxo_entry.parse(self.index);
        if self.index.index_addresses {
          let script_pubkey = utxo_entry.script_pubkey();
          script_pubkey_to_outpoint.insert(script_pubkey, &outpoint.store())?;
        }

        if self.index.index_inscriptions {
          for (sequence_number, offset) in utxo_entry.parse_inscriptions() {
            let satpoint = SatPoint { outpoint, offset };
            sequence_number_to_satpoint.insert(sequence_number, &satpoint.store())?;
          }
        }
      }
    }
```

**Commit invariants (✅ Verified):**
1. **Special-outpoint merge.** For `OutPoint::null()` and the unbound outpoint (`is_special_outpoint`, `index.rs:495-497`), the cached entry is merged with the existing DB entry via `UtxoEntryBuf::merged` before insert — these are the only outpoints written more than once. `updater.rs:846-850`.
2. **Canonical UTXO write.** Every cached outpoint (new outputs from the batch) is inserted into `OUTPOINT_TO_UTXO_ENTRY`. `updater.rs:852`.
3. **Address reverse index.** If `index_addresses`, `SCRIPT_PUBKEY_TO_OUTPOINT` gets a forward mapping. (Spends removed their reverse entry back in `index_utxo_entries`, `updater.rs:566-571`.) `updater.rs:855-858`.
4. **Inscription location materialized here.** `SEQUENCE_NUMBER_TO_SATPOINT` is written by parsing inscriptions *out of* each committed UTXO entry — this is where the staged locations from `04_transaction_processing.md` §B.6 become durable rows. `updater.rs:860-865`.

**Ordering invariant:** spends (`remove` from `OUTPOINT_TO_UTXO_ENTRY`) happened during block processing; creations (`insert`) happen here at commit. Within one batch, an output created and spent in the same batch never hits the DB — it lived and died in `utxo_cache` (`03_block_processing.md` §2.9). ✅ Inferred+verified via cache lifecycle.

### 1.2 Statistics + double commit

✅ Verified `src/index/updater.rs:869-878`:

```869:878:vendor/ord/src/index/updater.rs
    Index::increment_statistic(&wtx, Statistic::OutputsTraversed, self.outputs_traversed)?;
    self.outputs_traversed = 0;
    Index::increment_statistic(&wtx, Statistic::SatRanges, self.sat_ranges_since_flush)?;
    self.sat_ranges_since_flush = 0;
    Index::increment_statistic(&wtx, Statistic::Commits, 1)?;
    wtx.commit()?;

    // Commit twice since due to a bug redb will only reuse pages freed in the
    // transaction before last.
    self.index.begin_write()?.commit()?;
```

**Invariants:**
- `OutputsTraversed`, `SatRanges`, `Commits` counters are updated and their in-memory accumulators reset. `updater.rs:869-873`.
- **`wtx.commit()` is the single durability point** for the whole batch. Before this line nothing in the batch is persisted. `updater.rs:874`.
- **Empty double-commit** works around a redb page-reuse bug (only frees pages from the transaction-before-last). `updater.rs:876-878`.

### 1.3 Savepoint update

✅ Verified `src/index/updater.rs:880` — after committing, `Reorg::update_savepoints(self.index, self.height)?` runs (§2).

---

## 2. Savepoint lifecycle (`reorg.rs`)

Savepoints are redb persistent snapshots that make shallow reorgs cheap to undo.

### 2.1 When a savepoint is required

✅ Verified `src/index/reorg.rs:79-108`:

```99:101:vendor/ord/src/index/reorg.rs
    let result = (height < savepoint_interval
      || height.saturating_sub(last_savepoint_height) >= savepoint_interval)
      && blocks.saturating_sub(height) <= savepoint_interval * max_savepoints + 1;
```

**Invariants:**
- Under `Durability::None` (tests), savepoints are disabled entirely → returns `false`. `reorg.rs:80-82`.
- A savepoint is due when the height is early **or** ≥ `savepoint_interval` past the last savepoint, **and** the tip is within `savepoint_interval * max_savepoints + 1` of `height` (i.e. only maintain savepoints near the chain tip, where reorgs actually happen). `reorg.rs:99-101`.
- Defaults: `savepoint_interval = 10`, `max_savepoints = 2` (`settings.rs:378-380`). ✅ Verified. This gate is *also* used in the sync loop to force a commit near the tip (`updater.rs:104-105`, `02_sync.md` §4.2).

### 2.2 Creating / pruning savepoints

✅ Verified `src/index/reorg.rs:110-146` — `update_savepoints`:
- No-op under `Durability::None`. `reorg.rs:111-113`.
- If required: if `savepoints.len() >= max_savepoints`, delete the oldest (`min`) persistent savepoint (commit), then create a new `persistent_savepoint()` and record `LastSavepointHeight = height` (commit). `reorg.rs:115-143`.

**Invariant:** at most `max_savepoints` (default 2) persistent savepoints exist, spaced ~`savepoint_interval` blocks apart, always near the tip. This bounds max recoverable reorg depth. ✅ Verified.

---

## 3. Reorg detection (`detect_reorg`)

✅ Verified `src/index/reorg.rs:25-52`. Called at the top of `index_block` (`updater.rs:320`), before any writes.

```25:52:vendor/ord/src/index/reorg.rs
  pub(crate) fn detect_reorg(block: &BlockData, height: u32, index: &Index) -> Result {
    let bitcoind_prev_blockhash = block.header.prev_blockhash;

    match index.block_hash(height.checked_sub(1))? {
      Some(index_prev_blockhash) if index_prev_blockhash == bitcoind_prev_blockhash => Ok(()),
      Some(index_prev_blockhash) if index_prev_blockhash != bitcoind_prev_blockhash => {
        let savepoint_interval = u32::try_from(index.settings.savepoint_interval()).unwrap();
        let max_savepoints = u32::try_from(index.settings.max_savepoints()).unwrap();
        let max_recoverable_reorg_depth =
          (max_savepoints - 1) * savepoint_interval + height % savepoint_interval;

        for depth in 1..max_recoverable_reorg_depth {
          let index_block_hash = index.block_hash(height.checked_sub(depth))?;
          let bitcoind_block_hash = index
            .client
            .get_block_hash(u64::from(height.saturating_sub(depth)))
            .into_option()?;

          if index_block_hash == bitcoind_block_hash {
            return Err(anyhow!(reorg::Error::Recoverable { height, depth }));
          }
        }

        Err(anyhow!(reorg::Error::Unrecoverable))
      }
      _ => Ok(()),
    }
  }
```

**Invariants:**
- **Match:** incoming block's `prev_blockhash` == indexed hash at `height-1` → no reorg, proceed. `reorg.rs:29`.
- **Mismatch:** walk back `depth = 1..max_recoverable_reorg_depth`, comparing indexed vs bitcoind hashes; the first common ancestor → `Recoverable { height, depth }`. `reorg.rs:36-46`.
- **No common ancestor within window** → `Unrecoverable`. `reorg.rs:48`.
- `max_recoverable_reorg_depth = (max_savepoints - 1) * savepoint_interval + height % savepoint_interval`. `reorg.rs:33-34`. At defaults (`max_savepoints=2`, `savepoint_interval=10`) this evaluates to `10 + height%10`, i.e. a **bound value** in `10..=19`. ✅ Verified arithmetic.
- **Off-by-one (✅ Verified):** the search loop is `for depth in 1..max_recoverable_reorg_depth` — an **exclusive** upper bound (`reorg.rs:36`). So the deepest depth actually probed is `max_recoverable_reorg_depth − 1`, i.e. `9..=18` at defaults; the bound value itself is never tested as a depth. A reorg at exactly `max_recoverable_reorg_depth` is treated as `Unrecoverable`. Earlier prose that read "~10–19 blocks" refers to the *bound*, not the max recoverable depth (which is `9..=18`).
- Empty-index case (`height-1` underflows / no hash) → `Ok(())`. `reorg.rs:50` + `checked_sub`.

`block_hash` reads from `HEIGHT_TO_BLOCK_HEADER` (`index.rs:901-903` → `rtx.rs:31-45`). ✅ Verified.

---

## 4. Reorg handling (`handle_reorg`) — rollback path

✅ Verified `src/index/reorg.rs:54-77`. Dispatched from `Index::update`'s error arm (`index.rs:692-704`, `01_startup.md` §3).

```54:77:vendor/ord/src/index/reorg.rs
  pub(crate) fn handle_reorg(index: &Index, height: u32, depth: u32) -> Result {
    log::info!("rolling back database after reorg of depth {depth} at height {height}");

    if let redb::Durability::None = index.durability {
      panic!("set index durability to `Durability::Immediate` to test reorg handling");
    }

    let mut wtx = index.begin_write()?;

    let oldest_savepoint =
      wtx.get_persistent_savepoint(wtx.list_persistent_savepoints()?.min().unwrap())?;

    wtx.restore_savepoint(&oldest_savepoint)?;

    Index::increment_statistic(&wtx, Statistic::Commits, 1)?;
    wtx.commit()?;

    log::info!(
      "successfully rolled back database to height {}",
      index.begin_read()?.block_count()?
    );

    Ok(())
  }
```

**Invariants:**
- Requires `Durability::Immediate` — panics otherwise (savepoints don't exist under `None`). `reorg.rs:57-59`.
- **Restores the oldest** persistent savepoint (`min`), i.e. rolls back as far as the savepoint window allows, then commits. `reorg.rs:63-69`.
- After rollback, `update()`'s loop retries from the restored (lower) height — `Index::update` re-computes the resume height from `HEIGHT_TO_BLOCK_HEADER` on the next iteration (`index.rs:669-707`). ✅ Verified control flow.

🟡 Inferred — restoring the *oldest* savepoint (not the closest ancestor) means recovery over-rewinds to the safe floor and re-indexes forward; simpler and always safe within the window, at the cost of re-processing a few blocks.

### 4.1 Unrecoverable path

✅ Verified `src/index.rs:696-701` — `Unrecoverable` sets `unrecoverably_reorged` (atomic) and returns the error; the reorg is deeper than the savepoint window and requires operator intervention (typically reindex). 🟡 Inferred remediation.

---

## 5. End-to-end durability timeline

```
index_block writes → shared wtx + utxo_cache   (NOT durable)
        │
   [commit interval OR savepoint-required near tip]   updater.rs:103-106
        ▼
commit():
   utxo_cache → OUTPOINT_TO_UTXO_ENTRY (+ merge specials)   updater.rs:845-852
   → SCRIPT_PUBKEY_TO_OUTPOINT / SEQUENCE_NUMBER_TO_SATPOINT updater.rs:855-865
   counters bumped                                          updater.rs:869-873
   wtx.commit()   ← DURABILITY POINT                        updater.rs:874
   empty double-commit (redb page-reuse workaround)         updater.rs:878
   Reorg::update_savepoints()                               updater.rs:880
        │
   [detect_reorg mismatch on a later block]                 updater.rs:320
        ▼
update() error arm → handle_reorg() restore oldest savepoint index.rs:692-704 / reorg.rs:54-77
```

---

## 6. Stage summary

| Step | Function | Line | Effect |
|------|----------|------|--------|
| cache → UTXO | `commit` | `updater.rs:845-852` | canonical rows, specials merged |
| addr/inscr rows | `commit` | `updater.rs:855-865` | reverse + satpoint indexes |
| durability | `wtx.commit` | `updater.rs:874` | batch persisted |
| double commit | `begin_write().commit` | `updater.rs:878` | redb page bug workaround |
| savepoint mgmt | `update_savepoints` | `reorg.rs:110-146` | ≤ max_savepoints near tip |
| detect | `detect_reorg` | `reorg.rs:25-52` | Recoverable / Unrecoverable |
| rollback | `handle_reorg` | `reorg.rs:54-77` | restore oldest savepoint |

---

## Cross-references

- Commit trigger cadence: [`02_sync.md`](02_sync.md) §4.
- Staged UTXO/inscription state that this flushes: [`03_block_processing.md`](03_block_processing.md), [`04_transaction_processing.md`](04_transaction_processing.md).
- `update()` reorg error dispatch: [`01_startup.md`](01_startup.md) §3.

## Open follow-ups

- 🟡 `UtxoEntryBuf::merged` byte-level merge semantics not line-traced (Phase 3).
- ✅ Resolved — default `max_recoverable_reorg_depth` bound = `10 + height%10` (`10..=19`); deepest depth actually probed = `9..=18` (exclusive loop bound, §3). Not yet *measured* against a live testnet4 reorg — reproduction deferred.
- 🔴 Sat Asset Protocol: a separate listings DB (ADR-0005) must define its **own** reorg reconciliation vs ord's savepoint model — flagged for Phase 4/5, no ord behavior implied here.
