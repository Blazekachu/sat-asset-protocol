# Listings Session 08 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persistent sat listing storage plus `POST /v1/listings` and `GET /v1/listings`, enforcing the offset-0 precondition with tests.

**Architecture:** A dependency-injected Node `http` server delegates listing rules to a pure `ListingService`, decodes seller PSBTs with a focused parser, and stores open listings in SQLite through a `ListingStore` abstraction. Tests exercise the real HTTP handlers against an in-memory SQLite database and a stub ord client.

**Tech Stack:** TypeScript, Node `http`, Node `node:sqlite`, Node test runner

## Global Constraints

- Align behavior with `docs/PROTOCOL_SPEC_v1.md`.
- Enforce ADR-0007 offset-0 precondition on `POST /v1/listings`.
- Do not implement `/v1/psbt/template`; Session 09 owns template generation.
- Keep storage additive and local; this repo is not currently a git repository.

---

### Task 1: Write the listing API tests

**Files:**
- Create: `tests/listings-api.test.ts`

**Interfaces:**
- Consumes: `createApp(deps: AppDependencies): { server: HttpServer }`
- Produces: failing tests for `POST /v1/listings` and `GET /v1/listings`

- [ ] Write the failing tests for valid listing acceptance and non-offset-0 rejection.
- [ ] Run `npm test -- tests/listings-api.test.ts` and confirm failure.

### Task 2: Add PSBT parsing and listing domain logic

**Files:**
- Create: `src/listing-types.ts`
- Create: `src/psbt.ts`
- Create: `src/listing-service.ts`

**Interfaces:**
- Produces: `parseListingPsbt(psbtBase64: string): ParsedListingPsbt`
- Produces: `ListingService.createListing(input): Promise<Listing>`

- [ ] Implement the minimal PSBT parser needed for input-0/outpoint/output-0/sighash checks.
- [ ] Implement listing validation and offset-0 ord verification in `ListingService`.
- [ ] Run `npm test -- tests/listings-api.test.ts` and confirm partial progress.

### Task 3: Add SQLite listing store

**Files:**
- Create: `src/listing-store.ts`

**Interfaces:**
- Produces: `SqliteListingStore`
- Produces: `initializeListingStore(database: DatabaseSync): void`

- [ ] Implement schema creation and insert/query methods for listings.
- [ ] Run the focused test again and confirm persistence behavior is still failing only where routing is missing.

### Task 4: Add HTTP endpoints

**Files:**
- Create: `src/server.ts`

**Interfaces:**
- Produces: `createApp(deps)`
- Produces: `startServer(...)`

- [ ] Implement `POST /v1/listings` and `GET /v1/listings`.
- [ ] Run `npm test -- tests/listings-api.test.ts` and confirm they pass.

### Task 5: Run full verification

**Files:**
- Modify: `tests/listings-api.test.ts`
- Modify: `src/*` as needed

**Interfaces:**
- Consumes: all interfaces above

- [ ] Run `npm test`.
- [ ] Fix any regressions without expanding scope beyond Session 08.
