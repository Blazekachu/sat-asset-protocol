export type ListingAssetType = "sat" | "range" | "utxo";
export type CollectionPredicateType =
  | "sat_number"
  | "sat_range"
  | "block_range"
  | "epoch"
  | "rarity"
  | "name_prefix"
  | "mining_pool"
  | "historical_event"
  | "institution_certified"
  | "user_defined";

export interface CreateListingRequest {
  asset_type: ListingAssetType;
  sat_number?: number;
  outpoint?: string;
  price_sats?: number;
  seller_address?: string;
  signed_psbt?: string;
  expires_at?: string | null;
  // Range listings (asset_type="range") declare the sat range being sold. The
  // range must be pre-isolated into its own UTXO (see ListingService).
  sat_range_start?: number;
  sat_range_size?: number;
}

export interface ListingRecord {
  listing_id: string;
  asset_type: ListingAssetType;
  sat_number: number | null;
  outpoint: string | null;
  price_sats: number;
  seller_address: string;
  signed_psbt: string;
  created_at: string;
  expires_at: string | null;
  cancelled: boolean;
  // Populated for asset_type="range"; null for "sat"/"utxo".
  sat_range_start: number | null;
  sat_range_size: number | null;
}

/**
 * Filter contract for {@link ListingStore.listOpenListings}. All fields are
 * optional; a query with no fields returns all open (non-cancelled) listings.
 * When a field is provided it is applied as an exact-match filter:
 * - `sat_number` / `outpoint`: match the listing's sat/outpoint.
 * - `asset_type`: restrict to one asset kind ("sat" | "range" | "utxo").
 * - `sat_range_start` / `sat_range_size`: match range listings by their
 *   persisted range fields (useful for discovering a specific isolated range).
 */
export interface ListingQuery {
  sat_number?: number;
  outpoint?: string;
  asset_type?: ListingAssetType;
  sat_range_start?: number;
  sat_range_size?: number;
}

export interface CollectionRecord {
  collection_id: string;
  name: string;
  predicate_type: CollectionPredicateType;
  predicate_params: Record<string, unknown>;
}

export interface AttestationRecord {
  attestation_id: string;
  subject_sat: number;
  claim: string;
  issuer_pubkey: string;
  signature: string;
  expires_at: string | null;
  created_at: string;
}

// --- Sat-for-sat offers + negotiation (v2, ADR-0014/0016/0017/0018/0019) ---

// The kind of a persisted offer row. "intent" is an open, unsigned public
// advertisement (ADR-0016); "concrete" is a specific-asset settlement round
// (single-shot or a negotiation round); "bid" is a partially-fillable BTC buy
// bid (ADR-0019, WS-D).
export type OfferKind = "intent" | "concrete" | "bid";

// "countered"/"expired"/"settled" added for the negotiation model (ADR-0017,
// RD2); "filled" added by WS-D (ADR-0019) when a bid remainder hits 0.
export type OfferStatus =
  | "open"
  | "countered"
  | "accepted"
  | "cancelled"
  | "expired"
  | "settled"
  | "filled";

/**
 * An asset reference that can be a single sat OR a contiguous ordinal range.
 * For ranges the WHOLE UTXO span must be the range (offset-0, exact span) —
 * the same precondition {@link ListingService.createRangeListing} enforces
 * (ADR-0007).
 */
export interface OfferAssetRef {
  asset_type: "sat" | "range";
  asset_outpoint: string | null; // null allowed only on a predicate want side
  sat_number?: number; // required for asset_type="sat" (and a known range's start sat)
  sat_range_start?: number; // required for asset_type="range"
  sat_range_size?: number; // required for asset_type="range" (whole-UTXO span)
}

/** A predicate the taker's sat must satisfy (RD1, math-verifiable only). */
export interface WantPredicate {
  type: CollectionPredicateType;
  params: Record<string, unknown>;
}

/**
 * The "want" side of an intent (or a bid): either an enumerated set of specific
 * assets the maker will accept, or a predicate the taker's sat must satisfy
 * with a required cardinality (so bundle wants are expressible).
 */
export type WantSpec =
  | { mode: "specific"; assets: OfferAssetRef[] } // exact sats/ranges wanted (>=1)
  | { mode: "predicate"; predicate: WantPredicate; count: number }; // any `count` sats matching P

/**
 * Per-side signing/routing data the builder needs but ord cannot supply. One
 * bump outpoint per asset leg on that side (so #bumps === #assets), a change
 * script that receives each bump's passthrough, and the ordinals destination
 * script where this side RECEIVES the counterparty's asset(s).
 */
export interface SideBuildData {
  bump_outpoints: string[]; // length === that side's give/take asset count
  change_script_pubkey_hex: string; // receives bump passthrough for this side
  ordinals_script_pubkey_hex: string; // where this side receives counterparty asset(s)
}

/**
 * A persisted sat-for-sat offer/round. Legacy single-shot offers and the new
 * negotiation rounds share this shape. `offerer_sat_number`/`offerer_asset_outpoint`
 * name the offerer's primary asset; `give_assets`/`taker_assets` carry the full
 * (possibly multi-asset) leg sets. `offer_psbt` is the offerer-signed round
 * PSBT (null until the offerer signs); `accept_psbt` is populated once the taker
 * fully signs and the round transitions to "accepted".
 *
 * Negotiation fields (ADR-0016/0017): `offer_kind`, `negotiation_id` (shared by
 * every round of a thread), `parent_offer_id`/`supersedes`/`counter_index`
 * (thread linkage/ordering), `nonce` (per-round compare-and-swap token). `bid_*`
 * fields are populated only for `offer_kind="bid"` (ADR-0019, WS-D).
 */
export interface OfferRecord {
  offer_id: string;
  offerer_sat_number: number;
  offerer_asset_outpoint: string;
  taker_sat_number: number | null;
  taker_asset_outpoint: string | null;
  offer_psbt: string | null;
  accept_psbt: string | null;
  status: OfferStatus;
  created_at: string;
  expires_at: string | null;
  // Negotiation model (ADR-0016/0017).
  offer_kind: OfferKind;
  negotiation_id: string;
  parent_offer_id: string | null;
  counter_index: number;
  supersedes: string | null;
  nonce: string;
  give_assets: OfferAssetRef[] | null;
  want_spec: WantSpec | null; // the intent/bid want; a bid's want lives here too
  taker_assets: OfferAssetRef[] | null;
  taker_build: SideBuildData | null;
  settlement_txid: string | null; // RD2, set on explicit settle
  // Partially-fillable BTC buy bids (ADR-0019, WS-D). Null on non-bid rows.
  bid_target_quantity: number | null;
  bid_total_btc_sats: number | null;
  bid_remaining_quantity: number | null;
}

export interface CreateOfferRequest {
  offerer_sat_number: number;
  offerer_asset_outpoint: string;
  taker_sat_number: number;
  taker_asset_outpoint: string;
  offer_psbt: string;
  offerer_signed_inputs?: number[];
  expires_at?: string | null;
}

// --- Negotiation request contracts (WS-A) ---------------------------------

export interface PostIntentRequest {
  give_assets: OfferAssetRef[];
  want_spec: WantSpec;
  expires_at?: string | null;
}

/**
 * The taker names concrete assets AND supplies their own bump/destination data
 * up-front, because a SIGHASH_ALL tx must include BOTH parties' bump UTXOs and
 * output scripts before the offerer can sign.
 */
export interface RespondToIntentRequest {
  taker_assets: OfferAssetRef[];
  taker_build: SideBuildData;
  expires_at?: string | null;
}

/**
 * The maker (offerer) supplies their own side data + the fee-funding leg; the
 * builder then has everything (give/taker asset inputs from ord + both parties'
 * SideBuildData + fee inputs) to assemble the unsigned round PSBT.
 */
export interface BuildConcreteOfferRequest {
  offerer_build: SideBuildData;
  fee_funding_outpoint: string;
  fee_payer_change_script_pubkey_hex: string;
  fee_payer_change_value_sats: number;
  max_fee_rate_sat_per_vb?: number; // RD6, opt-in
}

/** Persist an offerer-signed round PSBT (open + still-unsigned round only). */
export interface SubmitOfferPsbtRequest {
  offer_psbt: string;
  offerer_signed_inputs?: number[];
  nonce: string;
}

/**
 * A counter-offer supersedes the round being countered with a new signed round.
 * Mirrors {@link SubmitOfferPsbtRequest} plus optionally re-negotiated legs.
 */
export interface CounterOfferRequest {
  offer_psbt: string;
  offerer_signed_inputs?: number[];
  nonce: string;
  give_assets?: OfferAssetRef[];
  taker_assets?: OfferAssetRef[];
  want_spec?: WantSpec;
  expires_at?: string | null;
}

// --- Bid request contracts (WS-D — type surface only; logic is WS-D) -------

export interface PostBidRequest {
  want_spec: WantSpec;
  bid_target_quantity: number; // N sats wanted
  bid_total_btc_sats: number; // total T BTC (sats) the buyer will pay
  expires_at?: string | null;
}

export interface BuildBidFillRequest {
  fill_asset: OfferAssetRef;
  seller_outpoint: string;
  seller_build: SideBuildData;
  buyer_asset_script_pubkey_hex: string;
  fee_funding_outpoint: string;
  fee_payer_change_script_pubkey_hex: string;
  fee_payer_change_value_sats: number;
  max_fee_rate_sat_per_vb?: number;
}

// References the server-persisted pending-build row rather than trusting a
// caller-supplied quantity/asset (WS-D).
export interface SubmitBidFillRequest {
  fill_id: string;
  fill_psbt: string;
  nonce: string;
}

/**
 * Filter contract for {@link ListingStore.listOffers}. All fields are optional;
 * a query with no fields returns all offers. Provided fields are applied as
 * exact-match filters.
 */
export interface OfferQuery {
  taker_sat_number?: number;
  offerer_sat_number?: number;
  status?: OfferStatus;
  offer_kind?: OfferKind;
  negotiation_id?: string;
}

/**
 * Filter contract for {@link ListingStore.listIntents}. `status` defaults to
 * "open"; `candidate_sat_number` post-filters intents whose want_spec would
 * accept that sat (predicate/specific-sat match).
 */
export interface IntentQuery {
  status?: OfferStatus;
  candidate_sat_number?: number;
}

export interface ListingStore {
  insertListing(listing: ListingRecord): void;
  getListing(listingId: string): ListingRecord | null;
  listOpenListings(query?: ListingQuery): ListingRecord[];
  insertCollection(collection: CollectionRecord): void;
  getCollection(collectionId: string): CollectionRecord | null;
  insertAttestation(attestation: AttestationRecord): void;
  listAttestationsBySat(subjectSat: number): AttestationRecord[];
  insertOffer(record: OfferRecord): void;
  getOffer(offerId: string): OfferRecord | null;
  getOfferByNonce(nonce: string): OfferRecord | null;
  listOffers(query?: OfferQuery): OfferRecord[];
  listIntents(query?: IntentQuery): OfferRecord[];
  listNegotiationThread(negotiationId: string): OfferRecord[];
  // Atomically insert a child round and CAS the parent open -> countered.
  supersedeWithCounter(
    parentId: string,
    parentNonce: string,
    childRow: OfferRecord,
  ): OfferRecord;
  // Transition-specific compare-and-swap methods; each guards on nonce AND the
  // exact expected source status and returns the updated row (or null on miss).
  updateOfferPsbt(offerId: string, offerPsbt: string, nonce: string): OfferRecord | null;
  updateOfferAccept(offerId: string, acceptPsbt: string, nonce: string): OfferRecord | null;
  settleAcceptedOffer(offerId: string, txid: string, nonce: string): OfferRecord | null;
  cancelOpenOffer(offerId: string, nonce: string): OfferRecord | null;
  expireOffer(offerId: string, nowIso: string): OfferRecord | null;
}
