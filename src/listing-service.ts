import type { OrdOutput } from "./types.ts";
import { parseListingPsbt } from "./psbt.ts";
import type {
  CreateListingRequest,
  ListingQuery,
  ListingRecord,
  ListingStore,
} from "./listing-types.ts";

export interface ListingOrdClient {
  output(outpoint: string): Promise<OrdOutput>;
}

export interface ListingServiceDependencies {
  store: ListingStore;
  ordClient: ListingOrdClient;
  now?: () => Date;
  createListingId?: () => string;
}

export class ListingValidationError extends Error {}

function ensureInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ListingValidationError(`${fieldName} must be an integer`);
  }

  return value;
}

function ensureRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ListingValidationError(`${fieldName} is required`);
  }

  return value;
}

function firstSatNumber(output: OrdOutput): number | null {
  const firstRange = output.sat_ranges?.[0];
  if (!firstRange) {
    return null;
  }

  const [start] = firstRange;
  return typeof start === "number" ? start : null;
}

export class ListingService {
  readonly #store: ListingStore;
  readonly #ordClient: ListingOrdClient;
  readonly #now: () => Date;
  readonly #createListingId: () => string;

  constructor(dependencies: ListingServiceDependencies) {
    this.#store = dependencies.store;
    this.#ordClient = dependencies.ordClient;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createListingId = dependencies.createListingId ?? (() => crypto.randomUUID());
  }

  async createListing(input: CreateListingRequest): Promise<ListingRecord> {
    if (input.asset_type !== "sat") {
      throw new ListingValidationError("Session 08 only supports asset_type=sat");
    }

    const satNumber = ensureInteger(input.sat_number, "sat_number");
    const outpoint = ensureRequiredString(input.outpoint, "outpoint");
    const priceSats = ensureInteger(input.price_sats, "price_sats");
    const sellerAddress = ensureRequiredString(input.seller_address, "seller_address");
    const signedPsbt = ensureRequiredString(input.signed_psbt, "signed_psbt");
    const expiresAt = input.expires_at ?? null;

    if (priceSats <= 0) {
      throw new ListingValidationError("price_sats must be greater than zero");
    }

    const ordOutput = await this.#ordClient.output(outpoint);
    if (!ordOutput.indexed) {
      throw new ListingValidationError("outpoint is not indexed by ord");
    }

    if (ordOutput.spent) {
      throw new ListingValidationError("outpoint is already spent");
    }

    const outputFirstSat = firstSatNumber(ordOutput);
    if (outputFirstSat === null) {
      throw new ListingValidationError("ord output has no sat ranges");
    }

    if (outputFirstSat !== satNumber) {
      throw new ListingValidationError(
        "listed sat must be at offset 0 according to ord output sat ranges",
      );
    }

    const parsedPsbt = parseListingPsbt(signedPsbt);
    if (parsedPsbt.inputOutpoint !== outpoint) {
      throw new ListingValidationError("signed_psbt input 0 must spend the declared outpoint");
    }

    if (!parsedPsbt.input0HasPartialSig) {
      throw new ListingValidationError("signed_psbt input 0 must include a seller partial signature");
    }

    if (parsedPsbt.input0SighashType !== 0x03 && parsedPsbt.input0SighashType !== 0x83) {
      throw new ListingValidationError(
        "signed_psbt input 0 must use SIGHASH_SINGLE|ANYONECANPAY (0x03)",
      );
    }

    const output0Value = parsedPsbt.outputValues[0];
    if (output0Value !== priceSats) {
      throw new ListingValidationError("signed_psbt output 0 must equal price_sats");
    }

    const listing: ListingRecord = {
      listing_id: this.#createListingId(),
      asset_type: "sat",
      sat_number: satNumber,
      outpoint,
      price_sats: priceSats,
      seller_address: sellerAddress,
      signed_psbt: signedPsbt,
      created_at: this.#now().toISOString(),
      expires_at: expiresAt,
      cancelled: false,
    };

    this.#store.insertListing(listing);
    return listing;
  }

  listOpenListings(query: ListingQuery = {}): ListingRecord[] {
    return this.#store.listOpenListings(query);
  }
}
