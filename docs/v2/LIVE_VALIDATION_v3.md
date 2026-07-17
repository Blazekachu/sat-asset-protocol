# Live-validation checklist (closes ADR-0014 E3)

This is the E3-closing checklist for the v3 offer matrix. It **cannot** run in an
ephemeral VM — it needs persistent chain state, a synced index, and interactive
wallet UIs. The offline suite (`node --experimental-strip-types --test`) covers
every deterministic matrix cell; this document covers the live cells (M1/M3/M4/
M6/M7/M8, B1/B3/B4/B5/B8, D1/D4, V1, N5-partial, BD7-partial) and the
wallet-signability crux that ADR-0014 E3 gates on.

## User must provide (hard requirements)

- [ ] Persistent testnet4 `bitcoind` 28.1.0 + `ord --index-sats`, synced, reachable
      (E3 cannot run in an ephemeral VM — needs chain state + interactive wallet UIs).
- [ ] Tunnels + RPC creds for both bitcoind RPC and the ord HTTP API
      (`SAT_ASSET_ORD_BASE_URL`).
- [ ] **TWO INDEPENDENT WALLETS** (default UniSat + Xverse, RD5) — each holds one
      side's sats, each signs only its own inputs with `SIGHASH_ALL`. This is the
      whole point of E3.
- [ ] ~200k–300k testnet4 sats fee funding in a separate UTXO.

## Funded UTXO shapes (via carve, gated on a single contiguous funding range)

- [ ] Wallet A: one **rare/named** sat (prior run had only common sats).
- [ ] Wallet A: **≥3 sats** for a bundle side (RD4).
- [ ] Wallet B: one **range > dust** (≥330) and one **range < dust** (~200, expect
      rejection at build) for D4 live.
- [ ] Wallet B: **multiple sats/ranges** for the counterparty bundle side (RD4).
- [ ] Each asset pre-isolated to **offset 0** (`ord list <outpoint>`; ADR-0007);
      one **~600-sat bump** per asset per side.

## Step sequence (per swap)

Run in order; do not skip the tamper check or the swap readback.

1. **Snapshot** — record starting UTXO set, sat ranges, and wallet balances for
   both wallets + the fee-funding wallet.
2. **Carve** (+`testmempoolaccept` gate, confirm) — isolate each traded asset into
   its own offset-0 UTXO and mint the per-asset bumps; broadcast only after
   `testmempoolaccept` passes; wait for confirmation.
3. **Readback carve** (offset-0) — `ord list <outpoint>` on every carved asset UTXO;
   confirm each traded sat/range sits at **offset 0** and the range span matches.
4. **Build** (exact ADR-0014 ordering) — construct the sat-for-sat / bundle PSBT
   with the canonical interleaved input/output ordering (per-asset bumps, RD3);
   confirm `input index === output index` at every non-fee position.
5. **Two-party sign** — Wallet A signs its own inputs (`SIGHASH_ALL`); Wallet B
   **independently verifies routing** (each ordinals output pays the correct
   counterparty at offset 0, no target sat leaked into change/fee) then signs its
   own inputs; finalize.
6. **Tamper check** — edit an output **after** signing and confirm the broadcast
   **fails** (every SIGHASH_ALL signature commits to the whole tx, so any output
   edit invalidates all signatures).
7. **Broadcast** (+confirm, capture txid/height) — broadcast the finalized tx;
   record txid and confirmation height.
8. **Readback swap** — `ord list` each ordinals output; confirm every traded
   sat/range landed **intact at offset 0** in the counterparty output and **no
   target sat leaked** into a change/fee output.
9. **Sweep** — sweep residual change/bumps back to a control wallet; record final
   balances.
10. **Verdict** — fill the SPIKE §5 results table (`docs/v2/SAT_FOR_SAT_SPIKE.md`).
    **≥2 mainstream wallets signed → E3 GO** + update `docs/adr/0014-sat-for-sat-offer-accept-sighash-all.md`.
    Only 1 wallet → CONDITIONAL; no dApp wallet signs foreign-input PSBTs → NO-GO.

## Cell coverage notes

- **B8 (bundle vs wallet foreign-input limits)** is a live-only finding: record the
  per-wallet maximum foreign-input tolerance while running the ≥3-asset bundle
  side. There is no offline test for it (it is excluded from the offline coverage
  guard).
- **N5 (invalidation race)** is *partially* live: pre-spend one committed input
  after the offer is built and confirm the offer becomes unbroadcastable (the race
  is surfaced, not prevented — ADR-0017).
- **BD7 (holder discovery)** is *partially* live: it needs `ord --index-sats` AND
  `--index-addresses`; offline it is stubbed.

## Per-run reporting

Record each swap using `docs/v2/TXN_REPORT_TEMPLATE.md`. Attach raw PSBTs and
txids so results are reproducible, and note the offline-suite result (including
the standing `tests/ord-live.test.ts` exception).
