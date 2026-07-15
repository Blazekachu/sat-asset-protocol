# PSBT Settlement

**Status:** Research complete (2026-07-07)

---

## 1. Executive Summary

**Sat-for-BTC trades can be represented as standard BIP-174 PSBTs** using the industry-de facto `SIGHASH_SINGLE | ANYONECANPAY` listing pattern. **Sat-for-sat barter cannot** use this listing pattern because `SIGHASH_SINGLE` commits to a sat **amount**, not a specific ordinal identity.

**Sat preservation** on L1 depends on FIFO output ordering and bump-UTXO construction — enforced by marketplace PSBT templates, not by Bitcoin consensus or generic wallets.

---

## 2. Trade Type Feasibility Matrix

| Trade Type | Standard PSBT? | Mechanism | Wallet Support |
|------------|----------------|-----------|----------------|
| Inscription / UTXO for BTC | **Yes** | Listing PSBT + buyer fill | Xverse, UniSat, Leather, OKX, ME |
| Rare-sat UTXO for BTC | **Yes** (if pre-isolated) | Same; buyer receives whole UTXO | Same |
| Sat-for-sat barter | **No** (listing model) | Needs offer/accept or external swap | Not standardized |
| Sat-for-inscription barter | **No** (listing model) | Same limitation | Not standardized |
| Buyer-initiated offer | **Yes** | `SIGHASH_ALL` both sides | Theoretically all PSBT wallets |
| Multi-asset batch buy | **Yes** | n+1 bump inputs | ord#2706 documented |

**Citation:** [ord#2706](https://github.com/ordinals/ord/issues/2706#issuecomment-1823502804) — @utxo-detective on `SIGHASH_SINGLE` limitation

---

## 3. Industry-Standard Sell/Buy Flow

Source: [Ordinals Wallet — How PSBT settlement works](https://ordinalswallet.com/learn/how-psbt-settlement-works), [ord#2706](https://github.com/ordinals/ord/issues/2706)

### Phase A — Seller Lists (Off-Chain)

```
Inputs:
  [0] asset_utxo                    SIGHASH_SINGLE | ANYONECANPAY (0x03)

Outputs:
  [0] seller_payment_addr: listing_price_sats
```

- Seller signs **input 0 only**.
- PSBT stored in marketplace database.
- Asset remains in seller wallet until fill.

### Phase B — Buyer Fills (On-Chain)

Canonical 2-bump construction:

```
Inputs (order matters):
  [0] bump_utxo_1 (~600 sats)           SIGHASH_ALL (0x01)
  [1] bump_utxo_2 (~600 sats)           SIGHASH_ALL
  [2] seller_asset_utxo                 (seller sig from listing PSBT)
  [3+] buyer_funding_utxo(s)            SIGHASH_ALL

Outputs (order matters):
  [0] buyer_ordinals_addr: 1200 sats    (bump passthrough)
  [1] buyer_ordinals_addr: asset_postage
  [2] seller_payment_addr: listing_price
  [3] marketplace_fee_addr (optional)
  [4] royalty_addr (optional)
  [5] buyer_change_addr
```

- Buyer signs inputs 0, 1, 3+.
- Merges seller partial signature on input 2.
- Finalizes and broadcasts.

### Phase C — Settlement Properties

- **Atomic:** All inputs/outputs succeed or none do.
- **Non-custodial:** Marketplace never holds keys.
- **Invalidation:** Seller spends UTXO elsewhere; competing buyers race (one confirms).
- **Size:** ~200–300 vB for simple trade.

---

## 4. Alternate Flow — Offer/Accept (Bid)

Better for auctions and potentially sat-for-sat (v2):

```
Inputs:
  [0] seller_asset_utxo     SIGHASH_ALL (seller signs last)
  [1+] buyer_funding...     SIGHASH_ALL (buyer signs first)

Outputs:
  [0] buyer_addr: asset_postage
  [1] seller_addr: bid_amount
  [2] buyer_change
```

- No bump UTXOs required.
- Seller countersigns after buyer.
- **Citation:** [ord#2706](https://github.com/ordinals/ord/issues/2706)

---

## 5. Sat Preservation Analysis

### 5.1 What Bitcoin Guarantees

Bitcoin consensus knows only UTXOs and amounts. It has **no sat concept**.

### 5.2 What Ordinal Theory Guarantees

Given identical chain data and `--index-sats`, FIFO rules deterministically assign sat ranges to outputs. Preservation depends on:

1. **Input/output ordering** in the transaction
2. **Bump UTXO placement** keeping target sat at offset 0 in buyer's output
3. **Indexer agreement** on sat locations

### 5.3 Can Preservation Occur Without Wallet-Specific Changes?

**Partially.**

| Layer | Preservation Mechanism | Wallet Change Needed? |
|-------|------------------------|----------------------|
| Marketplace PSBT template | Enforces output ordering | No — wallet signs what it's given |
| Generic wallet coin selection | May merge/spend wrong UTXOs | **Risk** — wallet must sign specific PSBT |
| Post-trade split | Buyer isolates sat in follow-up tx | Requires `ord` or tool |
| Pre-trade isolation | Seller extracts sat to clean UTXO | Requires `ord` or Sating/Satonomy |

**Conclusion:** Settlement PSBTs can preserve sats **if the marketplace constructs them correctly** and the wallet signs the exact PSBT without modifying inputs. Generic wallets do not actively preserve sats but will not break preservation if they sign as directed.

### 5.4 Bump-UTXO Scheme Fragmentation

Marketplaces use inconsistent bump counts:

| Scheme | Bumps | Post-Trade State |
|--------|-------|------------------|
| 0-bump | 0 | Asset may land at non-zero offset; split needed |
| 1-bump | 1 | Varies |
| 2-bump | 2 | Industry common (ord#2706) |
| 3-bump | 3 | Some venues |

**Protocol must specify one canonical scheme** to enable cross-marketplace interoperability.

---

## 6. Proposed Canonical PSBT Rules (Sat Asset Protocol v1)

### 6.1 Listing PSBT (Seller)

| Rule | Value |
|------|-------|
| Seller input index | 0 |
| Seller sighash | `SIGHASH_SINGLE \| ANYONECANPAY` (0x03) |
| Seller output index | 0 (payment) |
| Asset input | Must be sole occupant of UTXO OR sat at offset 0 |
| Minimum postage | 330 sats (inscription convention) or 546 sats (dust) — **TBD** |

### 6.2 Fill PSBT (Buyer) — 2-Bump Canonical

| Rule | Value |
|------|-------|
| Bump count | 2 |
| Bump size | 600 sats each (adjustable by fee environment) |
| Asset output index | 1 (offset 0 in output's sat ranges) |
| Buyer signs | All inputs except seller asset input |
| Seller sig | Merged from listing PSBT on asset input |

### 6.3 Validation Rules (Protocol `/v1/psbt/validate`)

1. Seller input UTXO matches listing `outpoint`.
2. Asset sat (if specified) is at offset 0 in seller input UTXO's sat ranges (query ord).
3. Output ordering matches canonical template.
4. Seller signature valid for `SIGHASH_SINGLE | ANYONECANPAY`.
5. No additional seller inputs signed (anti-tamper).

---

## 7. Sat-for-Sat (v2 — Not Standard PSBT Listing)

Options ranked by feasibility:

| Approach | Standard PSBT? | Notes |
|----------|----------------|-------|
| **Sequential BTC trades** | Yes (two listings) | Not atomic; trust/market risk between trades |
| **Offer/accept with `SIGHASH_ALL`** | Yes | Both parties sign full tx; requires coordination |
| **HTLC / DLC** | Partially | Not widely wallet-supported |
| **Lightning atomic swap** | Different layer | e.g. Sparkle — out of L1 scope |
| **`SIGHASH_ANYPREVOUT`** | Would enable | **Not in Bitcoin Core**; speculative |

**Recommendation:** Defer sat-for-sat to v2 with offer/accept PSBT specification.

---

## 8. Wallet Signing Interface

### UniSat

```javascript
await window.unisat.signPsbt(psbtHex, {
  autoFinalized: false,
  toSignInputs: [{
    index: 0,
    address: sellerAddress,
    sighashTypes: [0x03]
  }]
});
```

### Sats Connect (Xverse)

Equivalent `signPsbt` with per-input sighash — **UNKNOWN** consistency across all Sats Connect implementations.

---

## 9. Settlement Verification Checklist

After broadcast, verify:

1. `txid` confirms on-chain.
2. Asset UTXO spent from seller.
3. New UTXO owned by buyer contains correct sat at offset 0 (query ord `list(outpoint)`).
4. Seller received `listing_price_sats` at payment address.
5. Listing marked `filled` in protocol database.

---

## 10. Unknowns

1. Optimal bump size at varying fee rates — **UNKNOWN** (marketplace-specific today)
2. Minimum postage for bare sats (non-inscription) — convention unclear
3. Cross-wallet `sighashTypes` support in Sats Connect — **UNKNOWN**
4. Whether offer/accept can be standardized before ord#2706 resolves — **UNKNOWN**

---

## 11. Citations

- [ord#2706 — Offer PSBT design](https://github.com/ordinals/ord/issues/2706)
- [Ordinals Wallet — PSBT settlement](https://ordinalswallet.com/learn/how-psbt-settlement-works)
- [BIP-174 PSBT](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki)
- [UniSat Wallet API](https://docs.unisat.io/dev/unisat-wallet-api)
- [mempool.space example batch tx](https://mempool.space/tx/556156e855f1603342c2236c5168b4b3752a102089792d11a7feee69438668d9)
