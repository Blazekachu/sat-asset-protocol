# 02.01 — Startup

**Target:** ord 0.27.1 @ `1ad3f64`
**Scope:** process launch → index handle ready → sync loop entered
**Focus files:** `src/index.rs`, `src/subcommand/server.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal (Sat Asset Protocol, not ord behavior)

---

## 1. Entry points that trigger indexing

Every subcommand that needs a current chain view calls `Index::update()` after opening the index.

✅ Verified — callers of `index.update()`:

| Caller | Location |
|--------|----------|
| `server` (initial sync, test/integration) | `src/subcommand/server.rs:161` |
| `server` (background poll thread) | `src/subcommand/server.rs:171` |
| `index update` CLI | `src/subcommand/index/update.rs:6` |
| `index export` | `src/subcommand/index/export.rs:15` |
| `find`, `list`, `runes`, `balances` | `src/subcommand/find.rs:31`, `list.rs:40`, `runes.rs:35`, `balances.rs:16` |

The `server` subcommand is the canonical long-running path: it syncs once, then spawns a thread that re-runs `update()` on a poll interval.

✅ Verified `src/subcommand/server.rs:164-182` — background loop:

```164:182:vendor/ord/src/subcommand/server.rs
      let index_thread = thread::spawn(move || {
        loop {
          if SHUTTING_DOWN.load(atomic::Ordering::Relaxed) {
            break;
          }

          if !self.no_sync
            && let Err(error) = index_clone.update()
          {
            log::warn!("Updating index: {error}");
          }

          thread::sleep(if integration_test {
            Duration::from_millis(100)
          } else {
            self.polling_interval.into()
          });
        }
      });
```

✅ Verified — default poll interval is `5s` (`--polling-interval`, `src/subcommand/server.rs:142`). Integration tests use `100ms` (`server.rs:177`).

🟡 Inferred — a failed `update()` (e.g. transient RPC error, non-fatal reorg return) is only logged as a warning; the loop simply retries on the next tick. An unrecoverable reorg is the exception (see `05_commit.md`).

---

## 2. `Index::open` — acquiring the DB handle

✅ Verified `src/index.rs:222-224` — `open()` delegates to `open_with_event_sender`:

```222:224:vendor/ord/src/index.rs
  pub fn open(settings: &Settings) -> Result<Self> {
    Index::open_with_event_sender(settings, None)
  }
```

### 2.1 Bitcoin RPC client + data dir

✅ Verified `src/index.rs:230-236` — an RPC client is constructed and the parent dir of the index file is created:

```230:236:vendor/ord/src/index.rs
    let client = settings.bitcoin_rpc_client(None)?;

    let path = settings.index().to_owned();

    let data_dir = path.parent().unwrap();

    fs::create_dir_all(data_dir).snafu_context(error::Io { path: data_dir })?;
```

### 2.2 Durability mode

✅ Verified `src/index.rs:242-246` — durability is `None` under `cfg!(test)`, otherwise `Immediate`:

```242:246:vendor/ord/src/index.rs
    let durability = if cfg!(test) {
      redb::Durability::None
    } else {
      redb::Durability::Immediate
    };
```

**Invariant (startup):** production always runs with `Durability::Immediate`. This is a precondition for reorg handling — `Reorg::handle_reorg` panics if durability is `None` (`src/index/reorg.rs:57-59`), and savepoints are skipped entirely under `Durability::None` (`reorg.rs:80-82`, `reorg.rs:111-113`). ✅ Verified.

### 2.3 Open existing DB → schema gate

✅ Verified `src/index.rs:272-306` — when the redb file already exists, the schema version is read from `STATISTIC_TO_COUNT[Schema]` and compared against `SCHEMA_VERSION` (34):

```279:297:vendor/ord/src/index.rs
          let schema_version = database
            .begin_read()?
            .open_table(STATISTIC_TO_COUNT)?
            .get(&Statistic::Schema.key())?
            .map(|x| x.value())
            .unwrap_or(0);

          match schema_version.cmp(&SCHEMA_VERSION) {
            cmp::Ordering::Less => bail!(
              "index at `{}` appears to have been built with an older, incompatible version of ord, consider deleting and rebuilding the index: index schema {schema_version}, ord schema {SCHEMA_VERSION}",
              path.display()
            ),
            cmp::Ordering::Greater => bail!(
              "index at `{}` appears to have been built with a newer, incompatible version of ord, consider updating ord: index schema {schema_version}, ord schema {SCHEMA_VERSION}",
              path.display()
            ),
            cmp::Ordering::Equal => {}
          }
```

**Invariant:** ord refuses to touch an index whose schema differs from 34. There is **no in-place migration** — an older index must be deleted and rebuilt. ✅ Verified `src/index.rs:286-296`.

After the schema check, the existing path opens `NUMBER_TO_OFFER` in a throwaway write txn (idempotent table creation for the wallet-offer feature). ✅ Verified `src/index.rs:299-303`.

### 2.4 Create new DB → table + statistic bootstrap

✅ Verified `src/index.rs:307-427` — if the file is `NotFound`, a new database is created, durability + quick-repair are set on the bootstrap txn, and **22 tables** are opened (which creates them): 4 multimap + 18 tables at `src/index.rs:321-342`.

**Precision note:** this is *not* the full table set. `STATISTIC_TO_COUNT` is opened immediately after, inside the statistics block (`src/index.rs:345`), and `TRANSACTION_ID_TO_TRANSACTION` is **never** opened here — it is created lazily during block processing (`src/index/updater.rs:432`). So 22 tables are created in `:321-342`, 23 including `STATISTIC_TO_COUNT`, out of the 24 declared in `01_tables.md`. ✅ Verified by table-by-table read of `src/index.rs:321-345`.

Then the persistent config statistics are written from CLI/env settings:

```344:378:vendor/ord/src/index.rs
        {
          let mut statistics = tx.open_table(STATISTIC_TO_COUNT)?;

          Self::set_statistic(
            &mut statistics,
            Statistic::IndexAddresses,
            u64::from(settings.index_addresses_raw()),
          )?;
          // … IndexInscriptions, IndexRunes, IndexSats, IndexTransactions …
          Self::set_statistic(&mut statistics, Statistic::Schema, SCHEMA_VERSION)?;
        }
```

**Invariant:** the `IndexAddresses / IndexInscriptions / IndexRunes / IndexSats / IndexTransactions` flags are **frozen at creation time** into the DB. On every subsequent open they are *read back* from the DB (§2.5), not from the current CLI flags. ✅ Verified `src/index.rs:437-445`. 🟡 Inferred consequence: you cannot toggle `--index-sats` on an existing index; you must rebuild.

Mainnet rune bootstrap (the pre-seeded `\u{29C9}` / "uncommon-goods" rune) is inserted here when runes are enabled. ✅ Verified `src/index.rs:380-422`.

### 2.5 Read-back of index-mode flags

✅ Verified `src/index.rs:437-445` — after the DB is open (either branch), the five mode flags are loaded from the DB:

```437:445:vendor/ord/src/index.rs
    {
      let tx = database.begin_read()?;
      let statistics = tx.open_table(STATISTIC_TO_COUNT)?;
      index_addresses = Self::is_statistic_set(&statistics, Statistic::IndexAddresses)?;
      index_inscriptions = Self::is_statistic_set(&statistics, Statistic::IndexInscriptions)?;
      index_runes = Self::is_statistic_set(&statistics, Statistic::IndexRunes)?;
      index_sats = Self::is_statistic_set(&statistics, Statistic::IndexSats)?;
      index_transactions = Self::is_statistic_set(&statistics, Statistic::IndexTransactions)?;
    }
```

### 2.6 `first_index_height` — where sync starts

✅ Verified `src/index.rs:450-458`:

```450:458:vendor/ord/src/index.rs
    let first_index_height = if index_sats || index_addresses {
      0
    } else if index_inscriptions {
      settings.first_inscription_height()
    } else if index_runes {
      settings.first_rune_height()
    } else {
      u32::MAX
    };
```

✅ Verified `src/index.rs:486-488` — `have_full_utxo_index()` is exactly `first_index_height == 0`:

```486:488:vendor/ord/src/index.rs
  pub fn have_full_utxo_index(&self) -> bool {
    self.first_index_height == 0
  }
```

**Invariant:** with `--index-sats` **or** `--index-addresses`, ord maintains a *full* UTXO set from genesis, so every spent input's prevout is already in the DB. Without them, ord starts later and must fetch missing prevout `TxOut`s over RPC during block processing (see `03_block_processing.md` §4). ✅ Verified — this flag gates the fetcher path at `updater.rs:446` and `updater.rs:575`.

For **Sat Asset Protocol** the relevant deployment is `--index-sats` (rare-sat / range queries), which forces `first_index_height = 0` and `have_full_utxo_index() == true`. 🟡 Inferred from ADR-0002 (delegate to ord) + this code.

### 2.7 Index struct fields set at open

✅ Verified `src/index.rs:460-478` — the returned `Index` captures: `client`, `database`, `durability`, `event_sender`, `first_index_height`, `height_limit` (`settings.height_limit()`), the five mode flags, `settings`, and `unrecoverably_reorged: AtomicBool::new(false)`.

---

## 3. Entry into the sync loop

✅ Verified `src/index.rs:669-707` — `update()` is a retry loop that (re)computes the resume height and drives one `Updater::update_index` pass:

```669:685:vendor/ord/src/index.rs
  pub fn update(&self) -> Result {
    loop {
      let wtx = self.begin_write()?;

      let mut updater = Updater {
        height: wtx
          .open_table(HEIGHT_TO_BLOCK_HEADER)?
          .range(0..)?
          .next_back()
          .transpose()?
          .map(|(height, _header)| height.value() + 1)
          .unwrap_or(0),
        index: self,
        outputs_cached: 0,
        outputs_traversed: 0,
        sat_ranges_since_flush: 0,
      };
```

**Resume-height invariant:** the starting height is `max(HEIGHT_TO_BLOCK_HEADER key) + 1`, or `0` on an empty index. `HEIGHT_TO_BLOCK_HEADER` is therefore the **single source of truth for "how far am I indexed"** — the same computation appears in `rtx::block_count` (`src/index/rtx.rs:18-29`) and `Updater::update_index`'s post-commit re-read (`updater.rs:111-117`). ✅ Verified.

✅ Verified `src/index.rs:687-706` — the loop's error arm dispatches on downcast reorg errors:
- `Recoverable { height, depth }` → `Reorg::handle_reorg(...)` then loop again (`index.rs:693-695`).
- `Unrecoverable` → set `unrecoverably_reorged`, return error (`index.rs:696-701`).
- any other error → propagate (`index.rs:702`).

Detailed reorg semantics are in `05_commit.md`.

### `begin_write` — write-txn factory

✅ Verified `src/index.rs:796-801` — every write txn inherits the index durability and enables quick-repair:

```796:801:vendor/ord/src/index.rs
  fn begin_write(&self) -> Result<WriteTransaction> {
    let mut tx = self.database.begin_write()?;
    tx.set_durability(self.durability)?;
    tx.set_quick_repair(true);
    Ok(tx)
  }
```

---

## 4. Startup stage summary

| Step | Function | Line | Key effect |
|------|----------|------|------------|
| 1 | `Index::open` → `open_with_event_sender` | `index.rs:222-229` | build RPC client, ensure data dir |
| 2 | durability select | `index.rs:242-246` | `Immediate` in prod |
| 3 | open existing → schema gate | `index.rs:279-303` | bail unless schema == 34 |
| 4 | create new → open 22 tables (`:321-342`) + write config stats | `index.rs:316-424` | freeze index-mode flags; `STATISTIC_TO_COUNT` at `:345`, `TRANSACTION_ID_TO_TRANSACTION` lazy |
| 5 | read-back mode flags | `index.rs:437-445` | flags come from DB, not CLI |
| 6 | compute `first_index_height` | `index.rs:450-458` | full-UTXO vs late-start |
| 7 | `update()` resume height | `index.rs:674-680` | `last_header_height + 1` |
| 8 | enter `update_index` | `index.rs:687` | → `02_sync.md` |

---

## Cross-references

- Next stage: [`02_sync.md`](02_sync.md) — the block fetch/commit loop.
- Reorg branch of `update()`: [`05_commit.md`](05_commit.md).
- Table creation list detail: [`../01_database/01_tables.md`](../01_database/01_tables.md).

## Open follow-ups

- 🟡 `settings.first_inscription_height()` / `first_rune_height()` per-chain values not line-traced here (Phase 3 candidate).
- 🟡 `index_cache_size` / repair-callback behaviour (`index.rs:238-270`) noted but out of scope for the block→commit trace.
