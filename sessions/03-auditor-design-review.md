# Session 03 — Ord Auditor: Design Review Matrix

| Field | Value |
|-------|-------|
| **Phase** | 0b |
| **Agent type** | Ord Auditor |
| **Blocked by** | Sessions 01–02 |
| **Output** | `ORD_REVERSE_ENGINEERING/05_sat_asset_notes/` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** (not Ask — Ask cannot write files) |
| **Model** | **Sonnet** (alt: Opus) |
| **Subagent** | `explore` (optional) |
| **Avoid** | Ask mode, Grok, Codex |
| **Writes** | `ORD_REVERSE_ENGINEERING/05_sat_asset_notes/` |

**Steps:** New chat → **Agent** → **Sonnet** → paste PROMPT

---

## PROMPT

```
You are the Ord Auditor for sat-asset-protocol (Phase 0b, Session 03).

IMPORTANT: Write markdown under ORD_REVERSE_ENGINEERING/05_sat_asset_notes/ only. No src/.

Read all ORD_REVERSE_ENGINEERING/01_database/ and 02_pipeline/ docs.

TASK: Phase 4 design review — for EVERY ord table, answer:
Keep? | Improve? | Replace? | Generalize? | Sat Asset v1 action

Output: ORD_REVERSE_ENGINEERING/05_sat_asset_notes/03_table_reuse_matrix.md

Must align with ADR-0002 (delegate to ord, no custom indexer v1).

Also update 05_sat_asset_notes/README.md with completion status.

No src/ code. End handoff: Phase 0b complete? Y/N
```

---

## Exit criteria

- [ ] All 24 tables have a reuse decision
- [ ] Conflicts with ADRs flagged explicitly

## Next session

[04-spec-protocol-v1.md](./04-spec-protocol-v1.md) (can run in parallel anytime)
