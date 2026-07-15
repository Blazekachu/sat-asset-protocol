# Minimal Schema v1

**Status:** Research complete (2026-07-07)  
**Purpose:** Smallest dataset required for a wallet-agnostic sat marketplace

---

## 1. Design Principles

1. **Derive, don't duplicate** — sat name, rarity, degree, block height, and offset are computable from `sat_number` via `crates/ordinals`. Store only if query latency demands it.
2. **UTXO is the custody unit** — Bitcoin has no sat concept at consensus layer; location is always `(outpoint, offset)` within a UTXO's sat ranges.
3. **Owner is derived** — from UTXO spendability + address index, not stored as primary truth.
4. **Inscription fields are optional** — bare-sat trading does not require them.

---

## 2. Core Entity: `SatAsset`

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `sat_number` | `u64` | **Yes** | ord math / `--index-sats` | Canonical identity |
| `sat_name` | `string` | Derived | `Sat(sat_number).name()` | Cache for UX; recomputable |
| `block_height` | `u32` | Derived | `Sat(sat_number).height()` | Mining block |
| `offset_in_block` | `u64` | Derived | `Sat(sat_number).epoch_position()` | Position in subsidy |
| `rarity` | `enum` | Derived | `Sat(sat_number).rarity()` | Rodarmor taxonomy |
| `current_outpoint` | `string` | **Yes** | `OUTPOINT_TO_UTXO_ENTRY` scan or `SAT_TO_SATPOINT` | `txid:vout` |
| `offset_in_output` | `u64` | **Yes** | `SatPoint.offset` | Offset within output's sat ranges |
| `current_address` | `string?` | Derived | `--index-addresses` + outpoint | Requires address index |
| `inscribed` | `bool` | Optional | `SAT_TO_SEQUENCE_NUMBER` | Default `false` if no inscription index |
| `inscription_ids` | `string[]?` | Optional | `SAT_TO_SEQUENCE_NUMBER` | Empty if bare sat |

### Mandatory vs Optional Summary

**Mandatory for marketplace v1:**
- `sat_number`
- `current_outpoint` + `offset_in_output` (together = `satpoint`)

**Strongly recommended (derived but worth caching):**
- `sat_name`, `rarity`, `block_height`

**Optional (application-dependent):**
- `inscription_ids`, `current_address`, charms, degree, percentile

---

## 3. Core Entity: `SatRange` (for range/collection trading)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `start` | `u64` | **Yes** | Inclusive |
| `end` | `u64` | **Yes** | Exclusive (half-open) |
| `count` | `u64` | Derived | `end - start` |

Ranges are the native storage unit in ord (`OUTPOINT_TO_UTXO_ENTRY`). A marketplace listing a range must verify the range is **contiguous and wholly contained** in a listable UTXO.

---

## 4. Core Entity: `Listing` (protocol layer)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `listing_id` | `string` | **Yes** | UUID or content hash |
| `asset_type` | `enum` | **Yes** | `sat` \| `range` \| `utxo` |
| `sat_number` | `u64?` | Conditional | Required if `asset_type=sat` |
| `range` | `SatRange?` | Conditional | Required if `asset_type=range` |
| `outpoint` | `string?` | Conditional | Required if `asset_type=utxo` |
| `price_sats` | `u64` | **Yes** | Listing price in BTC sats |
| `seller_address` | `string` | **Yes** | Payment destination |
| `signed_psbt` | `string` (base64) | **Yes** | Seller partial signature |
| `created_at` | `ISO8601` | **Yes** | |
| `expires_at` | `ISO8601?` | Optional | |
| `cancelled` | `bool` | **Yes** | Off-chain or on-chain revocation |

---

## 5. Core Entity: `Offer` (bid side)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `offer_id` | `string` | **Yes** | |
| `target` | `SatAsset ref` | **Yes** | Sat, range, or UTXO |
| `bid_sats` | `u64` | **Yes** | |
| `buyer_address` | `string` | **Yes** | |
| `signed_psbt` | `string` | **Yes** | Buyer-initiated (`SIGHASH_ALL`) |
| `status` | `enum` | **Yes** | `open` \| `accepted` \| `expired` \| `cancelled` |

---

## 6. Core Entity: `Collection` (predicate-based grouping)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `collection_id` | `string` | **Yes** | |
| `name` | `string` | **Yes** | |
| `predicate_type` | `enum` | **Yes** | See §7 |
| `predicate_params` | `object` | **Yes** | Type-specific |
| `curator` | `string?` | Optional | For institution-certified collections |
| `attestation` | `string?` | Optional | Signed statement by curator |

Collections are **views over sats**, not on-chain assets. Membership is verified by evaluating predicates against `sat_number`.

---

## 7. Collection Predicate Types (v1)

| Type | Params | Verifiable From |
|------|--------|-----------------|
| `sat_number` | `{ number: u64 }` | ord math |
| `sat_range` | `{ start, end }` | ord math |
| `block_range` | `{ start_height, end_height }` | `Sat.height()` |
| `epoch` | `{ epoch: u32 }` | `Sat.epoch()` |
| `rarity` | `{ min_rarity: enum }` | `Sat.rarity()` |
| `name_prefix` | `{ prefix: string }` | `Sat.name()` |
| `mining_pool` | `{ pool_tag: string }` | **UNKNOWN** — requires coinbase metadata index |
| `historical_event` | `{ event_id: string }` | Attestation-dependent |
| `institution_certified` | `{ issuer, signature }` | Attestation layer |
| `user_defined` | `{ expression }` | **UNKNOWN** — sandbox TBD |

---

## 8. Core Entity: `Attestation` (optional extension)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `attestation_id` | `string` | **Yes** | |
| `subject_sat` | `u64` | **Yes** | |
| `claim` | `string` | **Yes** | Human-readable |
| `issuer_pubkey` | `string` | **Yes** | |
| `signature` | `string` | **Yes** | Over canonical payload |
| `expires_at` | `ISO8601?` | Optional | |

Attestations are **off-chain signed statements**. They do not change Bitcoin consensus or ord indexing.

---

## 9. What Is NOT in Minimal Schema

| Excluded | Reason |
|----------|--------|
| Inscription payload bytes | Out of protocol scope; fetch from chain/indexer |
| Full UTXO sat range lists | Query ord `list(outpoint)` on demand |
| Transaction history | ord / block explorer responsibility |
| Wallet private keys | Never in protocol data |
| Media URLs / hosting | Application layer |
| Custom satribute taxonomies | Extension via `Collection` predicates + attestations |

---

## 10. Index Requirements per Schema Field

| Field | ord Flag Required |
|-------|-------------------|
| `sat_number`, name, rarity, height | None (pure math) |
| `current_outpoint`, offset | `--index-sats` |
| `current_address` | `--index-sats` + `--index-addresses` |
| `inscribed`, `inscription_ids` | `--index-inscriptions` |

**Minimal ord deployment for bare-sat marketplace:** `--index-sats` only.

---

## 11. JSON Example

```json
{
  "sat_number": 0,
  "sat_name": "nvtdijuwxlp",
  "block_height": 0,
  "offset_in_block": 0,
  "rarity": "mythic",
  "current_outpoint": "7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e:0",
  "offset_in_output": 0,
  "current_address": null,
  "inscribed": false,
  "inscription_ids": []
}
```

**Verified:** `sat_number=0`, `name=nvtdijuwxlp`, `rarity=mythic` from local testnet4 ord 0.27.1 API (2026-07-07).

---

## 12. Citations

- [ord Architecture.md](./Ord%20Architecture.md)
- [ord API](https://docs.ordinals.com/guides/api.html)
- [crates/ordinals](https://github.com/ordinals/ord/tree/master/crates/ordinals)
