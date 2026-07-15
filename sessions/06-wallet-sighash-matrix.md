# Session 06 — Wallet Researcher: Sighash Matrix

| Field | Value |
|-------|-------|
| **Phase** | 1 |
| **Agent type** | Wallet researcher |
| **Parallel with** | Session 05 |
| **Blocked by** | Nothing |
| **Output** | `docs/Wallet Sighash Matrix.md` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** (not Ask — must write the matrix file) |
| **Model** | **Grok** (alt: Sonnet) |
| **Subagent** | `explore` |
| **Avoid** | Ask mode, Codex |
| **Writes** | `docs/Wallet Sighash Matrix.md` |

**Steps:** New chat → **Agent** → **Grok** → paste PROMPT

---

## PROMPT

```
You are the Wallet Researcher for sat-asset-protocol (Phase 1, Session 06).

IMPORTANT: Write docs/Wallet Sighash Matrix.md to disk. No src/ code.

Read:
- docs/Wallet Compatibility.md
- docs/adr/0006-canonical-two-bump-psbt.md
- UniSat signPsbt docs, Sats Connect docs

TASK: Create docs/Wallet Sighash Matrix.md

Table columns:
Wallet | signPsbt API | per-input sighashTypes | SIGHASH_SINGLE|ANYONECANPAY (0x03) | pushPsbt | Tested? | Notes

Wallets: UniSat, Xverse/Sats Connect, Leather, OKX, Magic Eden Wallet, ord wallet

Mark UNKNOWN where not empirically tested.
Resolve Open Questions Q10 if possible.

No src/ code.
```

---

## Exit criteria

- [ ] Matrix covers minimum v1 wallets (UniSat + Xverse)
- [ ] Q10 updated in Open Questions.md

## Next session

[05-bitcoin-psbt-vectors.md](./05-bitcoin-psbt-vectors.md) or [07-implementer-scaffold.md](./07-implementer-scaffold.md)
