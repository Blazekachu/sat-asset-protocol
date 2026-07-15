# Wallet Sighash Matrix

**Status:** Research complete (2026-07-12) — API/docs review only; **no empirical wallet signing in this session**  
**Phase:** 1 / Session 06  
**Related:** [Wallet Compatibility.md](./Wallet%20Compatibility.md), [ADR-0006](./adr/0006-canonical-two-bump-psbt.md), [Open Questions.md](./Open%20Questions.md) Q10

---

## 1. Executive Summary

v1 listing PSBTs require the seller to sign input 0 with **`SIGHASH_SINGLE | ANYONECANPAY`**. Buyer fill (canonical 2-bump per ADR-0006) uses **`SIGHASH_ALL`**.

| Minimum v1 target | Listing sighash via documented API | Notes |
|-------------------|------------------------------------|-------|
| **UniSat** | **Yes** — per-input `sighashTypes` | Prefer `131` (`0x83`), not `3` (`0x03`) |
| **Xverse / Sats Connect** | **Partial** | Current `signPsbt` has **no** per-input sighash param; legacy `signTransaction` + `sigHash: 131` works (community) |

**Byte value (critical):** Protocol docs historically write `0x03` for the listing flag. That is **`SIGHASH_SINGLE` alone**. The listing combination is:

| Name | Hex | Decimal |
|------|-----|---------|
| `SIGHASH_SINGLE` | `0x03` | 3 |
| `SIGHASH_ANYONECANPAY` | `0x80` | 128 |
| **`SIGHASH_SINGLE \| ANYONECANPAY`** | **`0x83`** | **131** |

UniSat support guidance and Sats Connect examples both use **`131` / `0x83`**. Integrating with `sighashTypes: [0x03]` will fail or produce the wrong commitment.

---

## 2. Compatibility Matrix

| Wallet | signPsbt API | per-input sighashTypes | SIGHASH_SINGLE\|ANYONECANPAY (`0x83` / 131) | pushPsbt | Tested? | Notes |
|--------|--------------|------------------------|-----------------------------------------------|----------|---------|-------|
| **UniSat** | `window.unisat.signPsbt(psbtHex, options)` | **Yes** — `toSignInputs[].sighashTypes: number[]` | **Yes (docs + vendor support)** — use `sighashTypes: [131]` | **Yes** — `unisat.pushPsbt(psbtHex)` | **UNKNOWN** | Also `signPsbts`, `autoFinalized`. Set `autoFinalized: false` for listing PSBTs. |
| **Xverse / Sats Connect** | `request('signPsbt', { psbt, signInputs, broadcast })` | **No** on current RPC — `signInputs` is `Record<address, number[]>` only | **Partial** — current docs default to `SIGHASH_ALL`; legacy `signTransaction` + `inputsToSign[].sigHash: 131` confirmed by maintainers/community | **No** dedicated `pushPsbt` — use `broadcast: true` or external broadcast | **UNKNOWN** | `allowedSignHash` removed from `@sats-connect/core`. Embed PSBT input `sighashType` **and** pass legacy `sigHash` when using old API. |
| **Leather** | `LeatherProvider.request('signPsbt', { hex, … })` | **No** — request-global `allowedSighash` + `signAtIndex` | **UNKNOWN** — API allows non-`ALL` via `allowedSighash`; combination with SINGLE\|ANYONECANPAY not project-tested | **No** — optional `broadcast`; else finalize + broadcast externally | **UNKNOWN** | Defaults to `ALL` if `allowedSighash` omitted. Not per-input UniSat shape. |
| **OKX** | `okxwallet.bitcoin.signPsbt(psbtHex, options)` (UniSat-shaped) | **Yes** — `toSignInputs[].sighashTypes` | **UNKNOWN** — API accepts `sighashTypes`; expect `131` by analogy to UniSat | **Yes** — `pushPsbt` / `signAndPushPsbt` (provider docs) | **UNKNOWN** | Treat as UniSat-compatible for v1 adapter design; verify empirically before launch. |
| **ord wallet** | No browser `signPsbt` — Bitcoin Core `walletprocesspsbt` via Core + `ord` | **Partial** — RPC `sighashtype` is **global**; PSBT may carry per-input sighash fields | **Yes (Core docs)** — `sighashtype: "SINGLE\|ANYONECANPAY"` | **No** — Core `sendrawtransaction` / equivalent | **UNKNOWN** | Reference sat-control wallet; not a dApp `signPsbt` target. Listing construction still manual. |

---

## 3. API Shapes (v1 adapters)

### 3.1 UniSat (canonical dApp pattern)

```javascript
// Listing: seller signs input 0 only; do not finalize
await window.unisat.signPsbt(psbtHex, {
  autoFinalized: false,
  toSignInputs: [{
    index: 0,
    address: sellerAddress,
    sighashTypes: [0x83], // 131 — SIGHASH_SINGLE | ANYONECANPAY
  }],
});
```

Citation: [UniSat Wallet API — signPsbt / pushPsbt](https://docs.unisat.io/dev/unisat-wallet-api); vendor note on `sighashTypes: [131]` in [unisat-wallet/dev-support#33](https://github.com/unisat-wallet/dev-support/issues/33).

### 3.2 Sats Connect — current `signPsbt` (Xverse docs)

```javascript
import { request } from 'sats-connect';

await request('signPsbt', {
  psbt: psbtBase64,
  signInputs: {
    [ordinalsAddress]: [0],
  },
  broadcast: false,
});
// Docs: signs with SIGHASH_ALL — insufficient alone for marketplace listings.
```

Citation: [Xverse Sats Connect — signPsbt](https://docs.xverse.app/sats-connect/bitcoin-methods/signpsbt).  
`@sats-connect/core` `BitcoinSignPsbtParams`: `{ psbt, signInputs?, broadcast? }` — **no sighash field**.

### 3.3 Sats Connect — legacy `signTransaction` (listing path)

```javascript
// Community / maintainer-confirmed pattern for 131
inputsToSign: [{
  address: sellerAddress,
  signingIndexes: [0],
  sigHash: 131, // SIGHASH_SINGLE | ANYONECANPAY
}]
```

Also set the PSBT input’s `sighashType` to the same value. Citation: [sats-connect#73](https://github.com/secretkeylabs/sats-connect/issues/73).

### 3.4 Leather

```javascript
await window.LeatherProvider.request('signPsbt', {
  hex: psbtHex,
  signAtIndex: 0,
  allowedSighash: [/* SignatureHash values allowing SINGLE + ANYONECANPAY */],
  broadcast: false,
});
```

Citation: [Leather — signPsbt](https://leather.gitbook.io/developers/bitcoin-methods/signpsbt). Empirical SINGLE\|ANYONECANPAY: **UNKNOWN**.

### 3.5 OKX

Same option shape as UniSat (`toSignInputs` / `sighashTypes` / `autoFinalized`). Prefer verifying `131` on a testnet listing before production.

### 3.6 ord + Bitcoin Core

```bash
bitcoin-cli walletprocesspsbt "<psbt_base64>" true "SINGLE|ANYONECANPAY"
```

Citation: [Bitcoin Core `walletprocesspsbt`](https://bitcoincore.org/en/doc/31.0.0/rpc/wallet/walletprocesspsbt/).

---

## 4. Q10 Resolution

**Q10:** Do all Sats Connect wallets honor per-input `sighashTypes`?

**Answer: No (current RPC).**

| Layer | Finding |
|-------|---------|
| Current `request('signPsbt')` | No per-input `sighashTypes` / `sigHash` in the published params schema |
| Legacy `signTransaction` | Per-address `sigHash` **is** supported; `131` works when PSBT + request agree |
| Cross-wallet via Sats Connect | **Not uniform** — Leather uses global `allowedSighash`; UniSat native API is a different shape |
| Empirical matrix | Still **UNKNOWN** for live extension versions |

v1 implication: treat **UniSat native** and **Xverse legacy listing path** as the two primary seller integrations; do not assume Sats Connect `signPsbt` alone is listing-capable.

---

## 5. Recommendations for Protocol v1

1. **Seller listing adapter:** UniSat `signPsbt` + `sighashTypes: [0x83]`; Xverse via legacy `sigHash: 131` until Sats Connect exposes per-input sighash on `signPsbt`.
2. **Buyer fill adapter:** `SIGHASH_ALL` + ADR-0006 2-bump template — all wallets above document ALL (or default to it).
3. **Broadcast:** UniSat/OKX `pushPsbt`; others finalize then broadcast (or `broadcast: true` where safe).
4. **Correct protocol constants:** prefer documenting listing sighash as **`0x83` (131)**; treat historical `0x03` mentions as a naming error for the combined flag.
5. **Before launch:** empirical Tested? column for UniSat + Xverse on testnet4 with a real listing PSBT (Risks R10).

---

## 6. Citations

- [UniSat Wallet API](https://docs.unisat.io/dev/unisat-wallet-api)
- [UniSat sighashTypes: 131](https://github.com/unisat-wallet/dev-support/issues/33)
- [Xverse Sats Connect signPsbt](https://docs.xverse.app/sats-connect/bitcoin-methods/signpsbt)
- [sats-connect#73 — sigHash 131](https://github.com/secretkeylabs/sats-connect/issues/73)
- [Remove allowedSignHash — sats-connect-core#43](https://github.com/secretkeylabs/sats-connect-core/pull/43)
- [Leather signPsbt](https://leather.gitbook.io/developers/bitcoin-methods/signpsbt)
- [OKX Bitcoin provider (UniSat-shaped)](https://web3.okx.com/build/dev-docs/sdks/chains/bitcoin/provider)
- [Bitcoin Core walletprocesspsbt](https://bitcoincore.org/en/doc/31.0.0/rpc/wallet/walletprocesspsbt/)
- [ord#2706 — listing PSBT pattern](https://github.com/ordinals/ord/issues/2706)
