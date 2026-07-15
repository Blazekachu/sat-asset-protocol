# Sat-for-Sat Spike — Offer/Accept (SIGHASH_ALL) on testnet4

**Status:** Spike plan (exploratory) — Phase 4 v2  
**Date:** 2026-07-13  
**Owner:** Planning by design agent; **execution handed to a coding agent** (this doc is the brief)  
**Decision it feeds:** [ADR-0014](../adr/0014-sat-for-sat-offer-accept-sighash-all.md) (`Proposed → Accepted`)  
**Resolves:** [Open Questions.md](../Open%20Questions.md) Q11 — "Can sat-for-sat work via offer/accept without wallet changes?"

> **Guardrail:** This is an isolated spike. **No code, endpoints, or docs from this spike may merge
> into the v1 API** until ADR-0014 is `Accepted` (see [ADR-0010](../adr/0010-sat-for-sat-deferred-v2.md)).
> Keep all spike artifacts under `docs/v2/` and a throwaway branch / scratch dir.

---

## 1. Objective & Hypothesis

**Hypothesis (H1):** Two parties can atomically swap two specific sats on Bitcoin L1 using a single
standard PSBT where **all inputs are signed `SIGHASH_ALL`**, with **no wallet modification** and **no
consensus change**, while **preserving both sats' identity at offset 0** in each recipient's output.

The spike either **confirms** H1 (→ GO, recommend ADR-0014 Accepted) or **falsifies** it and records
exactly which sub-claim broke (→ NO-GO or CONDITIONAL, with the specific blocker).

**Sub-claims to test:**
- **H1a — Construction validity:** the "mirrored 2-bump" tx (ADR-0014) is consensus-valid and confirms.
- **H1b — Sat preservation:** post-broadcast, ord reports sat X at offset 0 of B's output and sat Y at
  offset 0 of A's output.
- **H1c — Wallet signability (the crux):** ≥2 mainstream wallets will sign their own inputs in a PSBT
  that also contains foreign inputs/outputs, honoring `SIGHASH_ALL`, without breaking the deal.
- **H1d — Atomicity/tamper-resistance:** any post-signing edit to outputs invalidates the signatures.

---

## 2. Scope

**In scope**
- testnet4 only. Reproduce the ADR-0014 mirrored 2-bump construction end-to-end.
- Two signing paths: (a) `bitcoin-cli walletprocesspsbt` (baseline, always works), (b) ≥2 dApp wallets.
- Sat-identity verification via `ord` (`--index-sats`).

**Out of scope**
- Mainnet. Open orderbook / matching. Production API. Fee-market optimization. Wallet UX polish.
- HTLC/DLC/Lightning alternatives (already rejected in ADR-0014).

---

## 3. Environment & Prerequisites

| Item | Value / Note |
|------|--------------|
| Network | **testnet4** |
| Node | `bitcoind` (testnet4), synced |
| Indexer | `ord` 0.27.1 (pinned `vendor/ord @ 1ad3f64`) with `--index-sats` |
| Wallets A & B | Two independent wallets. Baseline: two Bitcoin Core / ord wallets. dApp: UniSat, Xverse, Leather, OKX (testnet4 support varies — record which support testnet4) |
| Assets | Two distinguishable sats: `X` (in `A_asset`, offset 0) and `Y` (in `B_asset`, offset 0). Rare sats not required — any two sats whose ranges ord can name are fine. Pre-isolate to offset 0 per [PSBT Settlement.md §5](../PSBT%20Settlement.md). |
| Bumps | One dust bump UTXO (~600 sats) per party: `A_bump`, `B_bump` |
| Fees | One funding UTXO `F` for network fee (decide payer per run) |
| Tooling | `bitcoinjs-lib` or `rust-bitcoin`/`ord` for PSBT assembly; `ord list <outpoint>` for offset checks |

**Setup checklist (coding agent):**
- [ ] testnet4 `bitcoind` + `ord --index-sats` synced; `ord index info` sane.
- [ ] Fund A and B; create `A_asset`(X@0), `B_asset`(Y@0), `A_bump`, `B_bump`, `F`.
- [ ] Record all outpoints, sat numbers, and `ord list` output **before** the swap (baseline snapshot).

---

## 4. Experiments

Run in order; each has an explicit pass/fail. Capture raw tx hex, PSBTs, txids, and `ord list` output.

### E1 — Baseline construction & broadcast (Core-signed)
Build the ADR-0014 mirrored 2-bump PSBT. Sign with `walletprocesspsbt` on both wallets
(`sighashtype "ALL"`), finalize, broadcast on testnet4.
- **Pass:** tx confirms.
- **Tests:** H1a.

### E2 — Sat preservation verification
After E1 confirms, run `ord list` on the new B and A ordinals outputs.
- **Pass:** X at offset 0 of B's output; Y at offset 0 of A's output; no sat leaked to change/fee outputs.
- **Tests:** H1b.

### E3 — Wallet signability matrix (the crux)
For each candidate wallet (UniSat, Xverse, Leather, OKX): have it sign **only its own inputs**
(`SIGHASH_ALL`) in the shared PSBT that contains the counterparty's inputs and outputs. Attempt via each
wallet's `signPsbt`-family API with `signInputs`/`toSignInputs` scoped to that party's indices.
Record per wallet: signs / refuses / mangles, and any per-input vs. global sighash constraints.
- **Pass:** ≥2 mainstream wallets produce valid partial signatures that finalize into a broadcastable tx.
- **Tests:** H1c. **This is the gating experiment.**

### E4 — Offer/accept round trip
Simulate the real flow: A signs `[0],[1]` (+`[4]` if payer) → serialize PSBT → B verifies routing
(X→B@0, Y→A@0, addresses/amounts) → B signs `[2],[3]` → finalize → broadcast.
- **Pass:** independent parties complete the swap from an exchanged PSBT; B's client-side verification
  catches a deliberately tampered offer (wrong recipient/amount) before signing.
- **Tests:** H1c + H1d.

### E5 — Tamper / atomicity check
After all signatures collected, edit one output (redirect X to A, or change an amount) and attempt to
re-finalize/broadcast.
- **Pass:** finalization/broadcast fails (signatures invalid). Confirms `SIGHASH_ALL` binding.
- **Tests:** H1d.

### E6 — Invalidation & edge cases (record, don't gate)
- Pre-spend one input after offer creation → offer should become unbroadcastable (expected).
- Fee too low / RBF behavior. Postage < dust. Non-offset-0 asset (should break preservation — confirms
  the bump requirement). Record outcomes as design notes.

---

## 5. Data to Capture

Produce a results table (append to this file or `docs/v2/SAT_FOR_SAT_SPIKE_RESULTS.md`):

| Field | Example |
|-------|---------|
| Experiment | E1–E6 |
| txid / status | `<txid>` confirmed@height |
| X offset post-swap | 0 (in `<B_outpoint>`) |
| Y offset post-swap | 0 (in `<A_outpoint>`) |
| Wallets that signed | UniSat ✅ / Xverse ❓ / Leather ❌ |
| Foreign-input signing | allowed / refused / partial |
| Sighash honored | ALL / other |
| Tamper rejected? | yes/no |
| tx vB / fee | … |
| Notes / blockers | … |

---

## 6. Risks & Known Unknowns

| # | Risk | Impact | Mitigation in spike |
|---|------|--------|---------------------|
| U1 | **Wallets refuse to sign PSBTs with foreign inputs** (security heuristic) | Kills no-wallet-change claim → NO-GO or CONDITIONAL | E3 is designed to isolate this; test per wallet, record exact failure mode |
| U2 | dApp wallets lack **testnet4** support (many are testnet3/signet) | Can't test that wallet | Note coverage gap; fall back to signet/regtest for that wallet and flag as unverified on testnet4 |
| U3 | Cross-wallet PSBT format friction (base64 vs hex, finalize semantics) | False negatives | Normalize with `bitcoinjs-lib`/Core; verify Core-signed baseline first (E1) |
| U4 | Sat lands at non-zero offset (FIFO miscalc) | Preservation fails | E2 gate; adjust bump sizing/ordering; document exact rule |
| U5 | Fee attribution / change routing leaks a target sat | Silent asset loss | E2 checks change/fee outputs for stray target sats |
| U6 | Offer negotiation channel (how A learns B's outpoints) undefined | UX/protocol gap, not consensus | Out of spike scope; note as v2 API design item |

---

## 7. Decision Framework — GO / NO-GO

Evaluate after E1–E5. This is the acceptance gate for [ADR-0014](../adr/0014-sat-for-sat-offer-accept-sighash-all.md).

**GO** (recommend ADR-0014 → Accepted, proceed to v2 API design) requires **all**:
- E1 ✅ tx valid & confirmed.
- E2 ✅ both sats verified at offset 0; no leakage.
- E3 ✅ **≥2 mainstream wallets** sign foreign-input `SIGHASH_ALL` PSBTs and finalize.
- E4 ✅ round trip works and client-side verification catches tampering.
- E5 ✅ tamper attempt rejected.

**CONDITIONAL-GO** (accept the mechanism, but note wallet-support caveat) if:
- E1, E2, E4, E5 ✅ but E3 shows **only 1** wallet (or only Core/ord) signs → mechanism is sound but
  adoption blocked on wallet gaps; document required wallet asks / upstream issues and re-test.

**NO-GO** (do not accept; return to alternatives) if any of:
- E1 fails (construction not consensus-valid), or
- E2 fails and cannot be fixed by bump/ordering tuning (sat identity not preservable), or
- E3 shows **no** dApp wallet will sign foreign-input PSBTs **and** no realistic wallet path exists.
  → Reopen HTLC/DLC/off-L1 alternatives from ADR-0014's rejected list.

---

## 8. Preliminary Recommendation (pre-execution)

> This is a **design-level provisional recommendation**; the binding go/no-go comes from §7 after the
> testnet4 runs, which are handed to the coding agent.

**Provisional: CONDITIONAL-GO to build the spike.** The construction is theoretically sound —
`SIGHASH_ALL` demonstrably commits to the full transaction, so H1a/H1b/H1d are expected to pass
(they are standard-PSBT + FIFO reasoning already proven for v1 fills in ADR-0006). The **entire
risk concentrates in H1c (E3): whether real wallets will sign a multi-party PSBT containing foreign
inputs.** Recommend the coding agent **front-load E1→E3** and treat E3 as the true decision point:
if E3 fails across all dApp wallets, stop early and escalate rather than polishing E4–E6.

**Expected most-likely outcome:** CONDITIONAL-GO — mechanism valid, with a subset of wallets requiring
per-input signing support or upstream fixes. That still justifies moving ADR-0014 forward while tracking
wallet-support as an explicit dependency.

---

## 9. Handoff Notes for the Coding Agent

1. Work in an **isolated scratch area** (throwaway branch / `docs/v2/` + local scratch); do **not** touch
   `src/` v1 API or v1 docs.
2. Implement PSBT assembly for the exact ADR-0014 §"mirrored 2-bump" layout; keep input/output **ordering**
   identical — ordering is load-bearing for FIFO preservation.
3. Do **E1 (Core baseline) and E2 first** to prove the construction independent of wallet quirks.
4. Then run **E3** across every wallet with testnet4 support; this determines the recommendation.
5. Record everything in the §5 results table; append raw PSBTs/txids so results are reproducible.
6. On completion, update [ADR-0014](../adr/0014-sat-for-sat-offer-accept-sighash-all.md) status with the
   §7 verdict and link the results. Do not merge to v1 regardless of outcome.

## 10. References

- [ADR-0014](../adr/0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0010](../adr/0010-sat-for-sat-deferred-v2.md) · [ADR-0006](../adr/0006-canonical-two-bump-psbt.md)
- [PSBT Settlement.md](../PSBT%20Settlement.md) §4, §5, §7
- [Wallet Sighash Matrix.md](../Wallet%20Sighash%20Matrix.md)
- [ord#2706 — offer PSBT design](https://github.com/ordinals/ord/issues/2706)
- [../ORD_REVERSE_ENGINEERING/05_sat_asset_notes/02_commerce_vs_ord_offers.md](../../ORD_REVERSE_ENGINEERING/05_sat_asset_notes/02_commerce_vs_ord_offers.md)
