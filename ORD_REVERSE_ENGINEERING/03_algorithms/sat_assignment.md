# Sat Assignment Algorithm

**Status:** ✅ Verified from source  
**Files:** `vendor/ord/bip.mediawiki`, `vendor/ord/src/index/updater.rs`, `vendor/ord/crates/ordinals/`

---

## Theory (BIP)

Sats numbered 0 … SUPPLY−1 in mining order. FIFO transfer across transaction inputs/outputs.

Non-coinbase transactions processed **before** coinbase in each block.

## Implementation

`Updater::index_transaction_sats()` — assigns input sat ranges to outputs in order.

Coinbase receives subsidy + accumulated fees via `coinbase_inputs`.

## Storage

Not per-sat rows — **11-byte ranges** in `UtxoEntry` inside `OUTPOINT_TO_UTXO_ENTRY`.

## Sat Asset

Use `crates/ordinals` for math; query ord for location. ADR-0001, ADR-0002.

See [Ord Architecture.md](../../docs/Ord%20Architecture.md) for full detail.
