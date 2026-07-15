# ADR-0012: Reference Implementation Stack Choice

**Status:** Accepted  
**Date:** 2026-07-12  
**Deciders:** Phase 2 Session 07 Protocol Implementer  
**Research:** [../PROTOCOL_SPEC_v1.md](../PROTOCOL_SPEC_v1.md), [0002-depend-on-ord-not-custom-indexer.md](./0002-depend-on-ord-not-custom-indexer.md), [0003-metadata-only-not-payload-aware.md](./0003-metadata-only-not-payload-aware.md), [0009-multi-node-ord-verification.md](./0009-multi-node-ord-verification.md)

---

## Context

Phase 2 Session 07 is only scaffolding the reference implementation: configuration, a read-only ord
HTTP client, and a live testnet4 integration test for `GET /status`.

The open stack question in [AGENT_LINEUP.md](../../AGENT_LINEUP.md) is whether to start the
reference implementation in Rust or TypeScript.

Both are viable long-term:

1. **Rust** aligns with upstream `vendor/ord` and `crates/ordinals`.
2. **TypeScript** aligns with the existing workspace runtime footprint and has no native linking
   dependency for this thin HTTP-only scaffold.

During this session, the local environment proved a practical constraint:

- `cargo` and `rustc` are installed.
- The required MSVC linker (`link.exe`) is **not** available in the current workstation environment.
- Node.js `v24.14.0` is available and can execute `.ts` files directly with
  `--experimental-strip-types`.

That means a Rust scaffold cannot satisfy the session exit criterion "tests must run and pass"
without first changing the machine toolchain, while a TypeScript scaffold can.

## Decision

**Use TypeScript on Node 24 for the Phase 2 reference implementation scaffold.**

The reference implementation starts as a small TypeScript library under `src/` with:

- configuration loading for the ord base URL and quorum node URLs,
- a read-only ord HTTP client for `GET /status`, `GET /sat/{n}`, and `GET /output/{outpoint}`,
- tests executed with the built-in Node test runner.

If a later phase needs direct reuse of `crates/ordinals`, native performance, or a Rust-first
deployment target, that change requires a new ADR superseding or refining this one.

## Rationale

- ADR-0002 delegates sat location to ord. Session 07 is therefore an HTTP integration problem, not
  an indexing problem.
- ADR-0003 keeps the protocol metadata-only, so no media pipeline or heavy native integration is
  needed in this scaffold.
- ADR-0009 requires multi-node verification later, and a TypeScript HTTP client is sufficient for
  quorum reads in Sessions 07-08.
- The actual local environment can run Node 24 immediately, but cannot currently link Rust/MSVC
  binaries.
- Choosing the stack that can be executed and tested now is better than choosing the more elegant
  stack that cannot satisfy the gate in this session.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Rust (`reqwest`, `tokio`) | Strong long-term fit, but blocked in this environment by missing `link.exe`, so tests could not pass in Session 07 |
| Hybrid start (TS wrapper, Rust core later) | Adds migration overhead immediately without solving a current protocol problem |
| JavaScript without TypeScript types | Faster still, but weaker contract clarity for the ord API surface and config boundary |

## Consequences

### Positive
- Session 07 can satisfy its live-test exit criterion on the existing machine.
- The ord client remains small, explicit, and easy to replace later if the stack changes.
- No extra package install is required for the initial scaffold and test run.

### Negative
- Direct reuse of Rust crates such as `crates/ordinals` is deferred.
- A later Rust migration, if chosen, will require a superseding ADR and code movement.

### Neutral
- The protocol boundary remains unchanged: ord is still the source of truth for sat location.

## Compliance

- Session 07 code stays limited to config plus read-only ord HTTP access.
- No listing store is added before Session 08.
- No custom sat indexer or ord fork is introduced.
- Tests must include one live `GET /status` test against the local testnet4 ord instance.

## References

- [ROADMAP.md](../../ROADMAP.md)
- [AGENT_LINEUP.md](../../AGENT_LINEUP.md)
- [docs/PROTOCOL_SPEC_v1.md](../PROTOCOL_SPEC_v1.md)
