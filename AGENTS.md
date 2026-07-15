# AGENTS.md — Bitcoin Sat Asset Protocol (Research First)

## Mission

Determine whether an open, wallet-agnostic, marketplace protocol can be built for trading arbitrary Bitcoin satoshis (sat-for-sat or sat-for-BTC), while reusing as much of Ordinal Theory as possible and avoiding unnecessary dependence on inscription payload storage.

The objective is **not** to replace Ordinals.

The objective is to build a **commerce metaprotocol** on top of deterministic sat indexing.

---

# Guiding Principles

1. Research before implementation.
2. Never duplicate functionality that already exists in Ord or Bitcoin Core.
3. Prefer open standards over custom implementations.
4. Every conclusion must be reproducible.
5. Every architectural decision must cite evidence.
6. If an assumption cannot be verified, mark it UNKNOWN.

---

# Core Questions

Research must answer the following before any code is written.

## A. Ord Architecture

Determine precisely:

* How Ord indexes sats.
* How sat numbering is stored.
* How sat names are generated.
* How rarity is computed.
* How ranges are represented.
* How sat location is tracked across UTXOs.
* How inscriptions are linked to sats.

Deliverable: `docs/Ord Architecture.md`

## B. Storage Analysis

Deliverable: `docs/Storage Analysis.md`

## C. Minimal Dataset

Deliverable: `docs/Minimal Schema.md`

## D. Existing APIs

Deliverable: `docs/API Specification.md`

## E. Wallet Compatibility

Deliverable: `docs/Wallet Compatibility.md`

## F. Marketplace Compatibility

Deliverable: `docs/Marketplace Analysis.md`

## G. Verification

Deliverable: `docs/Verification Model.md`

## H. Protocol Boundary

Deliverable: `docs/Protocol Boundary.md`

---

# Deliverables

## Research (`docs/`)

1. Ord Architecture.md
2. Storage Analysis.md
3. Wallet Compatibility.md
4. Marketplace Analysis.md
5. PSBT Settlement.md
6. Verification Model.md
7. Protocol Boundary.md
8. Minimal Schema.md
9. API Specification.md
10. Risks.md
11. Open Questions.md
12. Indexer Landscape.md — Ordinals vs BRC-20 indexer lessons

## Architecture Decision Records (`docs/adr/`)

**After research, before implementation:** every major design choice requires an ADR.

| ADR | Decision |
|-----|----------|
| 0001 | Reuse Ord sat numbering |
| 0002 | Depend on ord, not custom sat indexer |
| 0003 | Metadata-only, not payload-aware |
| 0004 | Commerce metaprotocol, not Ordinals replacement |
| 0005 | v1 PSBT: sat-for-BTC only |
| 0006 | Canonical 2-bump PSBT template |
| 0007 | UTXO listing with offset-0 precondition |
| 0008 | Collection predicates + attestations |
| 0009 | Multi-node ord verification |
| 0010 | Sat-for-sat deferred to v2 |
| 0011 | Ord architectural audit before custom indexer |

Process: [docs/adr/README.md](docs/adr/README.md) · Template: [docs/adr/0000-template.md](docs/adr/0000-template.md)

## Reverse Engineering (`ORD_REVERSE_ENGINEERING/`)

Architectural audit of ord 0.27.1 — **not** a code fork. Discipline: [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md).

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 1 Database | ✅ Started | [01_database/01_tables.md](ORD_REVERSE_ENGINEERING/01_database/01_tables.md) |
| 2 Pipeline | 🟡 Stub | [02_pipeline/](ORD_REVERSE_ENGINEERING/02_pipeline/) |
| 3 Algorithms | Pending | `03_algorithms/` |
| 4 Design review | Pending | `05_sat_asset_notes/` |
| 5 Protocol schema | After audit | ADRs + Minimal Schema |

Pinned source: `vendor/ord` @ commit `1ad3f64` (clone per [00_overview.md](ORD_REVERSE_ENGINEERING/00_overview.md)).

New major choices → new ADR before code merges. Never delete ADRs; supersede with links.

---

# Project Entry Points

| File | Purpose |
|------|---------|
| [README.md](README.md) | Human orientation |
| [ROADMAP.md](ROADMAP.md) | Phases and gates |
| [CONTRIBUTING.md](CONTRIBUTING.md) | ADR process, evidence standards |
| [AGENT_LINEUP.md](AGENT_LINEUP.md) | Which agent role per phase; chat templates |
| **[sessions/README.md](sessions/README.md)** | **Open these — one file per Cursor chat** |
| **[CURSOR_AGENTS.md](CURSOR_AGENTS.md)** | **Which Cursor mode + subagent per phase** |

---

# Rules for Every Agent

* Research phase is **complete** (2026-07-07). Implementation follows [ROADMAP.md](ROADMAP.md) gates.
* **Write an ADR** for every major design choice before implementing it.
* Cite every technical claim to upstream documentation, source code, or reproducible experiments.
* Prefer measuring over assuming.
* Record uncertainties explicitly.
* When possible, validate conclusions by running an independent local experiment.
* If an architectural assumption is disproven, update the design and supersede the relevant ADR.
