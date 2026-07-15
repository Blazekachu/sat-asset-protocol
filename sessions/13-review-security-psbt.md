# Session 13 — Review: Security (PSBT)

| Field | Value |
|-------|-------|
| **Phase** | review |
| **Agent type** | Reviewer (Security) |
| **When** | After Sessions 08–09 (listing + PSBT code) |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Security Review** subagent (fallback: **Opus**) |
| **Subagent** | Security Review |
| **Avoid** | Grok for PSBT security |

---

## PROMPT

```
Run Security Review on sat-asset-protocol PSBT and listing code.

Focus:
- PSBT tampering (SIGHASH_SINGLE seller output binding)
- Leaked listing replay
- Quorum bypass on /v1/verify/sat
- Secrets in config

Path: F:\Users\akhil\Main\sat-asset-protocol
Diff: uncommitted changes
```

---

## How to run in Cursor

Use the **review-security** skill or Security Review subagent.
