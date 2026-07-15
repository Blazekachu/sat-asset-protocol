# Sat Asset Protocol — Specification v1

```
Title:    Sat Asset Protocol v1 (sat-for-BTC commerce metaprotocol)
Status:   Draft
Type:     Standards Track (protocol)
Layer:    Commerce metaprotocol (above ord, above Bitcoin)
Created:  2026-07-12
Requires: Ordinal Theory (bip.mediawiki), BIP-174 (PSBT), ord ≥ 0.27.1 with --index-sats
Author:   Sat Asset Protocol — Phase 1 (Spec Author)
Source:   Phase 0 research + ADR-0001…0011 (all Accepted, 2026-07-07)
```

> **Document status.** This is a **draft** BIP-style protocol document produced in Phase 1
> (Specification) per [ROADMAP.md](../ROADMAP.md). It is normative where it says MUST/SHALL and
> informational elsewhere. It defines the wire schemas and rules; it does **not** contain a reference
> implementation (`src/` is out of scope for this session — see §12).
>
> **Every accepted ADR (0001–0011) is reflected below.** Points where the source research documents
> and the ADRs are ambiguous or appear to conflict are collected in **[§11 Open Conflicts &
> Items for Human Review](#11-open-conflicts--items-for-human-review)** and flagged inline with the
> marker **⚠ CONFLICT** or **⚠ OPEN**.

---

## Notational Conventions

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are to be interpreted as described in
RFC 2119 / RFC 8174.

- **satpoint** — the tuple `(txid, vout, offset)` locating a sat inside a UTXO's sat ranges.
- **offset-0** — the target sat sits at offset `0` within its output's sat-range list.
- **bump UTXO** — a small padding input/output used to preserve sat offset during settlement.
- **math-only field** — a value derivable purely from `sat_number` via `crates/ordinals`, no chain index needed.

---

## 1. Abstract

Sat Asset Protocol v1 is an open, wallet-agnostic **commerce metaprotocol** for trading individual
Bitcoin satoshis, sat ranges, and whole UTXOs **for BTC**. It standardizes: (a) asset identity based
on Ordinal Theory `sat_number` (ADR-0001), (b) listing and offer schemas (ADR-0005), (c) a canonical
2-bump settlement PSBT (ADR-0006), (d) an offset-0 listing precondition (ADR-0007), (e) predicate- and
attestation-based collections (ADR-0008), and (f) a multi-node ord verification model (ADR-0009).

The protocol sits **above** `ord` and Bitcoin Core and reuses them as read-only truth sources; it
does not reimplement sat indexing (ADR-0002), does not store inscription payloads (ADR-0003), and does
not attempt to replace Ordinals, marketplaces, or wallets (ADR-0004). **Sat-for-sat atomic barter is
explicitly out of scope for v1** and deferred to v2 (ADR-0005, ADR-0010).

---

## 2. Scope

### 2.1 In scope for v1 (normative)

Per **ADR-0005** (*v1 PSBT — sat-for-BTC only*), v1 standardizes **BTC-denominated settlement only**:

| Trade type | v1 status | Mechanism |
|------------|-----------|-----------|
| Individual sat → BTC | **In scope** | Listing PSBT + canonical 2-bump fill |
| Sat range → BTC | **In scope** | Same, range wholly contained + offset-0 |
| Whole UTXO → BTC | **In scope** | Same; buyer receives whole UTXO |
| Buyer-initiated offer (bid) **in BTC** | **In scope** | Offer/accept, `SIGHASH_ALL` both sides |

All prices and bids in v1 are denominated in **BTC sats only** (ADR-0005 Compliance: `price_sats` is
a BTC amount).

### 2.2 Explicitly deferred to v2 (normative)

Per **ADR-0005** and **ADR-0010** (*sat-for-sat deferred to v2*):

- **Sat-for-sat atomic barter** — the `SIGHASH_SINGLE | ANYONECANPAY` listing model commits to a
  payment **amount**, not a specific sat ordinal, so it cannot bind sat↔sat. v1 APIs and documentation
  **MUST NOT** imply sat-for-sat is supported (ADR-0010 Compliance).
- Sat-for-inscription barter, HTLC/DLC swaps, `SIGHASH_ANYPREVOUT`-based flows.

The v2 path begins with an offer/accept PSBT prototype and will require a new ADR that supersedes or
extends ADR-0005 (ADR-0010 Compliance).

### 2.3 Architectural boundary (normative)

Per **ADR-0002**, **ADR-0003**, **ADR-0004**, and [Protocol Boundary.md](./Protocol%20Boundary.md):

- The protocol **MUST NOT** maintain a parallel sat index; sat location and range queries are
  delegated to `ord` (ADR-0002).
- The protocol **MUST NOT** store, host, cache, or serve inscription payload bytes; it is
  **metadata-only** (ADR-0003).
- The protocol is a commerce layer only; it **MUST NOT** reimplement FIFO sat numbering, naming, or
  rarity (ADR-0004, ADR-0001).

See **[§10 What Is NOT in Scope](#10-what-is-not-in-scope)** for the full exclusion list.

---

## 3. Layer Model & Trust Assumptions

```
┌─────────────────────────────────────────────┐
│              Applications                    │  UI, media rendering, analytics
├─────────────────────────────────────────────┤
│           Sat Asset Protocol (this spec)     │  listings, offers, collections, attestations
├─────────────────────────────────────────────┤
│                  ord (≥0.27.1, --index-sats) │  sat index, math, explorer API   (ADR-0002)
├─────────────────────────────────────────────┤
│              Bitcoin Core                    │  consensus, UTXO set, txindex
└─────────────────────────────────────────────┘
```

Trust assumptions:

1. **Math-only fields** (`sat_number`, name, rarity, degree, epoch, height) are trustless — verifiable
   with `crates/ordinals` and no chain index (ADR-0001, ADR-0009).
2. **Location fields** (satpoint, sat ranges, ownership) are trusted only when corroborated by
   **≥2 independent ord nodes** (ADR-0009, §8).
3. **Non-consensus claims** (mining pool, Black Sats, institutional certification) are trusted only
   via signed **attestations**; the protocol verifies signatures, not truth (ADR-0008, §7).
4. Implementations **SHOULD** pin the ord version used for verification for reproducibility
   (ADR-0011; ord 0.27.1 is the audited reference, `SCHEMA_VERSION 34`).

---

## 4. Asset Identity

### 4.1 Canonical identity (normative, ADR-0001)

The canonical identity of a tradeable asset is its Ordinal Theory **`sat_number`** (`u64`).

- Name, rarity, degree, block height, epoch, and percentile **MUST** be derived from `sat_number`
  via `crates/ordinals` and **MUST NOT** be reimplemented with an alternate FIFO or naming algorithm
  (ADR-0001 Compliance).
- Identity conformance tests **MUST** use `ordinals` crate test vectors (ADR-0001 Compliance).
- Collections and attestations **extend** identity; they **MUST NOT** replace `sat_number`
  (ADR-0001 Consequences).

Reference vector (testnet4, ord 0.27.1, 2026-07-07): `sat_number = 0` → `name = "nvtdijuwxlp"`,
`rarity = "mythic"`, `satpoint = 7aa0a7ae…:0:0`.

### 4.2 `SatAsset` object

Derived from [Minimal Schema.md §2](./Minimal%20Schema.md). Mandatory fields carry the custody
information; derived fields MAY be cached for UX but remain recomputable.

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `sat_number` | `u64` | **MUST** | ord math / `--index-sats` | Canonical identity (ADR-0001) |
| `current_outpoint` | `string` (`txid:vout`) | **MUST** | ord `--index-sats` | Custody location |
| `offset_in_output` | `u64` | **MUST** | `SatPoint.offset` | With `current_outpoint` = satpoint |
| `sat_name` | `string` | Derived | `Sat(n).name()` | Cache only |
| `rarity` | `enum` | Derived | `Sat(n).rarity()` | Rodarmor taxonomy |
| `block_height` | `u32` | Derived | `Sat(n).height()` | |
| `offset_in_block` | `u64` | Derived | `Sat(n).epoch_position()` | |
| `current_address` | `string?` | Derived | requires `--index-addresses` | |
| `inscribed` | `bool` | Optional | `--index-inscriptions` | Default `false` |
| `inscription_ids` | `string[]?` | Optional | `--index-inscriptions` | References only (ADR-0003) — never payload bytes |

**Custody unit.** Bitcoin has no sat concept at consensus; location is always `(outpoint, offset)`
inside a UTXO's sat ranges ([Minimal Schema.md §1](./Minimal%20Schema.md), ADR-0001).

### 4.3 `SatRange` object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `start` | `u64` | **MUST** | Inclusive |
| `end` | `u64` | **MUST** | Exclusive (half-open) |
| `count` | `u64` | Derived | `end - start` |

A range listing **MUST** be **contiguous and wholly contained** within a single listable UTXO
([Minimal Schema.md §3](./Minimal%20Schema.md)).

### 4.4 Minimum ord deployment (normative, ADR-0002)

| Fields needed | Required ord flag |
|---------------|-------------------|
| identity math (number, name, rarity, height) | none (pure math) |
| `current_outpoint`, `offset_in_output` | `--index-sats` |
| `current_address` | `--index-sats` + `--index-addresses` |
| `inscribed`, `inscription_ids` | `--index-inscriptions` |

Minimal bare-sat marketplace deployment: **`--index-sats` only** (ADR-0002, ADR-0003). Deployment
docs **MUST** specify `ord --index-sats` as the minimum (ADR-0002 Compliance).

---

## 5. Listing Schema

Derived from [Minimal Schema.md §4](./Minimal%20Schema.md). A **`Listing`** represents a seller's
signed intent to sell an asset for BTC.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `listing_id` | `string` | **MUST** | Identifier — see ⚠ OPEN-3 |
| `asset_type` | `enum {sat, range, utxo}` | **MUST** | |
| `sat_number` | `u64?` | Conditional | Required iff `asset_type = sat` |
| `range` | `SatRange?` | Conditional | Required iff `asset_type = range` |
| `outpoint` | `string?` | Conditional | Required iff `asset_type = utxo` |
| `price_sats` | `u64` | **MUST** | **BTC sats** (ADR-0005) |
| `seller_address` | `string` | **MUST** | Payment destination |
| `signed_psbt` | `string` (base64) | **MUST** | Seller partial signature (§6.1) |
| `created_at` | ISO-8601 | **MUST** | |
| `expires_at` | ISO-8601? | Optional | |
| `cancelled` | `bool` | **MUST** | Off-chain or on-chain revocation |

Constraints:

- `price_sats` is a **BTC** amount only. There is **no** sat-for-sat price field in v1
  (ADR-0005, ADR-0010 Compliance).
- On submission (`POST /v1/listings`, §9) the protocol **MUST** verify the **offset-0 precondition**
  (§6.4, ADR-0007) and the seller signature shape (§6.1).

---

## 6. Settlement PSBTs

Settlement uses standard **BIP-174** PSBTs. v1 defines two seller sighash regimes: the **listing PSBT**
(sell side) and the **offer PSBT** (bid side), and one canonical buyer **fill** template.

### 6.1 Listing PSBT (seller, normative)

Per [PSBT Settlement.md §3/§6.1](./PSBT%20Settlement.md) and ADR-0005:

```
Inputs:
  [0] asset_utxo            SIGHASH_SINGLE | ANYONECANPAY (0x03)   ← seller signs input 0 only
Outputs:
  [0] seller_payment_addr : price_sats
```

Rules:

| Rule | Value |
|------|-------|
| Seller input index | `0` |
| Seller sighash | `SIGHASH_SINGLE | ANYONECANPAY` (`0x03`) |
| Seller output index | `0` (payment) |
| Asset input | Sole occupant of the UTXO **OR** target sat at **offset 0** (ADR-0007) |
| Minimum postage | **⚠ OPEN-1**: 330 sats (inscription convention) vs 546 sats (dust) — unresolved |

The seller signs **only** input 0; the asset stays in the seller wallet until fill. Wallets sign the
exact PSBT with `signPsbt(..., sighashTypes: [0x03])` (UniSat/Xverse/Leather support today, ADR-0005).

### 6.2 Canonical 2-bump fill PSBT (buyer, normative, ADR-0006)

**ADR-0006** adopts the **2-bump canonical fill template** ([PSBT Settlement.md §3 Phase B](./PSBT%20Settlement.md))
as *the* protocol standard. Alternate bump counts (0, 1, 3) are **non-canonical** and **MUST** be
rejected by validators (ADR-0006).

```
Inputs (order is significant):
  [0]  bump_utxo_1   (~600 sats)   SIGHASH_ALL (0x01)
  [1]  bump_utxo_2   (~600 sats)   SIGHASH_ALL
  [2]  seller_asset_utxo           (seller sig merged from listing PSBT)
  [3+] buyer_funding_utxo(s)       SIGHASH_ALL

Outputs (order is significant):
  [0]  buyer_ordinals_addr : 1200 sats     (bump passthrough)
  [1]  buyer_ordinals_addr : asset_postage (asset lands here, at offset 0 in this output)
  [2]  seller_payment_addr : price_sats
  [3]  marketplace_fee_addr  (optional)
  [4]  royalty_addr          (optional)
  [5]  buyer_change_addr
```

| Rule | Value | Source |
|------|-------|--------|
| Bump count | **exactly 2** | ADR-0006 |
| Bump size (default) | **600 sats** each, configurable per fee environment | ADR-0006 |
| Asset output index | `1` (asset at **offset 0** within that output's sat ranges) | ADR-0006, ADR-0007 |
| Buyer signs | all inputs **except** input `[2]` (the seller asset input) | PSBT Settlement §3 |
| Seller sig | merged onto input `[2]` from the listing PSBT | PSBT Settlement §3 |

Settlement is **atomic** (all-or-nothing), **non-custodial** (the protocol/marketplace never holds
keys), and typically ~200–300 vB ([PSBT Settlement.md §3](./PSBT%20Settlement.md)).

> **Note (offset semantics).** ADR-0006/ADR-0007 place the asset at **output index 1** but at
> **offset 0 within that output's sat-range list**. "Offset 0" is a *within-output* property, not an
> output-index-0 property. See **⚠ OPEN-2**.

### 6.3 Offer / accept PSBT (buyer-initiated bid, normative)

For BTC-denominated bids ([Minimal Schema.md §5](./Minimal%20Schema.md), [PSBT Settlement.md §4](./PSBT%20Settlement.md)):

```
Inputs:
  [0]  seller_asset_utxo    SIGHASH_ALL   (seller countersigns last)
  [1+] buyer_funding_utxo   SIGHASH_ALL   (buyer signs first)
Outputs:
  [0]  buyer_addr  : asset_postage
  [1]  seller_addr : bid_sats            (BTC amount)
  [2]  buyer_change
```

- No bump UTXOs required; buyer signs first, seller countersigns via `/v1/offers/{id}/accept`.
- `bid_sats` is a **BTC** amount. This flow is **not** sat-for-sat in v1 (ADR-0005, ADR-0010).
- ⚠ The same offer/accept construction is the **candidate** basis for v2 sat-for-sat; it **MUST NOT**
  be exposed as such in v1 (ADR-0010).

### 6.4 Offset-0 precondition (normative, ADR-0007)

**ADR-0007** requires that a listing be for a UTXO where the target sat (or a range's primary sat)
is at **offset 0** in the seller's input UTXO sat ranges:

1. On `POST /v1/listings`, the protocol **MUST** query ord (`ord list(outpoint)` / `GET /output/{outpoint}`)
   and **MUST reject** the listing if the target sat is at a **non-zero** offset (ADR-0007 Decision/Compliance).
2. Sellers pre-isolate the sat before listing via `ord wallet send`, Sating "Transfer Sats", or
   Satonomy (ADR-0007). The protocol does **not** perform auto-split (it would require keys — out of scope).
3. This precondition makes buyer custody deterministic after the 2-bump fill (ADR-0006 assumes the
   asset at output offset 0), and matches Magisat/Sating practice (ADR-0007 Rationale).

### 6.5 PSBT validation rules (`/v1/psbt/validate`, normative)

Per [PSBT Settlement.md §6.3](./PSBT%20Settlement.md) and ADR-0006:

1. Seller input UTXO matches the listing `outpoint`.
2. If a sat is specified, it is at **offset 0** in the seller input UTXO's sat ranges (query ord) — ADR-0007.
3. Output ordering matches the canonical 2-bump template (§6.2); non-canonical ordering **MUST** be rejected (ADR-0006 Compliance).
4. Seller signature is valid for `SIGHASH_SINGLE | ANYONECANPAY`.
5. No additional seller inputs are signed (anti-tamper).

Test vectors live in `tests/psbt/` when implemented (ADR-0006 Compliance) — deferred to Phase 1
"PSBT test vectors" task (ROADMAP Phase 1), not this document.

---

## 7. Collections & Attestations (ADR-0008)

**ADR-0008**: collections are **predicate-based views over `sat_number`**, not on-chain assets
([Minimal Schema.md §6–8](./Minimal%20Schema.md)).

### 7.1 `Collection` object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `collection_id` | `string` | **MUST** | |
| `name` | `string` | **MUST** | |
| `predicate_type` | `enum` | **MUST** | §7.2 |
| `predicate_params` | `object` | **MUST** | type-specific |
| `curator` | `string?` | Optional | institution-certified collections |
| `attestation` | `string?` | Optional | signed statement by curator |

### 7.2 Predicate types

| Type | Params | Verifiable from | Class |
|------|--------|-----------------|-------|
| `sat_number` | `{number}` | ord math | **verified** (math) |
| `sat_range` | `{start,end}` | ord math | **verified** |
| `block_range` | `{start_height,end_height}` | `Sat.height()` | **verified** |
| `epoch` | `{epoch}` | `Sat.epoch()` | **verified** |
| `rarity` | `{min_rarity}` | `Sat.rarity()` | **verified** |
| `name_prefix` | `{prefix}` | `Sat.name()` | **verified** |
| `mining_pool` | `{pool_tag}` | coinbase metadata | **⚠ OPEN-4** — not specified for v1 |
| `historical_event` | `{event_id}` | attestation | **attested** |
| `institution_certified` | `{issuer,signature}` | attestation layer | **attested** |
| `user_defined` | `{expression}` | sandbox | **⚠ OPEN-4** — not specified for v1 |

Membership responses **MUST** separate `verified: true` (math, via `crates/ordinals`) from
`attested: true` (signature valid) (ADR-0008 Compliance). Rodarmor predicates are trustless;
non-consensus predicates require attestations.

### 7.3 `Attestation` object (normative, ADR-0008)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `attestation_id` | `string` | **MUST** | |
| `subject_sat` | `u64` | **MUST** | |
| `claim` | `string` | **MUST** | human-readable |
| `issuer_pubkey` | `string` | **MUST** | base64 SPKI DER Ed25519 public key (ADR-0013) |
| `signature` | `string` | **MUST** | base64 Ed25519 signature over canonical payload (ADR-0013) |
| `expires_at` | ISO-8601? | Optional | |

Attestations are **off-chain signed statements**. The protocol **stores and verifies signatures but
does not adjudicate truth** (ADR-0008 Decision). They do not change Bitcoin consensus or ord indexing.
Claims such as "mined by pool X" or "this is a Black Sat" are **only** representable via attestations
([Verification Model.md §6](./Verification%20Model.md), ADR-0008).

Canonical payload (ADR-0013):

```json
{"subject_sat":"<decimal string>","claim":"<string>","expires_at":null}
```

`subject_sat` MUST be serialized as a decimal string and field order MUST match the payload shown
above for signature verification interoperability.

---

## 8. Verification (ADR-0009)

Per **ADR-0009** (*multi-node ord verification*) and [Verification Model.md §4–7](./Verification%20Model.md).

### 8.1 Verification classes

| Check | Method | Nodes | Trustless? |
|-------|--------|-------|-----------|
| Sat identity (number, name, rarity, degree, epoch) | `crates/ordinals` locally | 0 (pure math) | **Yes** |
| Sat location (satpoint / sat ranges) | ord `GET /sat/{n}`, `GET /output/{outpoint}` | **≥2** | given index |
| Ownership | ord `--index-addresses` + Bitcoin `gettxout` | ≥1 | given index |
| Listing still fillable | `gettxout` unspent + ord offset check + PSBT sig | ≥1 | given index |

### 8.2 Cross-node rule (normative)

1. Math-only checks use `crates/ordinals` directly — **no RPC** (ADR-0009 Decision).
2. **Location checks MUST query ≥2 independent ord nodes** and **MUST reject or flag** on `satpoint`
   disagreement (ADR-0009 Decision; Verification Model §4.5).
3. Quorum: **2-of-2 must agree for v1**; **2-of-3 RECOMMENDED for production** (ADR-0009).
4. Nodes must be on the same chain, same ord version, same flags (esp. `--index-sats`), and same
   canonical tip; `unrecoverably_reorged: true` requires reindex before results are trusted
   (Verification Model §3.3).
5. `/v1/verify/sat/{number}` **MUST** query configured ord node(s), never local sat tables
   (ADR-0002 Compliance). `/v1/verify/listing/{id}` confirms the asset is still at the listed outpoint.

### 8.3 Reproducibility (ADR-0011)

For reproducible verification, implementations pin the ord version they audit against. ord **0.27.1**
(`vendor/ord @ 1ad3f64`, `SCHEMA_VERSION 34`) is the audited reference; the living
`ORD_REVERSE_ENGINEERING/` set documents its 20 tables + 4 multimaps (ADR-0011). A **custom sat
indexer is not authorized** by this spec; superseding ADR-0002 requires the completed Phase 2 pipeline
audit and a new ADR (ADR-0011 Compliance).

---

## 9. Protocol API Surface (v1)

Derived from [API Specification.md §4](./API%20Specification.md). The API is a **commerce layer**;
it **MUST NOT** recompute FIFO and **MUST** delegate sat location to ord (ADR-0002).

### 9.1 Discovery
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/assets/{sat_number}` | GET | Resolve sat → custody + listing status |
| `/v1/assets/range/{start}/{end}` | GET | Range membership + overlapping listings |
| `/v1/collections/{id}/assets` | GET | Sats matching predicate (paginated; bounded scan stub permitted in Phase 2b) |
| `/v1/collections/{id}/verify/{sat_number}` | GET | Membership test (`verified` / `attested`) |

### 9.2 Listings & offers
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/listings` | POST | Submit signed listing PSBT — enforces offset-0 (§6.4) |
| `/v1/listings` | GET | Query open listings |
| `/v1/listings/{id}` | DELETE | Cancel (revoke / on-chain spend) |
| `/v1/listings/{id}/fill` | POST | Buyer submits 2-bump completion PSBT (§6.2) |
| `/v1/offers` | POST | Buyer-initiated BTC bid (§6.3) |
| `/v1/offers/{id}/accept` | POST | Seller countersigns |

### 9.3 Settlement & verification
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/psbt/validate` | POST | Validate PSBT against §6.5 rules |
| `/v1/psbt/template` | POST | Generate canonical 2-bump fill template (§6.2) |
| `/v1/verify/sat/{number}` | GET | Multi-node ord cross-check (§8.2) |
| `/v1/verify/listing/{id}` | GET | Confirm asset still at listed outpoint |

### 9.4 Attestations & metadata
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/attestations` | POST | Submit signed attestation (§7.3) |
| `/v1/attestations/{sat_number}` | GET | List attestations for a sat |
| `/v1/metadata/{sat_number}` | GET | Application metadata (non-consensus) |

The protocol **MUST NOT** expose `/content/*` endpoints or serve payload bytes (ADR-0003 Compliance).

---

## 10. What Is NOT in Scope

Consolidated from ADR-0002/0003/0004/0005/0010, [Protocol Boundary.md §7](./Protocol%20Boundary.md),
and [Minimal Schema.md §9](./Minimal%20Schema.md).

| Excluded | Reason | ADR |
|----------|--------|-----|
| **Sat-for-sat / sat-for-inscription barter** | `SIGHASH_SINGLE` cannot bind a sat identity | ADR-0005, ADR-0010 |
| **Custom / parallel sat indexer** | Delegated to ord; no `sat_ranges` table in protocol DB | ADR-0002, ADR-0011 |
| **Inscription payload bytes / media hosting / CDN** | Metadata-only; no `content`/`media_url`/blob columns; no `/content/*` | ADR-0003 |
| **Reimplementing FIFO numbering / naming / rarity** | Owned by ord / `crates/ordinals` | ADR-0001, ADR-0004 |
| **Replacing ord, Ordinals, runes, BRC-20, or a marketplace** | Metaprotocol sits *above* ord | ADR-0004 |
| **Bitcoin consensus changes / on-chain listing registry (OP_RETURN)** | Bloat; PSBT model suffices | ADR-0004, Protocol Boundary §2.1 |
| **Wallet implementation / mandating a wallet** | Any BIP-174 wallet works | Protocol Boundary §2.3 |
| **Transaction history, full UTXO sat-range storage** | Query ord on demand | Minimal Schema §9 |
| **Private keys, custody, auto-split** | Never in protocol data | Minimal Schema §9, ADR-0007 |
| **Marketplace fee models, UI/UX** | Application-layer competition | Protocol Boundary §7 |
| **WebSocket fill events** | Deferred | Protocol Boundary §5 (v2) |

---

## 11. Open Conflicts & Items for Human Review

The following are places where source docs/ADRs are ambiguous, under-specified, or in apparent
tension. **None block the draft**, but each needs a human decision (or a new ADR) before reference
implementation.

- **⚠ OPEN-1 — Minimum postage undecided.** ADR-0006 fixes the *bump* size at 600 sats, but
  [PSBT Settlement.md §6.1](./PSBT%20Settlement.md) leaves **asset postage** as "330 (inscription
  convention) or 546 (dust) — TBD", and [Open Questions.md] Q9 (bare-sat postage) is unresolved.
  *Action:* pick a canonical `asset_postage` (likely 546 dust for bare sats, 330 for inscribed) via
  ADR before test vectors. **No ADR conflict — an open gap.**

- **⚠ OPEN-2 — "offset 0" wording vs output index.** ADR-0006 output ordering puts the asset at
  **output index 1**, while ADR-0007 speaks of the asset being "at offset 0". These are consistent
  (offset-0 is *within the output's* sat ranges), but the phrasing invites misreading. *Action:*
  confirm the spec wording in §6.2/§6.4 is the canonical interpretation.

- **⚠ OPEN-3 — `listing_id` not canonical.** [Minimal Schema.md §4](./Minimal%20Schema.md) defines
  `listing_id` as "UUID **or** content hash". For cross-marketplace portability a deterministic
  **content hash** is preferable; a random UUID undermines dedup/interoperability (a stated goal of
  ADR-0006). *Action:* decide UUID vs content-hash canonicalization.

- **⚠ OPEN-4 — `mining_pool` / `user_defined` predicates unspecified.**
  [Minimal Schema.md §7](./Minimal%20Schema.md) marks both "UNKNOWN". ADR-0008 covers them only under
  the attestation umbrella. *Action:* either (a) drop from v1 predicate enum, or (b) route strictly
  through attestations. This spec treats them as **not specified for v1**.

- **RESOLVED (ADR-0013) — Attestation signature scheme.** v1 uses Ed25519 with base64 SPKI DER
  public keys and base64 signatures over canonical UTF-8 JSON payload bytes.

- **⚠ OPEN-6 — Offer/accept dual-use (v1 bid vs v2 barter).** The §6.3 offer/accept flow is both a v1
  BTC-bid mechanism ([Minimal Schema.md §5](./Minimal%20Schema.md)) and the *candidate* v2 sat-for-sat
  mechanism ([PSBT Settlement.md §4/§7](./PSBT%20Settlement.md), ADR-0010). *Action:* keep v1 offers
  strictly BTC-denominated; ensure API/marketing never conflate them (ADR-0005/0010 Compliance).

- **⚠ OPEN-7 — Cross-wallet `sighashTypes` support.** [PSBT Settlement.md §8/§10](./PSBT%20Settlement.md)
  flags Sats Connect (Xverse) per-input `sighashTypes` consistency as **UNKNOWN** (Open Questions Q10).
  *Action:* Phase 1 "wallet sighash compatibility matrix" task resolves this; not a spec conflict.

No **direct contradiction** with any accepted ADR was found; all items above are gaps or
clarifications rather than reversals.

---

## 12. Reference Implementation

**Out of scope for this document.** Per session rules, no `src/` is produced here. The reference
implementation is **Phase 2** (ROADMAP): listing store, `POST /v1/listings` with offset-0 validation,
`/v1/verify/sat/{n}` multi-node quorum, `/v1/psbt/validate` + `/template`, collection predicate
evaluator, and attestation signature verification. Phase 2 **MUST NOT** begin until PSBT test vectors
pass on testnet4 (ROADMAP Phase 1 gate).

---

## 13. ADR Coverage Matrix

| ADR | Title | Reflected in |
|-----|-------|--------------|
| 0001 | Reuse ord sat numbering | §4.1, §4.2, §3, §8.1 |
| 0002 | Depend on ord, not custom indexer | §2.3, §3, §4.4, §8.2, §9, §10 |
| 0003 | Metadata-only, not payload-aware | §2.3, §4.2, §9.4, §10 |
| 0004 | Commerce metaprotocol, not Ordinals replacement | §1, §2.3, §3, §10 |
| 0005 | v1 PSBT sat-for-BTC only | §2.1, §2.2, §5, §6.1, §6.3, §10 |
| 0006 | Canonical 2-bump PSBT | §6.2, §6.5 |
| 0007 | Offset-0 precondition | §6.1, §6.4, §6.5 |
| 0008 | Collection predicates + attestations | §7 |
| 0009 | Multi-node ord verification | §8 |
| 0010 | Sat-for-sat deferred to v2 | §2.2, §6.3, §10, ⚠ OPEN-6 |
| 0011 | Ord architectural audit | §3 (pin), §8.3 |

---

## 14. References

- ADRs [0001](./adr/0001-reuse-ord-sat-numbering.md)–[0011](./adr/0011-ord-architectural-audit.md) (all Accepted, 2026-07-07)
- [Minimal Schema.md](./Minimal%20Schema.md), [PSBT Settlement.md](./PSBT%20Settlement.md), [API Specification.md](./API%20Specification.md)
- [Verification Model.md](./Verification%20Model.md), [Protocol Boundary.md](./Protocol%20Boundary.md), [Open Questions.md](./Open%20Questions.md), [Risks.md](./Risks.md)
- [ROADMAP.md](../ROADMAP.md)
- Ordinal Theory [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki), [crates/ordinals](https://github.com/ordinals/ord/tree/master/crates/ordinals)
- [BIP-174 PSBT](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki), [ord#2706](https://github.com/ordinals/ord/issues/2706), [ord#2815](https://github.com/ordinals/ord/issues/2815)
