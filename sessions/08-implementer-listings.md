# Session 08 — Implementer: Listings API

| Field | Value |
|-------|-------|
| **Phase** | 2 |
| **Agent type** | Protocol implementer |
| **Blocked by** | Session 07 |
| **Output** | `POST /v1/listings` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** |
| **Subagent** | `shell` |
| **Avoid** | Grok, Composer |

---

## PROMPT

```
You are the Protocol Implementer for sat-asset-protocol (Phase 2, Session 08).

Read docs/Minimal Schema.md, docs/adr/0007-utxo-listing-offset-zero-precondition.md

TASK:
- SQLite (or chosen store) listing model
- POST /v1/listings — validate signed PSBT + offset-0 via ord list(outpoint)
- GET /v1/listings — query open listings
- Tests: accept valid listing, reject non-offset-0

Do not implement PSBT template yet (Session 09).
Align with PROTOCOL_SPEC_v1.md.
```

---

## Exit criteria

- [ ] offset-0 validation proven in tests
- [ ] Listing CRUD works

## Next session

[09-implementer-verify-psbt.md](./09-implementer-verify-psbt.md)
