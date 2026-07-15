# ADR-0003: Metadata-Only, Not Payload-Aware

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Research phase  
**Research:** [Storage Analysis.md](../Storage%20Analysis.md), [Protocol Boundary.md](../Protocol%20Boundary.md)

---

## Context

Marketplaces for inscriptions traditionally serve images, HTML, and recursive content. Sat trading may involve inscribed sats or bare sats. The protocol could:

1. Store and serve inscription payloads (images, HTML, SVG).
2. Store only metadata and reference payloads from ord/chain.
3. Ignore inscriptions entirely.

Storage research confirmed inscription **payload bytes are never in `index.redb`** — ord fetches from Bitcoin via `getrawtransaction` at serve time.

## Decision

**Sat Asset Protocol is metadata-only.** It does not store, host, cache, or serve inscription payloads. Optional `inscription_ids` in schema are references only. Media rendering is an application concern.

## Rationale

- Hypothesis verified: marketplace settlement requires UTXO/sat location + PSBT, not image bytes ([Storage Analysis.md](../Storage%20Analysis.md) §6.3).
- Omitting `--index-transactions` avoids ~176 GB duplicate tx/payload storage.
- Payload hosting creates legal, CDN, and moderation surface unrelated to commerce protocol.
- Bare-sat trading (rare sats) has no payload at all.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Payload-aware protocol (store media) | Duplicates ord + CDNs; ~TB scale; moderation burden |
| Proxy all content through protocol API | Couples commerce to media SLA; latency |
| Require inscription index for all listings | Excludes bare-sat market; larger ord index |

## Consequences

### Positive
- Protocol nodes stay lightweight relative to ord.
- Clear boundary: commerce vs media.

### Negative
- Applications must fetch previews from ord, mempool, or third-party indexers.

### Neutral
- Inscribed sats remain tradeable; only display is out of scope.

## Compliance

- No `content`, `media_url`, or blob columns in protocol schema.
- API must not expose `/content/*` endpoints.
- PR review rejects payload storage additions without new ADR.

## References

- https://docs.ordinals.com/inscriptions.html
- [Storage Analysis.md](../Storage%20Analysis.md) §5–6
