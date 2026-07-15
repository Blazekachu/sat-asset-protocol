# Session 07 — Implementer: Project Scaffold

| Field | Value |
|-------|-------|
| **Phase** | 2 |
| **Agent type** | Protocol implementer |
| **Blocked by** | Session 05 gate PASS |
| **Output** | `src/` scaffold |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** (alt: Composer for tiny edits) |
| **Subagent** | `shell` |
| **Avoid** | Grok, Auto |

---

## PROMPT

```
You are the Protocol Implementer for sat-asset-protocol (Phase 2, Session 07).

PREREQUISITE: Session 05 PSBT vectors PASS on testnet4.

Read:
- ROADMAP.md Phase 2
- docs/adr/0001-0011
- docs/PROTOCOL_SPEC_v1.md (if exists)
- AGENT_LINEUP.md

TASK: Scaffold reference implementation ONLY.

1. Write ADR-0012 for stack choice (Rust vs TypeScript) if not decided — propose one with rationale
2. Create src/ with:
   - ord HTTP client (GET /status, GET /sat/{n}, GET /output/{outpoint})
   - config (ord base URL, quorum node URLs)
   - one integration test hitting live testnet4 ord

Rules:
- No listing store yet (Session 08)
- No ord fork, no sat indexer (ADR-0002)
- No inscription payload serving (ADR-0003)
- Tests must run and pass

End handoff: stack ADR, test command, next = Session 08
```

---

## Exit criteria

- [ ] ADR-0012 stack choice accepted
- [ ] `GET /status` integration test passes

## Next session

[08-implementer-listings.md](./08-implementer-listings.md)
