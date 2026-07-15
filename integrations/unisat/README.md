# UniSat Adapter Mapping

Status: draft adapter spec for Session 10 (Integrator).  
Source constraints: `docs/Marketplace Analysis.md` (`create_put_on` flow), ADR-0006 canonical two-bump fill.

## Goal

Normalize a UniSat listing/create payload (including `create_put_on`-style payloads) into the protocol canonical listing create shape used by `POST /v1/listings`.

Canonical target (`CreateListingRequest`):

- `asset_type` = `"sat"`
- `sat_number`
- `outpoint`
- `price_sats`
- `seller_address`
- `signed_psbt`
- `expires_at` (nullable)

## Field Mapping (UniSat `create_put_on` Shape -> Canonical)

| Canonical field | UniSat candidate field(s) | Required | Notes |
|---|---|---|---|
| `asset_type` | static `"sat"` | Yes | v1 listing scope only. |
| `sat_number` | `satNumber`, `sat_number`, `sat`, `listedSatNumber` | Yes | If not returned by UniSat response, pass via adapter override from ord context. |
| `outpoint` | `outpoint`, `assetOutpoint`, `utxo`, `utxoOutpoint` | Yes | Must match seller listing PSBT input 0 outpoint. |
| `price_sats` | `price_sats`, `priceSats`, `price`, `unitPriceSats` | Yes | Integer sats only. |
| `seller_address` | `seller_address`, `sellerPaymentAddress`, `receiveAddress`, `sellerAddress` | Yes | Seller payment address for output 0 in listing PSBT. |
| `signed_psbt` | `signed_psbt`, `signedPsbtBase64`, `psbtBase64`, `psbt`, `signedListingPsbt` | Yes | Base64 seller-signed listing PSBT. |
| `expires_at` | `expires_at`, `expiresAt`, `expiredAt` | No | Normalize to `null` when omitted. |

## Asset Model Fields (rare sats, named sats, ranges)

The adapter maps the full asset model, not just single-sat (`asset_type="sat"`)
listings. `price_sats` stays **required** — listings are priced in sats
(sat-for-BTC); sat-for-sat *offers* are built from PSBTs elsewhere
(`OfferService`), never from a marketplace listing payload.

| Canonical field | UniSat candidate field(s) | Required | Notes |
|---|---|---|---|
| `asset_type` | `asset_type`, `assetType`, `type`, `listingType`, `kind` | No | One of `"sat"` \| `"range"` \| `"utxo"`; defaults to `"sat"` when absent/unrecognized. |
| `sat_range_start` | `sat_range_start`, `satRangeStart`, `rangeStart` | For `range` | First sat of the range being sold. Required when `asset_type="range"`. |
| `sat_range_size` | `sat_range_size`, `satRangeSize`, `rangeSize`, `satCount` | For `range` | Number of sats in the range. **Must equal the whole UTXO's contiguous sat span** — see pre-isolation note below. |

**Range pre-isolation (ADR-0007 / D3).** A range listing sells the **entire
UTXO's contiguous sat span**, not an arbitrary sub-range. The seller must first
**isolate the range into its own UTXO** before listing. The adapter is a pure
mapper and does not check chain state; the `range == full UTXO` constraint is
enforced by `ListingService` at `POST /v1/listings` (a sub-range listing is
rejected with a message telling the seller to isolate the range first).

## Rare-Sat / Named-Sat Discovery Context

| Discovery hint | UniSat candidate field(s) | Notes |
|---|---|---|
| `rarity` (metadata) | `rarity`, `satRarity`, `satribute`, `satributes` | Surfaced as an actual VALUE in `result.metadata.rarity` (with `rarity_source` = source key). Upstream hint only. |
| `sat_name` (metadata) | `sat_name`, `satName`, `name` | Surfaced as an actual VALUE in `result.metadata.sat_name` (with `sat_name_source` = source key). |

Note: the **canonical** `sat_name` / `rarity` used for discovery are derived by
`/v1/assets/*` from `sat_number` via `satName` / `rarityOfSat`. The adapter
`metadata` values are upstream-supplied provenance/hints only, not authoritative.

## `create_put_on` Compatibility Notes

| UniSat concept | Canonical effect |
|---|---|
| `create_put_on` listing creation | Produces or references seller listing PSBT material. |
| Seller signing step | Must preserve seller input 0 `SIGHASH_SINGLE|ANYONECANPAY` (`0x03` / `0x83`) semantics accepted by validator. |
| Price field variants | Adapter converts string or number to integer `price_sats`. |

## Canonical Fill Boundary (No Change in This Session)

UniSat integration maps listing intake only.  
All buyer-fill validation and template generation stays on protocol ADR-0006 canonical 2-bump path.

## Import-Only Adapter Entry Point

Use `mapUniSatCreatePutOnToCanonical` from:

- `src/integrations/marketplace-adapters.ts`

The adapter layer intentionally excludes UniSat auth, REST orchestration, bidding, auction state, and broadcast flows.
