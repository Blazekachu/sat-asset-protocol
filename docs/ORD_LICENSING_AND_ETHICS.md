# Ord Licensing and Ethics

**Status:** ✅ Verified from `vendor/ord` 0.27.1  
**Sources:** [ordinals/ord](https://github.com/ordinals/ord), prior design discussion (ChatGPT share)

---

## Critical Correction

A prior discussion stated `ord` is **GPL-3.0**. That is **incorrect** for current `ord`.

**✅ Verified:** `ord` 0.27.1 workspace license is **[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)** (`vendor/ord/Cargo.toml:26`, `LICENSE` file).

`crates/ordinals` uses the same workspace license (`CC0-1.0`).

**Implication:** CC0 dedicates the work to the public domain where possible — **more permissive** than GPL. Still: professional practice is to **attribute** and **document** what you studied vs what you authored.

---

## What Is Absolutely Fine

With CC0-1.0 ord source, you can:

- Read every line of source code
- Understand every algorithm
- Document the indexing pipeline (this repo's `ORD_REVERSE_ENGINEERING/`)
- Reverse engineer the database schema with line citations
- Study performance optimizations
- Compare architecture against Sat Asset Protocol design
- **Use `crates/ordinals` as a library** in Rust projects
- Write new implementations informed by understanding

CC0 does not impose copyleft. GPL obligations **do not apply** to ord itself.

---

## What Remains Good Practice (Regardless of License)

Even with CC0, we follow engineering discipline:

| Practice | Why |
|----------|-----|
| **Study ≠ copy** | Sat Asset Protocol is architecturally different (commerce layer) |
| **Cite sources** | Line numbers in `ORD_REVERSE_ENGINEERING/` |
| **Tag claims** | ✅ / 🟡 / 🔴 in [REVERSE_ENGINEERING.md](../REVERSE_ENGINEERING.md) |
| **Don't mix facts with proposals** | Prevents accidental "ord does X" when we designed X |
| **Prefer `ordinals` crate** | For sat math — don't reimplement FIFO |

---

## If You Study Other Code (GPL or otherwise)

Some ecosystem tools (not ord) may use other licenses. For each dependency:

1. Read `LICENSE` / `Cargo.toml` / `package.json`
2. Document in ADR if substantial code is incorporated
3. GPL derivatives require GPL compliance on distribution — **verify per project**

**ord 0.27.1:** CC0-1.0 ✅  
**Bitcoin Core:** MIT ✅  
**OPI / brc20-swap-indexer:** Check repo license before reuse

---

## Sat Asset Protocol Stance

| Activity | Allowed | Notes |
|----------|---------|-------|
| Architectural audit of ord | ✅ | `ORD_REVERSE_ENGINEERING/` |
| Run ord as dependency | ✅ | ADR-0002 |
| Import `ordinals` crate | ✅ | ADR-0001 |
| Copy-paste large ord blocks into proprietary code | Legally permissive (CC0) but **poor practice** | Prefer library or clean-room |
| Claim ord algorithms as original | ❌ unethical | Cite Ordinal Theory / ord |
| Fork ord for custom indexer | ✅ possible | Requires ADR superseding ADR-0002 |

---

## Ethical Methodology (from design discussions)

```
Read ord source
        ↓
Understand: compression, tables, pipeline, invariants
        ↓
Document with ✅ verified tags
        ↓
Close source / design Sat Asset Protocol layer
        ↓
Build commerce schema from first principles
```

This is standard systems engineering — same pattern as studying PostgreSQL internals before building a query layer, without forking Postgres.

---

## References

- https://github.com/ordinals/ord/blob/master/Cargo.toml
- https://github.com/ordinals/ord/blob/master/LICENSE
- [ADR-0011](./adr/0011-ord-architectural-audit.md)
- [Indexer Landscape.md](./Indexer%20Landscape.md)
