# Generic Adapter — the zero-code-change integration path

`mapGenericListingToCanonical(payload, overrides?)` is the **core neutrality
primitive** of the integration layer. It maps *any* marketplace's listing
payload into the canonical `CreateListingRequest` using a **superset of common
aliases** across marketplaces, plus caller-supplied `AdapterOverrides`.

An unlisted marketplace integrates with **zero code changes** — no new adapter
function required — by either:

1. emitting a payload whose keys match one of the common aliases, or
2. supplying `AdapterOverrides` for any canonical value that has no matching
   alias.

Entry point: `mapGenericListingToCanonical` from
`src/integrations/marketplace-adapters.ts`. Like every adapter here, it is a
**pure payload mapper** and calls **no external API** (the neutrality
guarantee).

## Canonical target (`CreateListingRequest`)

- `asset_type` — `"sat"` \| `"range"` \| `"utxo"` (default `"sat"`)
- `sat_number`
- `outpoint`
- `price_sats` (required — listings are sat-for-BTC)
- `seller_address`
- `signed_psbt`
- `expires_at` (nullable)
- `sat_range_start` / `sat_range_size` (for `asset_type="range"`)

## Common alias superset

| Canonical field | Common aliases matched |
|---|---|
| `asset_type` | `asset_type`, `assetType`, `type`, `listingType`, `kind` |
| `sat_number` | `satNumber`, `sat_number`, `sat`, `listedSatNumber`, `satoshi`, `ordinal`, `sat_ordinal` |
| `outpoint` | `outpoint`, `assetOutpoint`, `utxo`, `utxoOutpoint`, `location`, `satpoint`, `output` |
| `price_sats` | `priceSats`, `price_sats`, `price`, `listPriceSats`, `unitPriceSats`, `amount`, `priceInSats` |
| `seller_address` | `sellerPaymentAddress`, `seller_address`, `receiveAddress`, `sellerAddress`, `sellerReceiveAddress`, `payoutAddress`, `address` |
| `signed_psbt` | `signedPsbtBase64`, `signed_psbt`, `listingPsbtBase64`, `psbtBase64`, `psbt`, `signedListingPsbt`, `sellerPsbt` |
| `expires_at` | `expiresAt`, `expires_at`, `expiredAt`, `expiry`, `expiration` |
| `sat_range_start` | `sat_range_start`, `satRangeStart`, `rangeStart`, `range_start`, `startSat`, `start`, `rangeFrom` |
| `sat_range_size` | `sat_range_size`, `satRangeSize`, `rangeSize`, `range_size`, `size`, `satCount`, `rangeLength` |
| `sat_name` (metadata) | `sat_name`, `satName`, `name`, `satNameLabel`, `ordinalName`, `displayName` |
| `rarity` (metadata) | `rarity`, `satRarity`, `satribute`, `satributes`, `rareType`, `rarityTier`, `tier` |

The first candidate that resolves to a non-empty value wins. The source **key**
each canonical field was pulled from is recorded in `result.source_fields`.

## The `AdapterOverrides` mechanism

`AdapterOverrides` takes precedence over the payload for any field it sets, and
is the reliable escape hatch when a payload uses field names not in the alias
list:

```ts
const { listing, source_fields, metadata } = mapGenericListingToCanonical(
  marketplacePayload,
  {
    sat_number: 123456789,               // e.g. resolved from an ord lookup
    outpoint: "…:0",
    price_sats: 12345,
    seller_address: "bc1q…",
    signed_psbt: "cHNidP8B…",
    // asset_type / sat_range_start / sat_range_size / sat_name / rarity also supported
  },
);
```

Overridden fields appear in `source_fields` as `overrides.<field>`; unresolved
fields appear as `override_only`.

## Result contract

```ts
interface MarketplaceAdapterResult {
  listing: CreateListingRequest;
  source_fields: { /* source KEY name per field, or overrides.<field> */ };
  metadata: {
    sat_name?: string;      // actual VALUE lifted from payload/override
    rarity?: string;        // actual VALUE lifted from payload/override
    sat_name_source?: string;
    rarity_source?: string;
  };
}
```

`source_fields` records only the source **key**; `metadata` carries the actual
**values** for discovery hints. Canonical `sat_name` / `rarity` for discovery
are still derived by `/v1/assets/*` from `sat_number` via `satName` /
`rarityOfSat` — the adapter `metadata` is an upstream-supplied hint only.

## Range pre-isolation (ADR-0007)

A `range` listing sells the **whole UTXO's contiguous sat span**, not an
arbitrary sub-range. Sellers must **isolate the range into its own UTXO first**.
The adapter is a pure mapper and does not check chain state; the
`range == full UTXO` constraint is enforced by `ListingService` at
`POST /v1/listings`.

## See also

- `../README.md` — the neutral, two-node integration guide.
- `../unisat/README.md` — a concrete (live) marketplace mapping.
- `../satflow/README.md`, `../ord-net/README.md` — illustrative best-effort
  mappings; prefer generic + overrides.
