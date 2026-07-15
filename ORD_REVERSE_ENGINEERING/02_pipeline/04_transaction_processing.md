# 02.04 — Transaction processing

**Target:** ord 0.27.1 @ `1ad3f64`
**Scope:** sat-range FIFO assignment (`index_transaction_sats`) + inscription assignment (`inscription_updater.rs`)
**Focus files:** `src/index/updater.rs`, `src/index/updater/inscription_updater.rs`

> Tag legend: ✅ Verified (file:line) · 🟡 Inferred from code structure · 🔴 Design proposal

---

## Part A — Sat-range FIFO (`index_transaction_sats`)

✅ Verified `src/index/updater.rs:740-825`. This is the core sat-numbering engine: it distributes the tx's input sat ranges across its outputs in strict order.

### A.1 Input range iterator

✅ Verified `src/index/updater.rs:751-764` — inputs' sat ranges are flattened into a single iterator of 11-byte `SatRange` chunks, and a `sats` scratch buffer is preallocated to the combined input size:

```751:764:vendor/ord/src/index/updater.rs
    let mut pending_input_sat_range = None;
    let mut input_sat_ranges_iter = input_sat_ranges
      .iter()
      .flat_map(|slice| slice.chunks_exact(11));

    // Preallocate our temporary array, sized to hold the combined
    // sat ranges from our inputs.  We'll never need more than that
    // for a single output, even if we end up splitting some ranges.
    let mut sats = Vec::with_capacity(
      input_sat_ranges
        .iter()
        .map(|slice| slice.len())
        .sum::<usize>(),
    );
```

🟡 Inferred — a `SatRange` is encoded in 11 bytes (`chunks_exact(11)`); consistent with `SAT_TO_SATPOINT` value sizing noted in `01_tables.md`. Encoding internals are a Phase 3 item.

### A.2 Output fill loop (FIFO core)

✅ Verified `src/index/updater.rs:766-817`:

```766:817:vendor/ord/src/index/updater.rs
    for (vout, output) in tx.output.iter().enumerate() {
      let outpoint = OutPoint {
        vout: vout.try_into().unwrap(),
        txid,
      };

      let mut remaining = output.value.to_sat();
      while remaining > 0 {
        let range = pending_input_sat_range.take().unwrap_or_else(|| {
          SatRange::load(
            input_sat_ranges_iter
              .next()
              .expect("insufficient inputs for transaction outputs")
              .try_into()
              .unwrap(),
          )
        });

        if !Sat(range.0).common() {
          sat_to_satpoint.insert(
            &range.0,
            &SatPoint {
              outpoint,
              offset: output.value.to_sat() - remaining,
            }
            .store(),
          )?;
        }

        let count = range.1 - range.0;

        let assigned = if count > remaining {
          self.sat_ranges_since_flush += 1;
          let middle = range.0 + remaining;
          pending_input_sat_range = Some((middle, range.1));
          (range.0, middle)
        } else {
          range
        };

        sats.extend_from_slice(&assigned.store());

        remaining -= assigned.1 - assigned.0;

        *sat_ranges_written += 1;
      }

      *outputs_traversed += 1;

      output_utxo_entries[vout].push_sat_ranges(&sats, self.index);
      sats.clear();
    }
```

**FIFO invariants (✅ Verified):**
1. **Order preserved.** Outputs are filled `vout = 0, 1, …` and each pulls sat ranges from `input_sat_ranges_iter` in input order. First input sat → first output sat. `updater.rs:766`, `774-782`.
2. **Range splitting.** If a range is larger than the output's `remaining`, it is split at `middle = range.0 + remaining`; the head `(range.0, middle)` goes to the current output, the tail `(middle, range.1)` is stashed in `pending_input_sat_range` for the next output. `updater.rs:797-804`.
3. **Conservation.** `remaining` decrements by exactly the assigned width each step; the loop ends when the output is exactly filled. Sum of assigned ranges per output == output value. `updater.rs:808`.
4. **Rare-sat secondary index.** A `SAT_TO_SATPOINT` row is written **only** for the first sat of a range when it is *not* common (`!Sat(range.0).common()`), with offset = position within the output. `updater.rs:784-793`.
5. **`expect("insufficient inputs…")`** — if outputs demand more sats than inputs supply, ord panics. This encodes the assumption that total input sats ≥ total output sats (fees are the remainder). `updater.rs:778`.

### A.3 Leftover (fee) ranges

✅ Verified `src/index/updater.rs:819-822`:

```819:822:vendor/ord/src/index/updater.rs
    if let Some(range) = pending_input_sat_range {
      leftover_sat_ranges.extend(&range.store());
    }
    leftover_sat_ranges.extend(input_sat_ranges_iter.flatten());
```

**Invariant:** after outputs are filled, any partially-consumed range plus all fully-unconsumed input ranges are appended to `leftover_sat_ranges`. Per the caller (`updater.rs:608-634`, see `03_block_processing.md` §2.9):
- For **non-coinbase** txs, `leftover_sat_ranges = &mut coinbase_inputs` → fee sats flow to the coinbase tx (processed last).
- For the **coinbase** tx, `leftover_sat_ranges = &mut lost_sat_ranges` → anything the coinbase does not pay out becomes **lost sats** (→ `OutPoint::null()`, `03_block_processing.md` §2.11).

This is the mechanism that makes fee sats land in the miner's coinbase outputs, and truly-unclaimed sats become lost. ✅ Verified across `updater.rs:609-634` + `766-822`.

### A.4 Non-sat fallback

✅ Verified `src/index/updater.rs:635-641` — when `index_sats` is off, no FIFO runs; each output entry just records its value. Sat ranges are simply not tracked.

---

## Part B — Inscription assignment (`index_inscriptions`)

✅ Verified `src/index/updater/inscription_updater.rs:66-350`. Runs per tx (after sat ranges) when `index_inscriptions` and height ≥ `first_inscription_height` (`updater.rs:434-435`, `647-657`).

### B.1 Locate transferred + new inscriptions

✅ Verified `inscription_updater.rs:91-224` — walking inputs in order, accumulating `total_input_value`:

- **Transferred (Origin::Old):** existing inscriptions on each input UTXO entry are parsed and sorted by sequence number, then pushed as `Flotsam` at `offset = total_input_value + old_satpoint_offset`. `inscription_updater.rs:98-131`.
- **New (Origin::New):** envelopes parsed from the tx (`ParsedEnvelope::from_transaction`, `inscription_updater.rs:87`) are matched to their input; curse conditions are evaluated (`inscription_updater.rs:149-191`), and a pointer (if valid, `< total_output_value`) can relocate the offset. `inscription_updater.rs:193-223`.

**Invariant (transfer offset):** an inscription's flat offset within the tx is `sum(value of inputs before it) + its offset in its prevout` — a linear sat-space coordinate across all inputs. ✅ `inscription_updater.rs:117`, `133-136`.

### B.2 Curse / charm classification

✅ Verified `inscription_updater.rs:149-191` — curse reasons in priority order: `UnrecognizedEvenField`, `DuplicateField`, `IncompleteField`, `NotInFirstInput`, `NotAtOffsetZero`, `Pointer`, `Pushnum`, `Stutter`, `Reinscription`. `jubilant` (height ≥ jubilee) converts cursed→vindicated rather than negative-numbered. `inscription_updater.rs:79`, `203`, `212`.

🟡 Inferred — full charm semantics (Cursed/Reinscription/Lost/Unbound/Vindicated/Burned bit flags) at `inscription_updater.rs:451-479` are documented as behavior but the numeric charm bit layout is a Phase 3 item.

### B.3 Fee + parent normalization

✅ Verified `inscription_updater.rs:237-266` — purported parents are retained only if actually present among the tx's inscriptions (`inscription_updater.rs:242-255`); each new inscription's `fee` is set to `(total_input_value - total_output_value) / id_counter` (fee split across new inscriptions). `inscription_updater.rs:258-266`.

🟡 Inferred — this is **integer division** (`u64`), so when the total tx fee does not divide evenly by the number of new inscriptions (`id_counter`), the remainder is truncated: the per-inscription `fee` fields sum to *less than or equal to* the real tx fee, never more. The stored `fee` is therefore an attributed approximation, not an exact accounting split. Consequence: do **not** reconstruct a tx's total fee by summing its inscriptions' `fee` values — they can under-count by up to `id_counter − 1` sats. `inscription_updater.rs:264`.

### B.4 Coinbase flotsam + offset sort

✅ Verified `inscription_updater.rs:268-279` — for the coinbase tx, flotsam accumulated from earlier txs (`self.flotsam`) is appended, then all flotsam is sorted by offset:

```268:279:vendor/ord/src/index/updater/inscription_updater.rs
    let is_coinbase = tx
      .input
      .first()
      .map(|tx_in| tx_in.previous_output.is_null())
      .unwrap_or_default();

    if is_coinbase {
      floating_inscriptions.append(&mut self.flotsam);
    }

    floating_inscriptions.sort_by_key(|flotsam| flotsam.offset);
    let mut inscriptions = floating_inscriptions.into_iter().peekable();
```

**Invariant:** inscriptions ride the same FIFO sat-flow model as sats — sorted by flat offset and assigned to outputs by cumulative output value. This mirrors Part A's ordering. ✅ `inscription_updater.rs:278`, `282-307`.

### B.5 Assign to outputs / carry to fees / lose

✅ Verified `inscription_updater.rs:281-349`:
- Each flotsam whose `offset < end` (cumulative output value) is placed at a `new_satpoint` on that vout. `inscription_updater.rs:283-307`.
- Remaining flotsam after the last output:
  - **coinbase:** placed at `OutPoint::null()` with `Lost` semantics; `lost_sats` advances. `inscription_updater.rs:324-341`.
  - **non-coinbase:** re-offset by `reward` and pushed to `self.flotsam` to be claimed by the coinbase; `reward += total_input_value - output_value`. `inscription_updater.rs:342-348`.

**Invariant:** an inscription in a non-coinbase tx that lands "in the fee" is carried (via `self.flotsam` + `reward` offset) to the coinbase, exactly paralleling fee-sat flow (Part A.3). ✅ Verified.

### B.6 `update_inscription_location` — the write step

✅ Verified `inscription_updater.rs:372-610`. For each assigned inscription:

- **Origin::Old (transfer):** if the new location is an `OP_RETURN`, set `Charm::Burned` and rewrite the entry (`inscription_updater.rs:388-404`); emit `InscriptionTransferred` event (`inscription_updater.rs:406-414`).
- **Origin::New (reveal):** assign an inscription number (blessed = next non-negative; cursed = `-(n+1)`), a fresh `sequence_number` (monotonic), compute the bound `sat` via `calculate_sat` unless unbound, set charms, and write the full index set:
  - `INSCRIPTION_NUMBER_TO_SEQUENCE_NUMBER` (`inscription_updater.rs:441-443`)
  - `SAT_TO_SEQUENCE_NUMBER` if bound (`inscription_updater.rs:481-483`)
  - parent/child edges: `SEQUENCE_NUMBER_TO_CHILDREN`, `COLLECTION_SEQUENCE_NUMBER_TO_LATEST_CHILD_SEQUENCE_NUMBER`, `LATEST_CHILD_…` (`inscription_updater.rs:488-530`)
  - gallery: `GALLERY_SEQUENCE_NUMBERS` (`inscription_updater.rs:532-534`)
  - `SEQUENCE_NUMBER_TO_INSCRIPTION_ENTRY` (`inscription_updater.rs:547-562`)
  - `INSCRIPTION_ID_TO_SEQUENCE_NUMBER` (`inscription_updater.rs:564-566`)
  - `HOME_INSCRIPTIONS` (capped at 100, `pop_first`) (`inscription_updater.rs:568-578`)
  - emit `InscriptionCreated` event (`inscription_updater.rs:536-545`).

**Invariant (location record):** the inscription's *location* is not written to a table here — it is pushed onto the **output's `UtxoEntryBuf`** via `push_inscription(sequence_number, offset, index)` (`inscription_updater.rs:607`). The durable `SEQUENCE_NUMBER_TO_SATPOINT` row is derived from that UTXO entry later, at `commit()` (`05_commit.md`). ✅ Verified.

### B.7 Unbound + special outpoints

✅ Verified `inscription_updater.rs:584-605` — unbound inscriptions go to `unbound_outpoint()` at offset `unbound_inscriptions++`; special outpoints (`null` / unbound) create/merge a cache entry via `utxo_cache.entry(...).or_insert(UtxoEntryBuf::empty)`, because — like lost sats — they are written more than once and merged at commit. `is_special_outpoint` at `index.rs:495-497`.

✅ Verified — the two special outpoints are defined as: `unbound_outpoint()` = `OutPoint { txid: Hash::all_zeros(), vout: 0 }` (`src/lib.rs:181-186`), and `OutPoint::null()` = the all-zeros txid with `vout = u32::MAX` (bitcoin crate's coinbase-style null outpoint). They differ only in `vout`, which is why `is_special_outpoint` must test both explicitly (`index.rs:495-497`).

### B.8 `calculate_sat`

✅ Verified `inscription_updater.rs:352-370` — maps a flat `input_offset` back to an absolute sat number by walking the input sat ranges cumulatively; `unreachable!()` if the offset exceeds all inputs (only called for bound inscriptions where the offset is guaranteed in-range). 🟡 Inferred on the guarantee.

---

## Part C — Combined FIFO invariant table

| # | Invariant | Evidence |
|---|-----------|----------|
| 1 | Sats flow input→output in strict order | `updater.rs:766-782` ✅ |
| 2 | Oversized ranges split; tail carried in `pending_input_sat_range` | `updater.rs:797-804` ✅ |
| 3 | Per-output assigned width == output value | `updater.rs:772-808` ✅ |
| 4 | `SAT_TO_SATPOINT` written only for non-common range starts | `updater.rs:784-793` ✅ |
| 5 | Non-coinbase leftovers → `coinbase_inputs`; coinbase leftovers → `lost_sat_ranges` | `updater.rs:609-634`, `819-822` ✅ |
| 6 | Inscriptions ride the same offset FIFO (sorted by offset, assigned by cumulative output value) | `inscription_updater.rs:278-307` ✅ |
| 7 | Fee-riding inscriptions carried to coinbase via `self.flotsam` + `reward` | `inscription_updater.rs:342-348` ✅ |
| 8 | Coinbase-unclaimed inscriptions → `OutPoint::null()` (Lost) | `inscription_updater.rs:324-341` ✅ |
| 9 | Sequence numbers monotonic, never reused | `updater.rs:500-505`, `inscription_updater.rs:438-439` ✅ |
| 10 | Inscription location staged on output `UtxoEntryBuf`, not written directly | `inscription_updater.rs:607` ✅ |

---

## Cross-references

- Prev: [`03_block_processing.md`](03_block_processing.md) — how this is invoked per tx.
- Next: [`05_commit.md`](05_commit.md) — how staged UTXO entries + inscription locations become durable rows.
- Table roles: [`../01_database/01_tables.md`](../01_database/01_tables.md).

## Open follow-ups

- 🟡 `SatRange` 11-byte encoding + `Sat::common()` / rarity math → Phase 3 (`03_algorithms/`).
- 🟡 Charm bit layout and `ParsedEnvelope` parser → Phase 3.
- 🔴 Sat Asset Protocol: this FIFO model is exactly the sat-provenance mechanism to *query* (not reimplement) for listing eligibility (ADR-0002/0007).
