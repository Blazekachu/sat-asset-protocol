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

// --- Sat-for-sat offers (v2, ADR-0014) ------------------------------------

export type OfferStatus = "open" | "accepted" | "cancelled";

/**
 * A persisted sat-for-sat offer. The offerer proposes trading their sat
 * (`offerer_sat_number` at `offerer_asset_outpoint`) for the taker's sat
 * (`taker_sat_number` at `taker_asset_outpoint`). `offer_psbt` is the
 * offerer-signed offer PSBT; `accept_psbt` is populated once the taker fully
 * signs and the offer transitions to "accepted".
 */
export interface OfferRecord {
  offer_id: string;
  offerer_sat_number: number;
  offerer_asset_outpoint: string;
  taker_sat_number: number;
  taker_asset_outpoint: string;
  offer_psbt: string;
  accept_psbt: string | null;
  status: OfferStatus;
  created_at: string;
  expires_at: string | null;
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

/**
 * Filter contract for {@link ListingStore.listOffers}. All fields are optional;
 * a query with no fields returns all offers. Provided fields are applied as
 * exact-match filters.
 */
export interface OfferQuery {
  taker_sat_number?: number;
  offerer_sat_number?: number;
  status?: OfferStatus;
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
  updateOfferAccept(offerId: string, acceptPsbt: string): OfferRecord | null;
  listOffers(query?: OfferQuery): OfferRecord[];
}
