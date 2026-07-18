# ord.net Adapter Mapping

> **Illustrative best-effort mapping.** ord.net is user-named but has **no
> publicly pinned listing-payload schema**. The candidate field names below are
> **hypothesized**, **NOT** verified against a live API. Do **not** assume
> live-API compatibility. For a reliable integration, prefer the generic
> adapter (`mapGenericListingToCanonical` — see `../generic/README.md`) plus
> `AdapterOverrides`, and verify against a real payload before relying on any
> alias here. See `docs/Marketplace Analysis.md`.

Status: illustrative adapter spec (best-effort).
Source constraints: `docs/Marketplace Analysis.md`, ADR-0006 canonical two-bump fill.

## Goal

Normalize an ord.net-shaped listing payload into the protocol's canonical
listing create shape used by `POST /v1/listings`.

Canonical target (`CreateListingRequest`):

- `asset_type` — `"sat"` \| `"range"` \| `"utxo"` (default `"sat"`)
- `sat_number`
- `outpoint`
- `price_sats` (required — listings are sat-for-BTC)
- `seller_address`
- `signed_psbt`
- `expires_at` (nullable)
- `sat_range_start` / `sat_range_size` (for `asset_type="range"`)

## Neutral / Import-Only

This adapter **does not call the ord.net API**. It is a pure payload mapper
(import-only, marketplace-neutral) — the neutrality guarantee. Entry point:
`mapOrdNetListingToCanonical` from `src/integrations/marketplace-adapters.ts`.

## Field Mapping (ord.net-shaped Payload -> Canonical)

| Canonical field | ord.net candidate field(s) (best-effort) | Required | Notes |
|---|---|---|---|
| `asset_type` | `type`, `assetType`, `asset_type`, `kind` | No | Defaults to `"sat"` when absent/unrecognized. |
| `sat_number` | `sat`, `satNumber`, `ordinal`, `sat_number`, `satoshi` | Yes | Pass via override from ord context if absent. |
| `outpoint` | `satpoint`, `location`, `outpoint`, `output`, `utxo` | Yes | Must match seller listing PSBT input 0 outpoint. |
| `price_sats` | `priceInSats`, `priceSats`, `price`, `price_sats`, `amount` | Yes | Integer sats. |
| `seller_address` | `sellerReceiveAddress`, `sellerAddress`, `address`, `seller_address` | Yes | Seller receive address. |
| `signed_psbt` | `psbt`, `signedPsbtBase64`, `psbtBase64`, `signed_psbt`, `sellerPsbt` | Yes | Base64 seller-signed listing PSBT. |
| `expires_at` | `expiration`, `expiresAt`, `expiry`, `expires_at` | No | Normalize to `null` when omitted. |

## Rare Sats, Named Sats, Ranges

| Canonical field | ord.net candidate field(s) (best-effort) | Notes |
|---|---|---|
| `sat_range_start` | `rangeFrom`, `rangeStart`, `startSat`, `sat_range_start`, `start` | Required for `asset_type="range"`. |
| `sat_range_size` | `rangeLength`, `rangeSize`, `satCount`, `sat_range_size`, `size` | Must equal the whole UTXO's contiguous sat span (pre-isolation). |
| `rarity` (metadata) | `rarity`, `rarityTier`, `satribute`, `tier` | Surfaced as a VALUE in `result.metadata.rarity`. |
| `sat_name` (metadata) | `name`, `satName`, `displayName`, `sat_name` | Surfaced as a VALUE in `result.metadata.sat_name`. |

**Range pre-isolation (ADR-0007 / D3).** A range listing sells the entire
UTXO's contiguous sat span, not an arbitrary sub-range. Sellers must **isolate
the range into its own UTXO first**. The adapter does not check chain state;
`ListingService` enforces `range == full UTXO` at `POST /v1/listings`.

## Canonical Fill Boundary (Unchanged)

Listing intake maps to canonical listing records only. Buyer fill stays on the
ADR-0006 canonical 2-bump path (`/v1/psbt/template`, `/v1/psbt/validate`); this
adapter never mutates the template.
