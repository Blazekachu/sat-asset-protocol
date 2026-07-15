# Value Types — ord 0.27.1

**Status:** ✅ Verified from source  
**Primary file:** `vendor/ord/src/index/entry.rs`, `vendor/ord/src/index/utxo_entry.rs`

---

## UtxoEntry (most important value)

**Table:** `OUTPOINT_TO_UTXO_ENTRY`

Blob layout (`utxo_entry.rs`):

```
[varint: total value OR num_ranges if --index-sats]
[+ sat ranges: 11 bytes each]           // if --index-sats
[+ script_pubkey bytes]                 // if --index-addresses  
[+ inscription list: (u32 seq, varint offset)*]  // if --index-inscriptions
```

### SatRange encoding (11 bytes)

✅ Verified: `entry.rs` — `SatRange::store()` / `load()`

```
51-bit base (range start)
33-bit delta (end - start)
half-open interval [start, end)
```

---

## SatPointValue (44 bytes)

```
OutPoint (36 bytes) + offset (u64 LE)
```

---

## InscriptionEntryValue

✅ Verified: `entry.rs` — `InscriptionEntry` struct

Contains: inscription number, timestamp, fee, height, sat `Option<u64>`, charms, parents, etc.

**Does NOT contain:** payload bytes, media, HTML.

---

## RuneEntryValue

Rune metadata: divisibility, terms, mints, symbol, etc. (`entry.rs:43–56`).

---

## HeaderValue

Fixed `[u8; 80]` — Bitcoin block header consensus encoding.

---

## Serialized transaction

`TRANSACTION_ID_TO_TRANSACTION` value: raw `&[u8]` serialized `Transaction`.

---

## Offer PSBT

`NUMBER_TO_OFFER` value: `&[u8]` — `Psbt::serialize()` (`index.rs:874`).

---

## Empty unit `()`

`GALLERY_SEQUENCE_NUMBERS` value type `()` — presence-only set.

---

## Entry trait pattern

✅ Verified: `entry.rs:3–9`

```rust
pub(crate) trait Entry: Sized {
  type Value;
  fn load(value: Self::Value) -> Self;
  fn store(self) -> Self::Value;
}
```

All key/value types implement `Entry` for redb storage.

---

## Sat Asset Protocol Values

Protocol stores **no ord value blobs**. Only:

- Listing metadata (JSON)
- Base64 PSBT strings
- Attestation signatures

🔴 See [Minimal Schema.md](../../docs/Minimal%20Schema.md).
