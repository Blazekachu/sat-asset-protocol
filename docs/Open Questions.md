# Open Questions

**Status:** Research complete (2026-07-07) — items marked **UNKNOWN** require further investigation or implementation validation

---

## 1. Architecture & Indexing

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q1 | What is the canonical origin of the "~2.5 TB" figure? | **UNKNOWN** | Survey operator docs; no ord source found |
| Q2 | Exact per-table GB breakdown for current mainnet `index.redb`? | **UNKNOWN** | Run `ord index info` on synced mainnet node |
| Q3 | Do third-party indexers (ME, UniSat, SimpleHash) agree with ord on satpoint for all UTXOs? | **UNKNOWN** | Cross-query experiment on same UTXO sample |
| Q4 | What is Sat Asset Protocol incremental storage at 1M listings? | **UNKNOWN** | Implement and benchmark |
| Q5 | Can `--index-sats` without `--index-inscriptions` serve all bare-sat marketplace needs? | **Likely yes** | Confirm no marketplace requires inscription index for bare sats |
| Q6 | Optimal ord deployment: self-hosted vs ordstuff snapshot vs light client? | **Open** | Cost/latency tradeoff analysis |

---

## 2. PSBT & Settlement

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q7 | Will ord#2706 ever produce a merged `offers.md` spec? | **UNKNOWN** | Monitor ord repo; protocol may need to lead |
| Q8 | Optimal bump UTXO size at varying fee rates? | **Resolved — ADR-0015** | Canonical bump 600 sats (configurable); ADR-0006 preserved |
| Q9 | Minimum postage for bare sats (non-inscription)? | **Resolved — ADR-0015** | Bare-sat 546, inscribed 330 (both configurable) |
| Q10 | Do all Sats Connect wallets honor per-input `sighashTypes`? | **No (current RPC)** | See [Wallet Sighash Matrix.md](./Wallet%20Sighash%20Matrix.md); empirical Tested? still UNKNOWN |
| Q11 | Can sat-for-sat work via offer/accept without wallet changes? | **Theoretically yes** | Prototype PSBT on testnet4 |
| Q12 | Should protocol support 0-bump for compatibility or mandate 2-bump? | **Open** | Stakeholder input from marketplaces |
| Q13 | On-chain listing invalidation: mandate or optional? | **Open** | Gamma vs ME tradeoff (cost vs security) |

---

## 3. Wallets & UX

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q14 | Will wallet vendors adopt a unified protocol PSBT extension? | **UNKNOWN** | Outreach to Xverse, UniSat teams |
| Q15 | Hardware wallet PSBT signing for rare-sat trades? | **Partial** | Test Ledger + Xverse flow |
| Q16 | Can Satonomy/Sating expose pre-isolation as a protocol precondition API? | **Open** | Integration discussion |
| Q17 | Should protocol provide a reference `ord wallet` wrapper for sellers? | **Open** | UX vs dependency concern |

---

## 4. Collections & Identity

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q18 | How to handle Black Sats / non-Rodarmor satributes? | **Open** | Attestation namespace per taxonomy owner |
| Q19 | Mining pool collection verification — any on-chain signal? | **UNKNOWN** | Research coinbase metadata indexing projects |
| Q20 | User-defined collection predicate sandbox — what expression language? | **UNKNOWN** | WASM? JSON predicates? SQL? |
| Q21 | Can block-range collections be listed as a single trade unit? | **No** (today) | Requires range-in-UTXO or fractional ownership — research |
| Q22 | Relationship to `prefix-satnames-tracker` (existing project)? | **Open** | Integrate as collection predicate provider |

---

## 5. Marketplace Adoption

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q23 | Will Magic Eden expose rare-sat bid PSBT schema? | **UNKNOWN** | API exploration |
| Q24 | Magisat / Sating public developer APIs? | **UNKNOWN** | Contact or reverse-engineer |
| Q25 | Minimum viable marketplace integration (read-only vs full listing port)? | **Open** | Define Phase 1 adoption spec |
| Q26 | Cross-marketplace listing portability — legal/technical barriers? | **UNKNOWN** | Marketplace stakeholder input |

---

## 6. Verification & Determinism

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q27 | Behavior of `unrecoverably_reorged` on mainnet at depth? | **UNKNOWN** | Monitor; test on testnet4 reorg |
| Q28 | Formal conformance test suite for non-ord implementations? | **Does not exist** | Publish test vectors from `crates/ordinals` |
| Q29 | How many independent ord nodes for Byzantine tolerance? | **Open** | 2 for detect; 3 for quorum? |
| Q30 | Should protocol run its own indexer or always delegate to ord? | **Open** | Lean toward delegate; light index for listings only |

---

## 7. Performance

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q31 | Sat Asset Protocol API latency budget? | **UNKNOWN** | Benchmark after implementation |
| Q32 | Incremental sync cost per block with protocol layer? | **UNKNOWN** | Should be O(listings), not O(chain) |
| Q33 | RAM requirements for `--index-sats` on mainnet? | **Partial** | Community reports 16–32 GB; measure locally |
| Q34 | testnet4 component disk split (blocks vs ord vs chainstate)? | **UNKNOWN** | `du` on F: datadir (path resolution failed in session) |

---

## 8. Legal & Governance

| # | Question | Status | Next Step |
|---|----------|--------|-----------|
| Q35 | Regulatory classification of sat markets? | **UNKNOWN** | Legal counsel |
| Q36 | Protocol governance model (BIP-style? foundation?) | **Open** | Community decision |
| Q37 | Licensing for protocol spec (CC0? MIT?) | **Open** | Owner decision |

---

## 9. Resolved Questions (from Research)

| Question | Answer | Evidence |
|----------|--------|----------|
| Can sat indexing exist without inscription payloads? | **Yes** | Storage Analysis.md |
| Are sat numbers/names/rarity deterministic? | **Yes** | Verification Model.md + testnet4 experiment |
| Does ord use RocksDB? | **No — redb** | ord docs |
| Is ~2.5 TB an ord specification? | **No** | Storage Analysis.md |
| Can sat-for-BTC use standard PSBT? | **Yes** | PSBT Settlement.md |
| Can sat-for-sat use listing PSBT? | **No** | ord#2706 |
| Must wallets be modified for v1? | **No** (signPsbt sufficient) | Wallet Compatibility.md |
| Does protocol require consensus changes? | **No** | Protocol Boundary.md |
| Do all Sats Connect wallets honor per-input `sighashTypes`? (Q10) | **No** — current `signPsbt` has no per-input sighash; legacy `sigHash: 131` works; UniSat/OKX native APIs do | Wallet Sighash Matrix.md |

---

## 10. Recommended Priority Order

1. **Q11** — Prototype offer/accept PSBT on testnet4 (validates v2 path)
2. **Q10** — ~~Wallet sighash compatibility matrix~~ **resolved (docs)** — remaining: empirical UniSat + Xverse testnet4 listing sign (Risks R10)
3. **Q2** — `ord index info` on mainnet (storage planning)
4. **Q3** — Cross-indexer satpoint agreement (verification trust)
5. **Q7** — PSBT spec leadership decision (wait for ord or publish independently)

---

## 11. Citations

- All research documents in `docs/`
- [ord#2706](https://github.com/ordinals/ord/issues/2706)
- [ord#2815](https://github.com/ordinals/ord/issues/2815)
