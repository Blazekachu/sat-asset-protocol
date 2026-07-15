# Integrations — the neutral, verify-it-yourself model

Sat Asset Protocol is **marketplace-neutral and non-custodial**. Integrating a
marketplace does not mean trusting one — it means mapping open data into a
canonical shape and verifying everything against **your own** Bitcoin + `ord`
node. The protocol standardizes *metadata and verification*, not settlement
mechanics, so no marketplace has to hand over custody or adopt a new settlement
engine to interoperate.

The guiding model: **bring your own Bitcoin + `ord` node, verify everything
yourself.**

## 1. How a marketplace maps its listing payload

An adapter takes a marketplace's **listing** payload and produces a canonical
`CreateListingRequest` (plus provenance). Adapters are **pure payload mappers**
— they call **no** external marketplace API (the neutrality guarantee).

Two paths:

- **Specific adapter** — a named mapping for a known payload shape:
  - `mapUniSatCreatePutOnToCanonical` — UniSat (**live**).
  - `mapMagicEdenListingToCanonical` — Magic Eden (**`@deprecated`**; its BTC
    ordinals marketplace has closed, retained for reference).
  - `mapSatflowListingToCanonical`, `mapOrdNetListingToCanonical` —
    **illustrative best-effort** (Satflow wound down; ord.net has no publicly
    pinned schema). Do not assume live-API compatibility.
- **Generic adapter** — `mapGenericListingToCanonical`, a superset of common
  aliases plus `AdapterOverrides`. This is the **reliable, zero-code-change**
  path: any marketplace integrates by matching common field names or supplying
  overrides. See `generic/README.md`.

All adapters live in `src/integrations/marketplace-adapters.ts`. See
`docs/Marketplace Analysis.md` for the current landscape and per-marketplace
READMEs under this directory for field tables.

## 2. Listings and offers are open data + standard PSBTs — anyone can verify

- **Listings** are plain records (canonical `CreateListingRequest`) referencing
  a seller-signed PSBT. **Offers** (sat-for-sat, ADR-0014) are standard,
  mirrored 2-bump PSBTs constructed from on-chain UTXOs — *not* from marketplace
  listing payloads.
- Because both are open data + standard Bitcoin PSBTs, **anyone with a Bitcoin +
  `ord` node can verify them independently** — no marketplace or protocol
  operator is a trusted intermediary. Verify a sat's provenance/custody yourself
  via the quorum endpoint **`GET /v1/verify/sat/{n}`**, which cross-checks
  independent `ord` nodes so no single indexer is authoritative.

## 3. The three sellable asset kinds and where they live

| Asset kind | `asset_type` | List | Discover | Trade |
|---|---|---|---|---|
| **Rare sats / named sats** (single sat) | `"sat"` | `POST /v1/listings` | `GET /v1/assets/{sat_number}` (derives `sat_name` + `rarity`), `GET /v1/assets/search?name_prefix=…&rarity=…` | sat-for-BTC fill (`/v1/psbt/*`) or sat-for-sat offer (`/v1/sat-for-sat/offers/*`) |
| **Ordinal ranges** (whole UTXO span) | `"range"` | `POST /v1/listings` with `sat_range_start` / `sat_range_size` | `GET /v1/assets/range/{start}/{end}`, `GET /v1/listings?asset_type=range` | sat-for-BTC fill |
| **Whole UTXO** | `"utxo"` | `POST /v1/listings` | `GET /v1/listings?asset_type=utxo` | sat-for-BTC fill |

Rare-sat / named-sat semantics are derived server-side from `sat_number` via
`satName` / `rarityOfSat`; an adapter may also surface upstream `sat_name` /
`rarity` *hints* in `result.metadata`.

**Range pre-isolation (ADR-0007).** A `range` listing sells the **whole UTXO's
contiguous sat span**, not an arbitrary sub-range. Sellers must **isolate the
range into its own UTXO first**; `ListingService` rejects a sub-range listing.
Adapters are pure mappers and do not enforce this — the server does.

## 4. Non-custodial guarantee

The protocol **never holds keys**. Sellers sign their own listing PSBTs; buyers
and offer counterparties sign their own inputs; settlement is a single atomic
Bitcoin transaction that transfers asset and payment together. There is no
protocol-held escrow, hot wallet, or custodial account — the same
non-custodial property every comparable PSBT marketplace relies on, made
verifiable end-to-end.

## Related ADRs

- **ADR-0005** — v1 PSBT is sat-for-BTC only (listing scope).
- **ADR-0007** — UTXO listing offset-zero precondition (range pre-isolation).
- **ADR-0014** — sat-for-sat offer/accept, `SIGHASH_ALL` (v2 offers).
- **ADR-0015** — dust thresholds and canonical postage.

## Directory map

- `generic/README.md` — the zero-code-change integration primitive + overrides.
- `unisat/README.md` — live marketplace mapping.
- `magiceden/README.md` — deprecated mapping (marketplace closed).
- `satflow/README.md`, `ord-net/README.md` — illustrative best-effort mappings.
