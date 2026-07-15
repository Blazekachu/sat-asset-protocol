# Agent Lineup — Sat Asset Protocol

> **Open agent sessions:** [`sessions/README.md`](./sessions/README.md) — one file per chat, copy-paste PROMPT into Cursor.

**Purpose:** Define which agent posture, tools, and gates apply per project phase.  
**Short answer:** Auto mode does **not** work perfectly end-to-end. Use **phase-specific agents** with explicit handoff artifacts.

---

## Design Principle

```
One phase → one primary agent role → one deliverable set → one gate → next phase
```

Mixing roles in a single chat (audit ord + write Rust API + test wallets) causes context bleed, skipped ADRs, and unverified claims.

---

## Agent Roles (Cursor)

| Role | Tool / mode | Best for | Must NOT do |
|------|-------------|----------|-------------|
| **Auditor** | `explore` (readonly) | ord source trace, table inventory, citations | Write production code |
| **Spec author** | Agent + docs only | BIP-style spec, ADRs, test vector docs | Implement server |
| **Bitcoin engineer** | Agent + shell | PSBT construction, testnet4 txs, ord RPC | Redesign protocol without ADR |
| **Protocol implementer** | Agent + TDD | Listing API, validation, SQLite store | Fork ord indexing |
| **Integrator** | Agent + explore | ME/UniSat PSBT adapters, API mapping | Change canonical PSBT without ADR |
| **Reviewer** | `bugbot` / `security-review` | Pre-merge review of diffs | Start new features |
| **CI investigator** | `ci-investigator` | Failed checks on PRs | Architecture decisions |

**Default Auto agent** is fine for **narrow, gated tasks** inside a phase. It is **not** fine as the only agent across all phases.

---

## Phase Map

```
Phase 0b  Auditor          → ORD_REVERSE_ENGINEERING/
     ↓ (parallel OK)
Phase 1   Spec + Bitcoin   → spec/ + PSBT vectors + wallet matrix
     ↓ GATE: vectors pass testnet4
Phase 2   Implementer      → src/ reference API
     ↓ GATE: API + verify tests green
Phase 3   Integrator       → adapters + demo
     ↓
Phase 4   Spec + Bitcoin   → v2 ADRs (sat-for-sat)
```

---

## Phase 0b — Ord Reverse Engineering (In Progress)

**Primary agent:** Auditor (`explore`, readonly)

**Chat opener template:**
```
You are the Ord Auditor for sat-asset-protocol.
Read: AGENTS.md, REVERSE_ENGINEERING.md, ORD_REVERSE_ENGINEERING/00_overview.md
Task: Complete Phase 2 pipeline trace (block → commit) with file:line citations.
Tag every claim ✅🟡🔴. No production code. No ADR changes unless audit disproves one.
```

**Deliverables:**
- `ORD_REVERSE_ENGINEERING/02_pipeline/*.md`
- `ORD_REVERSE_ENGINEERING/03_algorithms/*.md`
- `05_sat_asset_notes/` Keep/Improve/Replace matrix

**Parallelism:** Can run **in parallel** with Phase 1 spec drafting (different chats).

**Gate to Phase 2 implementation:** Phase 0b Phase 2 complete **OR** explicitly waived (custom indexer not planned — already ADR-0002).

**Auto OK?** Partially — good for single-file traces. Use **explore subagent** for multi-file `updater.rs` / `inscription_updater.rs` chains.

---

## Phase 1 — Specification

**Primary agents:** Spec author + Bitcoin engineer (split into 2 chats)

### Chat 1A — Spec author

```
Task: Draft BIP-style protocol doc from docs/ + ADRs 0001–0011.
Output: docs/PROTOCOL_SPEC_v1.md
Do not write src/. Flag conflicts with ADRs for human review.
```

### Chat 1B — Bitcoin engineer

```
Task: Build PSBT test vectors for ADR-0006 (2-bump canonical).
Environment: testnet4 ord @ 127.0.0.1:8080, bitcoind 48332
Output: spec/psbt/vectors/*.json + spec/psbt/README.md
Prove: offset-0 precondition (ADR-0007), sat-for-BTC only (ADR-0005).
```

### Chat 1C — Wallet matrix (optional third)

```
Task: Document sighashTypes support — UniSat, Xverse/Sats Connect, Leather.
Output: docs/Wallet Sighash Matrix.md
Mark UNKNOWN where not tested.
```

**Gate to Phase 2:**
- [ ] PSBT vectors validate on testnet4
- [ ] Open Questions Q9, Q10 resolved or explicitly deferred in ADR
- [ ] No spec contradiction with accepted ADRs

**Auto OK?** No for PSBT work — needs shell + live testnet4. Yes for spec prose from existing docs.

---

## Phase 2 — Reference Implementation

**Primary agent:** Protocol implementer

**Prerequisites:** Phase 1 gate passed; read ADRs 0001–0011.

**Chat opener:**
```
Implement Phase 2 from ROADMAP.md only.
Stack: (TBD — suggest Rust or TypeScript; ADR required before choice)
Dependencies: ord HTTP client, SQLite, no ord fork.
Every PR-sized unit: tests first, then code.
Do not add inscription payload serving.
```

**Suggested task split (sequential chats):**

| Chat | Scope | Exit criteria |
|------|-------|---------------|
| 2A | Project scaffold + ord client + config | `GET /status` integration test |
| 2B | Listing store + `POST /v1/listings` | offset-0 rejection test |
| 2C | `GET /v1/verify/sat/{n}` | 2-node quorum test (mock or dual ord) |
| 2D | `POST /v1/psbt/validate` + `/template` | Passes Phase 1 vectors |

**Reviewer:** Run `bugbot` after each chat before merging.

**Gate to Phase 3:** All Phase 2 checklist items + verification tests green on testnet4.

**Auto OK?** Yes for isolated modules **if** chat scope is one row in the table above. No for full Phase 2 in one chat.

---

## Phase 3 — Marketplace Integration

**Primary agent:** Integrator

**Chat opener:**
```
Task: Map Magic Eden / UniSat listing PSBT shape → canonical (ADR-0006).
Output: integrations/{me,unisat}/README.md + adapter functions.
Do not change protocol schema without ADR.
```

**Parallel:** Partner outreach is **human** — agent prepares adapter spec only.

**Gate:** One successful testnet4 listing round-trip via adapter.

**Auto OK?** Partially — needs explore for external API docs + engineer for PSBT bytes.

---

## Phase 4 — v2 Exploration

**Primary agents:** Spec author + Bitcoin engineer (same split as Phase 1)

**Requires:** New ADR superseding or extending ADR-0005 (sat-for-sat).

**Auto OK?** No — exploratory; keep in dedicated chat with explicit "v2 spike" label.

---

## Cross-Cutting: When to Invoke Review Agents

| Trigger | Agent |
|---------|-------|
| Before merge to main | `bugbot` |
| PSBT / signing / listing validation code | `security-review` |
| PR CI red | `ci-investigator` |
| New indexer dependency proposed | Auditor + new ADR — **block implementation** |

---

## What Auto Mode Gets Wrong (Avoid)

| Failure mode | Why | Fix |
|--------------|-----|-----|
| Skips ADRs | Auto optimizes for code | Spec chat writes ADR first |
| Reimplements ord | Single chat loses ADR-0002 | Auditor role readonly |
| Confuses ✅ and 🔴 tags | Mixed audit + design | Separate chats |
| "Should work" PSBTs | No testnet4 run | Bitcoin engineer + shell |
| Scope creep to marketplace UI | One chat does everything | ROADMAP phase lock |
| GPL/CC0 confusion | Stale training data | Point to ORD_LICENSING_AND_ETHICS.md |

---

## Recommended Chat Lineup (Next 4 Sessions)

| # | Session title | Agent role | Branch / output |
|---|---------------|------------|-----------------|
| 1 | `0b-pipeline-trace` | Auditor | `ORD_REVERSE_ENGINEERING/02_pipeline/` |
| 2 | `1a-protocol-spec-v1` | Spec author | `docs/PROTOCOL_SPEC_v1.md` |
| 3 | `1b-psbt-vectors-testnet4` | Bitcoin engineer | `spec/psbt/` |
| 4 | `2a-scaffold-ord-client` | Implementer | `src/` (after gate 1) |

Sessions 1 and 2 can run **in parallel**. Session 4 waits for Session 3 gate.

---

## Handoff Checklist (Every Chat End)

Each agent session must leave:

1. **Files touched** — paths listed
2. **Gate status** — what passed / blocked
3. **UNKNOWNs** — appended to `docs/Open Questions.md` if new
4. **ADR status** — new or superseded ADR numbers
5. **Next chat opener** — copy-paste block for the following session

---

## Automations (Optional Future)

| Automation | Phase | Value |
|------------|-------|-------|
| Nightly ord `/status` + `/sat/0` check | 0b–2 | Detect testnet4 drift |
| PSBT vector CI on testnet4 | 1–2 | Gate enforcement |
| ADR index lint (every ADR linked in ROADMAP) | all | Process hygiene |

Not required for v1; manual gates sufficient initially.

---

## Summary

| Question | Answer |
|----------|--------|
| Will one Auto agent do the whole project? | **No** |
| Minimum viable lineup? | Auditor + Spec + Bitcoin engineer + Implementer |
| Can phases overlap? | 0b ∥ 1 yes; 1 → 2 and 2 → 3 **sequential gates** |
| When is Auto enough? | Single deliverable, phase-locked, ADRs already accepted |
