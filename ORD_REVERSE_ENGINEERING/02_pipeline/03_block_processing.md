# 02.03 — Block processing

**Target:** ord 0.27.1 @ `1ad3f64`
**Scope:** `Updater::index_block` + `index_utxo_entries` — one block from arrival to in-cache UTXO state
**Focus files:** `src/index/updater.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal

---

## 1. `index_block` — per-block driver

✅ Verified `src/index/updater.rs:312-402`.

### 1.1 Reorg gate (first thing)

✅ Verified `src/index/updater.rs:320` — before any writes, `Reorg::detect_reorg(&block, self.height, self.index)?` runs. It compares the incoming block's `prev_blockhash` to the indexed hash at `height-1`; a mismatch triggers the recoverable/unrecoverable reorg path (detailed in `05_commit.md`).

```319:320:vendor/ord/src/index/updater.rs
  ) -> Result<()> {
    Reorg::detect_reorg(&block, self.height, self.index)?;
```

**Invariant:** reorg detection precedes all block writes, so a divergent block never partially mutates the index before the error propagates. ✅ Verified (detect at `updater.rs:320`; writes begin at `updater.rs:333`).

### 1.2 Open block-scoped tables

✅ Verified `src/index/updater.rs:333-336` — `HEIGHT_TO_BLOCK_HEADER`, `INSCRIPTION_ID_TO_SEQUENCE_NUMBER`, `STATISTIC_TO_COUNT` are opened on the shared `wtx`.

### 1.3 UTXO / sat / inscription path (conditional)

✅ Verified `src/index/updater.rs:338-350` — `index_utxo_entries(...)` runs if **any** of `index_inscriptions`, `index_addresses`, `index_sats` is enabled:

```338:350:vendor/ord/src/index/updater.rs
    if self.index.index_inscriptions || self.index.index_addresses || self.index.index_sats {
      self.index_utxo_entries(
        &block,
        txout_receiver,
        output_sender,
        utxo_cache,
        wtx,
        &mut inscription_id_to_sequence_number,
        &mut statistic_to_count,
        &mut sat_ranges_written,
        &mut outputs_in_block,
      )?;
    }
```

This is the heart of block processing (§2 below). Sat-range FIFO and inscription assignment are covered in `04_transaction_processing.md`.

### 1.4 Rune path (conditional)

✅ Verified `src/index/updater.rs:352-389` — if `index_runes` and `height >= first_rune_height()`, a `RuneUpdater` is built over the rune tables and `index_runes` is called per tx, then `rune_updater.update()`. Out of scope for Sat Asset v1 (rune trading orthogonal, per `01_tables.md`). 🟡 Inferred scope note.

### 1.5 Commit the header, advance height

✅ Verified `src/index/updater.rs:391-394`:

```391:394:vendor/ord/src/index/updater.rs
    height_to_block_header.insert(&self.height, &block.header.store())?;

    self.height += 1;
    self.outputs_traversed += outputs_in_block;
```

**Invariants:**
- `HEIGHT_TO_BLOCK_HEADER[self.height]` is written **once per block** — this is the durable height cursor and the reorg-detection chain. ✅ `updater.rs:391`.
- `self.height` is incremented **after** the header write, so an error before this line leaves the cursor unadvanced. ✅ `updater.rs:393`.
- Header write happens even for header-only blocks below `first_index_height` (`txdata` empty), keeping the chain contiguous. 🟡 Inferred (ties to `02_sync.md` §2.1).

Note: these writes land in the **shared batch `wtx`**; they are not durable until `commit()` (`05_commit.md`).

---

## 2. `index_utxo_entries` — build UTXO deltas for the block

✅ Verified `src/index/updater.rs:404-728`. This function owns the UTXO/sat/inscription bookkeeping for the whole block.

### 2.1 Open all UTXO-related tables

✅ Verified `src/index/updater.rs:416-432` — opens the inscription/collection/gallery tables plus the core `OUTPOINT_TO_UTXO_ENTRY`, `SAT_TO_SATPOINT`, `SAT_TO_SEQUENCE_NUMBER`, `SCRIPT_PUBKEY_TO_OUTPOINT`, and `TRANSACTION_ID_TO_TRANSACTION`.

### 2.2 `index_inscriptions` height gate

✅ Verified `src/index/updater.rs:434-435`:

```434:435:vendor/ord/src/index/updater.rs
    let index_inscriptions = self.height >= self.index.settings.first_inscription_height()
      && self.index.index_inscriptions;
```

### 2.3 Drain-state assertion

✅ Verified `src/index/updater.rs:437-444` — if inscriptions are indexed, the TxOut receiver must be empty at block start, else the previous block left inputs unconsumed:

```439:444:vendor/ord/src/index/updater.rs
    if index_inscriptions {
      assert!(
        matches!(txout_receiver.try_recv(), Err(TryRecvError::Empty)),
        "Previous block did not consume all inputs"
      );
    }
```

**Invariant:** exactly the prevout `TxOut`s requested for a block are consumed within that block — a hard consistency check on the fetcher pairing (`02_sync.md` §3). ✅ Verified.

### 2.4 Request missing prevouts (only if not full-UTXO index)

✅ Verified `src/index/updater.rs:446-478` — when `!have_full_utxo_index()`, for every non-coinbase input whose prevout is **not** (a) produced earlier in this same block, (b) already in `utxo_cache`, or (c) already in `OUTPOINT_TO_UTXO_ENTRY`, the outpoint is sent to the fetcher thread:

```454:476:vendor/ord/src/index/updater.rs
      for (tx, _) in &block.txdata {
        for input in &tx.input {
          let prev_output = input.previous_output;
          // We don't need coinbase inputs
          if prev_output.is_null() {
            continue;
          }
          // We don't need inputs from txs earlier in the block, since
          // they'll be added to cache when the tx is indexed
          if txids.contains(&prev_output.txid) {
            continue;
          }
          // We don't need inputs we already have in our cache from earlier blocks
          if utxo_cache.contains_key(&prev_output) {
            continue;
          }
          // We don't need inputs we already have in our database
          if outpoint_to_utxo_entry.get(&prev_output.store())?.is_some() {
            continue;
          }
          // Send this outpoint to background thread to be fetched
          output_sender.blocking_send(prev_output)?;
        }
      }
```

**Sat Asset relevance:** with `--index-sats`, `have_full_utxo_index()` is true → this whole block is skipped; every prevout is already in the DB or cache. 🟡 Inferred (`have_full_utxo_index` at `index.rs:486-488`).

### 2.5 Load running counters

✅ Verified `src/index/updater.rs:480-507` — reads `LostSats`, `CursedInscriptions`, `BlessedInscriptions`, `UnboundInscriptions` from `STATISTIC_TO_COUNT`; computes `next_sequence_number` as `max(SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY key)+1` and `home_inscription_count = home_inscriptions.len()`.

**Invariant:** `next_sequence_number` is a **monotonic global counter** derived from the max existing key; sequence numbers are never reused. ✅ `updater.rs:500-505`.

### 2.6 Build the `InscriptionUpdater`

✅ Verified `src/index/updater.rs:509-531` — an `InscriptionUpdater` is constructed holding mutable references to all inscription tables plus the counters and `self.height`, `block.header.time` (`timestamp`), and `reward: Height(self.height).subsidy()`.

### 2.7 Seed coinbase sat input (sat index only)

✅ Verified `src/index/updater.rs:533-543`:

```536:543:vendor/ord/src/index/updater.rs
    if self.index.index_sats {
      let h = Height(self.height);
      if h.subsidy() > 0 {
        let start = h.starting_sat();
        coinbase_inputs.extend(SatRange::store((start.n(), (start + h.subsidy()).n())));
        self.sat_ranges_since_flush += 1;
      }
    }
```

**Invariant:** the block subsidy's brand-new sat range `[starting_sat, starting_sat + subsidy)` is the *only* source of newly-created sats; it is fed as a synthetic input to the coinbase tx. This is where ord's sat-numbering scheme materializes new sats. ✅ Verified. Details of how it flows to outputs are in `04_transaction_processing.md`.

### 2.8 Transaction ordering: non-coinbase first, coinbase last

✅ Verified `src/index/updater.rs:545-551`:

```545:551:vendor/ord/src/index/updater.rs
    for (tx_offset, (tx, txid)) in block
      .txdata
      .iter()
      .enumerate()
      .skip(1)
      .chain(block.txdata.iter().enumerate().take(1))
    {
```

**Invariant (critical):** transactions are iterated `[1, 2, …, n-1, 0]` — all non-coinbase txs first, coinbase (`tx_offset == 0`) **last**. This lets fees flow: non-coinbase leftovers accumulate into `coinbase_inputs` / inscription `flotsam`, which the coinbase then claims (fee sats → coinbase outputs; unclaimed → lost). The `tx_offset` value is the *original* index (so coinbase is still identified as `0`). ✅ Verified. Consumed in `04_transaction_processing.md`.

### 2.9 Per-transaction body (summary; detail in 04)

For each tx in that order (✅ `updater.rs:552-663`):
1. **Gather input UTXO entries** (`updater.rs:554-600`): coinbase has none; others `remove` each prevout from `utxo_cache` (cache hit, `outputs_cached++`) or from `OUTPOINT_TO_UTXO_ENTRY` (DB hit, also removing the `SCRIPT_PUBKEY_TO_OUTPOINT` reverse entry when `index_addresses`), or `blocking_recv` a fetched `TxOut` (non-full-UTXO fallback). ✅ Verified.
2. **Allocate empty output entries**, one `UtxoEntryBuf` per output (`updater.rs:602-606`).
3. **Sat ranges** (`updater.rs:608-641`): if `index_sats`, call `index_transaction_sats` with FIFO input ranges (coinbase uses `coinbase_inputs`, leftover → `lost_sat_ranges`; others use input entries' ranges, leftover → `coinbase_inputs`). Else just push each output's value. → `04_transaction_processing.md`.
4. **Address index** (`updater.rs:643-645`): push output script pubkeys.
5. **Inscriptions** (`updater.rs:647-657`): `inscription_updater.index_inscriptions(...)`. → `04_transaction_processing.md`.
6. **Stage outputs into cache** (`updater.rs:659-662`): insert each `OutPoint{txid,vout} → output_utxo_entry` into `utxo_cache`.

**Invariant:** newly created outputs live only in `utxo_cache` during the batch; they become DB rows only at `commit()`. Spends within the same batch are served straight from `utxo_cache` (the `remove` in step 1). ✅ Verified (`updater.rs:562` cache remove ↔ `updater.rs:661` cache insert).

### 2.10 Per-block inscription cursor

✅ Verified `src/index/updater.rs:665-668` — after all txs, if inscriptions indexed, `HEIGHT_TO_LAST_SEQUENCE_NUMBER[self.height] = next_sequence_number` (pagination cursor).

### 2.11 Lost sats bookkeeping

✅ Verified `src/index/updater.rs:670-701` — any `lost_sat_ranges` left over from the coinbase (fees not claimed + unspendable) are written to the special `OutPoint::null()` UTXO entry. Non-common lost sats also get a `SAT_TO_SATPOINT` row pointing at `null` with offset `lost_sats`; `lost_sats` accumulates. The null entry is **merged** (not overwritten) because it is written across many blocks:

```670:676:vendor/ord/src/index/updater.rs
    if !lost_sat_ranges.is_empty() {
      // Note that the lost-sats outpoint is special, because (unlike real
      // outputs) it gets written to more than once.  commit() will merge
      // our new entry with any existing one.
      let utxo_entry = utxo_cache
        .entry(OutPoint::null())
        .or_insert(UtxoEntryBuf::empty(self.index));
```

**Invariant:** `OutPoint::null()` is a special accumulator outpoint (see `is_special_outpoint`, `index.rs:495-497`); merge-on-commit semantics apply (`05_commit.md`). ✅ Verified.

### 2.12 Persist counters

✅ Verified `src/index/updater.rs:703-725` — writes back `LostSats` (sat-index value vs inscription-only value), `CursedInscriptions`, `BlessedInscriptions`, `UnboundInscriptions` into `STATISTIC_TO_COUNT`.

---

## 3. Stage summary

| Step | Function | Line | Effect |
|------|----------|------|--------|
| reorg gate | `detect_reorg` | `updater.rs:320` | bail before any write |
| open tables | `index_block` | `updater.rs:333-336` | header/inscr/stat tables |
| UTXO path | `index_utxo_entries` | `updater.rs:338-350` | §2 |
| rune path | `RuneUpdater` | `updater.rs:352-389` | out of scope v1 |
| header write | `index_block` | `updater.rs:391` | advance height cursor |
| height++ | `index_block` | `updater.rs:393` | after header write |
| seed subsidy | `index_utxo_entries` | `updater.rs:536-543` | new sats enter |
| tx order | loop | `updater.rs:545-551` | non-coinbase → coinbase |
| per-tx | loop body | `updater.rs:552-663` | → 04 |
| lost sats | `index_utxo_entries` | `updater.rs:670-701` | null outpoint merge |

---

## Cross-references

- Prev: [`02_sync.md`](02_sync.md).
- Next: [`04_transaction_processing.md`](04_transaction_processing.md) — sat FIFO + inscription assignment.
- Commit / null-outpoint merge: [`05_commit.md`](05_commit.md).
- Table roles: [`../01_database/01_tables.md`](../01_database/01_tables.md).

## Open follow-ups

- 🟡 `Height::subsidy()` / `starting_sat()` halving math not line-traced (Phase 3 algorithms).
- 🟡 Rune path internals deferred (out of v1 scope).
