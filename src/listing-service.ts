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

export function ensureInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ListingValidationError(`${fieldName} must be an integer`);
  }

  return value;
}

export function ensureRequiredString(value: unknown, fieldName: string): string {
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

/**
 * Fetch an ord output and require it to be indexed and unspent. Shared by every
 * asset-type branch of {@link ListingService.createListing}.
 */
export async function fetchIndexedUnspentOutput(
  ordClient: ListingOrdClient,
  outpoint: string,
): Promise<OrdOutput> {
  const ordOutput = await ordClient.output(outpoint);
  if (!ordOutput.indexed) {
    throw new ListingValidationError("outpoint is not indexed by ord");
  }

  if (ordOutput.spent) {
    throw new ListingValidationError("outpoint is already spent");
  }

  return ordOutput;
}

/**
 * Assert that `satNumber` sits at offset 0 of `outpoint` per ord's sat ranges
 * (ADR-0007). Fetches the ord output, requires it to be indexed + unspent, and
 * requires `output.sat_ranges[0][0] === satNumber`. Returns the fetched
 * OrdOutput so callers can apply further per-asset-type checks without a second
 * fetch. Exported so other services (e.g. sat-for-sat offers) can reuse it.
 */
export async function assertOffsetZero(
  ordClient: ListingOrdClient,
  outpoint: string,
  satNumber: number,
): Promise<OrdOutput> {
  const ordOutput = await fetchIndexedUnspentOutput(ordClient, outpoint);

  const outputFirstSat = firstSatNumber(ordOutput);
  if (outputFirstSat === null) {
    throw new ListingValidationError("ord output has no sat ranges");
  }

  if (outputFirstSat !== satNumber) {
    throw new ListingValidationError(
      "listed sat must be at offset 0 according to ord output sat ranges",
    );
  }

  return ordOutput;
}

/**
 * Validate that a signed listing PSBT's input 0 spends `outpoint` with a seller
 * partial signature under SIGHASH_SINGLE|ANYONECANPAY and that output 0 equals
 * the listing price. Shared by every asset-type branch.
 */
function validateSignedListingPsbt(signedPsbt: string, outpoint: string, priceSats: number): void {
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
    switch (input.asset_type) {
      case "sat":
        return this.#createSatListing(input);
      case "range":
        return this.#createRangeListing(input);
      case "utxo":
        return this.#createUtxoListing(input);
      default:
        throw new ListingValidationError(
          `asset_type must be one of "sat", "range", "utxo"`,
        );
    }
  }

  async #createSatListing(input: CreateListingRequest): Promise<ListingRecord> {
    const satNumber = ensureInteger(input.sat_number, "sat_number");
    const outpoint = ensureRequiredString(input.outpoint, "outpoint");
    const priceSats = this.#ensurePositivePrice(input.price_sats);
    const sellerAddress = ensureRequiredString(input.seller_address, "seller_address");
    const signedPsbt = ensureRequiredString(input.signed_psbt, "signed_psbt");
    const expiresAt = input.expires_at ?? null;

    await assertOffsetZero(this.#ordClient, outpoint, satNumber);
    validateSignedListingPsbt(signedPsbt, outpoint, priceSats);

    return this.#persist({
      asset_type: "sat",
      sat_number: satNumber,
      outpoint,
      price_sats: priceSats,
      seller_address: sellerAddress,
      signed_psbt: signedPsbt,
      expires_at: expiresAt,
      sat_range_start: null,
      sat_range_size: null,
    });
  }

  async #createRangeListing(input: CreateListingRequest): Promise<ListingRecord> {
    const rangeStart = ensureInteger(input.sat_range_start, "sat_range_start");
    const rangeSize = ensureInteger(input.sat_range_size, "sat_range_size");
    const outpoint = ensureRequiredString(input.outpoint, "outpoint");
    const priceSats = this.#ensurePositivePrice(input.price_sats);
    const sellerAddress = ensureRequiredString(input.seller_address, "seller_address");
    const signedPsbt = ensureRequiredString(input.signed_psbt, "signed_psbt");
    const expiresAt = input.expires_at ?? null;

    if (rangeStart < 0) {
      throw new ListingValidationError("sat_range_start must be greater than or equal to zero");
    }

    if (rangeSize < 1) {
      throw new ListingValidationError("sat_range_size must be greater than or equal to one");
    }

    // Offset-0 precondition + indexed/unspent fetch (ADR-0007).
    const ordOutput = await assertOffsetZero(this.#ordClient, outpoint, rangeStart);

    // The range must be pre-isolated into its own UTXO. The v1 fill template
    // transfers the ENTIRE seller input value to the buyer, so a range listing
    // must equal the whole spendable UTXO's sat span: exactly one contiguous
    // sat range whose start is the listed start (offset 0) and whose span
    // equals the listed size. A sub-range of a larger UTXO would silently
    // transfer extra sats and is rejected. A range-aware split/settlement
    // template is a future follow-up (out of scope).
    const satRanges = ordOutput.sat_ranges ?? [];
    if (satRanges.length !== 1) {
      throw new ListingValidationError(
        "range listing requires the outpoint to hold exactly one contiguous sat range; " +
          "isolate the range into its own UTXO first",
      );
    }

    const [start, end] = satRanges[0] as [number, number];
    const utxoSpan = end - start;
    if (start !== rangeStart || rangeSize !== utxoSpan) {
      throw new ListingValidationError(
        "range listing must equal the whole UTXO's sat span (a sub-range is not allowed); " +
          "isolate the range into its own UTXO first",
      );
    }

    validateSignedListingPsbt(signedPsbt, outpoint, priceSats);

    return this.#persist({
      asset_type: "range",
      sat_number: rangeStart,
      outpoint,
      price_sats: priceSats,
      seller_address: sellerAddress,
      signed_psbt: signedPsbt,
      expires_at: expiresAt,
      sat_range_start: rangeStart,
      sat_range_size: rangeSize,
    });
  }

  async #createUtxoListing(input: CreateListingRequest): Promise<ListingRecord> {
    const outpoint = ensureRequiredString(input.outpoint, "outpoint");
    const priceSats = this.#ensurePositivePrice(input.price_sats);
    const sellerAddress = ensureRequiredString(input.seller_address, "seller_address");
    const signedPsbt = ensureRequiredString(input.signed_psbt, "signed_psbt");
    const expiresAt = input.expires_at ?? null;

    // No offset-0 precondition for a whole-UTXO listing; the first sat number
    // (if any) is recorded for discovery but may be null.
    const ordOutput = await fetchIndexedUnspentOutput(this.#ordClient, outpoint);
    const satNumber = firstSatNumber(ordOutput);

    validateSignedListingPsbt(signedPsbt, outpoint, priceSats);

    return this.#persist({
      asset_type: "utxo",
      sat_number: satNumber,
      outpoint,
      price_sats: priceSats,
      seller_address: sellerAddress,
      signed_psbt: signedPsbt,
      expires_at: expiresAt,
      sat_range_start: null,
      sat_range_size: null,
    });
  }

  #ensurePositivePrice(value: unknown): number {
    const priceSats = ensureInteger(value, "price_sats");
    if (priceSats <= 0) {
      throw new ListingValidationError("price_sats must be greater than zero");
    }

    return priceSats;
  }

  #persist(fields: Omit<ListingRecord, "listing_id" | "created_at" | "cancelled">): ListingRecord {
    const listing: ListingRecord = {
      listing_id: this.#createListingId(),
      created_at: this.#now().toISOString(),
      cancelled: false,
      ...fields,
    };

    this.#store.insertListing(listing);
    return listing;
  }

  listOpenListings(query: ListingQuery = {}): ListingRecord[] {
    return this.#store.listOpenListings(query);
  }
}
