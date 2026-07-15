# Session 11 — v2 Spike: Sat-for-Sat

| Field | Value |
|-------|-------|
| **Phase** | 4 |
| **Agent type** | Spec author + Bitcoin engineer |
| **Blocked by** | Phase 3 complete |
| **Output** | ADR + spike doc |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Plan** then **Agent** |
| **Model** | **Opus** (Plan) → **Codex** (prototype) |
| **Subagent** | `shell` |
| **Avoid** | Grok |

---

## PROMPT

```
You are working Phase 4 v2 spike for sat-asset-protocol.

Read docs/adr/0010-sat-for-sat-deferred-v2.md, ord#2706 offer/accept PSBT design

TASK:
1. Draft ADR-0013 (proposed): sat-for-sat via offer/accept SIGHASH_ALL
2. docs/v2/SAT_FOR_SAT_SPIKE.md — testnet4 experiment plan
3. Do NOT merge to v1 API without ADR accepted

Exploratory only. Prototype on testnet4 if feasible.
```

---

## Exit criteria

- [ ] ADR-0013 proposed
- [ ] Spike doc with go/no-go recommendation
