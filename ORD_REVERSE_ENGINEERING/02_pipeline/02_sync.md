# 02.02 — Sync loop

**Target:** ord 0.27.1 @ `1ad3f64`
**Scope:** `Updater::update_index` — block fetch pipeline, per-block iteration, commit cadence
**Focus files:** `src/index/updater.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal

---

## 1. `update_index` overview

✅ Verified `src/index/updater.rs:44-154`. One call to `update_index` consumes blocks from a background fetch thread and commits them in batches until the fetcher runs dry, shutdown is requested, or a concurrent updater is detected.

Two concurrent producers feed the main loop:
1. **Block fetcher** — a `std::sync::mpsc` channel delivering `BlockData` (`updater.rs:74`, `fetch_blocks_from`).
2. **Output/TxOut fetcher** — a tokio broadcast channel used only when `have_full_utxo_index()` is false, to pull missing prevout `TxOut`s (`updater.rs:76`, `spawn_fetcher`).

### 1.1 Preamble

✅ Verified `src/index/updater.rs:45-57` — the pass records its wall-clock start, reads bitcoind's tip (`starting_height = get_block_count() + 1`), and stamps `WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP[self.height] = now_millis`:

```49:57:vendor/ord/src/index/updater.rs
    wtx
      .open_table(WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP)?
      .insert(
        &self.height,
        &SystemTime::now()
          .duration_since(SystemTime::UNIX_EPOCH)
          .map(|duration| duration.as_millis())
          .unwrap_or(0),
      )?;
```

🟡 Inferred — this timestamp table is a diagnostic ledger of when each write-batch began (used by `index info` timing per `01_tables.md`); it is not consulted by the indexing logic itself.

---

## 2. Block fetcher thread (`fetch_blocks_from`)

✅ Verified `src/index/updater.rs:156-194`. A bounded `sync_channel(32)` is created, then a thread walks heights upward, fetching each block and sending it downstream:

```156:194:vendor/ord/src/index/updater.rs
  fn fetch_blocks_from(
    index: &Index,
    mut height: u32,
  ) -> Result<std::sync::mpsc::Receiver<BlockData>> {
    let (tx, rx) = std::sync::mpsc::sync_channel(32);

    let first_index_height = index.first_index_height;

    let height_limit = index.height_limit;

    let client = index.settings.bitcoin_rpc_client(None)?;

    thread::spawn(move || {
      loop {
        if let Some(height_limit) = height_limit
          && height >= height_limit
        {
          break;
        }

        match Self::get_block_with_retries(&client, height, first_index_height) {
          Ok(Some(block)) => {
            if let Err(err) = tx.send(block.into()) {
              log::info!("Block receiver disconnected: {err}");
              break;
            }
            height += 1;
          }
          Ok(None) => break,
          Err(err) => {
            log::error!("failed to fetch block {height}: {err}");
            break;
          }
        }
      }
    });

    Ok(rx)
  }
```

**Invariants:**
- ✅ Blocks arrive **strictly in ascending height order**, one at a time (`height += 1` only after a successful send). `updater.rs:182`.
- ✅ Back-pressure: `sync_channel(32)` bounds in-flight blocks to 32; the fetcher blocks on `send` when the consumer lags. `updater.rs:160`.
- ✅ `Ok(None)` (height beyond chain tip) ends the fetch thread cleanly → main loop's `rx.recv()` will eventually return `Err` and exit. `updater.rs:184`.
- ✅ `height_limit` (`--height-limit`) stops the fetch early. `updater.rs:170-174`.

### 2.1 Header-only blocks below `first_index_height`

✅ Verified `src/index/updater.rs:196-239` — `get_block_with_retries`. For heights **below** `first_index_height`, only the header is fetched and `txdata` is empty; at/above it, the full block is fetched:

```205:219:vendor/ord/src/index/updater.rs
            .map(|hash| {
              if height >= first_index_height {
                Ok(client.get_block(&hash)?)
              } else {
                Ok(Block {
                  header: client.get_block_header(&hash)?,
                  txdata: Vec::new(),
                })
              }
            })
```

🟡 Inferred — header-only blocks still advance `HEIGHT_TO_BLOCK_HEADER` (written in `index_block`, see `03_block_processing.md`), keeping the height cursor and reorg-detection chain intact even during the "skip ahead" phase for inscription/rune-only indexes.

✅ Verified `src/index/updater.rs:220-236` — retry policy: exponential backoff `1 << errors` seconds, giving up past 120s; under `cfg!(test)` errors return immediately.

---

## 3. TxOut fetcher thread (`spawn_fetcher`)

✅ Verified `src/index/updater.rs:241-310`. Only meaningful when `have_full_utxo_index()` is false (non-sat/non-address indexes). It receives prevout `OutPoint`s on a tokio mpsc channel, batches them (up to `BATCH_SIZE = 2048`, `updater.rs:248`), splits into `bitcoin_rpc_limit()` parallel chunks (`updater.rs:257`), fetches transactions concurrently, and broadcasts the requested `TxOut`s back **in request order**:

```296:304:vendor/ord/src/index/updater.rs
          // Send all tx outputs back in order
          for (i, tx) in txs.iter().flatten().enumerate() {
            let Ok(_) =
              txout_sender.send(tx.output[usize::try_from(outpoints[i].vout).unwrap()].clone())
            else {
              log::error!("Value channel closed unexpectedly");
              return;
            };
          }
```

**Invariant:** the ordering of broadcast `TxOut`s matches the order in which `index_utxo_entries` enqueued the outpoints; the consumer relies on this FIFO pairing when it does `txout_receiver.blocking_recv()` for a missing input (`updater.rs:576`). ✅ Verified pairing at `updater.rs:474-475` (send) ↔ `updater.rs:576` (recv).

✅ Verified — channel/batch sizes: `CHANNEL_BUFFER_SIZE = 20_000` (~one block's inputs, `updater.rs:245`), `BATCH_SIZE = 2048` (`updater.rs:248`), and `parallel_requests = bitcoin_rpc_limit()` which defaults to **12** (`settings.rs:346` `unwrap_or(12)`; CLI `--bitcoin-rpc-limit`, `options.rs:24`) to respect bitcoind's default `rpcworkqueue` of 16 (comment `updater.rs:254-257`).

### 3.1 Broadcast-channel lag hazard

🟡 Inferred — `spawn_fetcher` returns a **`tokio::sync::broadcast`** receiver (`updater.rs:252`), not an mpsc. Broadcast channels drop the oldest buffered value once the buffer (`CHANNEL_BUFFER_SIZE = 20_000`) overflows a lagging receiver, surfacing as `RecvError::Lagged` on the next `recv`. Because there is exactly one consumer (`index_utxo_entries` → `blocking_recv`, `updater.rs:576`) and it drains synchronously per block, the buffer is not expected to overflow in practice. The per-block **drain-state assertion** (`updater.rs:439-444`, see `03_block_processing.md` §2.3) is what actually guards correctness: it panics if the previous block left `TxOut`s unconsumed, so silent `Lagged` loss cannot go undetected into a committed block. 🟡 Inferred — the `Lagged` branch itself is not explicitly handled in `updater.rs`; the assertion is the backstop.

For **Sat Asset Protocol** (`--index-sats`, full UTXO index) this thread is effectively idle: no missing-prevout sends occur (§4 branch not taken), so the lag hazard does not arise. 🟡 Inferred from `have_full_utxo_index() == true`.

---

## 4. Main consume loop

✅ Verified `src/index/updater.rs:78-136`:

```80:136:vendor/ord/src/index/updater.rs
    while let Ok(block) = rx.recv() {
      self.index_block(
        &mut output_sender,
        &mut txout_receiver,
        &mut wtx,
        block,
        &mut utxo_cache,
      )?;

      // … progress bar …

      uncommitted += 1;

      if uncommitted == self.index.settings.commit_interval()
        || (!self.index.settings.integration_test()
          && Reorg::is_savepoint_required(self.index, self.height)?)
      {
        self.commit(wtx, utxo_cache)?;
        utxo_cache = HashMap::new();
        uncommitted = 0;
        wtx = self.index.begin_write()?;
        let height = wtx
          .open_table(HEIGHT_TO_BLOCK_HEADER)?
          .range(0..)?
          .next_back()
          .transpose()?
          .map(|(height, _hash)| height.value() + 1)
          .unwrap_or(0);
        if height != self.height {
          // another update has run between committing and beginning the new
          // write transaction
          break;
        }
        wtx
          .open_table(WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP)?
          .insert(/* self.height → now_millis */)?;
      }

      if SHUTTING_DOWN.load(atomic::Ordering::Relaxed) {
        break;
      }
    }
```

### 4.1 Per-iteration steps

1. `rx.recv()` — pull the next in-order block (blocks until one arrives or the fetcher hangs up). ✅ `updater.rs:80`.
2. `index_block(...)` — process it into the open `wtx` + in-memory `utxo_cache` (detailed in `03_block_processing.md`). ✅ `updater.rs:81-87`.
3. `uncommitted += 1`. ✅ `updater.rs:101`.
4. Commit decision (§4.2).
5. Shutdown check — cooperative break on `SHUTTING_DOWN`. ✅ `updater.rs:133-135`.

### 4.2 Commit cadence

✅ Verified `src/index/updater.rs:103-106` — a commit is forced when **either**:
- `uncommitted == commit_interval()` — default **5000** blocks (`settings.rs:356`), or
- not an integration test **and** `Reorg::is_savepoint_required(index, height)` returns true (i.e. near the chain tip; see `05_commit.md`).

After `commit(...)`:
- `utxo_cache` is reset to a fresh `HashMap`. ✅ `updater.rs:108`.
- `uncommitted = 0`, a new write txn begins. ✅ `updater.rs:109-110`.
- **Concurrency guard:** the new txn re-reads the tip height from `HEIGHT_TO_BLOCK_HEADER`; if it differs from `self.height`, another updater ran in the gap → `break`. ✅ `updater.rs:111-122`.
- A new starting-timestamp row is stamped for the next batch. ✅ `updater.rs:123-130`.

**Invariant (batching):** all blocks in a commit batch share **one redb write transaction** and **one in-memory `utxo_cache`**. Nothing is durable until `commit()` succeeds; a crash mid-batch loses the whole uncommitted batch and re-indexing resumes from the last committed header height (`update()` resume rule, `01_startup.md` §3). ✅ Verified via single `wtx` lifetime + resume computation.

### 4.3 Loop exit paths

✅ Verified — the `while let Ok(block)` loop ends when:
- `rx.recv()` returns `Err` — fetcher finished/disconnected (`updater.rs:80`), **or**
- concurrent-updater guard breaks (`updater.rs:118-122`), **or**
- `SHUTTING_DOWN` is set (`updater.rs:133-135`).

### 4.4 Post-loop finalization

✅ Verified `src/index/updater.rs:138-152`:
- If this was an initial sync (`starting_index_height == 0 && self.height > 0`), record `Statistic::InitialSyncTime`. `updater.rs:138-143`.
- **Flush the tail:** if `uncommitted > 0`, `commit(wtx, utxo_cache)` one last time. `updater.rs:145-147`.

```145:147:vendor/ord/src/index/updater.rs
    if uncommitted > 0 {
      self.commit(wtx, utxo_cache)?;
    }
```

**Invariant:** every block that `index_block` processed is either flushed by the interval commit or by this tail commit before `update_index` returns `Ok`. ✅ Verified.

---

## 5. Stage summary

| Step | Function | Line | Effect |
|------|----------|------|--------|
| preamble | `update_index` | `updater.rs:45-57` | read tip, stamp batch start |
| spawn fetchers | `fetch_blocks_from` / `spawn_fetcher` | `updater.rs:74-76` | producers online |
| consume | `while rx.recv()` | `updater.rs:80` | in-order block delivery |
| process | `index_block` | `updater.rs:81-87` | → `03_block_processing.md` |
| commit gate | interval / savepoint | `updater.rs:103-131` | batch → durable |
| tail flush | `commit` | `updater.rs:145-147` | flush remainder |

---

## Cross-references

- Prev: [`01_startup.md`](01_startup.md) — how `update_index` is entered.
- Next: [`03_block_processing.md`](03_block_processing.md) — inside `index_block`.
- Commit + savepoints + reorg: [`05_commit.md`](05_commit.md).

## Open follow-ups

- ✅ Resolved — `bitcoin_rpc_limit()` default = **12** (`settings.rs:346`; CLI help `options.rs:24`).
- 🟡 Exact `SHUTTING_DOWN` signal wiring (SIGINT handler) not traced — Phase 3.
- 🟡 `broadcast::RecvError::Lagged` is unhandled; correctness relies on the drain assertion (§3.1). Revisit if a future ord version parallelizes the consumer.
