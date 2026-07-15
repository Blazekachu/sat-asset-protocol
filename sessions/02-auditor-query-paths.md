# Session 02 — Ord Auditor: Query Paths

| Field | Value |
|-------|-------|
| **Phase** | 0b |
| **Agent type** | Ord Auditor |
| **Parallel with** | Session 04 |
| **Blocked by** | Session 01 recommended first |
| **Output** | `ORD_REVERSE_ENGINEERING/03_algorithms/*.md` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** (not Ask — Ask cannot write files) |
| **Model** | **Opus** (alt: Sonnet) |
| **Subagent** | `explore` for `vendor/ord` |
| **Avoid** | Ask mode, Grok, Auto |
| **Writes** | `ORD_REVERSE_ENGINEERING/03_algorithms/` |

**Steps:** New chat → **Agent** → **Opus** → paste PROMPT

---

## PROMPT

```
You are the Ord Auditor for sat-asset-protocol (Phase 0b, Session 02).

IMPORTANT: Write markdown under ORD_REVERSE_ENGINEERING/ only. No src/.

Read:
- ORD_REVERSE_ENGINEERING/01_database/04_relationships.md
- docs/API Specification.md
- vendor/ord/src/index.rs (find, list, rare_sat_satpoint, get_inscription_*)

TASK: Map query engine — HTTP/CLI → redb tables.

Deliverables:
- ORD_REVERSE_ENGINEERING/03_algorithms/query_paths.md
- ORD_REVERSE_ENGINEERING/03_algorithms/inscription_detection.md (if not done)
- ORD_REVERSE_ENGINEERING/03_algorithms/charms.md (stub OK)

Document:
- find(sat) O(UTXOs) vs rare_sat_satpoint O(1)
- /sat/{n} JSON API → which tables
- /output/{outpoint} → OUTPOINT_TO_UTXO_ENTRY

Tag ✅🟡🔴. No src/ code. End with handoff to Session 03.
```

---

## Exit criteria

- [ ] Every major API endpoint mapped to tables
- [ ] Hot paths flagged for Sat Asset verify API

## Next session

[03-auditor-design-review.md](./03-auditor-design-review.md)
