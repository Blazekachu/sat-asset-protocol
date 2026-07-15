# Marketplace Analysis

**Status:** Research complete (2026-07-07)

---

## 1. Executive Summary

All major Bitcoin Ordinals marketplaces use **off-chain signed PSBTs + on-chain atomic settlement**. The listing unit is the **UTXO**, not an individual sat. Rare-sat specialists (Magisat, Sating, Magic Eden rare sats) require **pre-isolation** of sats into dedicated UTXOs before listing. No marketplace implements a formal **sat-for-sat** barter protocol on L1.

**Implication:** Sat Asset Protocol can standardize what marketplaces already do informally, and extend to sat-native identity without replacing their infrastructure.

---

## 2. Comparison Matrix

| Marketplace | Assets | Listing Model | Offer/Bid | Settlement | PSBT Pattern | Public API |
|-------------|--------|---------------|-----------|------------|--------------|------------|
| **Magic Eden** | Inscriptions, Runes, rare sats | Seller signs listing PSBT | Unknown (listings focus) | Single atomic tx | `SIGHASH_SINGLE\|ANYONECANPAY` | [ME Ordinals API](https://docs.magiceden.io/reference/ordinals-overview) |
| **UniSat** | Ordinals, BRC-20, Runes, Alkanes | `create_put_on` → sign PSBT | `create_bid` → `psbtBid` | Atomic on-chain | Standard + auction fields | [Open API v3](https://open-api.unisat.io/) |
| **Magisat** | Rare sats (UTXO) | P2P partial PSBT | Not documented | Atomic on-chain | Listing + buyer wallet prep | **Unknown** |
| **Sating** | Rare sats (UTXO) | Whole-UTXO listing | Unknown | PSBT-based | Same family | **Unknown** |
| **Ordinals Wallet** | Inscriptions | Sign-once listing | Unknown | Single atomic tx | Industry standard | Indexing API only |
| **Gamma** | Inscriptions | PSBT listing | Auctions/editions | On-chain atomic | PSBT + on-chain unlisting | **Unknown** |
| **OrdinalsBot** | Inscriptions | `create-listing` → base64 PSBT | Listings confirm | PSBT atomic | `SIGHASH_SINGLE\|ANYONECANPAY` | [Marketplace API](https://docs.ordinalsbot.com/marketplace-1/list-ordinals-for-sale) |
| **Satflow** | Inscriptions, Runes | `POST /intent/sell` | Unknown | PSBT | Standard sighash | [Satflow API](https://docs.satflow.com/reference/post_intent-sell) |
| **SatsX** | OP_NET tokens | NativeSwap price lock | Unknown | WASM contracts | **Not ordinals PSBT** | **Unknown** |
| **Satonomy** | — | **Not a marketplace** | — | — | — | Wallet tool only |

---

## 3. Common Settlement Model

All comparable marketplaces follow the same pattern documented by [Ordinals Wallet](https://ordinalswallet.com/learn/how-psbt-settlement-works):

1. **List (off-chain):** Seller signs PSBT with asset UTXO as input 0, payment output as output 0. Signature uses `SIGHASH_SINGLE | ANYONECANPAY`.
2. **Store:** Marketplace stores partial PSBT in database. Asset remains in seller wallet.
3. **Fill (on-chain):** Buyer adds funding inputs, bump UTXOs, fee/royalty outputs. Signs buyer inputs. Merges seller signature.
4. **Settle:** Single Bitcoin transaction atomically transfers asset + payment.
5. **Invalidate:** Seller spends UTXO elsewhere, or marketplace revokes listing.

**Key property:** Non-custodial — marketplace never holds keys.

---

## 4. Per-Marketplace Detail

### 4.1 Magic Eden

- **Listing:** Seller signs PSBT; stored off-chain ([ME PSBT security](https://help.magiceden.io/en/articles/7191642-securing-your-bitcoin-wallet-with-psbt-on-magic-eden)).
- **Rare sats:** Dedicated batch listing endpoints ([batch listing PSBT](https://docs.magiceden.io/reference/post_v2-ord-btc-raresats-listing-psbt)).
- **Fees:** Off-chain cancel; developing on-chain batch invalidation.
- **Wallets:** Xverse, ME Wallet, Leather, OKX.
- **Indexing:** Proprietary; includes Black Sats taxonomy not in ord ([ord#2815](https://github.com/ordinals/ord/issues/2815)).

### 4.2 UniSat

- **Listing:** `POST /v3/market/collection/auction/create_put_on`.
- **Buy:** `create_bid` → `psbtBid` with `bidSignIndexes`.
- **Fees:** 0.5% taker ([UniSat marketplace](https://docs.unisat.io/products/more-products/unisat-marketplace)).
- **Indexing:** Own indexer — 220+ Open API endpoints.
- **Gap:** Primary focus is collections/protocol tokens, not bare rare sats.

### 4.3 Magisat (Rare-Sat Specialist)

- **Unit:** Full UTXO (may contain multiple satributes).
- **Listing:** P2P PSBT; 0% maker, 2.5% taker.
- **Buyer prep:** First-time buyers create small padding UTXOs ([tutorial](https://magisat.io/tutorials/basics)).
- **Wallets:** Xverse (recommended), UniSat.
- **Gap:** No public developer API documented.

### 4.4 Sating

- **Unit:** Whole UTXO after "Transfer Sats" isolation ([listing prep](https://docs.sating.io/how-to-use-sating/sat-marketplace/prepare-your-listing)).
- **Addresses:** P2TR, P2WPKH only.
- **Safety:** Won't spend valuable sats for fees.
- **Gap:** PSBT schema and API undocumented.

### 4.5 Gamma

- **Differentiator:** On-chain unlisting with network fee ([security article](https://support.gamma.io/hc/en-us/articles/15065621705875)).
- **Gap:** Rare-sat support unclear; primarily inscriptions.

---

## 5. Indexing Assumptions (Cross-Cutting)

| Assumption | Implication for Protocol |
|------------|-------------------------|
| UTXO = listing unit | Protocol must support `asset_type: utxo` as first-class |
| Ordinals index required | Mandate ord-compatible indexer; document flag requirements |
| Satribute definitions vary | Collections use explicit predicate namespaces |
| Offset matters | PSBT template must land asset at offset 0 in buyer output |
| Third-party indexers | Protocol should not depend on a single marketplace indexer |

---

## 6. Adoption Path for Existing Marketplaces

| Phase | Action | Effort |
|-------|--------|--------|
| **1. Read compatibility** | Marketplaces continue existing PSBT flows; protocol adds metadata layer | Low |
| **2. Listing schema** | Map existing listing PSBTs to protocol `Listing` entity | Medium |
| **3. Verification API** | Marketplaces call `/v1/verify/sat/{n}` against shared ord nodes | Medium |
| **4. Collection predicates** | Marketplaces publish satribute → predicate mappings | Medium |
| **5. Unified PSBT template** | Adopt canonical bump-UTXO scheme from PSBT Settlement.md | High (coordination) |

**Incremental adoption is feasible** because the protocol standardizes metadata and verification, not settlement mechanics.

---

## 7. What's NOT Covered by Current Marketplaces

| Capability | Status |
|------------|--------|
| Sat-for-sat atomic barter | **Not supported** |
| Arbitrary sat range listings (partial UTXO) | **Not supported** — whole UTXO only |
| Block-range / epoch collections as tradeable units | Display only, not settlement primitives |
| Institution-certified collections | Ad hoc (Magic Eden launchpad model) |
| Cross-marketplace listing portability | **Not supported** |
| Open attestation layer | **Not supported** |

These are opportunities for Sat Asset Protocol differentiation.

---

## 8. Unknowns

1. Magic Eden bid PSBT schema for rare sats — **UNKNOWN**
2. Magisat / Sating public REST APIs — **UNKNOWN**
3. Ordinals Wallet marketplace PSBT endpoints — partially documented
4. Whether any marketplace will adopt an external protocol standard — **UNKNOWN**

---

## 9. Citations

- [Ordinals Wallet — PSBT settlement](https://ordinalswallet.com/learn/how-psbt-settlement-works)
- [Magic Eden Ordinals API](https://docs.magiceden.io/reference/ordinals-overview)
- [UniSat marketplace](https://docs.unisat.io/products/more-products/unisat-marketplace)
- [Magisat basics](https://magisat.io/tutorials/basics)
- [Sating listing prep](https://docs.sating.io/how-to-use-sating/sat-marketplace/prepare-your-listing)
- [Gamma unlisting security](https://support.gamma.io/hc/en-us/articles/15065621705875)
- [ord#2706 — PSBT design discussion](https://github.com/ordinals/ord/issues/2706)
