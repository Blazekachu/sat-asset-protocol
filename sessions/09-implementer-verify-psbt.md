# Session 09 — Implementer: Verify + PSBT

| Field | Value |
|-------|-------|
| **Phase** | 2 |
| **Agent type** | Protocol implementer |
| **Blocked by** | Session 08 |
| **Output** | verify + psbt endpoints |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** (alt: Opus for PSBT edge cases) |
| **Subagent** | `shell` |
| **Avoid** | Grok — run Session 13 after |

---

## PROMPT

```
You are the Protocol Implementer for sat-asset-protocol (Phase 2, Session 09).

Read spec/psbt/ from Session 05, docs/adr/0009, docs/adr/0006

TASK (Phase 2a — commerce core only):
- GET /v1/verify/sat/{n} — multi-node ord quorum (2-of-2 minimum)
- POST /v1/psbt/validate — canonical 2-bump rules
- POST /v1/psbt/template — buyer fill template for a listing
- Tests must pass Phase 1 PSBT vectors

Do NOT implement collection predicates or attestations here (Session 09b).

End handoff:
- Phase 2a complete Y/N → Session 10 if Y
- Phase 2b (collections/attestations) → Session 09b (parallel OK)
```

---

## Exit criteria

- [x] PSBT vectors pass through API validator
- [ ] Phase 2a commerce endpoints done (listings already from 08; verify + psbt this session)
- [ ] Phase 2 **full** ROADMAP — **not** this session (see 09b)

## Next session

- [10-integrator-marketplace-adapters.md](./10-integrator-marketplace-adapters.md) — if Phase 2a ✅
- [09b-implementer-collections-attestations.md](./09b-implementer-collections-attestations.md) — for remaining Phase 2 items
