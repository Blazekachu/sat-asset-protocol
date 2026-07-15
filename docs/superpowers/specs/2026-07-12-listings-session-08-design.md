# Session 08 Listings Design

## Goal

Implement the Phase 2 Session 08 listing slice for `sat-asset-protocol`:

- persistent listing storage
- `POST /v1/listings`
- `GET /v1/listings`
- offset-0 enforcement via ord output lookup
- tests proving accept/reject behavior

Session 09 remains responsible for PSBT template generation.

## Scope

This design covers only the listing ingestion and query path described in:

- `docs/Minimal Schema.md`
- `docs/adr/0007-utxo-listing-offset-zero-precondition.md`
- `docs/PROTOCOL_SPEC_v1.md`

Out of scope:

- buyer fill PSBT template generation
- listing fill execution
- listing cancellation endpoint
- offer endpoints
- multi-node quorum verification

## Architecture

Use a small Node `http` server with explicit dependency injection. Keep protocol rules in a pure `ListingService`, keep PSBT decoding in a dedicated parser module, and keep persistence behind a `ListingStore` interface.

The concrete store for this session is SQLite through Node's built-in `node:sqlite` module. Tests use the same SQLite-backed store in memory so the behavior exercised in tests matches production code paths.

## Data Model

The listing row stores the v1 fields required for Session 08:

- `listing_id`
- `asset_type`
- `sat_number`
- `outpoint`
- `price_sats`
- `seller_address`
- `signed_psbt`
- `created_at`
- `expires_at`
- `cancelled`

For Session 08, only `asset_type = "sat"` is accepted. `range` and `utxo` remain schema-level concepts but are rejected until their validation path exists.

## Validation Rules

`POST /v1/listings` validates:

1. request body is valid JSON
2. `asset_type` is `sat`
3. `sat_number`, `outpoint`, `price_sats`, `seller_address`, and `signed_psbt` are present
4. PSBT decodes successfully
5. PSBT unsigned transaction input `0` spends the declared `outpoint`
6. PSBT contains a seller signature on input `0`
7. PSBT input `0` uses `SIGHASH_SINGLE | ANYONECANPAY` (`0x03`)
8. unsigned transaction output `0` pays exactly `price_sats`
9. ord `output(outpoint)` shows the sat at offset `0`
10. the outpoint is indexed and unspent

Offset-0 is proven by checking the output sat ranges and confirming the listed `sat_number` equals the first sat in the first range.

## API Shape

### `POST /v1/listings`

Request:

```json
{
  "asset_type": "sat",
  "sat_number": 123,
  "outpoint": "txid:vout",
  "price_sats": 50000,
  "seller_address": "bc1...",
  "signed_psbt": "<base64>",
  "expires_at": null
}
```

Response:

```json
{
  "listing": {
    "listing_id": "...",
    "asset_type": "sat",
    "sat_number": 123,
    "outpoint": "txid:vout",
    "price_sats": 50000,
    "seller_address": "bc1...",
    "signed_psbt": "<base64>",
    "created_at": "...",
    "expires_at": null,
    "cancelled": false
  }
}
```

### `GET /v1/listings`

Returns open listings only. Optional filters:

- `sat_number`
- `outpoint`

## Testing

Tests cover:

1. valid offset-0 listing is accepted and returned by `GET /v1/listings`
2. non-offset-0 listing is rejected with `400`
3. SQLite persistence returns only open listings

## Notes

- This repo is not currently a git repository, so the spec can be written locally but cannot be committed in this session.
- Full cryptographic validation of signatures is deferred; Session 08 validates seller-signature presence and required sighash shape.
