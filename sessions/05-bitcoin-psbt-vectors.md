# Session 05 — Bitcoin Engineer: PSBT Test Vectors

| Field | Value |
|-------|-------|
| **Phase** | 1 |
| **Agent type** | Bitcoin engineer |
| **Blocked by** | testnet4 stack running |
| **Output** | `spec/psbt/` |

---

## Cursor agent to use

| Setting | Use this |
|---------|----------|
| **Cursor mode** | **Agent** |
| **Model** | **Codex** (alt: Opus) |
| **Subagent** | `shell` |
| **Avoid** | Grok alone, Composer, Auto |

---

```powershell
# Verify ord is up
Invoke-RestMethod http://127.0.0.1:8080/status
# If not: run /btcfullord or start-bitcoind.ps1 + start-ord.ps1
```

---

## PROMPT

```
You are the Bitcoin Engineer for sat-asset-protocol (Phase 1, Session 05).

Read:
- docs/PSBT Settlement.md
- docs/adr/0005-v1-psbt-sat-for-btc-only.md
- docs/adr/0006-canonical-two-bump-psbt.md
- docs/adr/0007-utxo-listing-offset-zero-precondition.md

Environment:
- testnet4 ord: http://127.0.0.1:8080
- bitcoind RPC: 127.0.0.1:48332
- ord 0.27.1, --index-sats enabled

TASK: Create and VALIDATE PSBT test vectors on testnet4.

Deliverables:
- spec/psbt/README.md
- spec/psbt/vectors/listing-seller.json (SIGHASH_SINGLE|ANYONECANPAY)
- spec/psbt/vectors/fill-buyer-2bump.json
- spec/psbt/vectors/invalid-offset-nonzero.json (must fail ADR-0007)

Prove on chain or via ord validate — do not say "should work" without running commands.

End handoff: gate Phase 2 — PASS/FAIL, blockers for Session 07
```

---

## Exit criteria

- [ ] Vectors exist and were executed on testnet4
- [ ] 2-bump template matches ADR-0006
- [ ] offset-0 rejection demonstrated

## Next session (only if PASS)

[07-implementer-scaffold.md](./07-implementer-scaffold.md)
