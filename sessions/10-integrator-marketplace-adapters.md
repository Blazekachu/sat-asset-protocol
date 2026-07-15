# Session 10 — Integrator: Marketplace Adapters

| Field | Value |
|-------|-------|
| **Phase** | 3 |
| **Agent type** | Integrator |
| **Blocked by** | Session 09 **Phase 2a** only (listings + verify + psbt) — **not** collections/attestations |
| **Parallel with** | Session 09b (collections) — OK |
| **Output** | `integrations/` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** (use **Grok** for ME/UniSat doc sweep only) |
| **Subagent** | `explore` + `shell` |
| **Avoid** | Auto |
| **Note** | Do not wait for Session 09b |

---

## PROMPT

```
You are the Integrator for sat-asset-protocol (Phase 3, Session 10).

PREREQUISITE: Phase 2a complete (Session 09 — verify + psbt). Collections/attestations (09b) are NOT required.

Read docs/Marketplace Analysis.md, docs/adr/0006

TASK:
- integrations/magiceden/README.md — ME listing PSBT → canonical mapping
- integrations/unisat/README.md — UniSat create_put_on shape → canonical
- Adapter functions (import only, no full marketplace)
- One testnet4 round-trip doc (manual steps OK)

Do not change canonical PSBT without new ADR.
```

---

## Exit criteria

- [ ] Two adapter READMEs with field mapping tables
- [ ] Documented testnet4 demo steps

## Next session

[12-review-bugbot.md](./12-review-bugbot.md) before any merge
