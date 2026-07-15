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
}

export interface ListingQuery {
  sat_number?: number;
  outpoint?: string;
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

export interface ListingStore {
  insertListing(listing: ListingRecord): void;
  getListing(listingId: string): ListingRecord | null;
  listOpenListings(query?: ListingQuery): ListingRecord[];
  insertCollection(collection: CollectionRecord): void;
  getCollection(collectionId: string): CollectionRecord | null;
  insertAttestation(attestation: AttestationRecord): void;
  listAttestationsBySat(subjectSat: number): AttestationRecord[];
}
