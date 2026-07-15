# Inscription Detection Algorithm

**Target:** `ord` **0.27.1** (commit `1ad3f64…`, schema `34`)
**Phase:** 0b · Session 02
**Status:** ✅ Verified from source · 🟡 Some indexer-write steps deferred to Phase 2

**Files audited:**
- `vendor/ord/src/inscriptions/envelope.rs` — witness → `Envelope` parsing
- `vendor/ord/crates/ordinals/` (tags, inscription struct) — cross-ref
- Read side: `vendor/ord/src/index.rs` (`get_inscription_*`, `inscriptions_on_output`)

Cross-ref: [query_paths.md](./query_paths.md) · [sat_assignment.md](./sat_assignment.md) · [01_database/04_relationships.md](../01_database/04_relationships.md)

---

## 1. What "detection" means

Detection = recognising an **inscription envelope** inside a Taproot witness script and parsing it into a structured `Inscription`. It happens during indexing (write side); the read side just serves what detection stored.

```
Transaction witness (tapscript)
        │  RawEnvelope::from_transaction   (envelope.rs:106)
        ▼
RawEnvelope { input, offset, payload: Vec<Vec<u8>>, pushnum, stutter }
        │  From<RawEnvelope> for ParsedEnvelope   (envelope.rs:29)
        ▼
ParsedEnvelope { payload: Inscription{ body, content_type, … } }
```

---

## 2. The envelope wire format ✅

Constants (`envelope.rs:13`):

```
PROTOCOL_ID = b"ord"      // 3 bytes
BODY_TAG    = []          // empty push separates fields from body
```

An inscription envelope inside a tapscript is:

```
OP_FALSE
OP_IF
  PUSH "ord"              ← PROTOCOL_ID
  <field key> <field value>   (repeated, even/odd pairs)
  OP_0 (empty push)      ← BODY_TAG separator
  <body chunk> <body chunk> …
OP_ENDIF
```

### Detection state machine (`from_tapscript` `:120`, `from_instructions` `:150`)

1. Walk tapscript instructions. On an **empty push** (`PushBytes([])`), attempt to open an envelope (`:127`).
2. Require `OP_IF` (`:156`) — else record possible **stutter** and bail.
3. Require `PUSH PROTOCOL_ID` (`:161`) — else stutter/bail.
4. Loop collecting payload pushes until `OP_ENDIF` (`:173`):
   - `OP_PUSHNUM_*` opcodes are normalised to their byte value and set `pushnum = true` (`:185`+). A `pushnum` envelope is flagged (non-standard encoding).
   - `None` (truncated script) → discard envelope (`:172`).

Only **unversioned leaf** tapscripts are considered (`unversioned_leaf_script_from_witness`, `:110`).

---

## 3. RawEnvelope → ParsedEnvelope (field parsing) ✅

`From<RawEnvelope>` (`envelope.rs:29`):

1. **Body split:** find first even-indexed empty push → everything after is body (`:31–35`, `:67`).
2. **Fields:** consume payload before body in `chunks(2)` as `key → [values]` (`:41`). Odd leftover → `incomplete_field = true` (`:44`).
3. **Duplicate detection:** any key with >1 value → `duplicate_field = true` (`:48`).
4. **Known tags** pulled via `Tag::*.take()` (`:50–59`):

| Tag | Field |
|-----|-------|
| ContentType | `content_type` |
| ContentEncoding | `content_encoding` |
| Delegate | `delegate` |
| Metadata | `metadata` |
| Metaprotocol | `metaprotocol` |
| Parent (array) | `parents` |
| Pointer | `pointer` |
| Properties / PropertyEncoding | `properties` |
| Rune | `rune` |

5. **Unrecognised even tag** → `unrecognized_even_field = true` (`:61`). Even tags are consensus-significant; unknown even tag can make an inscription **cursed/unbound** downstream.

The resulting `Inscription` carries these validity flags (`duplicate_field`, `incomplete_field`, `unrecognized_even_field`, `pushnum`, `stutter`) that the **inscription updater** uses to assign curse status. 🟡 Exact curse→charm mapping traced in Phase 2 pipeline + [charms.md](./charms.md).

---

## 4. Where detection output is stored (write side) 🟡

Detection feeds the indexer, which writes the tables the read side later queries:

| Written table | Holds |
|---------------|-------|
| `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` | id → sequence number |
| `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` | metadata entry (number, height, fee, **charms**, parents, …) |
| `SEQUENCE_NUMBER_TO_SATPOINT` | current location |
| `SAT_TO_SEQUENCE_NUMBER` (multimap) | sat → inscriptions (if `--index-sats`) |
| `OUTPOINT_TO_UTXO_ENTRY` | inscriptions **embedded** as `(sequence_number, offset)` alongside sat ranges |

🟡 The `updater` / `inscription_updater` write path (curse rules, first-reveal vs transfer, pointer application) is a **Phase 2 pipeline** topic; this doc covers detection/parsing only.

---

## 5. Read side — serving detected inscriptions ✅

| Method | index.rs | Path |
|--------|----------|------|
| `get_inscription_by_id` | `:1596` | id exists? → re-parse tx envelope via `ParsedEnvelope::from_transaction` (chain) |
| `get_inscription_entry` | `:2379` | `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` → `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` |
| `get_inscription_satpoint_by_id` | `:1574` | → `SEQUENCE_NUMBER_TO_SATPOINT` |
| `inscriptions_on_output` | `:2485` | reads embedded `(seq, offset)` from `UtxoEntry`, sorts by seq, joins entry |

✅ Note `get_inscription_by_id` **re-parses the raw transaction** (`ParsedEnvelope::from_transaction`, `:1604`) — content bytes are served from chain, not stored in redb (consistent with API spec: `/content` needs txindex). Only **metadata** lives in redb.

---

## 6. Sat Asset relevance 🔴

- Sat Asset v1 does **not** create inscriptions; it references sats. Detection matters only for **reading** whether a target sat/outpoint already carries an inscription (collision / provenance checks).
- The embedded `(seq, offset)` in `OUTPOINT_TO_UTXO_ENTRY` means `/output/{outpoint}` already returns inscriptions with **zero extra scans** — reuse this for "is this UTXO inscribed?" verification.
- 🔴 Do **not** reimplement envelope parsing in the protocol layer; delegate to ord (ADR-0002).

---

## 7. Follow-ups → Session 03 / Phase 2

1. 🟡 Trace curse rules: how `pushnum`/`stutter`/`unrecognized_even_field`/`duplicate_field` map to `Charm::Cursed`/`Unbound` in the updater.
2. 🟡 Pointer tag application (which output/offset an inscription lands on).
3. Delegate & parent resolution read paths.
