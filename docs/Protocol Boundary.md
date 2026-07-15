# Protocol Boundary

**Status:** Research complete (2026-07-07)

---

## 1. Layer Model (Validated)

```
┌─────────────────────────────────────────────┐
│              Applications                    │
│  (marketplace UIs, explorers, analytics)   │
├─────────────────────────────────────────────┤
│           Sat Asset Protocol                 │
│  listings, offers, collections, attestations │
├─────────────────────────────────────────────┤
│                  ord                         │
│  sat index, inscription index, explorer API  │
├─────────────────────────────────────────────┤
│              Bitcoin Core                    │
│  consensus, UTXO set, txindex, block data    │
└─────────────────────────────────────────────┘
```

**Validation:** This hypothesis is **confirmed**. No layer duplication is required for a sat marketplace.

---

## 2. Responsibility Matrix

### 2.1 Bitcoin (Consensus Layer)

**Owns:**
- UTXO creation, spending, validation
- Transaction structure (inputs, outputs, witnesses)
- Block chain consensus
- Script execution
- Fee market

**Does NOT own:**
- Sat numbering
- Asset metadata
- Marketplace listings
- PSBT coordination (BIP-174 is a wallet standard, not consensus)

**Sat Asset Protocol MUST NOT:**
- Change consensus rules
- Embed sat identity in script without Bitcoin soft fork
- Require miner/pool cooperation

---

### 2.2 ord (Indexing Layer)

**Owns:**
- FIFO sat assignment per Ordinal Theory
- Sat range tracking per UTXO (`--index-sats`)
- Inscription metadata indexing (`--index-inscriptions`)
- Rune indexing (`--index-runes`)
- Deterministic sat math (number, name, rarity, degree, charms)
- HTTP/CLI explorer API
- `ord wallet` sat-control (only official sat-selection wallet)

**Does NOT own:**
- Marketplace listings or offers
- PSBT marketplace templates
- Collection definitions (beyond ord's own `collections` feature for inscriptions)
- Off-chain attestations
- Media hosting

**Sat Asset Protocol MUST NOT:**
- Reimplement FIFO sat indexing
- Reimplement sat naming or rarity algorithms
- Store inscription payloads (ord already doesn't; protocol shouldn't either)
- Replace ord explorer for chain data

**Sat Asset Protocol SHOULD:**
- Depend on ord (or `crates/ordinals` + compatible indexer) as read-only truth source
- Pin ord version for verification reproducibility

---

### 2.3 Sat Asset Protocol (Commerce Layer)

**Owns:**
- Asset identity schema (sat number as canonical ID)
- Asset discovery API (listings, offers, collections)
- Listing and offer PSBT standards (canonical templates)
- Settlement coordination (validate, template, fill)
- Collection predicate definitions
- Attestation format and verification
- Metadata extensions (application-specific, non-consensus)

**Does NOT own:**
- Sat numbering algorithm
- UTXO consensus
- Inscription encoding
- Wallet implementation
- Media hosting / CDN
- On-chain settlement (Bitcoin does this)

**Sat Asset Protocol MUST NOT:**
- Duplicate ord's sat index
- Require inscription payload storage
- Mandate a specific wallet
- Mandate a specific marketplace implementation

---

### 2.4 Applications (Presentation Layer)

**Owns:**
- User interfaces
- Media rendering (images, HTML, SVG previews)
- Search, sort, filter UX
- Price discovery, charts, analytics
- Custody UX (wallet selection, key management)
- Notification systems

**Does NOT own:**
- Sat identity truth
- Settlement correctness (delegates to protocol + PSBT)

---

## 3. Duplication Audit

| Function | Already Exists In | Protocol Should |
|----------|-------------------|-----------------|
| Sat numbering | `crates/ordinals` | **Import / query** |
| Sat location | ord `--index-sats` | **Query** |
| Inscription content | Bitcoin blocks + ord serve | **Proxy (optional)** |
| PSBT creation (generic) | Bitcoin Core, wallets | **Template only** |
| PSBT signing | Wallets | **Specify sighash rules** |
| Listing storage | Each marketplace DB | **Standardize schema** |
| Rare sat display | ord + third-party indexers | **Reference predicates** |
| UTXO coin selection | Wallets, ord wallet | **Preconditions only** |
| Collection (inscription) | ord `collections` | **Separate sat collections** |

**No duplication detected** if protocol stays in the commerce/metadata layer.

---

## 4. Feature Ownership for Research Questions

| Feature | Layer | Consensus Change? |
|---------|-------|-------------------|
| Rare sats (Rodarmor) | ord math | No |
| Named sats | ord math | No |
| Arbitrary sat ranges | ord index + protocol collections | No |
| Block ranges | ord math (derivable) | No |
| Epoch collections | ord math | No |
| Mining pool collections | **Attestation** (coinbase metadata off-chain) | No |
| Historical event collections | **Attestation** | No |
| Institution-certified collections | **Attestation** | No |
| User-defined collections | **Protocol predicates** | No |
| Sat-for-BTC trading | Protocol PSBT + Bitcoin settlement | No |
| Sat-for-sat trading | Protocol v2 PSBT (offer/accept) | No |
| Custom satributes (Black Sats) | Application/attestation extension | No |

**All research questions can be supported without Bitcoin consensus changes.**

---

## 5. Interface Contracts Between Layers

### Bitcoin → ord

| Contract | Requirement |
|----------|-------------|
| `txindex=1` | Required for inscription content serving |
| Archival blocks | Required (no pruning) |
| RPC access | `getblock`, `getrawtransaction`, `gettxout` |

### ord → Sat Asset Protocol

| Contract | Requirement |
|----------|-------------|
| `GET /sat/{n}` | Sat metadata + satpoint |
| `GET /output/{outpoint}` | Sat ranges |
| `GET /status` | Index flag verification |
| `ord find`, `ord list` | CLI equivalents |
| `crates/ordinals` | Library for math-only verification |

### Sat Asset Protocol → Wallets

| Contract | Requirement |
|----------|-------------|
| BIP-174 PSBT | Standard format |
| Per-input sighash types | `SIGHASH_SINGLE\|ANYONECANPAY` for listings |
| `signPsbt` API | No protocol-specific wallet code |

### Sat Asset Protocol → Applications

| Contract | Requirement |
|----------|-------------|
| REST/JSON API | Listings, offers, collections, verify |
| WebSocket (optional) | Listing fill events — **v2** |
| Attestation verification | Public key registry |

---

## 6. What the Protocol Should Standardize

| Standard | Rationale |
|----------|-----------|
| Asset identity (`sat_number`) | Universal canonical ID |
| Listing schema | Cross-marketplace portability |
| Offer schema | Buyer-initiated trades |
| PSBT templates | Interoperable settlement |
| Collection predicates | Composable sat groupings |
| Attestation format | Institution/historical claims |
| Verification procedures | Independent reproducibility |

---

## 7. What the Protocol Should NOT Standardize

| Non-Standard | Rationale |
|--------------|-----------|
| Bitcoin consensus | Out of scope |
| Sat numbering algorithm | ord/BIP owns this |
| Inscription payload storage | On-chain + optional app hosting |
| Media hosting | Application layer |
| Wallet implementation | Too many existing wallets |
| Marketplace fee models | Competition |
| UI/UX patterns | Application layer |
| Custom satribute taxonomies | Extensible via attestations |

---

## 8. Relationship to Existing ord Features

| ord Feature | Protocol Relationship |
|-------------|----------------------|
| `ord collections` (inscriptions) | **Parallel** — protocol collections are sat-based, not inscription-based |
| `ord wallet` | **Complementary** — reference wallet, not required |
| `ord server` | **Dependency** — read-only indexer |
| `ord runes` | **Orthogonal** — rune trading is separate commerce |
| `hidden:` content filter | **Irrelevant** — protocol doesn't serve content |

---

## 9. Citations

- [ord Architecture.md](./Ord%20Architecture.md)
- [PSBT Settlement.md](./PSBT%20Settlement.md)
- [Minimal Schema.md](./Minimal%20Schema.md)
- [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki)
