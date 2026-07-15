# Sat Asset Protocol

Open commerce metaprotocol for trading Bitcoin satoshis — built on [Ordinal Theory](https://docs.ordinals.com/overview.html), not replacing it.

**Status:** Research complete · Phase 2 reference implementation in progress (TypeScript)  
**Vorflux:** [VORFLUX.md](./VORFLUX.md) · portable testnet4: [infra/testnet4](./infra/testnet4)

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
| Agent lineup (per phase) | [AGENT_LINEUP.md](./AGENT_LINEUP.md) |
| **Agent sessions (open & copy prompt)** | **[sessions/README.md](./sessions/README.md)** |
| **Which Cursor agent per phase** | **[CURSOR_AGENTS.md](./CURSOR_AGENTS.md)** |
| Contributing (incl. ADRs) | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Vorflux + cloud testnet4 | [VORFLUX.md](./VORFLUX.md) |

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

**Windows workstation** — workspace testnet4 stack ([`testnet4/`](../testnet4/), `/btcfullord`):

- bitcoind testnet4 — RPC `127.0.0.1:48332`
- ord — HTTP `127.0.0.1:8080` (all index flags)
- Verified 2026-07-07: `sat_index=true`, ord 0.27.1

**Linux / Vorflux / cloud** — portable compose stack: [`infra/testnet4`](./infra/testnet4) (see [VORFLUX.md](./VORFLUX.md)).

---

## License

MIT — see [LICENSE](./LICENSE).
