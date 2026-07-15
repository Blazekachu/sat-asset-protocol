# Architecture Decision Records (ADR)

Every **major design choice** in Sat Asset Protocol must have an ADR before implementation merges. ADRs document **why** a decision was made, not only what was built.

---

## When to Write an ADR

Write an ADR when a decision is:

- **Hard to reverse** (indexer dependency, PSBT schema, identity model)
- **Cross-cutting** (affects API, wallets, marketplaces, or verification)
- **Controversial** or had credible alternatives
- **Required for contributors** to understand constraints without reading all research

Do **not** write ADRs for trivial choices (formatter, folder naming, single-line fixes).

---

## Process

1. **Research first** — ADR must cite `docs/` research or reproducible experiments.
2. **Copy** `0000-template.md` → `NNNN-short-title.md`.
3. **Status:** `Proposed` → review → `Accepted`.
4. **Supersede** — never delete; mark `Superseded by ADR-XXXX` and link forward.
5. **Implement** — code must align with accepted ADRs; PR description links ADR.

---

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0000](./0000-template.md) | Template | — |
| [0001](./0001-reuse-ord-sat-numbering.md) | Reuse Ord sat numbering | Accepted |
| [0002](./0002-depend-on-ord-not-custom-indexer.md) | Depend on ord, not custom sat indexer | Accepted |
| [0003](./0003-metadata-only-not-payload-aware.md) | Metadata-only, not payload-aware | Accepted |
| [0004](./0004-commerce-metaprotocol-not-ordinals-replacement.md) | Commerce metaprotocol, not Ordinals replacement | Accepted |
| [0005](./0005-v1-psbt-sat-for-btc-only.md) | v1 PSBT: sat-for-BTC only | Accepted |
| [0006](./0006-canonical-two-bump-psbt.md) | Canonical 2-bump PSBT template | Accepted |
| [0007](./0007-utxo-listing-offset-zero-precondition.md) | UTXO listing with offset-0 precondition | Accepted |
| [0008](./0008-collection-predicates-and-attestations.md) | Collection predicates + attestations | Accepted |
| [0009](./0009-multi-node-ord-verification.md) | Multi-node ord verification | Accepted |
| [0010](./0010-sat-for-sat-deferred-v2.md) | Sat-for-sat deferred to v2 | Accepted |
| [0011](./0011-ord-architectural-audit.md) | Ord architectural audit before custom indexer | Accepted |
| [0012](./0012-reference-implementation-stack-choice.md) | Reference implementation stack choice | Accepted |
| [0013](./0013-attestation-signature-scheme-ed25519.md) | Attestation signature scheme (Ed25519) | Accepted |
| [0014](./0014-sat-for-sat-offer-accept-sighash-all.md) | Sat-for-sat via offer/accept (SIGHASH_ALL) | Proposed |

---

## Format

Based on [Michael Nygard's ADR](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) pattern. Keep ADRs short (1–2 pages). Link to research docs for depth.
