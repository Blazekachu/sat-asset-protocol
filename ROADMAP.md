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

- [x] Offer/accept PSBT for sat-for-sat (extends ADR-0005) — **in progress / building v2** — [ADR-0014 (Accepted)](docs/adr/0014-sat-for-sat-offer-accept-sighash-all.md); testnet4 wallet-signability spike is post-acceptance follow-up: [SAT_FOR_SAT_SPIKE.md](docs/v2/SAT_FOR_SAT_SPIKE.md) §7 GO gate
- [ ] On-chain listing invalidation option (Gamma-style)
- [ ] OPI-style integrity hash for listing DB (see Indexer Landscape IL1)

---

## Phase 5 — v3 Complete Offer Matrix (In Progress)

Backend-only. Completes the sat-for-sat / sat-for-BTC offer matrix on top of the ADR-0014
point-to-point settlement, adding discoverable advertisements, negotiation, bundles/ranges, and
BTC-denominated partial-fill bids. Each major choice is fixed by an ADR before its code merges.

- [ ] Open intent advertisement + point-to-point settlement — [ADR-0016 (Accepted)](docs/adr/0016-open-intent-point-to-point-settlement.md): two-phase model (open discoverable intent → concrete `SIGHASH_ALL` settlement round) reconciling ADR-0014 with postable specific-sat/range wants
- [ ] Counter-offers as new objects in a negotiation thread — [ADR-0017 (Accepted)](docs/adr/0017-counter-offers-negotiation-thread.md): append-only rounds (`parent_offer_id`/`supersedes`/`counter_index`), per-round expiry + nonce, end-to-end re-validation; invalidation race surfaced, not prevented
- [ ] Bundle (M×N) and range barter — [ADR-0018 (Accepted)](docs/adr/0018-bundle-and-range-barter.md): generalize the canonical 2-bump template to M×N asset legs (one bump per asset), range as a single contiguous whole-UTXO asset; reduces to ADR-0014 at M=N=1
- [ ] Partially-fillable BTC buy bids — [ADR-0019 (Accepted)](docs/adr/0019-partial-fill-btc-buy-bids.md): fungible-BTC bids filled by multiple sellers, co-signed per-fill point-to-point settlements (Decision #2045), `floor(T/N)` unit price + reserved-quantity ledger (Decision #2046)

---

## Explicit Non-Goals

- Replacing ord or Ordinals
- BRC-20 / Runes indexing
- Inscription payload CDN
- Consensus changes
- Production mainnet marketplace (application layer)
