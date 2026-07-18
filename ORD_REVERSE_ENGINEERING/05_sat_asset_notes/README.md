# Sat Asset Notes — from ord audit

**Tag:** 🔴 Design proposals (not ord facts)

Working name *Sat Aware* from prior design discussions maps to this repo: **Sat Asset Protocol**.

**Phase 0b status:** ✅ **Complete** — Sessions 01–03 all delivered (see [Completion Status](#completion-status) below).

---

## Documents

| File | Topic |
|------|-------|
| [01_indexer_future.md](./01_indexer_future.md) | Custom indexer vs ord delegation |
| [02_commerce_vs_ord_offers.md](./02_commerce_vs_ord_offers.md) | `NUMBER_TO_OFFER` vs protocol listings |
| [03_table_reuse_matrix.md](./03_table_reuse_matrix.md) | ✅ Phase 4 deliverable — all 24 tables scored Keep/Improve/Replace/Generalize + v1 action |

---

## Design Review Questions (Phase 4)

For each ord table, ask:

| Question | Default for v1 |
|----------|----------------|
| Keep it? | Query ord — don't store |
| Improve it? | N/A v1 |
| Replace it? | No |
| Generalize it? | Collections/attestations at protocol layer |

**Resolved (Session 03):** all 24 `index.redb` tables scored against these four questions in [03_table_reuse_matrix.md](./03_table_reuse_matrix.md). Result: 2 tables queried via ord as required (`OUTPOINT_TO_UTXO_ENTRY`, `SAT_TO_SATPOINT`), 1 queried optionally (`SCRIPT_PUBKEY_TO_OUTPOINT`), 11 skipped (inscription-only), 8 not applicable (rune/internal), 1 studied but not reused (`NUMBER_TO_OFFER`). Zero tables replaced, forked, or improved — fully consistent with the defaults above.

---

## Confirmed v1 stance (ADRs)

- ADR-0002: No custom sat indexer
- ADR-0003: No payload storage
- ADR-0004: Protocol owns its own commerce schema (don't borrow ord's `NUMBER_TO_OFFER`)
- ADR-0005: sat-for-BTC PSBT only
- ADR-0008: Collections/attestations are protocol-layer predicates, not ord's inscription child/parent graph

Audit informs **v2+** only unless ADR superseded.

---

## Completion status

| Session | Deliverable | Status |
|---------|-------------|--------|
| 01 — Ord Auditor, pipeline trace | `02_pipeline/` (01–05 + README) | ✅ Complete (per `02_pipeline/README.md` handoff, Sessions 1–3) |
| 02 — Ord Auditor, query paths | `03_algorithms/` (charms, inscription_detection, query_paths, sat_assignment) | ✅ Complete (files present; not re-verified in this session — out of scope, see note below) |
| 03 — Ord Auditor, design review | `05_sat_asset_notes/03_table_reuse_matrix.md` | ✅ Complete (this session) |

**Exit criteria (Session 03):**

- [x] All 24 `index.redb` tables have a reuse decision — see [03_table_reuse_matrix.md](./03_table_reuse_matrix.md) §9 summary table.
- [x] Conflicts with ADRs flagged explicitly — see §11 ("Explicit ADR alignment check") and the two 🔴 flags in §2 (sat-history table) and §8 (`NUMBER_TO_OFFER` reuse).

**Note on `03_algorithms/`:** this session's prompt scoped reading to `01_database/` and `02_pipeline/` only; `03_algorithms/` files exist on disk from Session 02 but were not re-read or re-verified here. No table decision in `03_table_reuse_matrix.md` depends on their contents (confirmed in that file's "Open follow-ups").

## Phase 0b complete? **Y**

All three Session 03 blockers (Sessions 01–02) were present as completed markdown before this session started, and this session's own deliverable (`03_table_reuse_matrix.md`) is written and cross-linked. No `src/` code was added. No ADR was changed — two potential conflicts were identified and explicitly flagged (not silently resolved) for a future session/ADR author to pick up if ever revisited.

**Next step:** protocol v1 spec (`docs/PROTOCOL_SPEC_v1.md`).
