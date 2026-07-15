# Sat Asset Protocol — Research Index

**Status:** Research phase complete · ADRs accepted · Ready for Phase 1 spec (2026-07-07)  
**Location:** `F:\Users\akhil\Main\sat-asset-protocol\`

---

## Verdict

An open, wallet-agnostic commerce metaprotocol for trading Bitcoin satoshis **is feasible** by reusing Ordinal Theory via `ord` / `crates/ordinals`, standardizing listing/offer PSBTs for sat-for-BTC, and remaining independent of inscription payload storage.

**Sat-for-sat atomic barter is not feasible in v1** using the industry-standard `SIGHASH_SINGLE | ANYONECANPAY` listing model.

---

## Success Criteria Scorecard

| Criterion | Result | Document |
|-----------|--------|----------|
| Reuse Ordinal Theory | **Pass** | Ord Architecture.md |
| Minimal wallet modifications | **Pass** (v1 sat-for-BTC) | Wallet Compatibility.md |
| Incremental marketplace adoption | **Pass** | Marketplace Analysis.md |
| Trade by arbitrary identity | **Pass** (predicates + attestations) | Minimal Schema.md |
| Independent verification | **Pass** | Verification Model.md |
| Independent of inscription payloads | **Pass** | Storage Analysis.md |

---

## Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Ord Architecture.md](./Ord%20Architecture.md) | How ord indexes sats, stores ranges, computes names/rarity |
| 2 | [Storage Analysis.md](./Storage%20Analysis.md) | Disk breakdown; payload independence |
| 3 | [Wallet Compatibility.md](./Wallet%20Compatibility.md) | Wallet capability matrix; gaps |
| 4 | [Marketplace Analysis.md](./Marketplace%20Analysis.md) | ME, UniSat, Magisat, etc. |
| 5 | [PSBT Settlement.md](./PSBT%20Settlement.md) | Canonical settlement flows |
| 6 | [Verification Model.md](./Verification%20Model.md) | Determinism + cross-node verification |
| 7 | [Protocol Boundary.md](./Protocol%20Boundary.md) | Bitcoin / ord / protocol / apps |
| 8 | [Minimal Schema.md](./Minimal%20Schema.md) | v1 data model |
| 9 | [API Specification.md](./API%20Specification.md) | ord APIs + proposed protocol API |
| 10 | [Risks.md](./Risks.md) | Risk register |
| 11 | [Open Questions.md](./Open%20Questions.md) | Unresolved items |
| 12 | [Indexer Landscape.md](./Indexer%20Landscape.md) | Ordinals vs BRC-20; OPI lessons |

### Architecture Decision Records

| Index | Path |
|-------|------|
| ADR index | [adr/README.md](./adr/README.md) |
| ADR-0001 … 0011 | [adr/](./adr/) |

### Ord Reverse Engineering

| Doc | Path |
|-----|------|
| Overview | [../ORD_REVERSE_ENGINEERING/00_overview.md](../ORD_REVERSE_ENGINEERING/00_overview.md) |
| **Table inventory (Phase 1)** | [../ORD_REVERSE_ENGINEERING/01_database/01_tables.md](../ORD_REVERSE_ENGINEERING/01_database/01_tables.md) |
| Licensing (CC0 not GPL) | [ORD_LICENSING_AND_ETHICS.md](./ORD_LICENSING_AND_ETHICS.md) |
| Tagging discipline | [../REVERSE_ENGINEERING.md](../REVERSE_ENGINEERING.md) |

---

## Indexer Landscape Note

Supplement from [ChatGPT share — Ordinals vs BRC-20 Indexer](https://chatgpt.com/share/6a4cd52a-831c-83ee-a2fa-237aa1c909c2) plus follow-up paste (architectural audit methodology, *Sat Aware* naming). [Indexer Landscape.md](./Indexer%20Landscape.md) synthesizes public OPI/UniSat sources. **Licensing correction:** ord is CC0-1.0, not GPL-3.0 — see [ORD_LICENSING_AND_ETHICS.md](./ORD_LICENSING_AND_ETHICS.md).

---

## Local Experiments

| Experiment | Date | Result |
|------------|------|--------|
| testnet4 ord `/sat/0` JSON API | 2026-07-07 | number=0, name=nvtdijuwxlp, rarity=mythic |
| testnet4 ord name round-trip | 2026-07-07 | `/sat/nvtdijuwxlp` → number=0 |
| testnet4 ord status | 2026-07-07 | sat_index=true, all flags on, v0.27.1 |

---

## Recommended Next Steps (Phase 1 — see ROADMAP.md)

1. Prototype canonical 2-bump PSBT on testnet4 (validate Q11 in Open Questions.md).
2. Run `ord index info` on mainnet for per-table storage numbers.
3. Publish protocol spec as draft BIP-style document; must align with accepted ADRs.
4. Wallet sighash matrix before reference implementation.
5. New major choices → new ADR before code merges.
