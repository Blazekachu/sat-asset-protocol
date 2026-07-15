# ADR-0001: Reuse Ord Sat Numbering

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Ord Architecture.md](../Ord%20Architecture.md), [Verification Model.md](../Verification%20Model.md)

---

## Context

Sat identity could be defined independently (custom numbering, hash-based IDs, UTXO-only identity) or by adopting Casey Rodarmor's Ordinal Theory as implemented in `ord` and `crates/ordinals`.

Bitcoin consensus has no sat concept. Any identity scheme outside Ordinal Theory would fragment interoperability with existing wallets, explorers, and rare-sat markets.

## Decision

**Adopt `sat_number` from Ordinal Theory as the canonical asset identity.** Derive name, rarity, degree, block height, and epoch from `crates/ordinals` — do not reimplement or fork the algorithms.

## Rationale

- FIFO sat assignment is fully specified in [bip.mediawiki](https://github.com/ordinals/ord/blob/master/bip.mediawiki).
- `crates/ordinals` is published as a standalone library — reusable without running `ord server`.
- Local testnet4 verification (2026-07-07): `/sat/0` → `nvtdijuwxlp`, mythic; name round-trip consistent.
- Reinventing numbering would break compatibility with Magic Eden, Magisat, Sating, and `ord wallet`.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| UTXO-only identity (no sat numbers) | Cannot trade individual sats or ranges; incompatible with rare-sat culture |
| Custom numbering scheme | No ecosystem support; verification requires custom indexers |
| Fork `ordinals` crate with patches | Maintenance burden; splits consensus on identity |

## Consequences

### Positive
- Instant interoperability with ord APIs and existing marketplaces.
- Math-only verification without full index for identity fields.

### Negative
- Bound to Ordinal Theory evolution (ord version bumps, charm sets).

### Neutral
- Collections and attestations extend identity; they do not replace `sat_number`.

## Compliance

- Protocol schema uses `sat_number: u64` as primary key ([Minimal Schema.md](../Minimal%20Schema.md)).
- No code may implement alternate FIFO or naming algorithms.
- Identity tests must use `ordinals` crate test vectors.

## References

- https://github.com/ordinals/ord/tree/master/crates/ordinals
- https://github.com/ordinals/ord/blob/master/bip.mediawiki
