# Reverse Engineering Discipline

**Companion to:** `ORD_REVERSE_ENGINEERING/`  
**Project:** Sat Asset Protocol (working name in discussions: *Sat Aware*)

---

## Tagging System

Every technical statement in reverse-engineering docs MUST be tagged:

| Tag | Meaning | Example |
|-----|---------|---------|
| **✅ Verified from source** | Confirmed in `vendor/ord` with file:line | `index.rs:58` table defs |
| **🟡 Inferred from code structure** | Logical but not line-traced | Reorg rollback details |
| **🔴 Design proposal** | Sat Asset Protocol idea — NOT ord behavior | Sat history event log |

**Never mix 🔴 into ord documentation without labeling.**

---

## Workflow

### Phase 1 — Database ✅ (started)

- [x] Freeze target: ord 0.27.1 / commit `1ad3f64`
- [x] Clone to `vendor/ord`
- [x] `rg "define_table!|define_multimap_table!"` inventory
- [x] [01_tables.md](../ORD_REVERSE_ENGINEERING/01_database/01_tables.md)
- [x] Key types, value types, relationships

### Phase 2 — Indexing engine 🟡

- [ ] Trace: block arrives → DB commit
- [ ] Document invariants per stage
- [ ] `02_pipeline/` detailed files

### Phase 3 — Query engine

- [ ] Map HTTP/CLI → table reads
- [ ] Identify hot paths (`find` O(n) vs `rare_sat_satpoint` O(1))

### Phase 4 — Design review

For each ord table: Keep? Improve? Replace? Generalize?  
→ Record in `05_sat_asset_notes/`

### Phase 5 — Sat Asset architecture

Only after Phases 1–4: finalize protocol storage (listings DB separate from ord).

---

## Per-Table Audit Template

```markdown
### TABLE_NAME

**Declared:** file:line
**Key:** type
**Value:** type
**Writer:** function → insert path
**Reader:** API / CLI
**Sat Asset reuse:** Query ord | Skip | Study | Replace (v2+)
**Tag:** ✅ / 🟡 / 🔴
```

---

## Search Commands (verified workflow)

```powershell
cd vendor/ord
rg "define_table!|define_multimap_table!" src/
rg "open_table\(" src/
rg "open_multimap_table\(" src/
rg "OUTPOINT_TO_UTXO_ENTRY" src/
```

---

## Relationship to ADRs

| Event | Action |
|-------|--------|
| Major design choice from audit | Write ADR before code |
| Audit disproves assumption | Supersede relevant ADR |
| Custom indexer proposed | Supersede ADR-0002 with new ADR |

---

## Licensing Note

✅ ord 0.27.1 is **CC0-1.0**, not GPL-3.0. See [ORD_LICENSING_AND_ETHICS.md](./docs/ORD_LICENSING_AND_ETHICS.md).

---

## Origin

Methodology adapted from architectural audit plan (ChatGPT discussion, 2026). First deliverable — verified table inventory — is in [01_tables.md](../ORD_REVERSE_ENGINEERING/01_database/01_tables.md).
