# Indexer Landscape — Ordinals vs BRC-20 and Lessons for Sat Asset Protocol

**Status:** Research synthesis (2026-07-07)  
**Source note:** Intended supplement from [ChatGPT share — Ordinals vs BRC-20 Indexer](https://chatgpt.com/share/6a4cd52a-831c-83ee-a2fa-237aa1c909c2). That URL returns only the page shell (login-gated); this document synthesizes the same topic from ord docs, OPI/BRC-20 public sources, and our research phase.

---

## 1. The Core Distinction

| Layer | What It Is | Consensus? | Reference Implementation |
|-------|------------|------------|--------------------------|
| **Bitcoin** | UTXOs, scripts, blocks | Yes | Bitcoin Core |
| **Ordinals** | Sat numbering + inscription envelopes on witness data | No (social/consensus on index) | `ord` + `crates/ordinals` |
| **BRC-20** | Token balances interpreted from JSON inscriptions | No | OPI / Best in Slot modules |
| **Runes** | Token balances in OP_RETURN / UTXO | No (index for rich queries) | `ord --index-runes` |
| **Sat Asset Protocol** | Commerce: listings, offers, collections | No | *This project* |

**Key insight:** BRC-20 is **not an alternative to ord**. It is a **meta-protocol** that interprets inscription content ord already indexes. Two BRC-20 indexers can disagree; there is no on-chain arbitration ([Spark](https://www.spark.money/research/bitcoin-ordinals-brc20-evolution), [thirdweb Runes guide](https://blog.thirdweb.com/bitcoin-runes-surge-to-2-year-high-what-developers-need-to-know-about-building-on-bitcoins-token-layer/)).

Sat Asset Protocol must avoid becoming "another BRC-20 indexer problem" — it should **not reinterpret chain data**. It should **standardize commerce** on top of ord's sat index.

---

## 2. What ord Indexes vs What It Does Not

### ord owns (base layer for Ordinal Theory)

- FIFO sat assignment and sat ranges per UTXO (`--index-sats`)
- Inscription envelope detection and metadata (`--index-inscriptions`)
- Inscription location (`txid:vout:offset`)
- Rune etchings and balances (`--index-runes`)
- Deterministic sat math: number, name, rarity, degree, charms

### ord does NOT own

- BRC-20 `deploy` / `mint` / `transfer` balance state
- BRC-20 swap pool state
- Marketplace listings or PSBTs
- Black Sats / custom satribute taxonomies
- Token price or order books

**Citation:** ord indexes inscriptions; BRC-20 rules live in [Layer 1 Foundation indexing spec](https://layer1.gitbook.io/layer1-foundation/protocols/brc-20/indexing) implemented by modules.

---

## 3. BRC-20 Indexer Architecture (OPI Pattern)

The [Open Protocol Indexer (OPI)](https://github.com/brc20-devs/brc20-swap-indexer) demonstrates the mature pattern:

```
ord fork (base inscription index)
        │
        ▼
Meta-protocol indexer (all json/text inscriptions + first N transfers)
        │
        ├── BRC-20 module
        ├── Bitmap module
        ├── SNS module
        └── BRC-20 Swap module
```

**Design choices in OPI:**

| Choice | Rationale |
|--------|-----------|
| Fork ord 0.14+ with minimal changes | Stay compatible with base Ordinal rules |
| Modular meta-protocols | Add BRC-20 without forking again |
| Limit transfer indexing depth (`INDEX_TX_LIMIT`) | Prevent DB flood from high-transfer UTXOs |
| Cumulative balance hashes | Detect indexer divergence |

**UniSat's 2024 decision:** Stop standalone UniSat indexer; co-develop BRC-20 reference on Best in Slot's modified ord ([Medium update](https://unisat-wallet.medium.com/2024-01-unisat-development-progress-update-73cc543ee170)).

**Lesson for Sat Asset Protocol:** When the ecosystem converged, it converged on **extending ord**, not replacing it.

---

## 4. Ordinals Indexer vs BRC-20 Indexer — Comparison

| Dimension | Ordinals (`ord`) | BRC-20 (OPI module) |
|-----------|------------------|---------------------|
| **Input data** | Raw blocks + witness | Parsed JSON text inscriptions |
| **State model** | Sat ranges, inscription locations | Off-chain token balances |
| **Determinism** | High (specified FIFO + math) | High *if* same rule version |
| **Dispute resolution** | Reindex from genesis | Compare cumulative hashes; no chain arbitration |
| **Disk cost** | 80–400+ GB (flags) | Additional module DB on top of ord |
| **Wallet coupling** | `ord wallet` (sat-control) | UniSat, OKX, etc. (token display) |
| **Commerce** | None native | Marketplace APIs separate |

---

## 5. Runes Contrast (Brief)

Runes embed messages in OP_RETURN; balances attach to UTXOs more natively than BRC-20 ([thirdweb guide](https://blog.thirdweb.com/bitcoin-runes-surge-to-2-year-high-what-developers-need-to-know-about-building-on-bitcoins-token-layer/)). `ord --index-runes` indexes them.

**Sat Asset Protocol relationship to Runes:** Orthogonal. Runes are fungible token balances; our asset is the sat itself. A UTXO may hold both a rare sat and rune balances — listing rules must not conflate them (future ADR if needed).

---

## 6. Hiro Deprecation and API Consolidation

Hiro deprecated its Ordinals API (March 2026 per [Spark](https://www.spark.money/research/bitcoin-ordinals-brc20-evolution)); migration to Xverse Ordinals API recommended. Commercial providers (QuickNode) and OPI remain.

**Lesson:** Depend on **self-hostable** truth (`ord`) plus **standard schemas**, not a single SaaS indexer.

---

## 7. Mapping to Sat Asset Protocol

| BRC-20 lesson | Sat Asset Protocol response | ADR |
|---------------|----------------------------|-----|
| Don't fork base indexing | Delegate to `ord --index-sats` | ADR-0002 |
| Meta-protocol is interpretive layer | Commerce only; no FIFO reimplementation | ADR-0004 |
| Indexer disagreement is real | Multi-node ord verification | ADR-0009 |
| Modular extensions | Collection predicates + attestations | ADR-0008 |
| Don't store what chain has | Metadata-only; no payloads | ADR-0003 |
| Reference implementation matters | Pin `crates/ordinals` version | ADR-0001 |

---

## 8. What Sat Asset Protocol Is NOT

- **Not a BRC-20 indexer** — no `deploy`/`mint`/`transfer` parsing
- **Not an inscription content indexer** — ord serves that
- **Not a replacement for UniSat/Open API** — complementary open listing schema
- **Not a Runes indexer** — ord handles runes

---

## 9. Open Questions (from this landscape)

| # | Question | Status |
|---|----------|--------|
| IL1 | Should protocol integrate OPI-style cumulative hash for listing DB integrity? | Open |
| IL2 | Relationship to `prefix-satnames-tracker` (existing workspace project)? | Open |
| IL3 | QuickNode/Xverse API as optional read replica vs ord-only? | Open |

---

## 10. Citations

- [ChatGPT share (title: Ordinals vs BRC-20 Indexer)](https://chatgpt.com/share/6a4cd52a-831c-83ee-a2fa-237aa1c909c2) — inaccessible content; topic used as outline
- https://github.com/brc20-devs/brc20-swap-indexer
- https://unisat-wallet.medium.com/2024-01-unisat-development-progress-update-73cc543ee170
- https://www.spark.money/research/bitcoin-ordinals-brc20-evolution
- https://blog.thirdweb.com/bitcoin-runes-surge-to-2-year-high-what-developers-need-to-know-about-building-on-bitcoins-token-layer/
- [Ord Architecture.md](./Ord%20Architecture.md)
- [Protocol Boundary.md](./Protocol%20Boundary.md)
