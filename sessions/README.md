# Agent Sessions — Open These

**Path:** `F:\Users\akhil\Main\sat-asset-protocol\sessions\`

Each file = **one Cursor chat**. Set **Agent** + **model** → paste **PROMPT**.

**Full guide:** [CURSOR_AGENTS.md](../CURSOR_AGENTS.md)

> **Ask mode writes nothing.** Every session below that creates files uses **Agent**. Sync between chats = files on disk.

---

## Quick pick — mode, model, what gets written

| Phase | File | **Mode** | **Model** | **Writes to disk** |
|-------|------|----------|-----------|-------------------|
| 0b | [01](./01-auditor-pipeline-trace.md) | **Agent** | Opus | `ORD_REVERSE_ENGINEERING/02_pipeline/` |
| 0b | [02](./02-auditor-query-paths.md) | **Agent** | Opus | `03_algorithms/` |
| 0b | [03](./03-auditor-design-review.md) | **Agent** | Sonnet | `05_sat_asset_notes/` |
| 1 | [04](./04-spec-protocol-v1.md) | **Agent** | Opus | `docs/PROTOCOL_SPEC_v1.md` |
| 1 | [05](./05-bitcoin-psbt-vectors.md) | **Agent** | Codex | `spec/psbt/` |
| 1 | [06](./06-wallet-sighash-matrix.md) | **Agent** | Grok | `docs/Wallet Sighash Matrix.md` |
| 2 | [07](./07-implementer-scaffold.md) | **Agent** | Codex | `src/` |
| 2 | [08](./08-implementer-listings.md) | **Agent** | Codex | `src/` |
| 2a | [09](./09-implementer-verify-psbt.md) | **Agent** | Codex | verify + psbt → **gate Session 10** |
| 2b | [09b](./09b-implementer-collections-attestations.md) | **Agent** | Codex | collections + attestations (∥ Session 10) |
| 3 | [10](./10-integrator-marketplace-adapters.md) | **Agent** | Codex | `integrations/` (after 2a only) |
| 4 | [11](./11-v2-sat-for-sat-spike.md) | Plan→Agent | Opus→Codex | ADR + spike |
| review | [12](./12-review-bugbot.md) | Agent | Bugbot | — |
| review | [13](./13-review-security-psbt.md) | Agent | Security | — |

---

## How chat 1 → chat 3 syncs

```
01 Agent+Opus  →  writes pipeline markdown
02 Agent+Opus  →  writes query-path markdown
03 Agent+Sonnet → writes reuse matrix
        ↓
04/05 Agent     →  PROMPT says "Read ORD_REVERSE_ENGINEERING/..."
        ↓
reads FILES, not Ask history
```

If you used Ask for 01–02 and got chat answers only: **re-run those sessions in Agent** so the files exist, or paste Ask output into Agent with “write these paths.”

---

## 3 steps

1. New chat → **Agent**
2. Pick **model** from table
3. Paste PROMPT from session file

---

## Order

```
01 Agent+Opus  ∥  04 Agent+Opus
02–03 Agent (after 01)
05 Agent+Codex (testnet4)
07–09 Agent+Codex  →  Phase 2a done
09b Agent+Codex  ∥  10 Agent+Codex
12–13 review
```

