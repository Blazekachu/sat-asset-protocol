# Wallet Compatibility

**Status:** Research complete (2026-07-07)

---

## 1. Executive Summary

No existing wallet provides full **sat-for-sat** trading without marketplace-specific PSBT construction. **`ord` is the only wallet with official sat-control and sat-selection** required to safely isolate and send named sats. Consumer wallets (Xverse, UniSat, Leather, OKX, Magic Eden Wallet) support Ordinals + PSBT signing but treat UTXOs as the trade unit, not individual sats.

**Goal for Sat Asset Protocol:** Require as few wallet modifications as possible — target existing `signPsbt` interfaces with explicit `toSignInputs` and `sighashTypes`.

**Citation:** [Collecting guide](https://docs.ordinals.com/guides/collecting.html)

---

## 2. Capability Matrix

| Wallet | Ordinals | PSBT | Rare-Sat Display | Sat-Control | Coin Selection | Marketplace PSBT |
|--------|----------|------|------------------|-------------|----------------|------------------|
| **ord + Core** | Yes | Via Core RPC | Yes | **Yes (only)** | Sat-aware | Manual |
| **Xverse** | Yes | Sats Connect | Yes (warnings) | No (address segregation) | Automatic | Yes |
| **UniSat** | Yes | `signPsbt`, `pushPsbt` | Partial (offset metadata) | No | Wallet-managed | Yes |
| **Leather** | Yes | Yes | Partial | No | Standard | Yes |
| **OKX Wallet** | Yes | Yes | Partial | No | Standard | Yes |
| **Magic Eden Wallet** | Yes | Yes | Partial | No | Standard | Yes |
| **Phantom** | Yes (spam filters) | Yes | Limited | No | Standard | Partial |
| **Sparrow** | Receive-safe | Manual PSBT | Via `ord` import | Manual only | **Manual UTXO** | Manual |
| **Satonomy** | Tool (not wallet) | Multi-wallet tx builder | Yes | UTXO drag-drop | Manual | N/A |
| **Bitcoin Core** | No | Generic | No | No | Generic | No |

---

## 3. What Each Wallet Provides

### 3.1 ord (Reference Implementation)

- Send named sat: `ord wallet send <ADDR> <sat-name> --fee-rate N`
- List rare sats: `ord wallet sats` (rare only)
- Split UTXOs: `ord wallet split` (YAML config)
- Requires: `--index-sats`, dedicated ordinals receive address

**Limitation:** `ord wallet split` does not assign inscriptions to specific outputs ([splitting guide](https://docs.ordinals.com/guides/splitting.html)).

### 3.2 Xverse

- Dual-address architecture: payment wallet vs ordinals wallet
- Sats Connect API for dApp PSBT signing
- Displays rare sats with signing warnings
- Does **not** extract individual sats from mixed UTXOs

**Citation:** [Sats Connect](https://docs.xverse.app/sats-connect), [Rare sats blog](https://www.xverse.app/blog/rare-satoshis)

### 3.3 UniSat

- `signPsbt(psbtHex, { autoFinalized, toSignInputs })` with explicit sighash types
- `pushPsbt` for broadcast
- Ordinals + BRC-20 + Runes in same wallet
- Marketplace integration via Open API

**Citation:** [UniSat Wallet API](https://docs.unisat.io/dev/unisat-wallet-api)

### 3.4 Sparrow

- Recommended for **receiving** ordinals safely
- **Not recommended for sending** without manual UTXO selection
- Can import ord descriptors for sat tracking

---

## 4. What's Missing for Sat-for-Sat Trading

| Gap | Detail | Severity |
|-----|--------|----------|
| **No atomic sat↔sat barter in listing PSBTs** | `SIGHASH_SINGLE` commits to sat **amount**, not ordinal identity | Blocker for sat-for-sat |
| **No standardized offer PSBT** | [ord#2706](https://github.com/ordinals/ord/issues/2706) open since 2023 | High |
| **UTXO-granularity** | Marketplaces list whole UTXOs; rare sat in mixed UTXO needs pre-extraction | High |
| **Fragmented satribute indexes** | Rodarmor vs Black Sats vs ME vs Magisat ([ord#2815](https://github.com/ordinals/ord/issues/2815)) | Medium |
| **Inconsistent bump-UTXO schemes** | 0/1/2/3-bump padding across venues | Medium |
| **No wallet sat-preservation guarantee** | Generic wallets spend sats fungibly | High |
| **Post-trade split required** | 0-bump schemes leave asset at non-zero offset | Medium |

---

## 5. Minimum Wallet Requirements for Protocol v1

### 5.1 Sat-for-BTC (Achievable Today)

| Requirement | Wallets Meeting It |
|-------------|------------------|
| Sign PSBT with `SIGHASH_SINGLE \| ANYONECANPAY` on seller input | Xverse, UniSat, Leather, OKX, ME Wallet |
| Sign PSBT with `SIGHASH_ALL` on buyer inputs | All above |
| Taproot address support (P2TR) | All above |
| Push/broadcast finalized PSBT | UniSat (`pushPsbt`), others via marketplace |

### 5.2 Sat-for-Sat (Not Achievable with Standard Listings)

Requires one of:
- **Offer/accept flow** with `SIGHASH_ALL` on both sides ([ord#2706](https://github.com/ordinals/ord/issues/2706))
- **Pre-isolated UTXOs** on both sides (whole-UTXO barter as two sequential BTC trades)
- **Future covenant/ANYPREVOUT** (not in Bitcoin Core) — speculative
- **Off-chain atomic swap** (Lightning, DLC) — out of L1 PSBT scope

### 5.3 Recommended Protocol Wallet Interface

```javascript
// Minimum viable wallet integration (UniSat pattern)
await wallet.signPsbt(psbtBase64, {
  autoFinalized: false,
  toSignInputs: [{
    index: 0,
    address: userAddress,
    sighashTypes: [0x03]  // SIGHASH_SINGLE | ANYONECANPAY
  }]
});
```

**Sats Connect equivalent** should expose the same `sighashTypes` control. **UNKNOWN:** whether all Sats Connect wallets honor per-input sighash types consistently.

---

## 6. Wallet Modification Assessment

| Approach | Wallet Changes Required | Feasibility |
|----------|------------------------|-------------|
| **BTC-for-sat via listing PSBT** | None (use existing `signPsbt`) | **High** |
| **Sat isolation before listing** | Optional helper (not required) | Medium — tools like Satonomy/Sating exist |
| **Sat-for-sat barter** | New PSBT template + dual-sign flow | **Low** without protocol extension |
| **Sat preservation enforcement** | Wallet would need ord-aware coin selection | High effort; defer to marketplace PSBT templates |
| **Collection/rarity display** | Read protocol metadata API | Low — display only |

**Conclusion:** Protocol v1 should target **sat-for-BTC** with standard listing PSBTs. Sat-for-sat is a v2 concern requiring offer/accept or external swap infrastructure.

---

## 7. Pre-Trade Isolation Tools (Non-Wallet)

| Tool | Function | Protocol Relationship |
|------|----------|----------------------|
| **ord wallet send** | Send specific named sat to new UTXO | Reference implementation |
| **Sating Transfer Sats** | Extract sat from UTXO before listing | Recommended pre-condition |
| **Satonomy** | UTXO management, rare-sat visualization | Optional user tooling |

---

## 8. Unknowns

1. Sats Connect sighash type support across all integrated wallets — **UNKNOWN**
2. Hardware wallet (Ledger) rare-sat PSBT signing fidelity — partial, via companion apps
3. Whether wallet vendors will adopt a unified Sat Asset Protocol PSBT extension — **UNKNOWN**

---

## 9. Citations

- [Collecting guide — sat-control](https://docs.ordinals.com/guides/collecting.html)
- [Sat hunting](https://docs.ordinals.com/guides/sat-hunting.html)
- [ord#2706 — Offer PSBT design](https://github.com/ordinals/ord/issues/2706)
- [ord#2815 — Satribute fragmentation](https://github.com/ordinals/ord/issues/2815)
- [UniSat Wallet API](https://docs.unisat.io/dev/unisat-wallet-api)
- [Magisat wallet prep tutorial](https://magisat.io/tutorials/basics)
