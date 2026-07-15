# API Specification

**Status:** Research complete (2026-07-07)  
**Scope:** Existing ord APIs + proposed Sat Asset Protocol API surface

---

## 1. API Capability Matrix — ord (Existing)

Source: [docs.ordinals.com/guides/api.html](https://docs.ordinals.com/guides/api.html), `src/subcommand/server.rs`

### 1.1 Sat Lookup & Location

| Endpoint | Method | Index Flags | Capability | Input Formats |
|----------|--------|-------------|------------|---------------|
| `/sat/{sat}` | GET | `--index-sats` for location | Full sat metadata + satpoint | number, name, degree, decimal, percentile |
| `/ordinal/{sat}` | GET | same | Redirect → `/sat/{sat}` | same |
| `/satpoint/{satpoint}` | GET | `--index-sats` | Reverse lookup: satpoint → sat | `txid:vout:offset` |
| `/output/{outpoint}` | GET | `--index-sats` for ranges | UTXO sat ranges, inscriptions | `txid:vout` |
| `/outputs` | POST | `--index-sats` | Batch output lookup | array of outpoints |
| `/outputs/{address}` | GET | `--index-addresses` | Address → outputs with sat ranges | bech32 address |
| `/address/{address}` | GET | `--index-addresses` | Aggregated balances + inscriptions | bech32 address |

### 1.2 Inscription Lookup

| Endpoint | Method | Index Flags | Capability |
|----------|--------|-------------|------------|
| `/inscription/{id}` | GET | `--index-inscriptions` | Metadata JSON |
| `/content/{id}` | GET | `--index-inscriptions` + txindex | Payload bytes (from chain) |
| `/preview/{id}` | GET | same | Rendered preview |
| `/r/inscription/{id}` | GET | same | Recursive content endpoint |
| `/r/sat/{n}` | GET | `--index-inscriptions` | First 100 inscription IDs on sat |
| `/r/sat/{n}/{page}` | GET | same | Paginated inscription IDs |
| `/r/sat/{n}/at/{index}` | GET | same | Single inscription ID |
| `/r/sat/{n}/at/{index}/content` | GET | same + txindex | Inscription content bytes |

> `/r/sat/*` accepts **integer sat number only** (not name/degree). [PR #2680](https://github.com/ordinals/ord/pull/2680)

### 1.3 Range & Supply

| Endpoint | Method | Capability |
|----------|--------|------------|
| `/range/{start}/{end}` | GET | Sat range info |
| `/block/{height_or_hash}` | GET | Block metadata + inscriptions |
| `/status` | GET | Index flags, height, version |

### 1.4 CLI Equivalents

| CLI Command | API Equivalent |
|-------------|----------------|
| `ord find <sat>` | `/sat/{sat}` (satpoint field) |
| `ord list <outpoint>` | `/output/{outpoint}` (sat_ranges) |
| `ord parse <notation>` | `/sat/{notation}` |
| `ord traits <sat>` | `/sat/{sat}` (charms, rarity, degree) |
| `ord wallet sats` | Wallet-only; lists **rare** sats in ord wallet |

### 1.5 JSON API Activation

Set header: `Accept: application/json`

**Verified response fields** (`GET /sat/0`, testnet4 2026-07-07):

```json
{
  "number": 0,
  "name": "nvtdijuwxlp",
  "rarity": "mythic",
  "degree": "0°0′0″0‴",
  "decimal": "0.0",
  "percentile": "0%",
  "block": 0,
  "cycle": 0, "epoch": 0, "period": 0, "offset": 0,
  "timestamp": 1714777860,
  "charms": ["coin", "mythic", "palindrome"],
  "inscriptions": [],
  "satpoint": "7aa0a7ae...:0:0",
  "address": null
}
```

---

## 2. API Capability Matrix — ord Wallet / PSBT

| Capability | Supported | Notes |
|------------|-----------|-------|
| Create PSBT | Via `ord wallet send` | Not a generic marketplace PSBT builder |
| Sign PSBT | Bitcoin Core integration | ord wallet uses Core RPC |
| Sat-named send | `ord wallet send <addr> <sat-name>` | **Only wallet with sat-selection** |
| UTXO split | `ord wallet split` | YAML config; does not assign inscriptions to outputs |
| Coin selection | ord wallet internal | Sat-aware for rare sats |
| Batch marketplace PSBT | **No** | Use marketplace APIs |

**Citation:** [Collecting guide](https://docs.ordinals.com/guides/collecting.html), [Sat hunting](https://docs.ordinals.com/guides/sat-hunting.html)

---

## 3. API Capability Matrix — Third-Party Indexers

| Provider | Sat Lookup | UTXO Ranges | Rare Sats | PSBT Marketplace | Public API |
|----------|------------|-------------|-----------|------------------|------------|
| **ord** | Yes | Yes | Rodarmor only | No | Self-hosted |
| **Magic Eden** | Via indexer | Yes | ME + Black Sats taxonomy | Yes | [ME Ordinals API](https://docs.magiceden.io/reference/ordinals-overview) |
| **UniSat** | Yes | Yes | Partial | Yes | [Open API v3](https://open-api.unisat.io/) |
| **SimpleHash** | Yes | UTXO chain ID | Custom satributes | No | [SimpleHash docs](https://simplehash.com/blog/how-to-query-rare-sats) |
| **Ordiscan** | Yes | Yes | Partial | No | Third-party |
| **Ordinals Wallet** | Yes | Yes | Partial | PSBT (undocumented REST) | `turbo.ordinalswallet.com` |

---

## 4. Proposed Sat Asset Protocol API (v0 — Not Implemented)

These endpoints define the **commerce layer** on top of ord. They do not duplicate ord indexing.

### 4.1 Asset Discovery

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/assets/{sat_number}` | GET | Resolve sat → current custody + listing status |
| `/v1/assets/range/{start}/{end}` | GET | Range membership + overlapping listings |
| `/v1/collections/{id}/assets` | GET | Paginated sats matching collection predicate |
| `/v1/collections/{id}/verify/{sat_number}` | GET | Boolean membership test |

### 4.2 Listings & Offers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/listings` | POST | Submit signed listing PSBT |
| `/v1/listings` | GET | Query open listings (filter by sat, range, collection) |
| `/v1/listings/{id}` | DELETE | Cancel listing (revoke or on-chain spend) |
| `/v1/listings/{id}/fill` | POST | Buyer submits completion PSBT |
| `/v1/offers` | POST | Buyer-initiated offer PSBT |
| `/v1/offers/{id}/accept` | POST | Seller countersigns |

### 4.3 Settlement & Verification

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/psbt/validate` | POST | Validate PSBT against listing rules + sat preservation |
| `/v1/psbt/template` | POST | Generate buyer-fill template for a listing |
| `/v1/verify/sat/{number}` | GET | Cross-check against configured ord node(s) |
| `/v1/verify/listing/{id}` | GET | Confirm asset still at listed outpoint |

### 4.4 Attestations & Metadata Extensions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/attestations` | POST | Submit signed attestation |
| `/v1/attestations/{sat_number}` | GET | List attestations for a sat |
| `/v1/metadata/{sat_number}` | GET | Application metadata (non-consensus) |

---

## 5. Integration Pattern

```
Wallet                    Sat Asset Protocol API          ord node
  │                              │                          │
  │── sign listing PSBT ────────►│                          │
  │                              │── verify outpoint ──────►│
  │                              │◄─ sat_ranges ────────────│
  │◄─ listing_id ────────────────│                          │
  │                              │                          │
  │── fill PSBT ────────────────►│                          │
  │                              │── validate satpoint ────►│
  │◄─ txid ──────────────────────│                          │
```

**Rule:** Protocol API never recomputes FIFO. It **delegates** sat location to ord (or compatible indexer).

---

## 6. Gaps in Existing APIs

| Gap | Impact | Protocol Response |
|-----|--------|-------------------|
| No standard marketplace PSBT schema | Incompatible bump-UTXO schemes | Publish canonical PSBT template in PSBT Settlement.md |
| No sat-for-sat listing PSBT | Cannot barter via `SIGHASH_SINGLE` | Define offer/accept flow |
| Fragmented satribute definitions | Collection predicates disagree | Support multiple predicate namespaces |
| ord has no listing/offer endpoints | Commerce is marketplace-specific | Sat Asset Protocol fills this layer |
| `/r/sat/*` integer-only | Name-based discovery needs conversion | Protocol resolves names → numbers |

---

## 7. Citations

- [ord API guide](https://docs.ordinals.com/guides/api.html)
- [ord Architecture.md](./Ord%20Architecture.md)
- [Magic Eden Ordinals API](https://docs.magiceden.io/reference/ordinals-overview)
- [UniSat Open API](https://docs.unisat.io/dev/open-api-documentation)
