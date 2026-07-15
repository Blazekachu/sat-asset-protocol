# Session 12 — Review: Bugbot

| Field | Value |
|-------|-------|
| **Phase** | review |
| **Agent type** | Reviewer (Bugbot) |
| **When** | After any Session 07–10 produces code |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Bugbot** subagent (not a chat model — use review skill) |
| **Fallback model** | Opus if reviewing manually |
| **Subagent** | Bugbot |

---

## PROMPT

```
Run Bugbot review on sat-asset-protocol uncommitted changes.

Focus:
- ADR compliance (0001-0011)
- No ord FIFO reimplementation
- No payload storage
- PSBT validation correctness

Path: F:\Users\akhil\Main\sat-asset-protocol
```

---

## How to run in Cursor

Use the **review-bugbot** skill or launch Bugbot subagent on branch/uncommitted changes.
