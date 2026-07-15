# Key Types — ord 0.27.1

**Status:** ✅ Verified from source (`vendor/ord/src/index/entry.rs`, `index.rs:58–81`)

---

## Index Table Keys

| Key type | Rust type | Size / encoding | Used in tables |
|----------|-----------|-----------------|----------------|
| OutPoint | `OutPointValue` | 36 bytes (txid + vout) | `OUTPOINT_TO_UTXO_ENTRY`, `OUTPOINT_TO_RUNE_BALANCES` |
| Sat number | `u64` | 8 bytes LE | `SAT_TO_SATPOINT`, `SAT_TO_SEQUENCE_NUMBER` |
| Sequence number | `u32` | 4 bytes LE | Inscription/rune/collection tables |
| Block height | `u32` | 4 bytes LE | `HEIGHT_TO_*` tables |
| Inscription ID | `InscriptionIdValue` | txid + index index | `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` |
| Inscription number | `i32` | signed | `INSCRIPTION_NUMBER_TO_SEQUENCE_NUMBER` |
| Script pubkey | `&[u8]` | variable | `SCRIPT_PUBKEY_TO_OUTPOINT` |
| Txid | `&TxidValue` | 32 bytes | `TRANSACTION_ID_TO_*` |
| Rune ID | `RuneIdValue` | block + tx index | `RUNE_ID_TO_RUNE_ENTRY` |
| Rune name | `u128` | | `RUNE_TO_RUNE_ID` |
| Offer number | `u64` | sequential | `NUMBER_TO_OFFER` |
| Statistic ID | `u64` | enum discriminant | `STATISTIC_TO_COUNT` |
| Timestamp | `u128` | | `WRITE_TRANSACTION_STARTING_BLOCK_COUNT_TO_TIMESTAMP` |

---

## Special OutPoints (✅ Verified)

| OutPoint | Purpose | Source |
|----------|---------|--------|
| `OutPoint::null()` | Lost sats | `lib.rs` / `index.rs` |
| `unbound_outpoint()` | Unbound inscriptions | `lib.rs` |

---

## SatPoint Key (value, but identity-relevant)

`SatPointValue` = 44 bytes: `outpoint (36) + offset (u64)`

String form: `txid:vout:offset` — used in APIs and CLI.

---

## Multimap Keys

Multimaps allow multiple values per key:

| Multimap | Key | Values |
|----------|-----|--------|
| `SAT_TO_SEQUENCE_NUMBER` | sat `u64` | inscription sequence numbers |
| `SCRIPT_PUBKEY_TO_OUTPOINT` | script bytes | outpoints |
| `SEQUENCE_NUMBER_TO_CHILDREN` | parent seq | child seqs |
| `LATEST_CHILD_*_TO_COLLECTION_*` | child seq | collection seqs |

---

## Sat Asset Protocol Keys

Protocol layer uses **orthogonal keys** (not ord redb keys):

| Field | Type | Maps to ord |
|-------|------|-------------|
| `sat_number` | `u64` | `SAT_TO_SATPOINT` key |
| `listing_id` | string/UUID | N/A — protocol-only |
| `outpoint` | string `txid:vout` | `OUTPOINT_TO_UTXO_ENTRY` key |

🔴 Design proposal: Protocol DB keys are commerce identifiers; ord keys are indexing identifiers. Never merge the databases.
