# Verification Model

**Status:** Research complete (2026-07-07)  
**Local experiment:** testnet4 ord 0.27.1 API queries (2026-07-07)

---

## 1. Executive Summary

Independent nodes running the same `ord` version with the same index flags on the same chain produce **deterministic** sat numbering, names, rarity, and FIFO locations. Verification is **index-dependent** — Bitcoin Core alone cannot verify sat properties. Edge cases exist around reorgs, lost sats, unbound inscriptions, and non-Rodarmor satribute definitions.

---

## 2. What Can Be Independently Verified

| Property | Verifiable By | Deterministic? | Requires |
|----------|---------------|----------------|----------|
| **Sat numbering** | Pure math (`crates/ordinals`) | **Yes** | Block height + subsidy rules only |
| **Sat name** | Pure math | **Yes** | Sat number |
| **Rarity (Rodarmor)** | Pure math | **Yes** | Sat number |
| **Degree / epoch / period** | Pure math | **Yes** | Sat number |
| **Charms** | Pure math + inscription state | **Yes** (given index) | `--index-inscriptions` for some charms |
| **Sat location (UTXO)** | ord index | **Yes** (given same chain state) | `--index-sats` |
| **Sat ownership** | Bitcoin UTXO set + address index | **Yes** | `--index-sats` + `--index-addresses` |
| **Inscription on sat** | ord index | **Yes** | `--index-inscriptions` |
| **Custom satributes (Black Sats, etc.)** | Marketplace-specific index | **No** — definitions vary | Third-party indexer |

---

## 3. Determinism Guarantees

### 3.1 Sat Numbering Algorithm

The FIFO algorithm in `bip.mediawiki` is fully specified. Given identical block data, any correct implementation produces identical sat assignments.

**Independent verification without ord:**

1. Implement FIFO from `bip.mediawiki` in any language.
2. Compare `Sat(n).name()`, `.rarity()`, `.height()` against `crates/ordinals` test vectors.
3. The `ordinals` crate is published separately and can be used as a library.

**Citation:** [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki), [crates/ordinals](https://github.com/ordinals/ord/tree/master/crates/ordinals)

### 3.2 Local Experiment Results (testnet4, 2026-07-07)

| Query | Result | Consistent with ordinals theory? |
|-------|--------|----------------------------------|
| `GET /sat/0` | number=0, name=`nvtdijuwxlp`, rarity=mythic | **Yes** |
| `GET /sat/nvtdijuwxlp` | number=0 | **Yes** (name round-trip) |
| `GET /sat/2099994106992659` | name=`satoshi` | **Yes** |
| `GET /status` | sat_index=true, height=143248, version=0.27.1 | **Yes** |

**Reproducible command:**

```powershell
$headers = @{ Accept = "application/json" }
Invoke-RestMethod -Uri "http://127.0.0.1:8080/sat/0" -Headers $headers
```

### 3.3 Do Independent Ord Nodes Always Agree?

**Yes, when:**

- Same `ord` version (or compatible `crates/ordinals` version)
- Same chain (mainnet/testnet/signet/regtest)
- Same index flags (especially `--index-sats`)
- Same canonical chain tip (no unresolved reorg)

**`ord` status field `unrecoverably_reorged: true`** (observed on testnet4) indicates the index detected a reorg it could not fully reconcile. Operators should reindex if this persists.

---

## 4. Verification Procedures

### 4.1 Verify Sat Identity

```
Input: sat_number OR sat_name
Steps:
  1. Parse notation via ord parse or /sat/{notation}
  2. Assert number ↔ name round-trip
  3. Compute rarity independently via crates/ordinals
  4. Compare degree, percentile, block height
Expected: All fields match
```

### 4.2 Verify Sat Location

```
Input: sat_number
Steps:
  1. Query ord GET /sat/{n} → satpoint
  2. Query ord GET /output/{outpoint} → sat_ranges
  3. Assert sat_number ∈ [range.start, range.end) for some range
  4. Assert offset = accumulated_prefix + (sat_number - range.start)
Expected: satpoint offset consistent with range list
```

### 4.3 Verify Ownership

```
Input: sat_number, claimed_address
Steps:
  1. Resolve satpoint (§4.2)
  2. Query ord GET /output/{outpoint} → address (requires --index-addresses)
  3. Assert address == claimed_address
Expected: UTXO is unspent and owned by claimed address
```

### 4.4 Verify Listing Still Valid

```
Input: listing (outpoint, sat_number, signed_psbt)
Steps:
  1. Query Bitcoin Core gettxout(outpoint) → must exist (unspent)
  2. Query ord list(outpoint) → sat still at expected offset
  3. Validate PSBT seller signature still valid
  4. Assert no conflicting spend in mempool
Expected: Listing is fillable
```

### 4.5 Cross-Node Verification

```
Input: sat_number
Steps:
  1. Query node A: GET /sat/{n}
  2. Query node B: GET /sat/{n}
  3. Assert satpoint, number, name, rarity match
Expected: Identical responses at same chain tip
```

---

## 5. Edge Cases

| Edge Case | Behavior | Verification Impact |
|-----------|----------|---------------------|
| **Lost sats** | Unassigned fees → `OutPoint::null()` | Rare lost sats in `SAT_TO_SATPOINT`; common lost sats unscannable |
| **Unbound inscriptions** | `sat = None` → `unbound_outpoint()` | No sat identity for inscription |
| **Reinscriptions** | Multiple inscriptions per sat | `SAT_TO_SEQUENCE_NUMBER` multimap |
| **Duplicate coinbase txids** | Older UTXO displaced | Pre-BIP34 blocks; ord handles per BIP |
| **Underpaid subsidy** | Does not shift numbering | Must implement BIP rule exactly |
| **Reorg** | Index may set `unrecoverably_reorged` | Reindex required; listings may be stale |
| **Without `--index-sats`** | No satpoint in API | Location queries fail — not a disagreement, a capability gap |
| **Non-Rodarmor satributes** | ME/Magisat/SimpleHash definitions | Cannot verify across indexers without shared schema |
| **0-value outputs** | Inscriptions on 0-value outputs | Special pointer/offset rules |

---

## 6. What Cannot Be Verified On-Chain

| Claim | Why |
|-------|-----|
| "This sat was mined by pool X" | Coinbase metadata not in consensus |
| "This sat is a Black Sat" | Community taxonomy, not ord-native |
| "Institution X certifies this sat" | Requires off-chain attestation verification |
| "This sat is lucky/cursed" | Charm sets may evolve with ord versions |

These require the **Attestation layer** (see Minimal Schema.md) with explicit issuer signatures.

---

## 7. Recommended Verification Architecture

```
                    ┌─────────────────┐
                    │  Protocol API   │
                    │  /v1/verify/*   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ ord #1   │  │ ord #2   │  │ ordinals │
        │ (primary)│  │ (witness)│  │  crate   │
        └────┬─────┘  └────┬─────┘  └──────────┘
             │              │
             └──────┬───────┘
                    ▼
            ┌──────────────┐
            │ Bitcoin Core │
            │  (txindex)   │
            └──────────────┘
```

**Rules:**

1. **Math checks** (number, name, rarity) — use `crates/ordinals` directly; no RPC needed.
2. **Location checks** — query ≥2 ord nodes; reject on disagreement.
3. **Ownership checks** — ord address index + Bitcoin `gettxout`.
4. **Listing checks** — PSBT signature validation + UTXO unspent.

---

## 8. Success Criteria Mapping

| Success Criterion | Verification Model Support |
|-------------------|---------------------------|
| Reuse Ordinal Theory | Math + FIFO verifiable via `crates/ordinals` |
| Independent identical results | Cross-node procedure §4.5 |
| Independent of inscription payloads | Location verification uses sat ranges only |
| Sat traded by arbitrary identity | Name, number, range, rarity all verifiable |

---

## 9. Unknowns

1. Behavior of `unrecoverably_reorged` on mainnet at depth — **UNKNOWN** (observed on testnet4 only)
2. Whether third-party indexers (ME, UniSat) agree with ord on satpoint for all UTXOs — **UNKNOWN** (not tested)
3. Formal conformance test suite for non-ord implementations — does not exist yet

---

## 10. Citations

- [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki)
- [ord Architecture.md](./Ord%20Architecture.md)
- [ord reindexing guide](https://docs.ordinals.com/guides/reindexing.html)
- [ord#2815 — satribute fragmentation](https://github.com/ordinals/ord/issues/2815)
