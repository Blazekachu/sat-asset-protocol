# Table Reuse Matrix — Phase 4 Design Review

**Status:** ✅ Review complete — all 24 `index.redb` tables scored
**Session:** Ord Auditor, Phase 0b / Session 03
**Inputs:** [`01_database/`](../01_database/) (01–04) + [`02_pipeline/`](../02_pipeline/) (01–05)
**Target:** ord 0.27.1 @ commit `1ad3f64`, schema version 34
**Governing ADR:** [ADR-0002](../../docs/adr/0002-depend-on-ord-not-custom-indexer.md) — delegate to ord, no custom indexer v1

> Tag legend: ✅ Verified (from source, per `01_database/`/`02_pipeline/` citations) · 🟡 Inferred · 🔴 Design proposal (this review's judgment, not ord behavior)

---

## 1. Decision framework

Each table is scored on four questions, then given one concrete **Sat Asset v1 action**.

| Question | What it means here |
|----------|--------------------|
| **Keep?** | Does ord keep this table, unmodified, as its own internal implementation detail? (Always **Yes** — we never fork ord tables for v1, per ADR-0002.) |
| **Improve?** | Would Sat Asset Protocol propose an improvement to this table *if* it ever contributed upstream or forked ord? Default **N/A (v1)** — no fork exists. |
| **Replace?** | Does the protocol build its own table that substitutes for this one? Default **No** — ADR-0002 forbids a parallel sat indexer. Exception is scoped narrowly (see `NUMBER_TO_OFFER`). |
| **Generalize?** | Could this table's *concept* be lifted into a protocol-layer abstraction (e.g. predicate-based collections, attestations)? Answered per ADR-0008 where relevant, otherwise **No**. |
| **Sat Asset v1 action** | The operational instruction: `Query via ord API`, `Skip`, `Study only`, or `Not applicable`. |

**Global v1 stance (from [README.md](./README.md) defaults, confirmed by this review):**

| Question | Default for v1 |
|----------|-----------------|
| Keep it? | Yes — query ord, don't store |
| Improve it? | N/A v1 |
| Replace it? | No |
| Generalize it? | Only where ADR-0008 predicates apply (collections/attestations), and only at the protocol layer, never inside ord's tables |

---

## 2. Sat indexing tables (`--index-sats`) — 3 tables

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `OUTPOINT_TO_UTXO_ENTRY` | Yes | N/A v1 | **No** | No | **Query via ord** (`find`/`list`/`/output`/`/sat`) — this is the canonical sat-location table (`01_tables.md` L27); ADR-0002 §Compliance forbids a local `sat_ranges` table |
| `SAT_TO_SATPOINT` | Yes | N/A v1 | No | No | **Query via ord** — O(1) fast path for rare/non-common sats (`01_tables.md` L28, `04_relationships.md` §Query Paths) |
| `STATISTIC_TO_COUNT` | Yes | N/A v1 | No | No | **Not applicable** — internal ord bookkeeping (schema version, mode flags, counters); protocol never reads or writes this table directly. Useful only as an operational health signal (`index info`) when auditing an ord deployment. |

🔴 **Design proposal (flagged, not authorized):** treating `OUTPOINT_TO_UTXO_ENTRY` + `SAT_TO_SATPOINT` as a *generalizable* base for a protocol-native sat-history/event-log table was considered and **rejected for v1**. ord stores only current state — spent `OUTPOINT_TO_UTXO_ENTRY` rows are deleted (`04_relationships.md` §Insight: History vs Current State). Building an append-only history table would be a genuine "Replace/Generalize" move and **requires superseding ADR-0002** first, per [01_indexer_future.md](./01_indexer_future.md) Decision gate. No such supersession has occurred — action stands as "Query via ord" only.

---

## 3. Inscription indexing tables (default on) — 11 tables

Out of scope for bare-sat trading per ADR-0003 (metadata-only) and the mission boundary (sats, not inscriptions, are the primary asset). None of these are queried, stored, or replaced by Sat Asset Protocol v1.

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `SAT_TO_SEQUENCE_NUMBER` | Yes | N/A v1 | No | No | **Skip** — sat→inscription mapping not needed for bare-sat listings |
| `SEQUENCE_NUMBER_TO_SATPOINT` | Yes | N/A v1 | No | No | **Skip** — inscription location, not sat location |
| `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | Yes | N/A v1 | No | No | **Skip** — inscription metadata (no payload per `03_value_types.md` L41-47, still out of protocol scope) |
| `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` | Yes | N/A v1 | No | No | **Skip** |
| `INSCRIPTION_NUMBER_TO_SEQUENCE_NUMBER` | Yes | N/A v1 | No | No | **Skip** |
| `HEIGHT_TO_LAST_SEQUENCE_NUMBER` | Yes | N/A v1 | No | No | **Skip** — pagination cursor, internal to ord |
| `HOME_INSCRIPTIONS` | Yes | N/A v1 | No | No | **Skip** — explorer UI feature |
| `SEQUENCE_NUMBER_TO_CHILDREN` | Yes | N/A v1 | No | 🟡 Partial | **Skip for v1.** Conceptually this is ord's parent/child provenance graph. ADR-0008 generalizes *collections* to predicate-based views, but Rodarmor parent/child edges are inscription-specific and don't cover bare sats — protocol collections are built independently at the protocol layer, not by reading this table. |
| `LATEST_CHILD_SEQUENCE_NUMBER_TO_COLLECTION_SEQUENCE_NUMBER` | Yes | N/A v1 | No | 🟡 Partial | Same as above — **Skip**; informs, does not feed, ADR-0008 attestation design |
| `COLLECTION_SEQUENCE_NUMBER_TO_LATEST_CHILD_SEQUENCE_NUMBER` | Yes | N/A v1 | No | 🟡 Partial | Same — **Skip** |
| `GALLERY_SEQUENCE_NUMBERS` | Yes | N/A v1 | No | No | **Skip** — explorer gallery feature, no commerce relevance |

**Optional schema field only (per `01_tables.md` L51):** protocol listing schema may carry an `inscription_ids` *reference* field (string, opaque), but this is a display hint filled from ord's API response — never a foreign key into these tables, and never backed by a local copy.

---

## 4. Address indexing table (`--index-addresses`) — 1 table

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `SCRIPT_PUBKEY_TO_OUTPOINT` | Yes | N/A v1 | No | No | **Query via ord (optional)** — `/address`, `/outputs/{address}`. Useful for owner-display UX (e.g. "seller currently holds N sat-bearing UTXOs") but **not required** for core listing/verification logic, which operates on `outpoint` + `sat_number` directly. |

---

## 5. Rune indexing tables (`--index-runes`) — 5 tables

Orthogonal to Sat Asset Protocol's mission (sats, not fungible rune balances). No ADR currently scopes runes in or out explicitly beyond the general mission boundary (ADR-0004), but the audit confirms zero overlap with sat-listing logic.

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `OUTPOINT_TO_RUNE_BALANCES` | Yes | N/A v1 | No | No | **Not applicable** — rune trading out of scope v1 (`01_tables.md` L73) |
| `RUNE_ID_TO_RUNE_ENTRY` | Yes | N/A v1 | No | No | **Not applicable** |
| `RUNE_TO_RUNE_ID` | Yes | N/A v1 | No | No | **Not applicable** |
| `SEQUENCE_NUMBER_TO_RUNE_ID` | Yes | N/A v1 | No | No | **Not applicable** |
| `TRANSACTION_ID_TO_RUNE` | Yes | N/A v1 | No | No | **Not applicable** |

---

## 6. Block / chain metadata tables — 2 tables

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `HEIGHT_TO_BLOCK_HEADER` | Yes | N/A v1 | No | No | **Not applicable directly** — this is ord's sync/reorg cursor (`02_pipeline/01_startup.md` §2.6, `05_commit.md` §3). Protocol never reads it; ord's own reorg handling (`handle_reorg`, savepoint restore) already covers the consistency guarantee the protocol relies on when it queries `find`/`list`. |
| `WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP` | Yes | N/A v1 | No | No | **Not applicable** — internal diagnostic timing ledger (`02_pipeline/02_sync.md` §1.1), not consulted by indexing logic itself, irrelevant to protocol |

---

## 7. Transaction cache table (`--index-transactions`) — 1 table

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `TRANSACTION_ID_TO_TRANSACTION` | Yes | N/A v1 | No | No | **Skip — do not enable this flag on marketplace ord nodes.** Adds ~176 GB (`01_tables.md` L92, ADR-0003 rationale). Protocol never needs raw tx bytes; PSBT construction uses `find`/`list` outputs + wallet-supplied UTXO data. |

🔴 **ADR conflict flag:** enabling `--index-transactions` for convenience (e.g. to build a local fee-attribution or history feature) would directly contradict ADR-0003's storage rationale ("Omitting `--index-transactions` avoids ~176 GB duplicate tx/payload storage"). Any future proposal to enable it needs its own ADR, not a silent deployment-config change.

---

## 8. ord wallet offer table (in `index.redb`) — 1 table

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `NUMBER_TO_OFFER` | Yes | N/A v1 | **No — study only** | 🔴 See flag below | **Study as prior art; do not adopt as protocol listing store.** ord's own PSBT offer table (`insert_offer`, `index.rs:863`). Sequential `u64` key, raw serialized-PSBT value only — no `sat_number`, `price_sats`, `seller_address`, `expires_at`, or `asset_type` fields (`02_commerce_vs_ord_offers.md` comparison table). |

🔴 **ADR conflict flag (explicit):** it is tempting to "Replace" this table by simply pointing the protocol at ord's `NUMBER_TO_OFFER`, since it already stores PSBTs. **This would violate ADR-0004** (Sat Asset Protocol must standardize its own commerce schema — listings, offers, settlement PSBTs — not delegate commerce state to ord's wallet internals) **and ADR-0005** (v1 listings require sat-for-BTC–specific fields: price in sats, expiry, seller address, asset type — none of which `NUMBER_TO_OFFER` carries). Decision: protocol defines its own `Listing`/`Offer` schema (ADR-0004/0005, tracked in `Minimal Schema.md`), storing it in a **separate** database from `index.redb`. `NUMBER_TO_OFFER` remains interesting only as a candidate interop target if [ord#2706](https://github.com/ordinals/ord/issues/2706) standardizes an offer PSBT format — status **UNKNOWN**, no action pending that.

---

## 9. Summary — all 24 `index.redb` tables

| # | Table | Category | v1 action |
|---|-------|----------|-----------|
| 1 | `OUTPOINT_TO_UTXO_ENTRY` | Sat | Query via ord |
| 2 | `SAT_TO_SATPOINT` | Sat | Query via ord |
| 3 | `STATISTIC_TO_COUNT` | Sat | Not applicable |
| 4 | `SAT_TO_SEQUENCE_NUMBER` | Inscription | Skip |
| 5 | `SEQUENCE_NUMBER_TO_SATPOINT` | Inscription | Skip |
| 6 | `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | Inscription | Skip |
| 7 | `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` | Inscription | Skip |
| 8 | `INSCRIPTION_NUMBER_TO_SEQUENCE_NUMBER` | Inscription | Skip |
| 9 | `HEIGHT_TO_LAST_SEQUENCE_NUMBER` | Inscription | Skip |
| 10 | `HOME_INSCRIPTIONS` | Inscription | Skip |
| 11 | `SEQUENCE_NUMBER_TO_CHILDREN` | Inscription | Skip |
| 12 | `LATEST_CHILD_SEQUENCE_NUMBER_TO_COLLECTION_SEQUENCE_NUMBER` | Inscription | Skip |
| 13 | `COLLECTION_SEQUENCE_NUMBER_TO_LATEST_CHILD_SEQUENCE_NUMBER` | Inscription | Skip |
| 14 | `GALLERY_SEQUENCE_NUMBERS` | Inscription | Skip |
| 15 | `SCRIPT_PUBKEY_TO_OUTPOINT` | Address | Query via ord (optional) |
| 16 | `OUTPOINT_TO_RUNE_BALANCES` | Rune | Not applicable |
| 17 | `RUNE_ID_TO_RUNE_ENTRY` | Rune | Not applicable |
| 18 | `RUNE_TO_RUNE_ID` | Rune | Not applicable |
| 19 | `SEQUENCE_NUMBER_TO_RUNE_ID` | Rune | Not applicable |
| 20 | `TRANSACTION_ID_TO_RUNE` | Rune | Not applicable |
| 21 | `HEIGHT_TO_BLOCK_HEADER` | Block/chain | Not applicable directly |
| 22 | `WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP` | Block/chain | Not applicable |
| 23 | `TRANSACTION_ID_TO_TRANSACTION` | Tx cache | Skip — do not enable flag |
| 24 | `NUMBER_TO_OFFER` | Wallet offer | Study only, don't copy |

**Action tally:** Query via ord — 2 required + 1 optional · Skip — 11 · Not applicable (rune/internal) — 8 · Study only — 1. **Zero tables replaced or forked.** Zero tables improved (no ord fork exists for v1). Zero net-new indexer surface — fully consistent with ADR-0002.

---

## 10. Appendix — wallet database tables (out of the 24, informational only)

✅ Verified (`01_tables.md` L106-113): these live in a **separate** `wallet.rs` redb file, not `index.redb`, so they are not part of the 24-table count above.

| Table | Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action |
|-------|-------|----------|----------|--------------|----------------------|
| `RUNE_TO_ETCHING` | Yes | N/A v1 | No | No | **Not applicable** — wallet-local rune etching state, orthogonal to protocol |
| `STATISTICS` | Yes | N/A v1 | No | No | **Not applicable** — wallet-local statistics |

---

## 11. Explicit ADR alignment check

| ADR | Requirement | This review's compliance |
|-----|-------------|---------------------------|
| [ADR-0001](../../docs/adr/0001-reuse-ord-sat-numbering.md) | Use `sat_number` from Ordinal Theory; never reimplement FIFO/naming | ✅ No table decision proposes reimplementing sat numbering — `OUTPOINT_TO_UTXO_ENTRY`/`SAT_TO_SATPOINT` are queried, not forked |
| [ADR-0002](../../docs/adr/0002-depend-on-ord-not-custom-indexer.md) | No `sat_ranges` table in protocol schema; query ord for location | ✅ Confirmed for all 3 sat tables (§2); explicitly rejected the history-table temptation (§2 flag) |
| [ADR-0003](../../docs/adr/0003-metadata-only-not-payload-aware.md) | No `content`/`media_url`/blob columns; no `--index-transactions` reliance | ✅ All 11 inscription tables scored "Skip"; `TRANSACTION_ID_TO_TRANSACTION` explicitly flagged (§7) |
| [ADR-0004](../../docs/adr/0004-commerce-metaprotocol-not-ordinals-replacement.md) | Protocol standardizes its own commerce schema, doesn't delegate to ord wallet internals | ✅ `NUMBER_TO_OFFER` explicitly flagged as **study only, not reuse** (§8) |
| [ADR-0005](../../docs/adr/0005-v1-psbt-sat-for-btc-only.md) | v1 listings need price/seller/expiry/asset_type fields ord doesn't store | ✅ Gap documented in §8 comparison |
| [ADR-0008](../../docs/adr/0008-collection-predicates-and-attestations.md) | Collections are protocol-layer predicates, not borrowed from ord's child/parent graph | ✅ `SEQUENCE_NUMBER_TO_CHILDREN` + collection tables scored "Skip", generalization boundary noted (§3) |
| [ADR-0011](../../docs/adr/0011-ord-architectural-audit.md) | Phase 1 table inventory required before any indexer ADR supersedes ADR-0002; Phase 2 pipeline audit required before that too | ✅ Both phases complete and read as inputs to this review; no supersession proposed |

**No ADR conflicts found that require a new/superseding ADR.** Two "tempting but rejected" paths were identified and are recorded as explicit flags so a future session doesn't rediscover them from scratch:

1. Sat-history/event-log table from `OUTPOINT_TO_UTXO_ENTRY` + `SAT_TO_SATPOINT` (§2) — would require superseding ADR-0002.
2. Direct reuse of `NUMBER_TO_OFFER` as the protocol listing store (§8) — would violate ADR-0004/0005 as currently written.

---

## Cross-references

- Table inventory (source of the 24): [`01_database/01_tables.md`](../01_database/01_tables.md)
- Key/value encodings: [`01_database/02_key_types.md`](../01_database/02_key_types.md), [`01_database/03_value_types.md`](../01_database/03_value_types.md)
- Relationships / canonical vs secondary: [`01_database/04_relationships.md`](../01_database/04_relationships.md)
- Pipeline (write path, confirms nothing here is stale relative to commit/reorg behavior): [`02_pipeline/README.md`](../02_pipeline/README.md)
- Indexer-future decision gate: [`01_indexer_future.md`](./01_indexer_future.md)
- Commerce table comparison detail: [`02_commerce_vs_ord_offers.md`](./02_commerce_vs_ord_offers.md)

## Open follow-ups

- 🟡 None block Phase 0b completion. Deferred to later phases:
  - Phase 3 (`03_algorithms/`) items already logged in `02_pipeline/README.md` (SatRange encoding, charm bit layout, `UtxoEntryBuf::merged` semantics) don't change any decision in this matrix — they're implementation detail of tables already scored "Query via ord."
  - If/when [ord#2706](https://github.com/ordinals/ord/issues/2706) standardizes offer PSBTs, revisit §8 interop opportunity — no action until then.
