# Which Cursor Agent to Use — Per Phase

**Open sessions:** [sessions/README.md](./sessions/README.md)

Maps each session to: **Cursor mode** · **subagent** · **model** (Opus, Sonnet, Codex, Grok, Composer).

---

## Critical rule: Ask cannot write files

| Mode | Can write files? | Use for |
|------|------------------|---------|
| **Ask** | **No** | Throwaway questions only ("what does this function do?") |
| **Agent** | **Yes** | Every session that creates docs or code |
| **Plan** | **No** (design only) | Then switch to Agent to write |

**Sessions 01–04 and 06 produce markdown on disk.** They must use **Agent**, not Ask.

Constraint in PROMPT (not mode) keeps audit chats from writing `src/`:

```
Write markdown under ORD_REVERSE_ENGINEERING/ or docs/ only.
Do NOT create or edit src/. Do NOT run package installs.
```

**How chats sync:** Chat 1 (Agent+Opus) writes files → Chat 3 (Agent+Codex) reads those files. Shared memory = **the repo**, never the Ask transcript.

---

## Master table (mode + model)

| Session | Phase | **Cursor mode** | **Subagent** | **Model** | Writes |
|---------|-------|-----------------|--------------|-----------|--------|
| [01](./sessions/01-auditor-pipeline-trace.md) | 0b | **Agent** | `explore` | **Opus** → Sonnet | `ORD_REVERSE_ENGINEERING/02_pipeline/` |
| [02](./sessions/02-auditor-query-paths.md) | 0b | **Agent** | `explore` | **Opus** → Sonnet | `03_algorithms/` |
| [03](./sessions/03-auditor-design-review.md) | 0b | **Agent** | `explore` | **Sonnet** → Opus | `05_sat_asset_notes/` |
| [04](./sessions/04-spec-protocol-v1.md) | 1 | **Agent** | — | **Opus** → Sonnet | `docs/PROTOCOL_SPEC_v1.md` |
| [05](./sessions/05-bitcoin-psbt-vectors.md) | 1 | **Agent** | `shell` | **Codex** → Opus | `spec/psbt/` |
| [06](./sessions/06-wallet-sighash-matrix.md) | 1 | **Agent** | `explore` | **Grok** → Sonnet | `docs/Wallet Sighash Matrix.md` |
| [07](./sessions/07-implementer-scaffold.md) | 2 | **Agent** | `shell` | **Codex** | `src/` |
| [08](./sessions/08-implementer-listings.md) | 2 | **Agent** | `shell` | **Codex** | `src/` |
| [09](./sessions/09-implementer-verify-psbt.md) | 2 | **Agent** | `shell` | **Codex** → Opus | `src/` |
| [10](./sessions/10-integrator-marketplace-adapters.md) | 3 | **Agent** | `explore`+`shell` | **Codex** | `integrations/` |
| [11](./sessions/11-v2-sat-for-sat-spike.md) | 4 | **Plan**→**Agent** | `shell` | **Opus**→**Codex** | ADR + spike |
| [12](./sessions/12-review-bugbot.md) | review | **Agent** | **Bugbot** | Bugbot | review only |
| [13](./sessions/13-review-security-psbt.md) | review | **Agent** | **Security Review** | Security → Opus | review only |

`→` = alternate if primary unavailable.

---

## Sync diagram (how chat 3 finds chat 1)

```
Chat 1: Agent + Opus
  PROMPT: write pipeline docs, no src/
       ↓
  CREATES files on disk
  ORD_REVERSE_ENGINEERING/02_pipeline/*.md
       ↓
Chat 2: Agent + Opus  (optional parallel)
  CREATES more docs
       ↓
Chat 3: Agent + Codex
  PROMPT: "Read ORD_REVERSE_ENGINEERING/02_pipeline/ first"
  READS disk → continues
```

Ask chats produce **zero files** → later Agent has nothing to read. Do not use Ask for Sessions 01–06.

Optional Ask use: open Ask only to peek at one function, then start Agent to write the doc.

---

## Model guide

| Model | Best for | Sessions |
|-------|----------|----------|
| **Opus** | ord audit, citations, ADR/spec | 01, 02, 04, 11 Plan |
| **Sonnet** | matrices, structured docs | 03, 06 alt |
| **Codex** | PSBT, shell, API code, tests | 05, 07–10 |
| **Grok** | fast wallet/API research (still Agent so it can write the matrix file) | 06 |
| **Composer** | tiny edits only | 07 alt |
| **Auto** | ❌ don't use | — |

---

## How to start a session

1. New chat
2. Mode: **Agent** (or Plan→Agent for 11)
3. Model: from table
4. Paste session PROMPT (includes "docs only / no src/" where needed)

---

## Phase cheat sheet

```
Phase 0b   Agent + Opus/Sonnet   (docs only — NO Ask)
Phase 1    Agent + Opus / Codex / Grok
Phase 2–3  Agent + Codex + shell
Phase 4    Plan Opus → Agent Codex
Review     Agent + Bugbot / Security
```

---

## What NOT to use

| Don't | Why |
|-------|-----|
| **Ask** for Sessions 01–06 | Creates no files → next chat has empty handoff |
| **Auto** | Wrong model + scope |
| **Grok** for 01–03 | Weak file:line audit |
| **Codex** for 04 alone | Jumps to `src/` — Opus + "docs only" |
| Mixing Ask then expecting Agent to "know" the talk | Chat history is not shared |
