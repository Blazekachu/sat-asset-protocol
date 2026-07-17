// Sat-for-sat offer/accept + negotiation service (ADR-0014/0016/0017/0018).
//
// The original single-shot flow (createOffer/acceptOffer) is preserved: it
// validates a caller-supplied offer PSBT against the canonical sat-for-sat
// construction, cross-checks the two traded assets are at offset 0 on their ord
// outputs, persists the offer, and later validates the fully-signed accept PSBT
// before marking the offer accepted.
//
// WS-A adds the two-phase negotiation model on top: an open, unsigned *intent*
// advertisement (postIntent), a taker naming concrete assets + build data
// (respondToIntent → first concrete round), the maker building and signing the
// round PSBT (buildConcreteOffer → submitConcreteOfferPsbt), counter-offers
// (counterOffer), and explicit settlement (settleOffer, RD2). Every round
// carries a per-round `nonce`; each state transition is a compare-and-swap that
// guards on nonce AND the exact expected source status, so a stale/superseded
// round can never be re-actioned. The protocol never holds keys — signatures
// are produced by the parties out of band.

import {
  assertOffsetZero,
  ensureInteger,
  ensureRequiredString,
  fetchIndexedUnspentOutput,
  ListingValidationError,
  type ListingOrdClient,
} from "./listing-service.ts";
import type {
  BidFillRecord,
  BuildBidFillRequest,
  BuildConcreteOfferRequest,
  CounterOfferRequest,
  CreateOfferRequest,
  IntentQuery,
  ListingStore,
  OfferAssetRef,
  OfferQuery,
  OfferRecord,
  PostBidRequest,
  PostIntentRequest,
  RespondToIntentRequest,
  SideBuildData,
  SubmitBidFillRequest,
  SubmitOfferPsbtRequest,
  WantSpec,
} from "./listing-types.ts";
import {
  assetRefSpan,
  assetSatisfiesPredicate,
  bidFillMatchesWant,
  normalizeAssetRef,
  normalizeWantSpec,
  assetsSatisfyWant,
} from "./offer-predicates.ts";
import { buildBuyerFillTemplatePsbt, validateBidFillPsbt } from "./psbt.ts";
import type { DustPolicy, TemplateInput } from "./psbt.ts";
import type { OrdSat, OrdStatus } from "./types.ts";
import {
  buildSatForSatBundlePsbt,
  validateSatForSatBundleAcceptPsbt,
  validateSatForSatBundleOfferPsbt,
  type SatForSatAssetLeg,
} from "./sat-for-sat-bundle.ts";
import {
  buildSatForSatOfferPsbt,
  validateSatForSatAcceptPsbt,
  validateSatForSatOfferPsbt,
  type SatForSatAssetSide,
} from "./sat-for-sat.ts";

/**
 * Raised when an offer lookup fails. The server maps this to HTTP 404 (distinct
 * from ListingValidationError which maps to 400).
 */
export class OfferNotFoundError extends Error {}

export interface OfferServiceDependencies {
  store: ListingStore;
  ordClient: ListingOrdClient;
  now?: () => Date;
  createOfferId?: () => string;
  createNonce?: () => string;
  dustPolicy?: DustPolicy;
}

// The bid discovery path needs sat/status resolution beyond ListingOrdClient's
// output(). The concrete OrdClient (and the test stubs) supply these; we narrow
// to them only inside findCandidateHolders.
interface SatCapableOrdClient {
  sat(number: number | bigint): Promise<OrdSat>;
  status(): Promise<OrdStatus>;
}

export interface CandidateHolder {
  sat_number: number;
  satpoint: string;
  address: string;
}

export class OfferService {
  readonly #store: ListingStore;
  readonly #ordClient: ListingOrdClient;
  readonly #now: () => Date;
  readonly #createOfferId: () => string;
  readonly #createNonce: () => string;
  readonly #dustPolicy: DustPolicy | undefined;

  constructor(dependencies: OfferServiceDependencies) {
    this.#store = dependencies.store;
    this.#ordClient = dependencies.ordClient;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createOfferId = dependencies.createOfferId ?? (() => crypto.randomUUID());
    this.#createNonce = dependencies.createNonce ?? (() => crypto.randomUUID());
    this.#dustPolicy = dependencies.dustPolicy;
  }

  // --- Legacy single-shot flow (unchanged behaviour) ----------------------

  async createOffer(input: CreateOfferRequest): Promise<OfferRecord> {
    const offererSatNumber = ensureInteger(input.offerer_sat_number, "offerer_sat_number");
    const offererAssetOutpoint = ensureRequiredString(
      input.offerer_asset_outpoint,
      "offerer_asset_outpoint",
    );
    const takerSatNumber = ensureInteger(input.taker_sat_number, "taker_sat_number");
    const takerAssetOutpoint = ensureRequiredString(
      input.taker_asset_outpoint,
      "taker_asset_outpoint",
    );
    const offerPsbt = ensureRequiredString(input.offer_psbt, "offer_psbt");
    const expiresAt = input.expires_at ?? null;

    // The validator derives all canonical invariants (5 inputs/outputs, FIFO
    // offset-0 value rules, per-input sighash/partial-sig, dust) from the PSBT
    // itself. We only pass what cannot be read from the PSBT.
    validateSatForSatOfferPsbt(offerPsbt, {
      offererAssetOutpoint,
      takerAssetOutpoint,
      offererSignedInputs: input.offerer_signed_inputs,
    });

    // Cross-check both traded sats sit at offset 0 of their ord outputs
    // (indexed + unspent). Reuses the shared listing-service helper.
    await assertOffsetZero(this.#ordClient, offererAssetOutpoint, offererSatNumber);
    await assertOffsetZero(this.#ordClient, takerAssetOutpoint, takerSatNumber);

    const offerId = this.#createOfferId();
    const record: OfferRecord = {
      offer_id: offerId,
      offerer_sat_number: offererSatNumber,
      offerer_asset_outpoint: offererAssetOutpoint,
      taker_sat_number: takerSatNumber,
      taker_asset_outpoint: takerAssetOutpoint,
      offer_psbt: offerPsbt,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: expiresAt,
      // Legacy rows are concrete, single-round, and carry nonce = offer_id.
      offer_kind: "concrete",
      negotiation_id: offerId,
      parent_offer_id: null,
      counter_index: 0,
      supersedes: null,
      nonce: offerId,
      give_assets: null,
      want_spec: null,
      taker_assets: null,
      taker_build: null,
      settlement_txid: null,
      bid_target_quantity: null,
      bid_total_btc_sats: null,
      bid_remaining_quantity: null,
    };

    this.#store.insertOffer(record);
    return record;
  }

  /**
   * Accept a concrete round. Backward-compatible: `nonce` is optional and
   * defaults to the record's own nonce, so the legacy single-shot path is
   * unchanged. Requires kind='concrete', a persisted offer_psbt, not expired,
   * and status 'open'; validates the accept PSBT then CASes open → accepted.
   */
  async acceptOffer(
    offerId: string,
    acceptPsbt: string,
    nonce?: string,
  ): Promise<OfferRecord> {
    const offer = this.#loadWithLazyExpiry(offerId);

    if (offer.offer_kind !== "concrete") {
      throw new ListingValidationError(
        `offer is not a concrete round (kind=${offer.offer_kind})`,
      );
    }
    if (offer.status !== "open") {
      throw new ListingValidationError(`offer is not open (status=${offer.status})`);
    }
    if (offer.offer_psbt === null) {
      throw new ListingValidationError("offer round has no signed offer PSBT yet");
    }

    const psbt = ensureRequiredString(acceptPsbt, "accept_psbt");
    if (this.#isBundleRound(offer)) {
      validateSatForSatBundleAcceptPsbt(psbt, offer.offer_psbt);
    } else {
      validateSatForSatAcceptPsbt(psbt, offer.offer_psbt);
    }

    const guardNonce = nonce ?? offer.nonce;
    const updated = this.#store.updateOfferAccept(offerId, psbt, guardNonce);
    if (!updated) {
      throw new ListingValidationError(
        "offer could not be accepted (stale nonce, wrong status, or unsigned round)",
      );
    }

    return updated;
  }

  getOffer(offerId: string): OfferRecord | null {
    const offer = this.#store.getOffer(offerId);
    if (!offer) {
      return null;
    }
    return this.#lazyExpire(offer);
  }

  listOffers(query: OfferQuery = {}): OfferRecord[] {
    return this.#store.listOffers(query);
  }

  // --- Negotiation model (WS-A) -------------------------------------------

  /** Post an open, unsigned intent advertisement (ADR-0016). */
  async postIntent(input: PostIntentRequest): Promise<OfferRecord> {
    if (!Array.isArray(input.give_assets) || input.give_assets.length === 0) {
      throw new ListingValidationError("give_assets must be a non-empty array");
    }
    const giveAssets = input.give_assets.map((ref, index) =>
      normalizeAssetRef(ref, `give_assets[${index}]`),
    );
    const wantSpec = normalizeWantSpec(input.want_spec);

    // Each give asset must currently sit at offset 0 on an indexed/unspent
    // output (and, for ranges, occupy the whole UTXO span).
    for (const asset of giveAssets) {
      await this.#resolveAssetInput(asset);
    }

    const offerId = this.#createOfferId();
    const record: OfferRecord = {
      offer_id: offerId,
      offerer_sat_number: giveAssets[0].sat_number ?? giveAssets[0].sat_range_start ?? 0,
      offerer_asset_outpoint: ensureRequiredString(
        giveAssets[0].asset_outpoint,
        "give_assets[0].asset_outpoint",
      ),
      taker_sat_number: null,
      taker_asset_outpoint: null,
      offer_psbt: null,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: input.expires_at ?? null,
      offer_kind: "intent",
      negotiation_id: offerId,
      parent_offer_id: null,
      counter_index: 0,
      supersedes: null,
      nonce: this.#createNonce(),
      give_assets: giveAssets,
      want_spec: wantSpec,
      taker_assets: null,
      taker_build: null,
      settlement_txid: null,
      bid_target_quantity: null,
      bid_total_btc_sats: null,
      bid_remaining_quantity: null,
    };

    this.#store.insertOffer(record);
    return record;
  }

  /**
   * Respond to an intent by naming concrete taker assets + build data. Produces
   * the first concrete round (counter_index=1) and CASes the intent open →
   * countered atomically (so the thread can never have a superseded parent with
   * no active child). Returns the new round (with its nonce).
   */
  async respondToIntent(
    offerId: string,
    input: RespondToIntentRequest,
  ): Promise<OfferRecord> {
    const intent = this.#loadWithLazyExpiry(offerId);
    if (intent.offer_kind !== "intent") {
      throw new ListingValidationError("offer is not an intent");
    }
    if (intent.status !== "open") {
      throw new ListingValidationError(`intent is not open (status=${intent.status})`);
    }
    if (!intent.want_spec) {
      throw new ListingValidationError("intent has no want_spec");
    }

    if (!Array.isArray(input.taker_assets) || input.taker_assets.length === 0) {
      throw new ListingValidationError("taker_assets must be a non-empty array");
    }
    const takerAssets = input.taker_assets.map((ref, index) =>
      normalizeAssetRef(ref, `taker_assets[${index}]`),
    );
    const takerBuild = this.#normalizeSideBuild(input.taker_build, "taker_build");

    // Authoritative want check (exact multiset / count+unique).
    assetsSatisfyWant(intent.want_spec, takerAssets);

    // Each taker asset must currently sit at offset 0 (range: whole span).
    for (const asset of takerAssets) {
      await this.#resolveAssetInput(asset);
    }

    const childId = this.#createOfferId();
    const childRow: OfferRecord = {
      offer_id: childId,
      offerer_sat_number: intent.offerer_sat_number,
      offerer_asset_outpoint: intent.offerer_asset_outpoint,
      taker_sat_number: takerAssets[0].sat_number ?? takerAssets[0].sat_range_start ?? null,
      taker_asset_outpoint: takerAssets[0].asset_outpoint,
      offer_psbt: null,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: input.expires_at ?? intent.expires_at,
      offer_kind: "concrete",
      negotiation_id: intent.negotiation_id,
      parent_offer_id: intent.offer_id,
      counter_index: intent.counter_index + 1,
      supersedes: intent.offer_id,
      nonce: this.#createNonce(),
      give_assets: intent.give_assets,
      want_spec: intent.want_spec,
      taker_assets: takerAssets,
      taker_build: takerBuild,
      settlement_txid: null,
      bid_target_quantity: null,
      bid_total_btc_sats: null,
      bid_remaining_quantity: null,
    };

    return this.#store.supersedeWithCounter(intent.offer_id, intent.nonce, childRow);
  }

  /**
   * Build the unsigned PSBT for a concrete round from ord-resolved asset/bump/
   * fee inputs + both parties' SideBuildData. Persists no signature; the
   * offerer signs off-VM then calls submitConcreteOfferPsbt.
   */
  async buildConcreteOffer(
    offerId: string,
    input: BuildConcreteOfferRequest,
  ): Promise<{ psbt_base64: string; input_outpoints: string[]; output_values: number[] }> {
    const round = this.#loadWithLazyExpiry(offerId);
    if (round.offer_kind !== "concrete") {
      throw new ListingValidationError("offer is not a concrete round");
    }
    if (round.status !== "open") {
      throw new ListingValidationError(`round is not open (status=${round.status})`);
    }

    const giveAssets = round.give_assets ?? [];
    const takerAssets = round.taker_assets ?? [];
    if (giveAssets.length === 0 || takerAssets.length === 0) {
      throw new ListingValidationError("round is missing give/taker assets");
    }

    const offererBuild = this.#normalizeSideBuild(input.offerer_build, "offerer_build");
    const takerBuild = round.taker_build;
    if (!takerBuild) {
      throw new ListingValidationError("round has no persisted taker build data");
    }

    if (offererBuild.bump_outpoints.length !== giveAssets.length) {
      throw new ListingValidationError(
        "offerer_build.bump_outpoints length must equal give_assets length (#bumps === #assets)",
      );
    }
    if (takerBuild.bump_outpoints.length !== takerAssets.length) {
      throw new ListingValidationError(
        "taker_build.bump_outpoints length must equal taker_assets length (#bumps === #assets)",
      );
    }

    const feePayerChangeScriptPubkeyHex = ensureRequiredString(
      input.fee_payer_change_script_pubkey_hex,
      "fee_payer_change_script_pubkey_hex",
    );
    const feePayerChangeValueSats = ensureInteger(
      input.fee_payer_change_value_sats,
      "fee_payer_change_value_sats",
    );
    const feeFundingInput = await this.#resolveTemplateInput(input.fee_funding_outpoint);

    // Resolve every asset + bump input from ord.
    const offererAssetInputs = await Promise.all(
      giveAssets.map((asset) => this.#resolveAssetInput(asset)),
    );
    const takerAssetInputs = await Promise.all(
      takerAssets.map((asset) => this.#resolveAssetInput(asset)),
    );
    const offererBumpInputs = await Promise.all(
      offererBuild.bump_outpoints.map((outpoint) => this.#resolveTemplateInput(outpoint)),
    );
    const takerBumpInputs = await Promise.all(
      takerBuild.bump_outpoints.map((outpoint) => this.#resolveTemplateInput(outpoint)),
    );

    const dustPolicy = this.#buildDustPolicy(input.max_fee_rate_sat_per_vb);

    if (giveAssets.length === 1 && takerAssets.length === 1) {
      const partyA: SatForSatAssetSide = {
        bumpInput: offererBumpInputs[0],
        assetInput: offererAssetInputs[0],
        changeScriptPubkeyHex: offererBuild.change_script_pubkey_hex,
        counterpartyOrdinalsScriptPubkeyHex: takerBuild.ordinals_script_pubkey_hex,
      };
      const partyB: SatForSatAssetSide = {
        bumpInput: takerBumpInputs[0],
        assetInput: takerAssetInputs[0],
        changeScriptPubkeyHex: takerBuild.change_script_pubkey_hex,
        counterpartyOrdinalsScriptPubkeyHex: offererBuild.ordinals_script_pubkey_hex,
      };
      const result = buildSatForSatOfferPsbt({
        partyA,
        partyB,
        feeFundingInput,
        feePayerChangeScriptPubkeyHex: feePayerChangeScriptPubkeyHex,
        feePayerChangeValueSats,
        dustPolicy,
      });
      return {
        psbt_base64: result.psbtBase64,
        input_outpoints: result.inputOutpoints,
        output_values: result.outputValues,
      };
    }

    // Bundle path (RD4).
    const offererLegs: SatForSatAssetLeg[] = giveAssets.map((_asset, index) => ({
      bumpInput: offererBumpInputs[index],
      assetInput: offererAssetInputs[index],
      changeScriptPubkeyHex: offererBuild.change_script_pubkey_hex,
      counterpartyOrdinalsScriptPubkeyHex: takerBuild.ordinals_script_pubkey_hex,
    }));
    const takerLegs: SatForSatAssetLeg[] = takerAssets.map((_asset, index) => ({
      bumpInput: takerBumpInputs[index],
      assetInput: takerAssetInputs[index],
      changeScriptPubkeyHex: takerBuild.change_script_pubkey_hex,
      counterpartyOrdinalsScriptPubkeyHex: offererBuild.ordinals_script_pubkey_hex,
    }));
    const result = buildSatForSatBundlePsbt({
      offerer: { legs: offererLegs },
      taker: { legs: takerLegs },
      feeFundingInput,
      feePayerChangeScriptPubkeyHex,
      feePayerChangeValueSats,
      dustPolicy,
    });
    return {
      psbt_base64: result.psbtBase64,
      input_outpoints: result.inputOutpoints,
      output_values: result.outputValues,
    };
  }

  /** Persist an offerer-signed round PSBT (open + still-unsigned round only). */
  async submitConcreteOfferPsbt(
    offerId: string,
    input: SubmitOfferPsbtRequest,
  ): Promise<OfferRecord> {
    const round = this.#loadWithLazyExpiry(offerId);
    if (round.offer_kind !== "concrete") {
      throw new ListingValidationError("offer is not a concrete round");
    }
    if (round.status !== "open") {
      throw new ListingValidationError(`round is not open (status=${round.status})`);
    }
    if (round.offer_psbt !== null) {
      throw new ListingValidationError("round already has a signed offer PSBT");
    }

    const nonce = ensureRequiredString(input.nonce, "nonce");
    if (nonce !== round.nonce) {
      throw new ListingValidationError("nonce does not match the round");
    }

    const offerPsbt = ensureRequiredString(input.offer_psbt, "offer_psbt");
    this.#validateOfferPsbtAgainstRound(round, offerPsbt, input.offerer_signed_inputs);

    const updated = this.#store.updateOfferPsbt(offerId, offerPsbt, nonce);
    if (!updated) {
      throw new ListingValidationError(
        "offer PSBT could not be persisted (stale nonce, wrong status, or already signed)",
      );
    }
    return updated;
  }

  /**
   * Counter a round: re-validate the supplied offer PSBT, then atomically insert
   * a new signed child round and CAS the parent open → countered.
   */
  async counterOffer(offerId: string, input: CounterOfferRequest): Promise<OfferRecord> {
    const parent = this.#loadWithLazyExpiry(offerId);
    if (parent.offer_kind !== "concrete") {
      throw new ListingValidationError("offer is not a concrete round");
    }
    if (parent.status !== "open") {
      throw new ListingValidationError(`round is not open (status=${parent.status})`);
    }

    const nonce = ensureRequiredString(input.nonce, "nonce");
    if (nonce !== parent.nonce) {
      throw new ListingValidationError("nonce does not match the round");
    }

    // Re-negotiated legs override the parent's; otherwise inherit.
    const giveAssets = input.give_assets
      ? input.give_assets.map((ref, index) => normalizeAssetRef(ref, `give_assets[${index}]`))
      : parent.give_assets;
    const takerAssets = input.taker_assets
      ? input.taker_assets.map((ref, index) => normalizeAssetRef(ref, `taker_assets[${index}]`))
      : parent.taker_assets;
    const wantSpec: WantSpec | null = input.want_spec
      ? normalizeWantSpec(input.want_spec)
      : parent.want_spec;

    if (!giveAssets || giveAssets.length === 0 || !takerAssets || takerAssets.length === 0) {
      throw new ListingValidationError("counter round is missing give/taker assets");
    }

    const offerPsbt = ensureRequiredString(input.offer_psbt, "offer_psbt");
    const childRoundShape: OfferRecord = {
      ...parent,
      give_assets: giveAssets,
      taker_assets: takerAssets,
    };
    this.#validateOfferPsbtAgainstRound(childRoundShape, offerPsbt, input.offerer_signed_inputs);

    // Offset-0/range-span re-check for all assets in the countered round.
    for (const asset of [...giveAssets, ...takerAssets]) {
      await this.#resolveAssetInput(asset);
    }

    const childId = this.#createOfferId();
    const childRow: OfferRecord = {
      offer_id: childId,
      offerer_sat_number: giveAssets[0].sat_number ?? giveAssets[0].sat_range_start ?? parent.offerer_sat_number,
      offerer_asset_outpoint:
        giveAssets[0].asset_outpoint ?? parent.offerer_asset_outpoint,
      taker_sat_number: takerAssets[0].sat_number ?? takerAssets[0].sat_range_start ?? null,
      taker_asset_outpoint: takerAssets[0].asset_outpoint,
      offer_psbt: offerPsbt,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: input.expires_at ?? parent.expires_at,
      offer_kind: "concrete",
      negotiation_id: parent.negotiation_id,
      parent_offer_id: parent.offer_id,
      counter_index: parent.counter_index + 1,
      supersedes: parent.offer_id,
      nonce: this.#createNonce(),
      give_assets: giveAssets,
      want_spec: wantSpec,
      taker_assets: takerAssets,
      taker_build: parent.taker_build,
      settlement_txid: null,
      bid_target_quantity: null,
      bid_total_btc_sats: null,
      bid_remaining_quantity: null,
    };

    return this.#store.supersedeWithCounter(parent.offer_id, parent.nonce, childRow);
  }

  /** Report on-chain settlement of an accepted round (RD2). */
  settleOffer(offerId: string, txid: string, nonce: string): OfferRecord {
    const offer = this.#store.getOffer(offerId);
    if (!offer) {
      throw new OfferNotFoundError("offer not found");
    }
    const settlementTxid = ensureRequiredString(txid, "txid");
    const guardNonce = ensureRequiredString(nonce, "nonce");
    const updated = this.#store.settleAcceptedOffer(offerId, settlementTxid, guardNonce);
    if (!updated) {
      throw new ListingValidationError(
        "offer could not be settled (must be an accepted round with a matching nonce)",
      );
    }
    return updated;
  }

  /** Cancel an open round. */
  cancelOffer(offerId: string, nonce: string): OfferRecord {
    const offer = this.#store.getOffer(offerId);
    if (!offer) {
      throw new OfferNotFoundError("offer not found");
    }
    const guardNonce = ensureRequiredString(nonce, "nonce");
    const updated = this.#store.cancelOpenOffer(offerId, guardNonce);
    if (!updated) {
      throw new ListingValidationError(
        "offer could not be cancelled (must be an open round with a matching nonce)",
      );
    }
    return updated;
  }

  /** Explicitly expire an open, past-expiry round. */
  expireOffer(offerId: string): OfferRecord | null {
    return this.#store.expireOffer(offerId, this.#now().toISOString());
  }

  listIntents(query: IntentQuery = {}): OfferRecord[] {
    return this.#store.listIntents(query).map((offer) => this.#lazyExpire(offer));
  }

  getNegotiationThread(negotiationId: string): OfferRecord[] {
    return this.#store
      .listNegotiationThread(negotiationId)
      .map((offer) => this.#lazyExpire(offer));
  }

  // --- Partially-fillable BTC buy bids (WS-D, ADR-0019) -------------------

  /**
   * Post an open, discoverable BTC buy bid. `unit_price = floor(T / N)` (>= 1);
   * flooring favors the bidder (residual up to N-1 sats intentionally unspent).
   */
  async postBid(input: PostBidRequest): Promise<OfferRecord> {
    const wantSpec = normalizeWantSpec(input.want_spec);
    const targetQuantity = ensureInteger(input.bid_target_quantity, "bid_target_quantity");
    const totalBtcSats = ensureInteger(input.bid_total_btc_sats, "bid_total_btc_sats");
    if (targetQuantity < 1) {
      throw new ListingValidationError("bid_target_quantity must be >= 1");
    }
    if (totalBtcSats < targetQuantity) {
      throw new ListingValidationError(
        "bid_total_btc_sats must be >= bid_target_quantity (unit price >= 1 sat/sat)",
      );
    }

    const bidId = this.#createOfferId();
    const record: OfferRecord = {
      offer_id: bidId,
      offerer_sat_number: 0,
      offerer_asset_outpoint: bidId, // bids have no offerer asset; use a stable non-empty token
      taker_sat_number: null,
      taker_asset_outpoint: null,
      offer_psbt: null,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: input.expires_at ?? null,
      offer_kind: "bid",
      negotiation_id: bidId,
      parent_offer_id: null,
      counter_index: 0,
      supersedes: null,
      nonce: this.#createNonce(),
      give_assets: null,
      want_spec: wantSpec,
      taker_assets: null,
      taker_build: null,
      settlement_txid: null,
      bid_target_quantity: targetQuantity,
      bid_total_btc_sats: totalBtcSats,
      bid_remaining_quantity: targetQuantity,
    };
    this.#store.insertOffer(record);
    return record;
  }

  listBids(query: { status?: OfferRecord["status"] } = {}): OfferRecord[] {
    return this.#store
      .listOffers({ offer_kind: "bid", status: query.status })
      .map((bid) => this.#lazyExpire(bid));
  }

  getBid(bidId: string): OfferRecord | null {
    const bid = this.#store.getOffer(bidId);
    if (!bid || bid.offer_kind !== "bid") {
      return null;
    }
    return this.#lazyExpire(bid);
  }

  /**
   * Discovery (advisory, live-ord). Resolves candidate sats to their current
   * holding UTXO/address via ord's `GET /sat/{n}`. For a specific-range bid the
   * candidates come from the wanted ranges; for a predicate bid the caller
   * supplies `candidateSats` (predicate-checked). Skips entries whose satpoint/
   * address is null; throws if the ord node is missing --index-sats/-addresses.
   */
  async findCandidateHolders(
    bidId: string,
    candidateSats: number[] = [],
  ): Promise<CandidateHolder[]> {
    const bid = this.#loadBid(bidId);
    const spec = bid.want_spec;
    if (!spec) {
      throw new ListingValidationError("bid has no want_spec");
    }

    const ord = this.#ordClient as unknown as SatCapableOrdClient;
    if (typeof ord.status !== "function" || typeof ord.sat !== "function") {
      throw new ListingValidationError("ord client is not sat-capable (discovery is live-ord)");
    }
    const status = await ord.status();
    if (!status.sat_index || !status.address_index) {
      throw new ListingValidationError(
        "ord node must run with --index-sats and --index-addresses for bid discovery",
      );
    }

    // Determine candidate sat numbers.
    let candidates: number[];
    if (spec.mode === "specific") {
      candidates = [];
      for (const ref of spec.assets) {
        const span = assetRefSpan(ref);
        for (let n = span.start; n < span.end; n += 1) {
          candidates.push(n);
        }
      }
    } else {
      candidates = candidateSats.filter((n) =>
        assetSatisfiesPredicate(spec.predicate, {
          asset_type: "sat",
          asset_outpoint: null,
          sat_number: n,
        }),
      );
    }

    const holders: CandidateHolder[] = [];
    for (const satNumber of candidates) {
      const sat = await ord.sat(satNumber);
      if (sat.satpoint === null || sat.address === null) {
        continue;
      }
      holders.push({ sat_number: satNumber, satpoint: sat.satpoint, address: sat.address });
    }
    return holders;
  }

  /**
   * Build the unsigned per-fill PSBT for a single seller UTXO. Validates the
   * seller asset against the bid's want (bid-specific containment matcher),
   * derives the LOGICAL fill quantity k from the delivered asset, reads the
   * seller UTXO's on-chain postage value separately, and persists a
   * pending_build ledger row. Returns the unsigned PSBT + its fill_id.
   */
  async buildBidFill(
    bidId: string,
    input: BuildBidFillRequest,
  ): Promise<{ psbt_base64: string; fill_id: string; input_outpoints: string[]; output_values: number[] }> {
    const bid = this.#loadBid(bidId);
    if (bid.status !== "open") {
      throw new ListingValidationError(`bid is not open (status=${bid.status})`);
    }
    const spec = bid.want_spec;
    if (!spec) {
      throw new ListingValidationError("bid has no want_spec");
    }
    const remaining = bid.bid_remaining_quantity ?? 0;
    const targetQuantity = bid.bid_target_quantity ?? 0;
    const totalBtcSats = bid.bid_total_btc_sats ?? 0;
    const unitPrice = Math.floor(totalBtcSats / targetQuantity);

    const sellerAsset = normalizeAssetRef(input.fill_asset, "fill_asset");
    const sellerOutpoint = ensureRequiredString(input.seller_outpoint, "seller_outpoint");
    const buyerAssetScriptPubkeyHex = ensureRequiredString(
      input.buyer_asset_script_pubkey_hex,
      "buyer_asset_script_pubkey_hex",
    );
    const sellerBuild = this.#normalizeSideBuild(input.seller_build, "seller_build");

    // Overlap re-check against active (reserved/settled) ledger rows.
    const alreadyFilled = this.#store
      .listBidFills(bidId)
      .filter((fill) => fill.state === "reserved" || fill.state === "settled")
      .map((fill) => this.#bidFillAssetRef(fill));
    bidFillMatchesWant(spec, sellerAsset, alreadyFilled);

    // Logical fill quantity k derived from the DELIVERED asset (not want_spec).
    const k = sellerAsset.asset_type === "range" ? (sellerAsset.sat_range_size ?? 1) : 1;
    if (k > remaining) {
      throw new ListingValidationError(
        `fill quantity ${k} exceeds remaining bid quantity ${remaining}`,
      );
    }

    // Seller UTXO on-chain VALUE (postage), independent of k.
    const sellerOrdOutput = await fetchIndexedUnspentOutput(this.#ordClient, sellerOutpoint);
    const sellerUtxoValueSats = sellerOrdOutput.value;
    const listingPriceSats = k * unitPrice;

    // Resolve the two bidder bumps + fee funding.
    if (sellerBuild.bump_outpoints.length !== 2) {
      throw new ListingValidationError(
        "seller_build.bump_outpoints must contain exactly 2 bidder bump outpoints",
      );
    }
    const bumpInputs = await Promise.all(
      sellerBuild.bump_outpoints.map((outpoint) => this.#resolveTemplateInput(outpoint)),
    );
    const feeFundingInput = await this.#resolveTemplateInput(input.fee_funding_outpoint);
    const feePayerChangeScriptPubkeyHex = ensureRequiredString(
      input.fee_payer_change_script_pubkey_hex,
      "fee_payer_change_script_pubkey_hex",
    );
    const feePayerChangeValueSats = ensureInteger(
      input.fee_payer_change_value_sats,
      "fee_payer_change_value_sats",
    );
    const dustPolicy = this.#buildDustPolicy(input.max_fee_rate_sat_per_vb);

    // Reuse the canonical 2-bump fill builder with role mapping:
    // filler = "seller" (input 2 = their sat UTXO), bidder = "buyer".
    const template = buildBuyerFillTemplatePsbt(
      {
        sellerOutpoint,
        sellerInputValueSats: sellerUtxoValueSats,
        sellerInputScriptPubkeyHex: sellerOrdOutput.script_pubkey,
        listingPriceSats,
        bumpInputs,
        fundingInputs: [feeFundingInput],
        buyerBumpScriptPubkeyHex: sellerBuild.change_script_pubkey_hex,
        buyerAssetScriptPubkeyHex,
        buyerChangeScriptPubkeyHex: feePayerChangeScriptPubkeyHex,
        buyerChangeValueSats: feePayerChangeValueSats,
      },
      dustPolicy ?? {},
    );

    const fillId = this.#createOfferId();
    const fillOfferId = this.#createOfferId();
    const fillRecord: BidFillRecord = {
      fill_id: fillId,
      bid_id: bidId,
      fill_offer_id: fillOfferId,
      filled_sat_number: sellerAsset.asset_type === "sat" ? (sellerAsset.sat_number ?? null) : null,
      filled_range_start:
        sellerAsset.asset_type === "range" ? (sellerAsset.sat_range_start ?? null) : null,
      filled_range_size:
        sellerAsset.asset_type === "range" ? (sellerAsset.sat_range_size ?? null) : null,
      filled_quantity: k,
      seller_outpoint: sellerOutpoint,
      seller_utxo_value_sats: sellerUtxoValueSats,
      buyer_asset_script_pubkey_hex: buyerAssetScriptPubkeyHex,
      price_sats: listingPriceSats,
      state: "pending_build",
      created_at: this.#now().toISOString(),
    };
    this.#store.insertPendingBidFill(fillRecord);

    return {
      psbt_base64: template.psbtBase64,
      fill_id: fillId,
      input_outpoints: template.inputOutpoints,
      output_values: template.outputValues,
    };
  }

  /**
   * Submit a co-signed fill PSBT. Re-reads the pending_build ledger row by
   * fill_id, validates the PSBT against server-persisted values, then atomically
   * records the reserved fill (debiting the remainder by the logical quantity
   * and rotating the nonce). Returns the updated bid.
   */
  async submitBidFill(bidId: string, input: SubmitBidFillRequest): Promise<OfferRecord> {
    const bid = this.#loadBid(bidId);
    if (bid.status !== "open") {
      throw new ListingValidationError(`bid is not open (status=${bid.status})`);
    }
    const nonce = ensureRequiredString(input.nonce, "nonce");
    if (nonce !== bid.nonce) {
      throw new ListingValidationError("nonce does not match the bid");
    }
    const fillId = ensureRequiredString(input.fill_id, "fill_id");
    const fillPsbt = ensureRequiredString(input.fill_psbt, "fill_psbt");

    const pending = this.#store.getBidFill(fillId);
    if (!pending || pending.bid_id !== bidId) {
      throw new ListingValidationError("fill not found for this bid");
    }
    if (pending.state !== "pending_build") {
      throw new ListingValidationError(`fill is not pending build (state=${pending.state})`);
    }

    // Validate the co-signed PSBT against SERVER-persisted values.
    validateBidFillPsbt(
      fillPsbt,
      ensureRequiredString(pending.seller_outpoint, "seller_outpoint"),
      pending.price_sats ?? 0,
      ensureRequiredString(pending.buyer_asset_script_pubkey_hex, "buyer_asset_script_pubkey_hex"),
      pending.seller_utxo_value_sats ?? 0,
      this.#dustPolicy,
    );

    const filledAssetRef = this.#bidFillAssetRef(pending);
    const nextNonce = this.#createNonce();
    const fillRow: OfferRecord = {
      offer_id: pending.fill_offer_id,
      offerer_sat_number: 0,
      offerer_asset_outpoint: pending.seller_outpoint ?? pending.fill_offer_id,
      taker_sat_number: null,
      taker_asset_outpoint: null,
      offer_psbt: fillPsbt,
      accept_psbt: null,
      status: "accepted",
      created_at: this.#now().toISOString(),
      expires_at: null,
      offer_kind: "concrete",
      negotiation_id: bid.negotiation_id,
      parent_offer_id: bidId,
      counter_index: 0,
      supersedes: null,
      nonce: pending.fill_offer_id,
      give_assets: null,
      want_spec: null,
      taker_assets: [filledAssetRef],
      taker_build: null,
      settlement_txid: null,
      bid_target_quantity: null,
      bid_total_btc_sats: null,
      bid_remaining_quantity: null,
    };

    try {
      return this.#store.recordBidFill(
        bidId,
        fillId,
        nonce,
        fillRow,
        pending.filled_quantity,
        filledAssetRef,
      );
    } catch (error) {
      throw new ListingValidationError(
        error instanceof Error ? error.message : "bid fill could not be recorded",
      );
    }
  }

  /** Report on-chain settlement of a reserved fill (RD2). */
  settleBidFill(bidId: string, fillId: string, txid: string, nonce: string): OfferRecord {
    this.#loadBid(bidId);
    const settlementTxid = ensureRequiredString(txid, "txid");
    const guardNonce = ensureRequiredString(nonce, "nonce");
    try {
      return this.#store.settleBidFill(bidId, fillId, settlementTxid, guardNonce);
    } catch (error) {
      throw new ListingValidationError(
        error instanceof Error ? error.message : "bid fill could not be settled",
      );
    }
  }

  /** Release a reserved fill (recovery): credit the remainder, cancel the child. */
  releaseBidFill(bidId: string, fillId: string, nonce: string): OfferRecord {
    this.#loadBid(bidId);
    const guardNonce = ensureRequiredString(nonce, "nonce");
    try {
      return this.#store.releaseBidFill(bidId, fillId, guardNonce);
    } catch (error) {
      throw new ListingValidationError(
        error instanceof Error ? error.message : "bid fill could not be released",
      );
    }
  }

  /** Cancel an open bid (CAS open -> cancelled). */
  cancelBid(bidId: string, nonce: string): OfferRecord {
    this.#loadBid(bidId);
    const guardNonce = ensureRequiredString(nonce, "nonce");
    const updated = this.#store.cancelOpenOffer(bidId, guardNonce);
    if (!updated) {
      throw new ListingValidationError(
        "bid could not be cancelled (must be an open bid with a matching nonce)",
      );
    }
    return updated;
  }

  // --- Private helpers ----------------------------------------------------

  #loadWithLazyExpiry(offerId: string): OfferRecord {
    const offer = this.#store.getOffer(offerId);
    if (!offer) {
      throw new OfferNotFoundError("offer not found");
    }
    return this.#lazyExpire(offer);
  }

  // Load a bid (kind='bid') with lazy expiry, or throw OfferNotFoundError.
  #loadBid(bidId: string): OfferRecord {
    const bid = this.#store.getOffer(bidId);
    if (!bid || bid.offer_kind !== "bid") {
      throw new OfferNotFoundError("bid not found");
    }
    return this.#lazyExpire(bid);
  }

  // Turn a persisted bid_fills row's delivered-asset columns into an
  // OfferAssetRef for overlap checks.
  #bidFillAssetRef(fill: BidFillRecord): OfferAssetRef {
    if (fill.filled_range_start !== null && fill.filled_range_size !== null) {
      return {
        asset_type: "range",
        asset_outpoint: fill.seller_outpoint,
        sat_number: fill.filled_range_start,
        sat_range_start: fill.filled_range_start,
        sat_range_size: fill.filled_range_size,
      };
    }
    return {
      asset_type: "sat",
      asset_outpoint: fill.seller_outpoint,
      sat_number: fill.filled_sat_number ?? 0,
    };
  }

  // Report (and persist opportunistically) an open, past-expiry round as
  // expired. ISO-8601 timestamps sort lexicographically = chronologically.
  #lazyExpire(offer: OfferRecord): OfferRecord {
    if (offer.status !== "open" || offer.expires_at === null) {
      return offer;
    }
    const nowIso = this.#now().toISOString();
    if (offer.expires_at < nowIso) {
      const expired = this.#store.expireOffer(offer.offer_id, nowIso);
      return expired ?? { ...offer, status: "expired" };
    }
    return offer;
  }

  #isBundleRound(offer: OfferRecord): boolean {
    return (offer.give_assets?.length ?? 1) > 1 || (offer.taker_assets?.length ?? 1) > 1;
  }

  // Validate a round's offer PSBT with the appropriate validator and confirm
  // its asset inputs match the round's give/taker assets.
  #validateOfferPsbtAgainstRound(
    round: OfferRecord,
    offerPsbt: string,
    offererSignedInputs: number[] | undefined,
  ): void {
    const giveAssets = round.give_assets ?? [];
    const takerAssets = round.taker_assets ?? [];

    if (this.#isBundleRound(round)) {
      const offererIsFeePayer = (offererSignedInputs ?? []).includes(
        2 * (giveAssets.length + takerAssets.length),
      );
      validateSatForSatBundleOfferPsbt(offerPsbt, {
        offererAssetOutpoints: giveAssets.map((asset) =>
          ensureRequiredString(asset.asset_outpoint, "give_assets[].asset_outpoint"),
        ),
        takerAssetOutpoints: takerAssets.map((asset) =>
          ensureRequiredString(asset.asset_outpoint, "taker_assets[].asset_outpoint"),
        ),
        offererIsFeePayer,
      });
      return;
    }

    // Single-asset round (m=n=1). Fall back to the round's primary outpoints
    // when give/taker asset arrays are absent (legacy shape).
    const offererAssetOutpoint = ensureRequiredString(
      giveAssets[0]?.asset_outpoint ?? round.offerer_asset_outpoint,
      "offerer_asset_outpoint",
    );
    const takerAssetOutpoint = ensureRequiredString(
      takerAssets[0]?.asset_outpoint ?? round.taker_asset_outpoint,
      "taker_asset_outpoint",
    );
    validateSatForSatOfferPsbt(offerPsbt, {
      offererAssetOutpoint,
      takerAssetOutpoint,
      offererSignedInputs,
    });
  }

  #normalizeSideBuild(input: unknown, field: string): SideBuildData {
    if (!input || typeof input !== "object") {
      throw new ListingValidationError(`${field} must be an object`);
    }
    const raw = input as Record<string, unknown>;
    if (!Array.isArray(raw.bump_outpoints) || raw.bump_outpoints.length === 0) {
      throw new ListingValidationError(`${field}.bump_outpoints must be a non-empty array`);
    }
    const bumpOutpoints = raw.bump_outpoints.map((entry, index) =>
      ensureRequiredString(entry, `${field}.bump_outpoints[${index}]`),
    );
    const changeScriptPubkeyHex = ensureRequiredString(
      raw.change_script_pubkey_hex,
      `${field}.change_script_pubkey_hex`,
    );
    const ordinalsScriptPubkeyHex = ensureRequiredString(
      raw.ordinals_script_pubkey_hex,
      `${field}.ordinals_script_pubkey_hex`,
    );
    return {
      bump_outpoints: bumpOutpoints,
      change_script_pubkey_hex: changeScriptPubkeyHex,
      ordinals_script_pubkey_hex: ordinalsScriptPubkeyHex,
    };
  }

  #buildDustPolicy(maxFeeRateSatPerVb: number | undefined): DustPolicy | undefined {
    if (this.#dustPolicy === undefined && maxFeeRateSatPerVb === undefined) {
      return undefined;
    }
    return {
      ...this.#dustPolicy,
      ...(maxFeeRateSatPerVb === undefined ? {} : { maxFeeRateSatPerVb }),
    };
  }

  // Resolve a TRADED sat/range asset to a TemplateInput: indexed + unspent,
  // offset-0 for the asset's sat, and (for ranges) a single contiguous span
  // equal to sat_range_start/sat_range_size (whole-UTXO span, ADR-0007).
  async #resolveAssetInput(assetRef: OfferAssetRef): Promise<TemplateInput> {
    const outpoint = ensureRequiredString(assetRef.asset_outpoint, "asset_outpoint");

    if (assetRef.asset_type === "range") {
      const rangeStart = ensureInteger(assetRef.sat_range_start, "sat_range_start");
      const rangeSize = ensureInteger(assetRef.sat_range_size, "sat_range_size");
      const ordOutput = await assertOffsetZero(this.#ordClient, outpoint, rangeStart);
      const satRanges = ordOutput.sat_ranges ?? [];
      if (satRanges.length !== 1) {
        throw new ListingValidationError(
          "range asset requires the outpoint to hold exactly one contiguous sat range; " +
            "isolate the range into its own UTXO first",
        );
      }
      const [start, end] = satRanges[0] as [number, number];
      if (start !== rangeStart || rangeSize !== end - start) {
        throw new ListingValidationError(
          "range asset must equal the whole UTXO's sat span (a sub-range is not allowed)",
        );
      }
      return {
        outpoint,
        valueSats: ordOutput.value,
        scriptPubkeyHex: ordOutput.script_pubkey,
      };
    }

    const satNumber = ensureInteger(assetRef.sat_number, "sat_number");
    const ordOutput = await assertOffsetZero(this.#ordClient, outpoint, satNumber);
    return {
      outpoint,
      valueSats: ordOutput.value,
      scriptPubkeyHex: ordOutput.script_pubkey,
    };
  }

  // Resolve a plain funding UTXO (bump or fee-funding) to a TemplateInput. No
  // sat/range/offset semantics — just indexed/unspent value + script.
  async #resolveTemplateInput(outpoint: string): Promise<TemplateInput> {
    const op = ensureRequiredString(outpoint, "outpoint");
    const ordOutput = await fetchIndexedUnspentOutput(this.#ordClient, op);
    return {
      outpoint: op,
      valueSats: ordOutput.value,
      scriptPubkeyHex: ordOutput.script_pubkey,
    };
  }
}
