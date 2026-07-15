# Session 04 — Spec Author: Protocol Spec v1

| Field | Value |
|-------|-------|
| **Phase** | 1 |
| **Agent type** | Spec author |
| **Parallel with** | Sessions 01–03 |
| **Blocked by** | Nothing |
| **Output** | `docs/PROTOCOL_SPEC_v1.md` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Opus** (alt: Sonnet) |
| **Subagent** | None |
| **Avoid** | Codex, Grok (they jump to code) |

---

## PROMPT

```
You are the Spec Author for sat-asset-protocol (Phase 1).

Read:
- docs/README.md (all research docs)
- docs/adr/0001 through 0011
- docs/Minimal Schema.md
- docs/PSBT Settlement.md
- docs/API Specification.md

TASK: Draft docs/PROTOCOL_SPEC_v1.md — BIP-style protocol document.

Include:
- Scope (sat-for-BTC v1 only, ADR-0005)
- Asset identity (sat_number, ADR-0001)
- Listing / offer schemas
- Canonical 2-bump PSBT (ADR-0006)
- Offset-0 precondition (ADR-0007)
- Verification (multi-node ord, ADR-0009)
- What is NOT in scope

Rules:
- Do NOT write src/
- Flag any conflict with ADRs for human review
- Cite ADR numbers inline

End handoff: spec draft path, open conflicts list, next = Session 05
```

---

## Exit criteria

- [ ] `PROTOCOL_SPEC_v1.md` exists
- [ ] Every ADR 0001–0011 reflected or conflict noted

## Next session

[05-bitcoin-psbt-vectors.md](./05-bitcoin-psbt-vectors.md)
