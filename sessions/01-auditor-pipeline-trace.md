# Session 01 — Ord Auditor: Pipeline Trace

| Field | Value |
|-------|-------|
| **Phase** | 0b |
| **Agent type** | Ord Auditor |
| **Parallel with** | Session 04 (spec) |
| **Blocked by** | Nothing — start here |
| **Output** | `ORD_REVERSE_ENGINEERING/02_pipeline/*.md` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** (not Ask — Ask cannot write files) |
| **Model** | **Opus** (alt: Sonnet) |
| **Subagent** | `explore` for reading `vendor/ord` |
| **Avoid** | Ask mode, Grok, Auto |
| **Writes** | `ORD_REVERSE_ENGINEERING/02_pipeline/*.md` only |

**Steps:** New chat → **Agent** → **Opus** → paste PROMPT

---

## PROMPT — copy everything below into a new Cursor chat

```
You are the Ord Auditor for sat-asset-protocol (Phase 0b).

IMPORTANT: You are in Agent mode so you CAN write files.
Write markdown under ORD_REVERSE_ENGINEERING/ only.
Do NOT create or edit src/. Do NOT install packages.

Read first:
- F:\Users\akhil\Main\sat-asset-protocol\AGENTS.md
- F:\Users\akhil\Main\sat-asset-protocol\REVERSE_ENGINEERING.md
- F:\Users\akhil\Main\sat-asset-protocol\ORD_REVERSE_ENGINEERING\00_overview.md
- F:\Users\akhil\Main\sat-asset-protocol\ORD_REVERSE_ENGINEERING\01_database\01_tables.md

Source: F:\Users\akhil\Main\sat-asset-protocol\vendor\ord (ord 0.27.1 @ 1ad3f64)

TASK: Complete Phase 2 pipeline documentation — trace block arrival → DB commit.

Deliverables (create/update):
- ORD_REVERSE_ENGINEERING/02_pipeline/01_startup.md
- ORD_REVERSE_ENGINEERING/02_pipeline/02_sync.md
- ORD_REVERSE_ENGINEERING/02_pipeline/03_block_processing.md
- ORD_REVERSE_ENGINEERING/02_pipeline/04_transaction_processing.md
- ORD_REVERSE_ENGINEERING/02_pipeline/05_commit.md

Rules:
- Tag every claim: ✅ Verified (file:line) | 🟡 Inferred | 🔴 Design proposal
- No production code in src/
- No ADR changes unless audit disproves an accepted ADR
- Focus files: src/index/updater.rs, src/index/updater/inscription_updater.rs, src/index/reorg.rs

End with handoff: files touched, gate status, next session = 02-auditor-query-paths.md
```

---

## Exit criteria

- [ ] Each pipeline stage has file:line citations
- [ ] FIFO invariants documented
- [ ] Reorg path at least 🟡 outlined

## Next session

[02-auditor-query-paths.md](./02-auditor-query-paths.md)
