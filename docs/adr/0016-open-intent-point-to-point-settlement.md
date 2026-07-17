# ADR-0016: Open Intent Advertisement + Point-to-Point Settlement

**Status:** Accepted  
**Date:** 2026-07-17  
**Deciders:** v3 complete offer matrix (Workstream A/C)  
**Research:** [v3-complete-offer-matrix plan](../../.plans/v3-complete-offer-matrix.md) (Task 8, "Two denominations" section) · [OFFER_MATRIX.md](../v2/OFFER_MATRIX.md) · [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) · [ADR-0010](./0010-sat-for-sat-deferred-v2.md)

---

## Context

[ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) established that sat-for-sat
barter must use `SIGHASH_ALL` on every input from both parties, which makes it inherently
**point-to-point**: both parties' concrete UTXOs must be known and both must sign the same
finalized transaction. It also stated (Key structural implication) that a sat-for-sat offer is
therefore **not** an open, anyone-can-fill orderbook listing — a third party adding an input
would invalidate every existing signature.

That constraint left a gap the "complete offer matrix" must close: **how does a maker who wants
a specific sat (or range) make that want publicly discoverable at all**, if a specific-sat trade
can never be posted as a fillable listing? A believer who owns sat X and wants sat Y needs to
advertise the want; but they cannot know Y's owner, that owner's bump/fee UTXOs, or their
destination scripts at post time — and all of those must be fixed before a `SIGHASH_ALL` PSBT can
be built and signed.

The forces:

- **Discoverability** — wants must be postable and queryable, for single sats and whole ranges.
- **Atomicity** — actual settlement must remain the ADR-0014 `SIGHASH_ALL` point-to-point swap;
  we are not weakening the signing regime.
- **No custody / no consensus change** — same non-goals as ADR-0005/0010/0014.

## Decision

**Adopt a two-phase model that separates advertisement from settlement:**

1. **Open INTENT phase.** A maker posts an unsigned, discoverable **intent**: a `give_assets`
   list (specific sats/ranges they own, offset-0) and a `want_spec` describing what they will
   accept. The intent carries **no PSBT and no counterparty data**; it is purely an advertisement
   that lives in the offer store and is queryable (`listIntents`).
2. **Point-to-point concrete SETTLEMENT round.** When a counterparty responds, they supply their
   concrete `taker_assets` **and** their own side build data (bump outpoints, change script,
   ordinals-destination script). Only then does the maker have everything needed to build the
   ADR-0014 mirrored 2-bump `SIGHASH_ALL` PSBT, sign it, and hand it to the taker to co-sign and
   broadcast. This concrete round is the point-to-point settlement exactly as ADR-0014 requires.

The intent's `want_spec` supports **predicate-consideration** scope (per plan RD1): a want may be
either an enumerated set of specific sats/ranges, or `{ predicate P, count N }` — "any N sats
satisfying predicate P" (rarity, range, name-prefix, epoch, block-range). Predicate wants apply to
individual **sats only**; a range's per-sat predicate membership is not evaluated.

## Rationale

- **Reconciles, not weakens, ADR-0014.** The intent is unsigned advertising metadata; it never
  claims to be fillable. Every signature still commits to the whole finalized transaction, so
  atomicity and non-custody are preserved verbatim — settlement is still point-to-point.
- **A specific-sat want cannot be a listing PSBT.** Unlike a fungible-BTC listing (ADR-0005), a
  sat-for-sat want has no open payment-amount output to leave signable; both sides' exact UTXOs
  must be fixed at signing. Splitting posting (open) from settlement (point-to-point) is the only
  construction that makes the want public without pretending it can be pre-signed.
- **Symmetry with ranges.** Because a range is treated as a single contiguous whole-UTXO asset
  (see [ADR-0018](./0018-bundle-and-range-barter.md)), an intent advertises single sats and ranges
  through the identical `OfferAssetRef` shape; no separate discovery surface is needed.
- **Discovery is matchmaking, orthogonal to settlement.** Finding candidate counterparties never
  changes the signing regime — it only suggests who to open a concrete round with.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Signed-PSBT orderbook for sat-for-sat (post a pre-signed offer anyone can fill) | Invalid: a `SIGHASH_ALL` tx commits to every input, but the counterparty's foreign bump/asset/fee inputs are **unknown at post time**, so the offer PSBT cannot be pre-signed — any later-added input voids the maker's signature (ADR-0014, Key structural implication). |
| `SIGHASH_SINGLE \| ANYONECANPAY` for the wanted sat | Commits to an **amount**, not a specific **sat identity** — it cannot express "I accept THAT sat" (see [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md), [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md), [ord#2706](https://github.com/ordinals/ord/issues/2706)). |
| Two sequential sat-for-BTC trades to simulate a barter | Non-atomic; counterparty/market risk between the two legs — already rejected in [ADR-0010](./0010-sat-for-sat-deferred-v2.md)/[ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md). |

## Consequences

### Positive
- Specific-sat and range wants become **publicly discoverable** without weakening ADR-0014.
- Settlement remains the proven atomic, non-custodial, standard-PSBT `SIGHASH_ALL` swap.
- Predicate wants let a maker advertise "any N sats matching P" without enumerating owners.

### Negative
- A response requires the taker to supply concrete assets **and** their build data up front
  (a want cannot be filled by name alone), adding a negotiation round trip.
- Intents can go stale: the advertised sat may be spent before a concrete round is built
  (surfaced at build/validate time, not prevented — same invalidation class as ADR-0014).

### Neutral
- Does not change v1 sat-for-BTC listings (ADR-0005) or the BTC-denominated fill path.
- The concrete settlement round is the substrate that [ADR-0017](./0017-counter-offers-negotiation-thread.md)
  (counter-offers) extends into a multi-round thread.

## Compliance

- `OfferService#postIntent` / `respondToIntent` / `buildConcreteOffer` enforce the phase split;
  intents persist with `offer_kind='intent'`, `offer_psbt=null`, and no taker data.
- Concrete rounds validate via the ADR-0014 `SIGHASH_ALL` validators before acceptance.
- Tests in `tests/negotiation-model.test.ts` / `tests/negotiation-api.test.ts` assert intents
  are unsigned/discoverable and that concrete rounds require both parties' data and `SIGHASH_ALL`.

## References

- [ADR-0014](./0014-sat-for-sat-offer-accept-sighash-all.md) · [ADR-0005](./0005-v1-psbt-sat-for-btc-only.md) · [ADR-0010](./0010-sat-for-sat-deferred-v2.md)
- [ADR-0017](./0017-counter-offers-negotiation-thread.md) · [ADR-0018](./0018-bundle-and-range-barter.md)
- [OFFER_MATRIX.md — "Two denominations: sat-for-BTC vs sat-for-sat"](../v2/OFFER_MATRIX.md)
- [ord#2706 — offer PSBT design](https://github.com/ordinals/ord/issues/2706)
