# Per-transaction reporting template (v3)

Reusable template for reporting a live-validation run (E1–E6, closing ADR-0014
E3). Copy this file per run, fill the header, and append one row per broadcast
transaction stage. Generalizes the `report_id-75` structure into a per-stage
table + a per-run header.

---

## Per-run header

| Field | Value |
|-------|-------|
| Run ID | `<report_id>` |
| Date (UTC) | `<YYYY-MM-DD>` |
| Network | testnet4 |
| `bitcoind` version | 28.1.0 (`getnetworkinfo.subversion`) |
| `ord` version + flags | `<ord --version>` with `--index-sats` (and `--index-addresses` for BD7) |
| Wallet A | `<name/kind>` — testnet4 support: `<yes/no>` |
| Wallet B | `<name/kind>` — testnet4 support: `<yes/no>` |
| Fee-funding wallet | `<name/kind>` — funding ~200k–300k sats |
| Matrix cells exercised | `<e.g. M1, M4, B1, D4, N5-partial>` |

### Experiment verdicts (E1–E6)

| Experiment | Verdict | Notes |
|------------|---------|-------|
| E1 — baseline construction & broadcast (Core-signed) | `GO / NO-GO / N/A` | |
| E2 — offset-0 readback after swap | `GO / NO-GO / N/A` | |
| E3 — wallet signability matrix (**the crux**) | `GO / CONDITIONAL / NO-GO` | ≥2 mainstream wallets sign foreign-input SIGHASH_ALL → GO |
| E4 — tamper check (post-sign output edit fails to broadcast) | `GO / NO-GO / N/A` | |
| E5 — invalidation race (pre-spent input → unbroadcastable) | `GO / NO-GO / N/A` | N5 |
| E6 — bundle / wallet foreign-input limits | `GO / NO-GO / N/A` | B8 finding |

### Offline suite

Record the full-suite result:

```
node --experimental-strip-types --test
# tests <N> / # pass <N-1> / # fail 1
```

> The **only** acceptable failure is `tests/ord-live.test.ts` — it requires a
> live `ord --index-sats` node and cannot run in an ephemeral CI/VM. It is a
> known standing exception, not a regression. Every other test must pass.

---

## Per-stage transaction table

One row per broadcast tx (carve, swap, sweep, …). `sat_range evidence` is the
`ord list <outpoint>` readback proving offset-0 / span integrity.

| Stage | txid | In shape | Out shape | Accomplishes | sat_range evidence | Fee (sats) |
|-------|------|----------|-----------|--------------|--------------------|------------|
| carve (A asset) | `<txid>` | `<n in>` | `<n out>` | isolate A's traded sat/range to its own offset-0 UTXO + bump | `ord list` → `[start,end]` @ offset 0 | `<fee>` |
| carve (B asset) | `<txid>` | | | isolate B's traded sat/range | | |
| swap | `<txid>` | `2(m+n)+1 in` | `2(m+n)+1 out` | atomic sat-for-sat / bundle exchange (both sides SIGHASH_ALL) | each ordinals out `[start,end]` @ offset 0, no leak | |
| sweep | `<txid>` | | | reclaim residual change/bumps to control wallet | | |

### Notes / anomalies

- `<free text: wallet quirks, PSBT-format friction, foreign-input refusals, etc.>`

### Verdict

- **E3 outcome:** `<GO / CONDITIONAL / NO-GO>` — `<# wallets that produced valid finalizing sigs>`.
- **ADR-0014 update:** `<link / commit updating the ADR status>`.
