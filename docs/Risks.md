# Risks

**Status:** Research complete (2026-07-07)

---

## 1. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | **No cross-marketplace PSBT standard** — bump-UTXO schemes differ | High | High | Publish canonical template in PSBT Settlement.md; version PSBT spec |
| R2 | **Sat-for-sat not achievable via listing PSBTs** | Certain | Medium | Scope v1 to sat-for-BTC; v2 offer/accept |
| R3 | **Only ord has sat-control** — users may commingle sats | High | High | Document pre-isolation requirement; partner with Sating/Satonomy |
| R4 | **Fragmented satribute definitions** | High | Medium | Predicate namespaces + attestations; don't mandate Rodarmor-only |
| R5 | **Indexer disagreement** (ord vs ME vs UniSat) | Medium | High | Multi-node verification; pin ord version |
| R6 | **Large disk requirements** (~1 TB+ mainnet) | High | Medium | Recommend `--index-sats` without `--index-transactions` |
| R7 | **Index reorg / `unrecoverably_reorged`** | Low (mainnet) | High | Monitor status; auto-invalidate listings on reorg |
| R8 | **Leaked listing PSBTs** — perpetual sale risk | Medium | High | Recommend on-chain unlisting (Gamma model) or short TTL |
| R9 | **ord schema version bumps require full reindex** | Medium | Medium | Pin version; plan migration windows |
| R10 | **Wallet `sighashTypes` support inconsistent** | Medium | High | Test matrix across Xverse/UniSat/Leather; document failures |
| R11 | **ord project maintenance / governance** | Low | High | Depend on `crates/ordinals` library, not ord server alone |
| R12 | **Regulatory scrutiny of sat markets** | Medium | Unknown | Legal review outside technical scope |
| R13 | **Spam/brute-force listings** | Medium | Low | Rate limits; listing bonds (application layer) |
| R14 | **Stale listings after UTXO spend** | High | Medium | Verify UTXO unspent before fill; mempool monitoring |
| R15 | **0-bump post-trade offset** — buyer must split | Medium | Medium | Mandate 2-bump canonical template |
| R16 | **Mining pool collection claims unverifiable on-chain** | Certain | Low | Require attestation layer; mark as non-consensus |
| R17 | **Pathological index.redb bloat** | Low | High | Use default `--commit-interval`; monitor with `ord index info` |
| R18 | **Competing protocols** (OP_NET, 1Sat on BSV) | Medium | Low | Clear boundary: L1 Bitcoin + Ordinal Theory only |

---

## 2. Technical Risks (Detail)

### R1 — PSBT Fragmentation

**Evidence:** [ord#2706](https://github.com/ordinals/ord/issues/2706) documents 0/1/2/3-bump schemes across venues.

**Impact:** A listing PSBT from marketplace A cannot be filled using marketplace B's buyer template.

**Mitigation:** Sat Asset Protocol v1 mandates 2-bump canonical template. Marketplaces adopt incrementally.

### R2 — Sat-for-Sat Limitation

**Evidence:** `@utxo-detective` in ord#2706: `SIGHASH_SINGLE` commits to amount, not ordinal.

**Impact:** Protocol cannot deliver sat-for-sat as v1 core feature.

**Mitigation:** Honest scoping. v2 explores offer/accept or HTLC.

### R3 — Wallet Sat-Control Gap

**Evidence:** [Collecting guide](https://docs.ordinals.com/guides/collecting.html): "ord is the only wallet supporting sat-control."

**Impact:** Users list mixed UTXOs; rare sat not at offset 0; buyer receives wrong asset.

**Mitigation:** Protocol validation rejects listings where target sat is not at offset 0.

### R5 — Indexer Disagreement

**Evidence:** [ord#2815](https://github.com/ordinals/ord/issues/2815) — Black Sats not in ord.

**Impact:** Collection membership differs between indexers.

**Mitigation:** Separate Rodarmor predicates (verifiable) from attested predicates (explicit issuer).

---

## 3. Operational Risks

| Risk | Detail |
|------|--------|
| **Sync time** | Full mainnet ord index: hours to days |
| **RPC dependency** | ord requires healthy bitcoind with txindex |
| **Single point of failure** | One ord node down → verification degraded |
| **Key management** | Marketplace never custodies; user error in PSBT signing |

---

## 4. Security Risks

| Risk | Description | Severity |
|------|-------------|----------|
| **PSBT tampering** | Buyer modifies seller outputs | Mitigated by `SIGHASH_SINGLE` on seller input |
| **Signature replay** | Leaked listing PSBT reused | Mitigated by on-chain unlisting or UTXO spend |
| **Fake attestations** | Forged institution claims | Mitigated by signature verification against known pubkeys |
| **Indexer poisoning** | Malicious ord node returns wrong satpoint | Mitigated by multi-node consensus (§4.5 Verification Model) |
| **Dust attacks** | Spam listings | Rate limiting at application layer |

---

## 5. Project Risks

| Risk | Description |
|------|-------------|
| **Scope creep** | Building another rare-sat marketplace instead of protocol |
| **Premature implementation** | Coding before PSBT spec is agreed |
| **Adoption chicken-and-egg** | Marketplaces won't adopt without users; users won't come without marketplaces |
| **ord version drift** | New ord release changes schema → reindex |

---

## 6. Risk Acceptance

| Risk | Accepted? | Rationale |
|------|-----------|-----------|
| R2 (no sat-for-sat v1) | **Yes** | Honest protocol scoping |
| R6 (disk size) | **Yes** | Inherent to sat indexing; optimizable |
| R12 (regulatory) | **Deferred** | Non-technical |
| R16 (unverifiable pool claims) | **Yes** | Attestation layer makes uncertainty explicit |

---

## 7. Citations

- [ord#2706](https://github.com/ordinals/ord/issues/2706)
- [ord#2815](https://github.com/ordinals/ord/issues/2815)
- [ord#4234](https://github.com/ordinals/ord/issues/4234)
- [Gamma unlisting security](https://support.gamma.io/hc/en-us/articles/15065621705875)
- [Storage Analysis.md](./Storage%20Analysis.md)
