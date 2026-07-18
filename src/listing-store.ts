import { DatabaseSync } from "node:sqlite";

import type {
  AttestationRecord,
  CollectionRecord,
  ListingQuery,
  ListingRecord,
  ListingStore,
  OfferQuery,
  OfferRecord,
  OfferStatus,
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
    sat_range_start:
      row.sat_range_start === null || row.sat_range_start === undefined
        ? null
        : Number(row.sat_range_start),
    sat_range_size:
      row.sat_range_size === null || row.sat_range_size === undefined
        ? null
        : Number(row.sat_range_size),
  };
}

function mapOfferRow(row: Record<string, unknown>): OfferRecord {
  return {
    offer_id: String(row.offer_id),
    offerer_sat_number: Number(row.offerer_sat_number),
    offerer_asset_outpoint: String(row.offerer_asset_outpoint),
    taker_sat_number: Number(row.taker_sat_number),
    taker_asset_outpoint: String(row.taker_asset_outpoint),
    offer_psbt: String(row.offer_psbt),
    accept_psbt: row.accept_psbt === null ? null : String(row.accept_psbt),
    status: String(row.status) as OfferStatus,
    created_at: String(row.created_at),
    expires_at: row.expires_at === null ? null : String(row.expires_at),
  };
}

export class SqliteListingStore implements ListingStore {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;

    // Schema setup order is load-bearing: create tables, THEN migrate columns
    // onto any pre-existing tables, THEN create indexes. Indexes that reference
    // migrated columns (e.g. listings_open_range_idx on sat_range_start) must
    // come after the migration or an existing DB missing those columns fails
    // with "no such column" on startup.
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
        cancelled INTEGER NOT NULL DEFAULT 0,
        sat_range_start INTEGER,
        sat_range_size INTEGER
      );
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
      CREATE TABLE IF NOT EXISTS offers (
        offer_id TEXT PRIMARY KEY,
        offerer_sat_number INTEGER NOT NULL,
        offerer_asset_outpoint TEXT NOT NULL,
        taker_sat_number INTEGER NOT NULL,
        taker_asset_outpoint TEXT NOT NULL,
        offer_psbt TEXT NOT NULL,
        accept_psbt TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
    `);

    this.#migrateListingRangeColumns();

    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS listings_open_sat_number_idx
        ON listings (sat_number, cancelled);
      CREATE INDEX IF NOT EXISTS listings_open_outpoint_idx
        ON listings (outpoint, cancelled);
      CREATE INDEX IF NOT EXISTS listings_open_range_idx
        ON listings (sat_range_start, cancelled);
      CREATE INDEX IF NOT EXISTS attestations_subject_sat_idx
        ON attestations (subject_sat, created_at DESC);
      CREATE INDEX IF NOT EXISTS offers_taker_status_idx
        ON offers (taker_sat_number, status);
      CREATE INDEX IF NOT EXISTS offers_offerer_status_idx
        ON offers (offerer_sat_number, status);
    `);
  }

  // Idempotent migration for pre-existing DBs created before the range columns
  // were added. CREATE TABLE IF NOT EXISTS won't alter an existing table, so we
  // inspect the current columns and add any that are missing.
  #migrateListingRangeColumns(): void {
    const existingColumns = new Set(
      this.#database
        .prepare("PRAGMA table_info(listings)")
        .all()
        .map((row) => String((row as Record<string, unknown>).name)),
    );

    const requiredColumns: Array<{ name: string; definition: string }> = [
      { name: "sat_range_start", definition: "sat_range_start INTEGER" },
      { name: "sat_range_size", definition: "sat_range_size INTEGER" },
    ];

    for (const column of requiredColumns) {
      if (!existingColumns.has(column.name)) {
        this.#database.exec(`ALTER TABLE listings ADD COLUMN ${column.definition}`);
      }
    }
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
          cancelled,
          sat_range_start,
          sat_range_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        listing.sat_range_start ?? null,
        listing.sat_range_size ?? null,
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
          cancelled,
          sat_range_start,
          sat_range_size
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

    if (query.asset_type !== undefined) {
      conditions.push("asset_type = ?");
      values.push(query.asset_type);
    }

    if (query.sat_range_start !== undefined) {
      conditions.push("sat_range_start = ?");
      values.push(query.sat_range_start);
    }

    if (query.sat_range_size !== undefined) {
      conditions.push("sat_range_size = ?");
      values.push(query.sat_range_size);
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
        cancelled,
        sat_range_start,
        sat_range_size
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

  insertOffer(record: OfferRecord): void {
    this.#database
      .prepare(`
        INSERT INTO offers (
          offer_id,
          offerer_sat_number,
          offerer_asset_outpoint,
          taker_sat_number,
          taker_asset_outpoint,
          offer_psbt,
          accept_psbt,
          status,
          created_at,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.offer_id,
        record.offerer_sat_number,
        record.offerer_asset_outpoint,
        record.taker_sat_number,
        record.taker_asset_outpoint,
        record.offer_psbt,
        record.accept_psbt,
        record.status,
        record.created_at,
        record.expires_at,
      );
  }

  getOffer(offerId: string): OfferRecord | null {
    const row = this.#database
      .prepare(`
        SELECT
          offer_id,
          offerer_sat_number,
          offerer_asset_outpoint,
          taker_sat_number,
          taker_asset_outpoint,
          offer_psbt,
          accept_psbt,
          status,
          created_at,
          expires_at
        FROM offers
        WHERE offer_id = ?
        LIMIT 1
      `)
      .get(offerId) as Record<string, unknown> | undefined;

    return row ? mapOfferRow(row) : null;
  }

  updateOfferAccept(offerId: string, acceptPsbt: string): OfferRecord | null {
    this.#database
      .prepare(`
        UPDATE offers
        SET accept_psbt = ?, status = 'accepted'
        WHERE offer_id = ?
      `)
      .run(acceptPsbt, offerId);

    return this.getOffer(offerId);
  }

  listOffers(query: OfferQuery = {}): OfferRecord[] {
    const conditions: string[] = [];
    const values: Array<number | string> = [];

    if (query.taker_sat_number !== undefined) {
      conditions.push("taker_sat_number = ?");
      values.push(query.taker_sat_number);
    }

    if (query.offerer_sat_number !== undefined) {
      conditions.push("offerer_sat_number = ?");
      values.push(query.offerer_sat_number);
    }

    if (query.status !== undefined) {
      conditions.push("status = ?");
      values.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const statement = this.#database.prepare(`
      SELECT
        offer_id,
        offerer_sat_number,
        offerer_asset_outpoint,
        taker_sat_number,
        taker_asset_outpoint,
        offer_psbt,
        accept_psbt,
        status,
        created_at,
        expires_at
      FROM offers
      ${whereClause}
      ORDER BY created_at DESC, offer_id DESC
    `);

    return statement.all(...values).map((row) => mapOfferRow(row as Record<string, unknown>));
  }
}
