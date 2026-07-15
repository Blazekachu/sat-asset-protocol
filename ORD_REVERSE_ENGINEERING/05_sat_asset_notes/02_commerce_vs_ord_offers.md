# Commerce vs ord `NUMBER_TO_OFFER`

**Tag:** ✅ Verified ord behavior · 🔴 Protocol design

---

## What ord stores (✅ Verified)

**Table:** `NUMBER_TO_OFFER` (`index.rs:69`)  
**Key:** sequential `u64`  
**Value:** serialized PSBT bytes (`index.rs:874`)

```rust
// index.rs:863-876
pub(crate) fn insert_offer(&self, offer: Psbt) -> Result {
  let number = number_to_offer.last()?.map(|(key, _)| key.value() + 1).unwrap_or_default();
  number_to_offer.insert(number, offer.serialize().as_slice())?;
}
```

**Reader:** `get_offers()` — iterates all offers (`index.rs:850`)

This is **ord wallet** offer storage, not a marketplace orderbook API.

---

## Relation to ord#2706

Open issue for standardized offer PSBT design: https://github.com/ordinals/ord/issues/2706

ord's `NUMBER_TO_OFFER` is a **minimal persistent store** — no listing metadata, no expiry, no sat identity fields.

---

## Sat Asset Protocol approach (🔴 Design)

Protocol `Listing` entity ([Minimal Schema.md](../../docs/Minimal%20Schema.md)) adds:

| Field | ord `NUMBER_TO_OFFER` |
|-------|----------------------|
| `sat_number` | ❌ |
| `price_sats` | ❌ (inside PSBT only) |
| `seller_address` | ❌ |
| `expires_at` | ❌ |
| `asset_type` | ❌ |
| `signed_psbt` | ✅ (same concept) |

**Decision:** Study ord offers as prior art; implement protocol listing store separately (ADR-0004, ADR-0005).

---

## Interop opportunity

🟡 If ord merges offer PSBT spec, protocol could:

- Import/export compatible PSBT bytes
- Map `NUMBER_TO_OFFER` entries to protocol listings on read

**Status:** UNKNOWN — depends on ord#2706 resolution.
