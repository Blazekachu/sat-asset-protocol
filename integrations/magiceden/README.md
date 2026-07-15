# Magic Eden Adapter Mapping

Status: draft adapter spec for Session 10 (Integrator).  
Source constraints: `docs/Marketplace Analysis.md`, ADR-0006 canonical two-bump fill.

## Goal

Normalize a Magic Eden listing payload (and its seller listing PSBT) into the protocol's canonical listing create shape used by `POST /v1/listings`.

Canonical target (`CreateListingRequest`):

- `asset_type` = `"sat"`
- `sat_number`
- `outpoint`
- `price_sats`
- `seller_address`
- `signed_psbt`
- `expires_at` (nullable)

## Field Mapping (Magic Eden Payload -> Canonical)

| Canonical field | Preferred Magic Eden field(s) | Required | Notes |
|---|---|---|---|
| `asset_type` | static `"sat"` | Yes | v1 listing scope from ADR-0005/0007. |
| `sat_number` | `satNumber`, `sat_number`, `sat`, `listedSatNumber` | Yes | If absent in upstream payload, pass via adapter override from ord lookup context. |
| `outpoint` | `assetOutpoint`, `outpoint`, `utxo`, `utxoOutpoint` | Yes | Must match input 0 outpoint in seller listing PSBT. |
| `price_sats` | `priceSats`, `price_sats`, `price`, `listPriceSats` | Yes | Must equal seller listing PSBT output 0 value. |
| `seller_address` | `sellerPaymentAddress`, `seller_address`, `receiveAddress`, `sellerAddress` | Yes | Seller receive address for listing price output. |
| `signed_psbt` | `signedPsbtBase64`, `signed_psbt`, `listingPsbtBase64`, `psbtBase64`, `psbt` | Yes | Base64 seller-signed listing PSBT. |
| `expires_at` | `expiresAt`, `expires_at` | No | Normalize to `null` when omitted. |

## Seller Listing PSBT Constraints -> Canonical Assertions

| Seller listing PSBT check | Canonical assertion |
|---|---|
| Input 0 outpoint | Equals canonical `outpoint`. |
| Input 0 partial signature exists | Listing is seller-authorized. |
| Input 0 sighash is `0x03` or `0x83` | `SIGHASH_SINGLE|ANYONECANPAY` accepted by current validator path. |
| Output 0 value | Equals canonical `price_sats`. |

These checks are already enforced by current listing validation code (`parseListingPsbt` path).

## Canonical Fill Boundary (No Change in This Session)

Magic Eden-specific listing intake maps into canonical listing records only.  
Buyer fill must remain ADR-0006 canonical 2-bump (`/v1/psbt/template`, `/v1/psbt/validate`) with no template mutation in this adapter layer.

## Import-Only Adapter Entry Point

Use `mapMagicEdenListingToCanonical` from:

- `src/integrations/marketplace-adapters.ts`

The adapter intentionally does not call Magic Eden APIs directly and does not implement marketplace workflow state.
