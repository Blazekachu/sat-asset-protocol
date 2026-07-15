# Testnet4 Round-Trip Demo (Manual)

This runbook demonstrates one end-to-end adapter round-trip on testnet4 without introducing a full marketplace implementation.

Scope:

- Import marketplace listing payload.
- Adapt to canonical listing shape.
- Submit canonical listing to protocol API.
- Build canonical ADR-0006 buyer-fill template.
- Validate fill PSBT.

## Prerequisites

- Local protocol server running (Session 09 APIs available):
  - `POST /v1/listings`
  - `POST /v1/psbt/template`
  - `POST /v1/psbt/validate`
- `ord` running on testnet4 with sat index.
- Known seller listing vector or live listing PSBT that passes Session 09 checks.
- Two 600-sat bump UTXOs + one funding UTXO in buyer wallet context.

## 1) Build a Canonical Listing Input via Adapter

Example (Node REPL/script):

```ts
import { mapUniSatCreatePutOnToCanonical } from "./src/integrations/marketplace-adapters.ts";

const adapted = mapUniSatCreatePutOnToCanonical({
  sat_number: "777777777",
  outpoint: "<seller_txid>:0",
  price: "15000",
  receiveAddress: "tb1q_seller_receive",
  psbt: "<base64_listing_psbt>",
});

console.log(adapted.listing);
```

Expected:

- `asset_type: "sat"`
- integer `sat_number`
- `outpoint`, `price_sats`, `seller_address`, `signed_psbt` populated

## 2) Create Listing in Protocol API

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/listings \
  -H "content-type: application/json" \
  -d '<adapted.listing JSON>'
```

Record `listing_id` from response.

## 3) Build ADR-0006 Canonical Fill Template

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/psbt/template \
  -H "content-type: application/json" \
  -d '{
    "listing_id": "<listing_id>",
    "bump_inputs": [
      {"outpoint":"<bump_txid_1>:0","value_sats":600,"script_pubkey_hex":"<buyer_script_hex>"},
      {"outpoint":"<bump_txid_2>:1","value_sats":600,"script_pubkey_hex":"<buyer_script_hex>"}
    ],
    "funding_inputs": [
      {"outpoint":"<funding_txid>:0","value_sats":4000,"script_pubkey_hex":"<buyer_script_hex>"}
    ],
    "buyer_bump_script_pubkey_hex":"<buyer_script_hex>",
    "buyer_asset_script_pubkey_hex":"<buyer_asset_script_hex>",
    "buyer_change_script_pubkey_hex":"<buyer_change_script_hex>",
    "buyer_change_value_sats":3000
  }'
```

Expected summary characteristics:

- Seller outpoint at input index `2`
- Output values begin with `1200`, `<asset_value>`, `<listing_price>`

## 4) Validate Fill PSBT

Use signed or unsigned candidate fill PSBT from step 3/your wallet flow:

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/psbt/validate \
  -H "content-type: application/json" \
  -d '{
    "listing_id":"<listing_id>",
    "psbt_base64":"<fill_psbt_base64>"
  }'
```

Expected:

- `valid: true`
- `summary.seller_input_index: 2`

## 5) Optional Chain-Level Confirmation Check

- Broadcast finalized transaction with your wallet flow.
- Query ord output for buyer asset output:
  - Confirm `indexed: true`
  - Confirm expected sat location and offset behavior.

## Notes

- This round-trip keeps canonical PSBT behavior unchanged and only adapts inbound marketplace payloads to canonical listing shape.
- Any change to canonical fill/input/output ordering requires a new ADR superseding ADR-0006.
