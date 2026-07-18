# Contributing

## Before You Code

1. Read [docs/README.md](./docs/README.md) for the research index and context.
2. Read accepted [ADRs](./docs/adr/README.md) — they are binding for implementation.
3. Do not write production code until the phase you're working on is defined in [ROADMAP.md](./ROADMAP.md).

---

## Architecture Decision Records (Required)

Every **major design choice** needs an ADR **before** implementation merges.

### Examples requiring an ADR

- Indexer dependency or new data source
- PSBT schema changes
- Identity model changes
- Payload or media storage
- New settlement type (e.g. sat-for-sat)
- Breaking API changes

### Process

1. Copy [docs/adr/0000-template.md](./docs/adr/0000-template.md) → `docs/adr/NNNN-short-title.md`
2. Set status to `Proposed`; open for review
3. Link research docs and evidence
4. After acceptance, update [docs/adr/README.md](./docs/adr/README.md) index
5. PR description must cite ADR number(s)

### Updating decisions

- **Never delete** ADRs
- Supersede: set status `Superseded by ADR-XXXX` and link forward
- Deprecate: explain migration path

---

## Evidence Standards

- Cite ord source, docs, or reproducible experiments
- Mark unverified claims as **UNKNOWN**
- Prefer testnet4/regtest validation before mainnet claims

---

## Git

- One logical change per commit
- Do not commit secrets (`.env`, keys)
- Commit author: `Blazekachu <237100058+Blazekachu@users.noreply.github.com>` (workspace convention)

---

## Project Layout

```
sat-asset-protocol/
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
├── docs/
│   ├── README.md       # Research index
│   ├── adr/            # Architecture Decision Records
│   ├── ORD_LICENSING_AND_ETHICS.md
│   └── *.md            # Research deliverables
├── ORD_REVERSE_ENGINEERING/  # ord 0.27.1 architectural audit
├── REVERSE_ENGINEERING.md    # ✅🟡🔴 tagging discipline
├── vendor/ord/         # Pinned ord checkout (gitignored; clone locally)
└── (future) src/       # Implementation — not started
```
