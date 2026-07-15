# Sat Asset Protocol

Open commerce metaprotocol for trading Bitcoin satoshis — built on [Ordinal Theory](https://docs.ordinals.com/overview.html), not replacing it.

**Status:** Research complete · Phase 2 reference implementation in progress (TypeScript)  
**Portable testnet4 stack:** [infra/testnet4](./infra/testnet4)

---

## What This Is

A wallet-agnostic layer that standardizes:

- Asset identity (`sat_number`)
- Listings and offers (PSBT)
- Settlement verification
- Collection predicates and attestations

It does **not** reimplement sat indexing, store inscription payloads, or replace `ord`.

---

## Quick Links

| Resource | Path |
|----------|------|
| Agent rules | [AGENTS.md](./AGENTS.md) |
| Research index | [docs/README.md](./docs/README.md) |
| Architecture decisions | [docs/adr/README.md](./docs/adr/README.md) |
| Ord reverse engineering | [ORD_REVERSE_ENGINEERING/](./ORD_REVERSE_ENGINEERING/) |
| Audit discipline (✅🟡🔴) | [REVERSE_ENGINEERING.md](./REVERSE_ENGINEERING.md) |
| Licensing & ethics | [docs/ORD_LICENSING_AND_ETHICS.md](./docs/ORD_LICENSING_AND_ETHICS.md) |
| Roadmap | [ROADMAP.md](./ROADMAP.md) |
| Contributing (incl. ADRs) | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Portable testnet4 stack | [infra/testnet4](./infra/testnet4) |

---

## Verdict (Research Phase)

| Goal | Result |
|------|--------|
| Reuse Ordinal Theory | Yes — `crates/ordinals` + `ord --index-sats` |
| Minimal wallet changes (v1) | Yes — existing `signPsbt` |
| Payload independence | Yes — metadata only |
| Sat-for-BTC | Yes — standard listing PSBT |
| Sat-for-sat (v1) | No — deferred to v2 |

---

## Stack

```
Applications (marketplaces, UIs)
        ↓
Sat Asset Protocol (listings, offers, verify)
        ↓
ord (--index-sats) + Bitcoin Core (txindex)
        ↓
Bitcoin mainnet / testnet4
```

---

## Local Development

The reference implementation is zero-dependency TypeScript run directly on Node 22 (no build step):

```
npm test   # node --experimental-strip-types --test
```

Live verification against a real node needs `ord --index-sats` (HTTP `127.0.0.1:8080`, `sat_index=true`) backed by Bitcoin Core with `txindex` on testnet4. Point the implementation at it with `SAT_ASSET_ORD_BASE_URL`. A portable Docker Compose stack is in [`infra/testnet4`](./infra/testnet4); first sync (IBD + ord sat index) takes hours and needs ≥ 80 GB disk, so run it on a persistent host, not an ephemeral VM.

---

## License

MIT — see [LICENSE](./LICENSE).
