import { DatabaseSync } from "node:sqlite";

import {
  assetMatchesRef,
  assetSatisfiesPredicate,
  assetSpansOverlap,
  bidFillAssetRef,
} from "./offer-predicates.ts";
import type {
  AttestationRecord,
  BidFillRecord,
  BidFillState,
  CollectionRecord,
  IntentQuery,
  ListingQuery,
  ListingRecord,
  ListingStore,
  OfferAssetRef,
  OfferKind,
  OfferQuery,
  OfferRecord,
  OfferStatus,
  SideBuildData,
  WantSpec,
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

function parseJsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.parse(String(value)) as T;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapOfferRow(row: Record<string, unknown>): OfferRecord {
  return {
    offer_id: String(row.offer_id),
    offerer_sat_number: Number(row.offerer_sat_number),
    offerer_asset_outpoint: String(row.offerer_asset_outpoint),
    taker_sat_number: nullableNumber(row.taker_sat_number),
    taker_asset_outpoint:
      row.taker_asset_outpoint === null || row.taker_asset_outpoint === undefined
        ? null
        : String(row.taker_asset_outpoint),
    offer_psbt: row.offer_psbt === null || row.offer_psbt === undefined ? null : String(row.offer_psbt),
    accept_psbt: row.accept_psbt === null ? null : String(row.accept_psbt),
    status: String(row.status) as OfferStatus,
    created_at: String(row.created_at),
    expires_at: row.expires_at === null ? null : String(row.expires_at),
    offer_kind: String(row.offer_kind) as OfferKind,
    negotiation_id: String(row.negotiation_id),
    parent_offer_id:
      row.parent_offer_id === null || row.parent_offer_id === undefined
        ? null
        : String(row.parent_offer_id),
    counter_index: Number(row.counter_index),
    supersedes:
      row.supersedes === null || row.supersedes === undefined ? null : String(row.supersedes),
    nonce: String(row.nonce),
    give_assets: parseJsonColumn<OfferAssetRef[]>(row.give_assets_json),
    want_spec: parseJsonColumn<WantSpec>(row.want_spec_json),
    taker_assets: parseJsonColumn<OfferAssetRef[]>(row.taker_assets_json),
    taker_build: parseJsonColumn<SideBuildData>(row.taker_build_json),
    settlement_txid:
      row.settlement_txid === null || row.settlement_txid === undefined
        ? null
        : String(row.settlement_txid),
    bid_target_quantity: nullableNumber(row.bid_target_quantity),
    bid_total_btc_sats: nullableNumber(row.bid_total_btc_sats),
    bid_remaining_quantity: nullableNumber(row.bid_remaining_quantity),
  };
}

function mapBidFillRow(row: Record<string, unknown>): BidFillRecord {
  return {
    fill_id: String(row.fill_id),
    bid_id: String(row.bid_id),
    fill_offer_id: String(row.fill_offer_id),
    filled_sat_number: nullableNumber(row.filled_sat_number),
    filled_range_start: nullableNumber(row.filled_range_start),
    filled_range_size: nullableNumber(row.filled_range_size),
    filled_quantity: Number(row.filled_quantity),
    seller_outpoint:
      row.seller_outpoint === null || row.seller_outpoint === undefined
        ? null
        : String(row.seller_outpoint),
    seller_utxo_value_sats: nullableNumber(row.seller_utxo_value_sats),
    buyer_asset_script_pubkey_hex:
      row.buyer_asset_script_pubkey_hex === null || row.buyer_asset_script_pubkey_hex === undefined
        ? null
        : String(row.buyer_asset_script_pubkey_hex),
    price_sats: nullableNumber(row.price_sats),
    state: String(row.state) as BidFillState,
    created_at:
      row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
  };
}

const BID_FILL_COLUMNS = `
  fill_id,
  bid_id,
  fill_offer_id,
  filled_sat_number,
  filled_range_start,
  filled_range_size,
  filled_quantity,
  seller_outpoint,
  seller_utxo_value_sats,
  buyer_asset_script_pubkey_hex,
  price_sats,
  state,
  created_at
`;

// Full column list for offers_v2 SELECTs (order-independent; mapOfferRow reads
// by name).
const OFFER_COLUMNS = `
  offer_id,
  offerer_sat_number,
  offerer_asset_outpoint,
  taker_sat_number,
  taker_asset_outpoint,
  offer_psbt,
  accept_psbt,
  status,
  created_at,
  expires_at,
  offer_kind,
  negotiation_id,
  parent_offer_id,
  counter_index,
  supersedes,
  nonce,
  give_assets_json,
  want_spec_json,
  taker_assets_json,
  taker_build_json,
  settlement_txid,
  bid_target_quantity,
  bid_total_btc_sats,
  bid_remaining_quantity
`;

// Single source of truth for the offers INSERT: column list + matching value
// placeholders. Used by insertOffer and the transactional counter/bid-fill
// paths so the 25-column list is never duplicated (and can never drift).
const INSERT_OFFER_SQL = `
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
    expires_at,
    offer_kind,
    negotiation_id,
    parent_offer_id,
    counter_index,
    supersedes,
    nonce,
    give_assets_json,
    want_spec_json,
    taker_assets_json,
    taker_build_json,
    settlement_txid,
    bid_target_quantity,
    bid_total_btc_sats,
    bid_remaining_quantity,
    bid_want_spec_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

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
    this.#migrateOffersTable();

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
      CREATE INDEX IF NOT EXISTS offers_kind_status_idx
        ON offers (offer_kind, status);
      CREATE INDEX IF NOT EXISTS offers_negotiation_idx
        ON offers (negotiation_id, counter_index);
      CREATE INDEX IF NOT EXISTS offers_nonce_idx
        ON offers (nonce);
      CREATE INDEX IF NOT EXISTS bid_fills_bid_idx
        ON bid_fills (bid_id);
    `);
  }

  // Idempotent migration to the negotiation-model offers schema (ADR-0016/0017)
  // AND the WS-D bid schema (ADR-0019), built in ONE pass so WS-D never has to
  // rebuild the table. The legacy `offers` table declared NOT NULL on
  // taker_sat_number/taker_asset_outpoint/offer_psbt, which intents and
  // unsigned rounds must relax, so a CREATE ... AS SELECT + DROP + RENAME
  // rebuild is required (ALTER cannot relax NOT NULL). No-op once migrated.
  #migrateOffersTable(): void {
    const existingColumns = new Set(
      this.#database
        .prepare("PRAGMA table_info(offers)")
        .all()
        .map((row) => String((row as Record<string, unknown>).name)),
    );

    // The bid_fills ledger is additive; create it regardless (WS-D writes it).
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS bid_fills (
        fill_id TEXT PRIMARY KEY,
        bid_id TEXT NOT NULL,
        fill_offer_id TEXT NOT NULL,
        filled_sat_number INTEGER,
        filled_range_start INTEGER,
        filled_range_size INTEGER,
        filled_quantity INTEGER NOT NULL,
        seller_outpoint TEXT,
        seller_utxo_value_sats INTEGER,
        buyer_asset_script_pubkey_hex TEXT,
        price_sats INTEGER,
        state TEXT NOT NULL,
        created_at TEXT
      );
    `);

    if (existingColumns.has("offer_kind")) {
      // Already migrated.
      return;
    }

    // Build the complete final schema (WS-A + WS-D columns) in offers_v2, copy
    // legacy rows as concrete offers, then swap it in.
    this.#database.exec(`
      CREATE TABLE offers_v2 (
        offer_id TEXT PRIMARY KEY,
        offerer_sat_number INTEGER NOT NULL,
        offerer_asset_outpoint TEXT NOT NULL,
        taker_sat_number INTEGER,
        taker_asset_outpoint TEXT,
        offer_psbt TEXT,
        accept_psbt TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        offer_kind TEXT NOT NULL DEFAULT 'concrete',
        negotiation_id TEXT NOT NULL,
        parent_offer_id TEXT,
        counter_index INTEGER NOT NULL DEFAULT 0,
        supersedes TEXT,
        nonce TEXT NOT NULL,
        give_assets_json TEXT,
        want_spec_json TEXT,
        taker_assets_json TEXT,
        taker_build_json TEXT,
        settlement_txid TEXT,
        bid_target_quantity INTEGER,
        bid_total_btc_sats INTEGER,
        bid_remaining_quantity INTEGER,
        bid_want_spec_json TEXT
      );
    `);

    // Copy legacy rows only when the legacy table has content to copy. Legacy
    // rows become concrete offers with negotiation_id=offer_id, counter_index=0,
    // nonce=offer_id, and all new JSON/settlement/bid cols NULL.
    if (existingColumns.size > 0) {
      this.#database.exec(`
        INSERT INTO offers_v2 (
          offer_id,
          offerer_sat_number,
          offerer_asset_outpoint,
          taker_sat_number,
          taker_asset_outpoint,
          offer_psbt,
          accept_psbt,
          status,
          created_at,
          expires_at,
          offer_kind,
          negotiation_id,
          parent_offer_id,
          counter_index,
          supersedes,
          nonce,
          give_assets_json,
          want_spec_json,
          taker_assets_json,
          taker_build_json,
          settlement_txid,
          bid_target_quantity,
          bid_total_btc_sats,
          bid_remaining_quantity,
          bid_want_spec_json
        )
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
          expires_at,
          'concrete',
          offer_id,
          NULL,
          0,
          NULL,
          offer_id,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        FROM offers;
      `);
    }

    this.#database.exec(`
      DROP TABLE offers;
      ALTER TABLE offers_v2 RENAME TO offers;
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

  // Run `body` inside a single BEGIN IMMEDIATE transaction, committing on
  // success and rolling back on any thrown error. node:sqlite's DatabaseSync
  // has no db.transaction() helper (verified typeof db.transaction ===
  // "undefined"), so this explicit wrapper is the shared primitive for every
  // multi-statement CAS below.
  #transaction<T>(body: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  // Insert one offers row from an OfferRecord (shared by insertOffer and the
  // transactional counter/bid-fill paths).
  #insertOfferRow(record: OfferRecord): void {
    this.#database.prepare(INSERT_OFFER_SQL).run(...this.#offerInsertValues(record));
  }

  insertOffer(record: OfferRecord): void {
    this.#insertOfferRow(record);
  }

  #offerInsertValues(record: OfferRecord): Array<string | number | null> {
    const jsonOrNull = (value: unknown): string | null =>
      value === null || value === undefined ? null : JSON.stringify(value);
    const valueOrNull = <T>(value: T | undefined | null): T | null =>
      value === undefined || value === null ? null : value;

    // Coalesce the negotiation fields to their legacy defaults when a caller
    // constructs a bare OfferRecord (e.g. older tests/fixtures that predate the
    // negotiation model). NOT NULL columns must always receive a value.
    const offerKind = record.offer_kind ?? "concrete";
    const negotiationId = record.negotiation_id ?? record.offer_id;
    const counterIndex = record.counter_index ?? 0;
    const nonce = record.nonce ?? record.offer_id;

    // A bid stores its want under want_spec; mirror it into bid_want_spec_json
    // so the WS-D bid path (which reads that column) sees the same spec.
    const bidWantSpecJson = offerKind === "bid" ? jsonOrNull(record.want_spec) : null;

    return [
      record.offer_id,
      record.offerer_sat_number,
      record.offerer_asset_outpoint,
      valueOrNull(record.taker_sat_number),
      valueOrNull(record.taker_asset_outpoint),
      valueOrNull(record.offer_psbt),
      valueOrNull(record.accept_psbt),
      record.status,
      record.created_at,
      valueOrNull(record.expires_at),
      offerKind,
      negotiationId,
      valueOrNull(record.parent_offer_id),
      counterIndex,
      valueOrNull(record.supersedes),
      nonce,
      jsonOrNull(record.give_assets),
      jsonOrNull(record.want_spec),
      jsonOrNull(record.taker_assets),
      jsonOrNull(record.taker_build),
      valueOrNull(record.settlement_txid),
      valueOrNull(record.bid_target_quantity),
      valueOrNull(record.bid_total_btc_sats),
      valueOrNull(record.bid_remaining_quantity),
      bidWantSpecJson,
    ];
  }

  getOffer(offerId: string): OfferRecord | null {
    const row = this.#database
      .prepare(`SELECT ${OFFER_COLUMNS} FROM offers WHERE offer_id = ? LIMIT 1`)
      .get(offerId) as Record<string, unknown> | undefined;

    return row ? mapOfferRow(row) : null;
  }

  getOfferByNonce(nonce: string): OfferRecord | null {
    const row = this.#database
      .prepare(`SELECT ${OFFER_COLUMNS} FROM offers WHERE nonce = ? LIMIT 1`)
      .get(nonce) as Record<string, unknown> | undefined;

    return row ? mapOfferRow(row) : null;
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

    if (query.offer_kind !== undefined) {
      conditions.push("offer_kind = ?");
      values.push(query.offer_kind);
    }

    if (query.negotiation_id !== undefined) {
      conditions.push("negotiation_id = ?");
      values.push(query.negotiation_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const statement = this.#database.prepare(`
      SELECT ${OFFER_COLUMNS}
      FROM offers
      ${whereClause}
      ORDER BY created_at DESC, offer_id DESC
    `);

    return statement.all(...values).map((row) => mapOfferRow(row as Record<string, unknown>));
  }

  listIntents(query: IntentQuery = {}): OfferRecord[] {
    const status = query.status ?? "open";
    const rows = this.#database
      .prepare(`
        SELECT ${OFFER_COLUMNS}
        FROM offers
        WHERE offer_kind = 'intent' AND status = ?
        ORDER BY created_at DESC, offer_id DESC
      `)
      .all(status)
      .map((row) => mapOfferRow(row as Record<string, unknown>));

    if (query.candidate_sat_number === undefined) {
      return rows;
    }

    // Post-filter to intents whose want_spec would accept the candidate sat.
    const candidate: OfferAssetRef = {
      asset_type: "sat",
      asset_outpoint: null,
      sat_number: query.candidate_sat_number,
    };
    return rows.filter((offer) => {
      const spec = offer.want_spec;
      if (!spec) {
        return false;
      }
      try {
        if (spec.mode === "predicate") {
          return assetSatisfiesPredicate(spec.predicate, candidate);
        }
        return spec.assets.some((ref) => assetMatchesRef(ref, candidate));
      } catch {
        return false;
      }
    });
  }

  listNegotiationThread(negotiationId: string): OfferRecord[] {
    return this.#database
      .prepare(`
        SELECT ${OFFER_COLUMNS}
        FROM offers
        WHERE negotiation_id = ?
        ORDER BY counter_index ASC, created_at ASC
      `)
      .all(negotiationId)
      .map((row) => mapOfferRow(row as Record<string, unknown>));
  }

  // Atomically insert the child round and CAS the parent open -> countered.
  // If the parent CAS changes !== 1, the child is never orphaned (rolled back).
  supersedeWithCounter(
    parentId: string,
    parentNonce: string,
    childRow: OfferRecord,
  ): OfferRecord {
    this.#transaction(() => {
      this.#insertOfferRow(childRow);

      const result = this.#database
        .prepare(`
          UPDATE offers
          SET status = 'countered'
          WHERE offer_id = ? AND nonce = ? AND status = 'open'
        `)
        .run(parentId, parentNonce);

      if (Number(result.changes) !== 1) {
        throw new Error("parent offer is not open under the supplied nonce");
      }
    });

    const child = this.getOffer(childRow.offer_id);
    if (!child) {
      throw new Error("counter round was not persisted");
    }
    return child;
  }

  updateOfferPsbt(offerId: string, offerPsbt: string, nonce: string): OfferRecord | null {
    const result = this.#database
      .prepare(`
        UPDATE offers
        SET offer_psbt = ?
        WHERE offer_id = ? AND nonce = ? AND status = 'open' AND offer_psbt IS NULL
      `)
      .run(offerPsbt, offerId, nonce);

    return Number(result.changes) === 1 ? this.getOffer(offerId) : null;
  }

  updateOfferAccept(offerId: string, acceptPsbt: string, nonce: string): OfferRecord | null {
    const result = this.#database
      .prepare(`
        UPDATE offers
        SET accept_psbt = ?, status = 'accepted'
        WHERE offer_id = ? AND nonce = ? AND status = 'open' AND offer_psbt IS NOT NULL
      `)
      .run(acceptPsbt, offerId, nonce);

    return Number(result.changes) === 1 ? this.getOffer(offerId) : null;
  }

  settleAcceptedOffer(offerId: string, txid: string, nonce: string): OfferRecord | null {
    const result = this.#database
      .prepare(`
        UPDATE offers
        SET status = 'settled', settlement_txid = ?
        WHERE offer_id = ? AND nonce = ? AND status = 'accepted'
      `)
      .run(txid, offerId, nonce);

    return Number(result.changes) === 1 ? this.getOffer(offerId) : null;
  }

  cancelOpenOffer(offerId: string, nonce: string): OfferRecord | null {
    const result = this.#database
      .prepare(`
        UPDATE offers
        SET status = 'cancelled'
        WHERE offer_id = ? AND nonce = ? AND status = 'open'
      `)
      .run(offerId, nonce);

    return Number(result.changes) === 1 ? this.getOffer(offerId) : null;
  }

  expireOffer(offerId: string, nowIso: string): OfferRecord | null {
    const result = this.#database
      .prepare(`
        UPDATE offers
        SET status = 'expired'
        WHERE offer_id = ? AND status = 'open'
          AND expires_at IS NOT NULL AND expires_at < ?
      `)
      .run(offerId, nowIso);

    return Number(result.changes) === 1 ? this.getOffer(offerId) : null;
  }

  // --- Bid fill ledger (WS-D, ADR-0019) -----------------------------------

  insertPendingBidFill(fill: BidFillRecord): void {
    this.#database
      .prepare(`
        INSERT INTO bid_fills (
          ${BID_FILL_COLUMNS}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        fill.fill_id,
        fill.bid_id,
        fill.fill_offer_id,
        fill.filled_sat_number,
        fill.filled_range_start,
        fill.filled_range_size,
        fill.filled_quantity,
        fill.seller_outpoint,
        fill.seller_utxo_value_sats,
        fill.buyer_asset_script_pubkey_hex,
        fill.price_sats,
        fill.state,
        fill.created_at,
      );
  }

  getBidFill(fillId: string): BidFillRecord | null {
    const row = this.#database
      .prepare(`SELECT ${BID_FILL_COLUMNS} FROM bid_fills WHERE fill_id = ? LIMIT 1`)
      .get(fillId) as Record<string, unknown> | undefined;
    return row ? mapBidFillRow(row) : null;
  }

  listBidFills(bidId: string): BidFillRecord[] {
    return this.#database
      .prepare(`
        SELECT ${BID_FILL_COLUMNS} FROM bid_fills
        WHERE bid_id = ?
        ORDER BY created_at ASC, fill_id ASC
      `)
      .all(bidId)
      .map((row) => mapBidFillRow(row as Record<string, unknown>));
  }

  // Correctness-critical atomic fill: re-read the bid under one BEGIN IMMEDIATE
  // transaction, re-check the remainder + overlap ledger, insert the child
  // settlement offer, transition the pending_build fill row to reserved, and CAS
  // the bid's remainder/nonce/status. Any failure rolls the whole thing back.
  recordBidFill(
    bidId: string,
    fillId: string,
    nonce: string,
    fillRow: OfferRecord,
    filledDelta: number,
    filledAssetRef: OfferAssetRef,
  ): OfferRecord {
    this.#transaction(() => {
      // (1) re-read the bid, assert open + matching nonce.
      const bid = this.getOffer(bidId);
      if (!bid) {
        throw new Error("bid not found");
      }
      if (bid.offer_kind !== "bid") {
        throw new Error("offer is not a bid");
      }
      if (bid.status !== "open") {
        throw new Error(`bid is not open (status=${bid.status})`);
      }
      if (bid.nonce !== nonce) {
        throw new Error("nonce does not match the bid");
      }
      const remaining = bid.bid_remaining_quantity ?? 0;

      // (2) assert 0 < filledDelta <= remaining.
      if (!(filledDelta > 0 && filledDelta <= remaining)) {
        throw new Error(
          `fill quantity ${filledDelta} is not within 0 < q <= remaining (${remaining})`,
        );
      }

      // (3) overlap re-check against reserved/settled ledger rows.
      const activeFills = this.listBidFills(bidId).filter(
        (fill) => fill.state === "reserved" || fill.state === "settled",
      );
      for (const fill of activeFills) {
        if (assetSpansOverlap(filledAssetRef, bidFillAssetRef(fill))) {
          throw new Error("fill overlaps a sat/range already recorded for this bid");
        }
      }

      // (4) insert the child settlement offer + transition the pending_build
      // ledger row to reserved.
      this.#insertOfferRow(fillRow);

      const fillTransition = this.#database
        .prepare(`
          UPDATE bid_fills
          SET state = 'reserved', fill_offer_id = ?
          WHERE fill_id = ? AND bid_id = ? AND state = 'pending_build'
        `)
        .run(fillRow.offer_id, fillId, bidId);
      if (Number(fillTransition.changes) !== 1) {
        throw new Error("pending_build fill row not found for transition");
      }

      // (5) CAS the bid remainder/status/nonce.
      const casResult = this.#database
        .prepare(`
          UPDATE offers
          SET bid_remaining_quantity = bid_remaining_quantity - ?,
              status = CASE WHEN bid_remaining_quantity - ? = 0 THEN 'filled' ELSE 'open' END,
              nonce = ?
          WHERE offer_id = ? AND nonce = ? AND status = 'open'
            AND bid_remaining_quantity >= ?
        `)
        .run(filledDelta, filledDelta, fillRow.nonce, bidId, nonce, filledDelta);

      // (6) if the CAS did not apply, roll back.
      if (Number(casResult.changes) !== 1) {
        throw new Error("bid remainder CAS failed (stale nonce or over-commit)");
      }
    });

    const updated = this.getOffer(bidId);
    if (!updated) {
      throw new Error("bid disappeared after recordBidFill");
    }
    return updated;
  }

  settleBidFill(bidId: string, fillId: string, txid: string, nonce: string): OfferRecord {
    this.#transaction(() => {
      const bid = this.getOffer(bidId);
      if (!bid || bid.offer_kind !== "bid") {
        throw new Error("bid not found");
      }
      if (bid.nonce !== nonce) {
        throw new Error("nonce does not match the bid");
      }
      const fill = this.getBidFill(fillId);
      if (!fill || fill.bid_id !== bidId) {
        throw new Error("fill not found for this bid");
      }
      if (fill.state !== "reserved") {
        throw new Error(`fill is not reserved (state=${fill.state})`);
      }

      const fillTransition = this.#database
        .prepare(`
          UPDATE bid_fills SET state = 'settled'
          WHERE fill_id = ? AND bid_id = ? AND state = 'reserved'
        `)
        .run(fillId, bidId);
      if (Number(fillTransition.changes) !== 1) {
        throw new Error("fill row could not be transitioned to settled");
      }

      this.#database
        .prepare(`
          UPDATE offers SET status = 'settled', settlement_txid = ?
          WHERE offer_id = ?
        `)
        .run(txid, fill.fill_offer_id);
    });

    const updated = this.getOffer(bidId);
    if (!updated) {
      throw new Error("bid disappeared after settleBidFill");
    }
    return updated;
  }

  releaseBidFill(bidId: string, fillId: string, nonce: string): OfferRecord {
    this.#transaction(() => {
      const bid = this.getOffer(bidId);
      if (!bid || bid.offer_kind !== "bid") {
        throw new Error("bid not found");
      }
      if (bid.nonce !== nonce) {
        throw new Error("nonce does not match the bid");
      }
      const fill = this.getBidFill(fillId);
      if (!fill || fill.bid_id !== bidId) {
        throw new Error("fill not found for this bid");
      }
      if (fill.state !== "reserved") {
        throw new Error(`only a reserved fill can be released (state=${fill.state})`);
      }

      // (a) ledger row reserved -> released (kept for audit).
      const fillTransition = this.#database
        .prepare(`
          UPDATE bid_fills SET state = 'released'
          WHERE fill_id = ? AND bid_id = ? AND state = 'reserved'
        `)
        .run(fillId, bidId);
      if (Number(fillTransition.changes) !== 1) {
        throw new Error("fill row could not be released");
      }

      // (b) credit the remainder back; reopen a filled bid if it was consumed.
      this.#database
        .prepare(`
          UPDATE offers
          SET bid_remaining_quantity = bid_remaining_quantity + ?,
              status = CASE WHEN status = 'filled' THEN 'open' ELSE status END
          WHERE offer_id = ?
        `)
        .run(fill.filled_quantity, bidId);

      // (c) mark the child settlement row terminal cancelled.
      this.#database
        .prepare(`UPDATE offers SET status = 'cancelled' WHERE offer_id = ?`)
        .run(fill.fill_offer_id);
    });

    const updated = this.getOffer(bidId);
    if (!updated) {
      throw new Error("bid disappeared after releaseBidFill");
    }
    return updated;
  }
}
