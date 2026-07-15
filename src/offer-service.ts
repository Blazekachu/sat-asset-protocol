// Sat-for-sat offer/accept service (ADR-0014, v2).
//
// Mirrors ListingService: it validates a caller-supplied offer PSBT against the
// canonical sat-for-sat construction, cross-checks the two traded assets are at
// offset 0 on their ord outputs, persists the offer, and later validates the
// fully-signed accept PSBT before marking the offer accepted. The protocol
// never holds keys — signatures are produced by the parties out of band.

import {
  assertOffsetZero,
  ensureInteger,
  ensureRequiredString,
  ListingValidationError,
  type ListingOrdClient,
} from "./listing-service.ts";
import type {
  CreateOfferRequest,
  ListingStore,
  OfferQuery,
  OfferRecord,
} from "./listing-types.ts";
import { validateSatForSatAcceptPsbt, validateSatForSatOfferPsbt } from "./sat-for-sat.ts";

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
}

export class OfferService {
  readonly #store: ListingStore;
  readonly #ordClient: ListingOrdClient;
  readonly #now: () => Date;
  readonly #createOfferId: () => string;

  constructor(dependencies: OfferServiceDependencies) {
    this.#store = dependencies.store;
    this.#ordClient = dependencies.ordClient;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createOfferId = dependencies.createOfferId ?? (() => crypto.randomUUID());
  }

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

    const record: OfferRecord = {
      offer_id: this.#createOfferId(),
      offerer_sat_number: offererSatNumber,
      offerer_asset_outpoint: offererAssetOutpoint,
      taker_sat_number: takerSatNumber,
      taker_asset_outpoint: takerAssetOutpoint,
      offer_psbt: offerPsbt,
      accept_psbt: null,
      status: "open",
      created_at: this.#now().toISOString(),
      expires_at: expiresAt,
    };

    this.#store.insertOffer(record);
    return record;
  }

  async acceptOffer(offerId: string, acceptPsbt: string): Promise<OfferRecord> {
    const offer = this.#store.getOffer(offerId);
    if (!offer) {
      throw new OfferNotFoundError("offer not found");
    }

    if (offer.status !== "open") {
      throw new ListingValidationError(`offer is not open (status=${offer.status})`);
    }

    const psbt = ensureRequiredString(acceptPsbt, "accept_psbt");
    validateSatForSatAcceptPsbt(psbt, offer.offer_psbt);

    const updated = this.#store.updateOfferAccept(offerId, psbt);
    if (!updated) {
      throw new OfferNotFoundError("offer not found");
    }

    return updated;
  }

  getOffer(offerId: string): OfferRecord | null {
    return this.#store.getOffer(offerId);
  }

  listOffers(query: OfferQuery = {}): OfferRecord[] {
    return this.#store.listOffers(query);
  }
}
