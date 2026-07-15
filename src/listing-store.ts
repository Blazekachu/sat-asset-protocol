import { DatabaseSync } from "node:sqlite";

import type {
  AttestationRecord,
  CollectionRecord,
  ListingQuery,
  ListingRecord,
  ListingStore,
} from "./listing-types.ts";

function mapListingRow(row: Record<string, unknown>): ListingRecord {
  return {
    listing_id: String(row.listing_id),
    asset_type: String(row.asset_type) as ListingRecord["asset_type"],
    sat_number: row.sat_number === null ? null : Number(row.sat_number),
    outpoint: row.outpoint === null ? null : String(row.outpoint),
    price_sats: Number(row.price_sats),
    seller_address: String(row.seller_address),
    signed_psbt: String(row.signed_psbt),
    created_at: String(row.created_at),
    expires_at: row.expires_at === null ? null : String(row.expires_at),
    cancelled: Number(row.cancelled) === 1,
  };
}

export class SqliteListingStore implements ListingStore {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        listing_id TEXT PRIMARY KEY,
        asset_type TEXT NOT NULL,
        sat_number INTEGER,
        outpoint TEXT,
        price_sats INTEGER NOT NULL,
        seller_address TEXT NOT NULL,
        signed_psbt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        cancelled INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS listings_open_sat_number_idx
        ON listings (sat_number, cancelled);
      CREATE INDEX IF NOT EXISTS listings_open_outpoint_idx
        ON listings (outpoint, cancelled);
      CREATE TABLE IF NOT EXISTS collections (
        collection_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        predicate_type TEXT NOT NULL,
        predicate_params TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attestations (
        attestation_id TEXT PRIMARY KEY,
        subject_sat INTEGER NOT NULL,
        claim TEXT NOT NULL,
        issuer_pubkey TEXT NOT NULL,
        signature TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attestations_subject_sat_idx
        ON attestations (subject_sat, created_at DESC);
    `);
  }

  insertListing(listing: ListingRecord): void {
    this.#database
      .prepare(`
        INSERT INTO listings (
          listing_id,
          asset_type,
          sat_number,
          outpoint,
          price_sats,
          seller_address,
          signed_psbt,
          created_at,
          expires_at,
          cancelled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        listing.listing_id,
        listing.asset_type,
        listing.sat_number,
        listing.outpoint,
        listing.price_sats,
        listing.seller_address,
        listing.signed_psbt,
        listing.created_at,
        listing.expires_at,
        listing.cancelled ? 1 : 0,
      );
  }

  getListing(listingId: string): ListingRecord | null {
    const row = this.#database
      .prepare(`
        SELECT
          listing_id,
          asset_type,
          sat_number,
          outpoint,
          price_sats,
          seller_address,
          signed_psbt,
          created_at,
          expires_at,
          cancelled
        FROM listings
        WHERE listing_id = ?
        LIMIT 1
      `)
      .get(listingId) as Record<string, unknown> | undefined;

    return row ? mapListingRow(row) : null;
  }

  listOpenListings(query: ListingQuery = {}): ListingRecord[] {
    const conditions = ["cancelled = 0"];
    const values: Array<number | string> = [];

    if (query.sat_number !== undefined) {
      conditions.push("sat_number = ?");
      values.push(query.sat_number);
    }

    if (query.outpoint !== undefined) {
      conditions.push("outpoint = ?");
      values.push(query.outpoint);
    }

    const statement = this.#database.prepare(`
      SELECT
        listing_id,
        asset_type,
        sat_number,
        outpoint,
        price_sats,
        seller_address,
        signed_psbt,
        created_at,
        expires_at,
        cancelled
      FROM listings
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, listing_id DESC
    `);

    return statement.all(...values).map((row) => mapListingRow(row as Record<string, unknown>));
  }

  insertCollection(collection: CollectionRecord): void {
    this.#database
      .prepare(`
        INSERT INTO collections (
          collection_id,
          name,
          predicate_type,
          predicate_params
        ) VALUES (?, ?, ?, ?)
      `)
      .run(
        collection.collection_id,
        collection.name,
        collection.predicate_type,
        JSON.stringify(collection.predicate_params),
      );
  }

  getCollection(collectionId: string): CollectionRecord | null {
    const row = this.#database
      .prepare(`
        SELECT collection_id, name, predicate_type, predicate_params
        FROM collections
        WHERE collection_id = ?
        LIMIT 1
      `)
      .get(collectionId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      collection_id: String(row.collection_id),
      name: String(row.name),
      predicate_type: String(row.predicate_type) as CollectionRecord["predicate_type"],
      predicate_params: JSON.parse(String(row.predicate_params)) as Record<string, unknown>,
    };
  }

  insertAttestation(attestation: AttestationRecord): void {
    this.#database
      .prepare(`
        INSERT INTO attestations (
          attestation_id,
          subject_sat,
          claim,
          issuer_pubkey,
          signature,
          expires_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        attestation.attestation_id,
        attestation.subject_sat,
        attestation.claim,
        attestation.issuer_pubkey,
        attestation.signature,
        attestation.expires_at,
        attestation.created_at,
      );
  }

  listAttestationsBySat(subjectSat: number): AttestationRecord[] {
    return this.#database
      .prepare(`
        SELECT
          attestation_id,
          subject_sat,
          claim,
          issuer_pubkey,
          signature,
          expires_at,
          created_at
        FROM attestations
        WHERE subject_sat = ?
        ORDER BY created_at DESC, attestation_id DESC
      `)
      .all(subjectSat)
      .map((row) => {
        const typedRow = row as Record<string, unknown>;
        return {
          attestation_id: String(typedRow.attestation_id),
          subject_sat: Number(typedRow.subject_sat),
          claim: String(typedRow.claim),
          issuer_pubkey: String(typedRow.issuer_pubkey),
          signature: String(typedRow.signature),
          expires_at: typedRow.expires_at === null ? null : String(typedRow.expires_at),
          created_at: String(typedRow.created_at),
        } satisfies AttestationRecord;
      });
  }
}
