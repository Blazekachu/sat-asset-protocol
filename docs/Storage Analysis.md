# Storage Analysis

**Status:** Research complete (2026-07-07)  
**Question:** Where does ~2.5 TB come from? Can sat indexing exist without inscription payloads?

---

## 1. Executive Summary

A fully synced **mainnet** stack (Bitcoin Core archival + `txindex` + ord with all index flags) is approximately **1.0–1.2 TB today**, not a documented 2.5 TB constant. The **~2.5 TB** figure is best interpreted as **conservative provisioning + growth headroom**, not an ord specification.

**Critical finding:** Inscription **payload bytes are never stored in `index.redb`**. They live in Bitcoin block files and are fetched at serve time via `getrawtransaction`. Sat indexing (`--index-sats`) is independent of payload storage.

**Evidence:** [ordstuff index sizes](https://ordstuff.info/indexes/), [ord inscriptions docs](https://docs.ordinals.com/inscriptions.html), `index.rs` `get_inscription_by_id()`

---

## 2. Full-Stack Storage Breakdown (Mainnet)

| Component | Location | Estimated Size | Confidence | Citation |
|-----------|----------|----------------|------------|----------|
| **Block files** | `~/.bitcoin/blocks/` | 700–800 GB | High | [CryptoCellLabs](https://github.com/CryptoCellLabs/Ordinals-Index-Data); [Start9](https://community.start9.com/t/blockchain-size-is-suppose-be-roughly-523gb-but-its-taking-more-space-on-ssd/760) |
| **Block index** | `blocks/index/` | <0.2 GB | High | Bitcoin StackExchange |
| **Chainstate (UTXO set)** | `chainstate/` | 5–11 GB | High | [ord#1863](https://github.com/ordinals/ord/issues/1863) |
| **Txindex** (required) | `indexes/txindex/` | 44–59 GB | High | Start9; StackExchange |
| **ord index (runes only)** | `index.redb` | ~80–85 GB | High | [ordstuff 0.27 `without`](https://ordstuff.info/indexes/0.27/) |
| **ord (+ sats + addresses)** | `index.redb` | ~215–231 GB | High | [ordstuff 0.25 `with`](https://ordstuff.info/indexes/0.25/) |
| **ord (all flags incl. txs)** | `index.redb` | ~335–407 GB | High | [ordstuff 0.27 `tx`](https://ordstuff.info/indexes/0.27/) |
| **Inscription payloads** | Inside block witnesses | Included in blocks | High | Not separate ord category |
| **Typical full ord node total** | Bitcoin + ord (all flags) | **~1.0–1.2 TB** | Medium | Sum of above |
| **~2.5 TB figure** | Planning / worst case | Headroom + bloat | Low | No primary source found |

---

## 3. Where Does ~2.5 TB Come From?

**No official ord source cites 2.5 TB exactly.** Plausible explanations:

1. **Conservative SSD sizing** — operators provision 2 TB+ for ~1 TB current usage + headroom ([CryptoCellLabs](https://github.com/CryptoCellLabs/Ordinals-Index-Data)).
2. **Growth buffer** — Bitcoin blocks grow ~50–100 GB/year; ord index grows with activity.
3. **Pathological bloat** — [ord#4234](https://github.com/ordinals/ord/issues/4234): `index.redb` reached ~1 TB with low `--commit-interval`.
4. **Transient overhead** — reindexing, savepoints, redb fragmentation, keeping old `index.redb` during rebuild.
5. **Double-counting** — inscription bytes are in block files; `--index-transactions` duplicates them inside ord.

**Status:** Canonical 2.5 TB origin = **UNKNOWN**.

---

## 4. Bitcoin Core Storage

| Component | Role | Size |
|-----------|------|------|
| `blocks/blk*.dat`, `rev*.dat` | Full archival chain (includes all inscription witness bytes) | ~700–800 GB |
| `blocks/index/` | Block → file offset map | <0.2 GB |
| `chainstate/` | Current UTXO set | 5–11 GB |
| `indexes/txindex/` | txid → block location; powers `getrawtransaction` | 44–59 GB |

**ord requirements:** `txindex=1` in `bitcoin.conf`. Pruned nodes are **incompatible** with ord content serving.

**Citation:** [ord wallet guide](https://docs.ordinals.com/guides/wallet.html)

---

## 5. Ord Database Components (`index.redb`)

All ord data lives in one redb file. Tables defined in `src/index.rs`.

### 5.1 CLI Flags (`src/options.rs`)

| Flag | Default | Effect |
|------|---------|--------|
| `--index-sats` | off | Track every sat's location |
| `--index-runes` | off | Track runes |
| `--index-addresses` | off | ScriptPubKey → outpoint |
| `--index-transactions` | off | Store full serialized txs in ord DB |
| `--no-index-inscriptions` | inscriptions on | Disable inscription metadata |

### 5.2 Logical Components

| Component | Stored in redb? | Primary Tables | Size Delta (ordstuff) |
|-----------|-----------------|----------------|----------------------|
| **Sat index** | Yes | `OUTPOINT_TO_UTXO_ENTRY`, `SAT_TO_SATPOINT` | +~150 GB vs runes-only |
| **Inscription metadata** | Yes (no body bytes) | `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY`, etc. | Included in ~80 GB baseline |
| **Inscription payloads** | **No** | N/A | Served from chain at runtime |
| **Rune index** | Yes | `RUNE_ID_TO_RUNE_ENTRY`, etc. | ~80 GB baseline |
| **Transaction cache** | Optional | `TRANSACTION_ID_TO_TRANSACTION` | +~176 GB |

### 5.3 ordstuff Prebuilt Index Sizes

Source: [ordstuff.info/indexes](https://ordstuff.info/indexes/)

| Variant | Uncompressed `.redb` | Flags |
|---------|---------------------|-------|
| 0.27 `tx` | **359 GB** | runes + sats + addresses + transactions |
| 0.27 `without` | **85 GB** | runes only (+ inscriptions by default) |
| 0.25 `tx` | **407 GB** | all four index flags |
| 0.25 `with` | **231 GB** | sats + addresses + runes |

**Per-table sizes:** Run `ord index info` — returns bytes per redb table ([PR #2711](https://github.com/ordinals/ord/pull/2711)). Public benchmark dump = **UNKNOWN**.

---

## 6. Inscription Payload Dependency

### 6.1 Can sat indexing exist without storing inscription payloads?

**Yes — this is the default architecture.**

```rust
// index.rs — payload comes from chain tx, not redb
self.get_transaction(inscription_id.txid)?.and_then(|tx| {
  ParsedEnvelope::from_transaction(&tx)
    .into_iter()
    .nth(inscription_id.index as usize)
    .map(|envelope| envelope.payload)
})
```

Sat index + inscription metadata does **not** require local payload storage. Payload bytes remain in Bitcoin block files.

### 6.2 Can payload storage/serving be disabled?

| Question | Answer | Evidence |
|----------|--------|----------|
| Disable payload storage in ord? | **Already default** — ord does not store payloads | `index.rs` |
| Avoid duplicating payloads locally? | Omit `--index-transactions` | ordstuff size delta ~+176 GB |
| Disable inscription metadata? | `--no-index-inscriptions` | `options.rs` |
| Disable content serving? | **Partial:** `hidden:` config per inscription ID | [settings guide](https://docs.ordinals.com/guides/settings.html) |
| Prune payloads from ord? | **No dedicated prune flag** | Rebuild `index.redb` or omit tx cache |
| Prune payloads from Bitcoin? | **No** — ord needs archival blocks + txindex | Bitcoin pruning incompatible |

### 6.3 Marketplace Hypothesis Verification

**Hypothesis:** Only metadata is required for marketplace functionality.

**Verdict: CONFIRMED for sat-for-BTC trading.**

| Marketplace need | Requires payload storage? |
|------------------|--------------------------|
| List sat by number/name/rarity | No — ord sat index |
| Verify sat location (UTXO) | No — `OUTPOINT_TO_UTXO_ENTRY` |
| Show inscription thumbnail | Yes — but can proxy from any indexer or on-chain fetch |
| PSBT settlement | No — UTXO-level, not media |
| Collection membership (sat ranges) | No — computed from sat number |
| Display inscribed asset preview | Yes — application-layer concern, not protocol |

**Sat Asset Protocol should not mandate payload storage.** Applications may fetch content from ord, third-party indexers, or IPFS — out of protocol scope.

---

## 7. Web Server Assets & Caches

| Item | Location | Size | Notes |
|------|----------|------|-------|
| ord static assets | Bundled in binary | Negligible | CSS/JS/icons |
| Inscription content cache | **None by default** | 0 | Fetched per request |
| `--index-transactions` | `index.redb` | ~+176 GB | Optional tx cache |
| HTTP response cache | **None** | 0 | No built-in CDN |

---

## 8. Performance Estimates by Stack Tier

| Stack | Disk (mainnet) | RAM (typical) | Initial Sync | Incremental |
|-------|----------------|---------------|--------------|-------------|
| Bitcoin Core only | ~750–870 GB | 4–8 GB | Days (IBD) | Per block |
| Bitcoin + ord (runes) | ~830–950 GB | 8–16 GB | Days + hours | Seconds–minutes per block |
| Bitcoin + ord (all flags) | ~1.0–1.2 TB | 16–32 GB | Days + 12–48h ord | Minutes catch-up |
| + Sat Asset Protocol | +**UNKNOWN** | +**UNKNOWN** | **UNKNOWN** | Target: listings/offers only |

**Local testnet4 observation (2026-07-07):** ord 0.27.1 running at height 143,248 with all index flags; `initial sync time: 0s` (resumed from existing index). Full testnet4 datadir ~14 GB (order of magnitude; exact component split = **UNKNOWN** on this host).

**Sat Asset Protocol incremental cost hypothesis:** If the protocol stores only listings/offers/attestations (off-chain or lightweight on-chain), incremental storage should be **megabytes to low gigabytes** — not comparable to chain indexing. **Requires implementation to verify.**

---

## 9. Recommended Flag Matrix for Sat Asset Protocol

| Use Case | Bitcoin | ord Flags | Approx ord Size |
|----------|---------|-----------|-----------------|
| **Minimal sat marketplace indexer** | txindex=1 | `--index-sats` (no tx cache, no inscriptions) | ~150–230 GB |
| **Sat + inscription awareness** | txindex=1 | `--index-sats` + default inscriptions | ~215–231 GB |
| **Full explorer (avoid)** | txindex=1 | all flags | ~335–407 GB |

**Recommendation:** Run `--index-sats` without `--index-transactions`. Use Bitcoin Core RPC for occasional tx fetches. Disable inscription indexing if trading bare sats only.

---

## 10. Unknowns

1. Exact per-table GB breakdown on current mainnet — requires `ord index info` on live node.
2. Canonical origin of "2.5 TB" marketing number.
3. Sat Asset Protocol index size at scale (no implementation yet).
4. ordstuff `with` variant size for 0.27 — listed as unknown on site.

---

## 11. Citations

- [ordstuff index sizes](https://ordstuff.info/indexes/)
- [ord#1863 — early size report](https://github.com/ordinals/ord/issues/1863)
- [ord#4234 — index bloat](https://github.com/ordinals/ord/issues/4234)
- [ord reindexing guide](https://docs.ordinals.com/guides/reindexing.html)
- [ord inscriptions docs](https://docs.ordinals.com/inscriptions.html)
