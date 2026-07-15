# Roadmap

## Phase 0 — Research ✅ (2026-07-07)

- [x] Ord architecture study
- [x] Storage analysis
- [x] Wallet / marketplace / PSBT research
- [x] Verification model
- [x] Protocol boundary
- [x] Minimal schema v1
- [x] API specification (draft)
- [x] Risks and open questions
- [x] ADRs for major decisions (0001–0010)
- [x] Indexer landscape (Ordinals vs BRC-20)

---

## Phase 0 — Research ✅ (2026-07-07)

- [x] 11 research documents + ADRs 0001–0010
- [x] Indexer landscape (Ordinals vs BRC-20)
- [x] Ord architectural audit **Phase 1** — verified table inventory
- [x] ADR-0011 — audit methodology
- [x] Licensing doc (CC0-1.0 correction)

---

## Phase 0b — Ord Reverse Engineering (In Progress)

- [x] Pin ord 0.27.1 (`vendor/ord` @ `1ad3f64`)
- [x] Full `define_table!` / `define_multimap_table!` inventory
- [x] Key types, value types, relationship graph
- [ ] Phase 2: block → commit pipeline trace (`02_pipeline/`)
- [ ] Phase 3: query hot paths (`03_algorithms/`)
- [ ] Phase 4: per-table Keep/Improve/Replace matrix
- [ ] Discover `NUMBER_TO_OFFER` interop with ord#2706

**Gate:** Phase 1 spec may proceed in parallel; custom indexer requires Phase 2 complete + new ADR superseding ADR-0002.

---

## Phase 1 — Specification (Next)

- [ ] Draft BIP-style protocol document from research + ADRs
- [ ] PSBT test vectors (canonical 2-bump)
- [ ] Wallet sighash compatibility matrix (Xverse, UniSat, Leather)
- [ ] `ord index info` on mainnet — per-table storage numbers
- [ ] Cross-indexer satpoint agreement experiment (ord vs ME/UniSat sample)
- [ ] Resolve Open Questions Q9 (bare-sat postage), Q10 (sighashTypes)

**Gate:** Phase 2 does not start until PSBT test vectors pass on testnet4.

---

## Phase 2 — Reference Implementation (Prototype)

### Phase 2a — Commerce core (gate for Session 10)

- [x] Listing store (SQLite or similar — lightweight)
- [x] `POST /v1/listings` with offset-0 validation via ord
- [x] `GET /v1/verify/sat/{n}` multi-node ord quorum
- [x] `POST /v1/psbt/validate` and `/v1/psbt/template`

**Gate to Session 10 (marketplace adapters):** Phase 2a complete. Collections/attestations are **not** required for ME/UniSat PSBT mapping.

### Phase 2b — Collections + attestations (Session 09b; parallel with Session 10 OK)

- [x] Collection predicate evaluator (Rodarmor math via `ordinals` crate or FFI / TS port)
- [x] Attestation verify (signature only)

**Not in Phase 2:** Media hosting, wallet app, marketplace UI, sat-for-sat.

---

## Phase 3 — Marketplace Integration

- [ ] Adapter: import existing listing PSBT (ME / UniSat shape → canonical)
- [ ] Partner test with one marketplace or wallet vendor
- [ ] Public testnet4 demo

---

## Phase 4 — v2 Exploration

- [ ] Offer/accept PSBT for sat-for-sat (extends ADR-0005) — [ADR-0014 (Proposed)](docs/adr/0014-sat-for-sat-offer-accept-sighash-all.md), spike: [SAT_FOR_SAT_SPIKE.md](docs/v2/SAT_FOR_SAT_SPIKE.md)
- [ ] On-chain listing invalidation option (Gamma-style)
- [ ] OPI-style integrity hash for listing DB (see Indexer Landscape IL1)

---

## Explicit Non-Goals

- Replacing ord or Ordinals
- BRC-20 / Runes indexing
- Inscription payload CDN
- Consensus changes
- Production mainnet marketplace (application layer)
