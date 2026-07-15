# Session 09b — Implementer: Collections + Attestations

| Field | Value |
|-------|-------|
| **Phase** | 2b |
| **Agent type** | Protocol implementer |
| **Blocked by** | Session 09 (commerce core) |
| **Parallel with** | Session 10 (marketplace adapters) — **OK to run in parallel** |
| **Output** | collection predicates + attestation verify |

---

## Why this exists

Session 09 completed listings + verify + PSBT. ROADMAP still had:

- Collection predicate evaluator (ADR-0008)
- Attestation verify (signature only)

Those are **Phase 2b**, not required to start Session 10.

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** (alt: Opus for crypto/signing) |
| **Subagent** | `shell` |
| **Avoid** | Grok |
| **Writes** | `src/` collections + attestations modules |

**Steps:** New chat → **Agent** → **Codex** → paste PROMPT

---

## PROMPT

```
You are the Protocol Implementer for sat-asset-protocol (Phase 2b, Session 09b).

PREREQUISITE: Session 09 done (listings, /v1/verify/sat, /v1/psbt/*).

Read:
- docs/adr/0008-collection-predicates-and-attestations.md
- docs/Minimal Schema.md (§ Collection, Attestation)
- docs/PROTOCOL_SPEC_v1.md §7 (if present)
- docs/Open Questions.md Q19–Q20, OPEN-4 notes

TASK (Phase 2b only):

1. Collection predicate evaluator for Rodarmor math predicates only:
   - rarity, block_range, epoch, name_prefix, sat_number, sat_range
   - GET /v1/collections/{id}/verify/{sat_number} → { verified: bool, attested?: bool }
   - GET /v1/collections/{id}/assets (paginated stub OK if full scan is expensive — document)

2. Attestation verify (signature only):
   - POST /v1/attestations — store signed attestation
   - GET /v1/attestations/{sat_number}
   - Verify signature against issuer pubkey (pick ed25519 or secp256k1; document in ADR-0013 if new)
   - Do NOT adjudicate claim truth (ADR-0008)

3. Tests for:
   - rarity/block_range membership true/false
   - valid vs invalid attestation signature

Rules:
- No ord fork; use crates/ordinals math via TS port or pure functions matching ordinals crate
- Skip mining_pool / user_defined predicates (OPEN-4 — route through attestation or defer)
- No media / payload storage

End handoff: Phase 2b complete Y/N; ROADMAP Phase 2 fully checked Y/N
```

---

## Exit criteria

- [ ] Rodarmor predicates evaluate correctly in tests
- [ ] Attestation signature verify works (accept valid, reject invalid)
- [ ] ROADMAP Phase 2 collection + attestation items checked

## Next session

Full Phase 2 complete → optional polish; Session 10 may already be done in parallel.
