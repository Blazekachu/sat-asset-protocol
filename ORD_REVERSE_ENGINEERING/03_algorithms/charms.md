# Charms — STUB

**Target:** `ord` **0.27.1** (commit `1ad3f64…`)
**Phase:** 0b · Session 02 — *stub only, to be expanded in Session 03*
**Status:** 🟡 Stub · ✅ core facts verified

**Files:** `vendor/ord/crates/ordinals/src/charm.rs`, `vendor/ord/crates/ordinals/src/sat.rs`
Cross-ref: [query_paths.md](./query_paths.md) (§4.1 `/sat/{n}` charms field), [inscription_detection.md](./inscription_detection.md)

---

## 1. What a charm is

A **charm** is a boolean trait flag. Stored as a `u16` bitfield (14 flags). `Charm::flag() = 1 << variant` (`charm.rs:39`).

Enum (`charm.rs:4`), bit index = discriminant:

| Bit | Charm | Origin |
|----:|-------|--------|
| 0 | Coin | sat-intrinsic |
| 1 | Cursed | inscription |
| 2 | Epic | sat rarity |
| 3 | Legendary | sat rarity |
| 4 | Lost | inscription/location |
| 5 | Nineball | sat-intrinsic |
| 6 | Rare | sat rarity |
| 7 | Reinscription | inscription |
| 8 | Unbound | inscription |
| 9 | Uncommon | sat rarity |
| 10 | Vindicated | inscription |
| 11 | Mythic | sat rarity |
| 12 | Burned | inscription |
| 13 | Palindrome | sat-intrinsic |

`Charm::charms(u16)` (`charm.rs:74`) decodes the bitfield to `Vec<Charm>` in `ALL` order.

---

## 2. Two sources of charms ✅ (key finding)

### 2a. Sat-intrinsic charms — computed, no table

`Sat::charms()` (`sat.rs:105`) computes **only** charms derivable from the sat number itself:

- `nineball`, `palindrome`, `coin`
- rarity → `Uncommon` / `Rare` / `Epic` / `Legendary` / `Mythic` (Common → none)

This is what the **`/sat/{n}`** endpoint serves (`server.rs:745` `sat.charms()`). **No redb read** — pure math on the sat number.

### 2b. Inscription charms — stored in InscriptionEntry 🟡

`Cursed`, `Reinscription`, `Unbound`, `Lost`, `Vindicated`, `Burned` are **not** derivable from the sat number. They are assigned by the **inscription updater** at index time and stored in the `charms` field of `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY`, read via `get_inscription_entry` ([query_paths.md](./query_paths.md) `index.rs:2379`).

⚠️ Therefore `/sat/{n}.charms` shows **sat-intrinsic charms only** — it does **not** include the cursed/unbound/etc. status of inscriptions on that sat. Those appear on the inscription entry, not the sat.

---

## 3. Sat Asset relevance 🔴

- Rarity/palindrome/nineball charms are cheap (O(1) math) → safe to compute in the protocol layer directly from `sat_number` without querying ord at all.
- Inscription charms require an inscription-entry read; only relevant if the protocol tracks inscribed assets.

---

## 4. TODO → Session 03 (expand this stub)

1. 🟡 Trace exact updater rules that set `Cursed` / `Unbound` / `Vindicated` (link to [inscription_detection.md](./inscription_detection.md) validity flags: `pushnum`, `stutter`, `unrecognized_even_field`, `duplicate_field`).
2. 🟡 `Burned` / `Lost` assignment conditions (OP_RETURN / null outpoint).
3. Confirm `InscriptionEntry.charms` field offset/type in `03_value_types.md`.
4. Verify HTML vs JSON charm rendering parity.

---

## Handoff to Session 03

**Completed in Session 02 (Phase 0b):**
- ✅ [query_paths.md](./query_paths.md) — HTTP/CLI → redb table map; `find` O(UTXOs) vs `rare_sat_satpoint` O(1); `/sat/{n}` and `/output/{outpoint}` fully mapped; hot paths flagged for Sat Asset verify API.
- ✅ [inscription_detection.md](./inscription_detection.md) — witness envelope parsing (`envelope.rs`), field/tag extraction, read-side serving.
- 🟡 charms.md (this stub) — charm bitfield + two-source model.

**Session 03 pickup list:**
1. Expand charms.md §4 (updater curse/charm rules — Phase 2 write-side trace).
2. Complete inscription_detection.md §7 follow-ups (curse rules, pointer, delegate).
3. query_paths.md §9: benchmark outpoint-first verify (`/output` O(1)) vs `ord find` O(UTXOs) on local testnet4.
4. Rune query paths (`RUNE_*` tables) — deferred, out of Session 02 scope.
5. Fold verified findings' tags into [../../REVERSE_ENGINEERING.md](../../REVERSE_ENGINEERING.md) claim ledger.

**Guardrail carried forward:** verify API takes **outpoint as input** and confirms via `/output/{outpoint}` (O(1)); never reverse-search sat→location on the request path (degrades to `find` O(UTXOs)). Consistent with ADR-0002 and [00_overview.md](../00_overview.md).
