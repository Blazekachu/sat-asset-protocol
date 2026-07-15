# Ord Reverse Engineering — Overview

**Target:** `ord` **0.27.1** (commit `1ad3f64dbc05b75e98665f411dbaa415f586e1c0` — matches local testnet4 node)  
**Schema version:** `34` (`SCHEMA_VERSION` in `src/index.rs:56`)  
**Database:** [redb](https://docs.rs/redb) file `index.redb`

---

## Purpose

This is an **architectural audit** of `ord`, not a code clone. We study the implementation to make informed design decisions for **Sat Asset Protocol** (working name in prior discussions: *Sat Aware*).

**Discipline:** Every claim is tagged in [REVERSE_ENGINEERING.md](../REVERSE_ENGINEERING.md):

| Tag | Meaning |
|-----|---------|
| ✅ Verified from source | File + line in `vendor/ord` |
| 🟡 Inferred from code structure | Logical conclusion; needs line-level follow-up |
| 🔴 Design proposal | Our idea — not ord behavior |

---

## Relationship to ADRs

| Layer | Decision | ADR |
|-------|----------|-----|
| **v1 protocol** | Delegate to ord; no custom sat indexer | [ADR-0002](../docs/adr/0002-depend-on-ord-not-custom-indexer.md) |
| **Audit** | Understand ord before any future indexer work | [ADR-0011](../docs/adr/0011-ord-architectural-audit.md) |

Reverse engineering **does not** override ADR-0002 for v1. It informs Phase 4+ decisions.

---

## Local Checkout

```powershell
git clone --depth 1 --branch 0.27.1 https://github.com/ordinals/ord.git vendor/ord
# Resolves to commit 1ad3f64... (detached HEAD)
```

Verify:

```powershell
cd vendor/ord
rg "define_table!|define_multimap_table!" src/
```

---

## Document Map

```
ORD_REVERSE_ENGINEERING/
├── 00_overview.md          ← you are here
├── 01_database/
│   ├── 01_tables.md        ✅ Phase 1 deliverable — full table inventory
│   ├── 02_key_types.md
│   ├── 03_value_types.md
│   └── 04_relationships.md
├── 02_pipeline/            🟡 Phase 2 (in progress)
├── 03_algorithms/          🟡 Phase 3
├── 04_performance/         Pending
└── 05_sat_asset_notes/     🔴 Design proposals for this project
```

---

## Core Architectural Insight (✅ Verified)

Almost every sat-location lookup flows through:

```
OutPoint → OUTPOINT_TO_UTXO_ENTRY → UtxoEntry (sat ranges + optional inscriptions)
```

Rare sats add a secondary index:

```
Sat (u64) → SAT_TO_SATPOINT → SatPoint (outpoint + offset)
```

**🔴 Design proposal:** If Sat Asset Protocol ever stores **sat history** (not only current ranges), storage would look fundamentally different from ord's UTXO-centric model. v1 does not do this (ADR-0002).

---

## ord vs Sat Asset Protocol (from design discussions)

| | ord | Sat Asset Protocol |
|---|-----|-------------------|
| Primary focus | Ordinals explorer + wallet | Sat-centric commerce layer |
| First-class entity | Inscriptions | Satoshis (`sat_number`) |
| Indexing | Full chain index | Delegates to ord |
| Commerce | `NUMBER_TO_OFFER` (wallet offers) | Listings, offers, collections (protocol API) |
| Payloads | Serves from chain | Metadata-only (ADR-0003) |

---

## Licensing

See [docs/ORD_LICENSING_AND_ETHICS.md](../docs/ORD_LICENSING_AND_ETHICS.md).

**✅ Verified:** `ord` 0.27.1 workspace license is **CC0-1.0** (`Cargo.toml:26`), not GPL-3.0.

---

## Next Steps

1. Complete [02_pipeline/](./02_pipeline/) — block → commit trace
2. Map each table's writer/reader paths in detail
3. Record Sat Asset reuse decisions in [05_sat_asset_notes/](./05_sat_asset_notes/)
