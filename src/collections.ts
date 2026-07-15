import type { CollectionRecord } from "./listing-types.ts";

const SATS_PER_BTC = 100_000_000n;
const HALVING_INTERVAL = 210_000n;
const DIFFICULTY_ADJUSTMENT_INTERVAL = 2_016n;
const CYCLE_INTERVAL = HALVING_INTERVAL * 6n;
const MAX_SUBSIDY_EPOCH = 33n;
const SAT_SUPPLY = 2_099_999_997_690_000n;

const rarityRank: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

function subsidyForHeight(height: bigint): bigint {
  const epoch = height / HALVING_INTERVAL;
  if (epoch >= MAX_SUBSIDY_EPOCH) {
    return 0n;
  }

  return (50n * SATS_PER_BTC) >> epoch;
}

function satsMinedBeforeHeight(height: bigint): bigint {
  let sats = 0n;
  let remaining = height;
  let epoch = 0n;

  while (remaining > 0n && epoch < MAX_SUBSIDY_EPOCH) {
    const blocksThisEpoch = remaining > HALVING_INTERVAL ? HALVING_INTERVAL : remaining;
    sats += blocksThisEpoch * subsidyForHeight(epoch * HALVING_INTERVAL);
    remaining -= blocksThisEpoch;
    epoch += 1n;
  }

  return sats;
}

function satToHeightAndOffset(satNumber: bigint): { height: bigint; offset: bigint } {
  if (satNumber < 0n || satNumber >= SAT_SUPPLY) {
    throw new Error("sat_number is out of Bitcoin supply bounds");
  }

  let low = 0n;
  let high = 6_930_000n;

  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    if (satsMinedBeforeHeight(mid) <= satNumber) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const blockStart = satsMinedBeforeHeight(low);
  return { height: low, offset: satNumber - blockStart };
}

function rarityOfSat(satNumber: bigint): keyof typeof rarityRank {
  if (satNumber === 0n) {
    return "mythic";
  }

  const { height, offset } = satToHeightAndOffset(satNumber);

  if (offset !== 0n) {
    return "common";
  }

  if (height % CYCLE_INTERVAL === 0n) {
    return "legendary";
  }

  if (height % HALVING_INTERVAL === 0n) {
    return "epic";
  }

  if (height % DIFFICULTY_ADJUSTMENT_INTERVAL === 0n) {
    return "rare";
  }

  return "uncommon";
}

function satName(satNumber: bigint): string {
  let value = SAT_SUPPLY - satNumber;
  let encoded = "";

  while (value > 0n) {
    const digit = Number((value - 1n) % 26n);
    encoded += String.fromCharCode("a".charCodeAt(0) + digit);
    value = (value - 1n) / 26n;
  }

  return encoded.split("").reverse().join("");
}

function asBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be a non-negative integer`);
}

export function evaluateCollectionPredicate(collection: CollectionRecord, satNumber: bigint): boolean {
  const params = collection.predicate_params;

  switch (collection.predicate_type) {
    case "sat_number":
      return satNumber === asBigint(params.number, "predicate_params.number");
    case "sat_range": {
      const start = asBigint(params.start, "predicate_params.start");
      const end = asBigint(params.end, "predicate_params.end");
      return satNumber >= start && satNumber < end;
    }
    case "block_range": {
      const startHeight = asBigint(params.start_height, "predicate_params.start_height");
      const endHeight = asBigint(params.end_height, "predicate_params.end_height");
      const { height } = satToHeightAndOffset(satNumber);
      return height >= startHeight && height < endHeight;
    }
    case "epoch": {
      const wantedEpoch = asBigint(params.epoch, "predicate_params.epoch");
      const { height } = satToHeightAndOffset(satNumber);
      return height / HALVING_INTERVAL === wantedEpoch;
    }
    case "rarity": {
      if (typeof params.min_rarity !== "string") {
        throw new Error("predicate_params.min_rarity must be a string");
      }

      const minRarity = params.min_rarity.toLowerCase();
      if (!(minRarity in rarityRank)) {
        throw new Error("predicate_params.min_rarity is invalid");
      }

      return rarityRank[rarityOfSat(satNumber)] >= rarityRank[minRarity];
    }
    case "name_prefix": {
      if (typeof params.prefix !== "string" || params.prefix.length === 0) {
        throw new Error("predicate_params.prefix must be a non-empty string");
      }

      return satName(satNumber).startsWith(params.prefix);
    }
    default:
      throw new Error(
        `predicate_type=${collection.predicate_type} is not implemented in Phase 2b (OPEN-4)`,
      );
  }
}

export interface CollectionAssetPage {
  assets: Array<{ sat_number: number }>;
  nextCursor: string | null;
  scanStartSat: string;
  scanCount: number;
}

export function listCollectionAssetsPage(
  collection: CollectionRecord,
  cursor: bigint,
  limit: number,
): CollectionAssetPage {
  const scanCount = Math.max(limit, 0);
  const assets: Array<{ sat_number: number }> = [];

  for (let i = 0; i < scanCount; i += 1) {
    const sat = cursor + BigInt(i);
    if (sat >= SAT_SUPPLY) {
      break;
    }

    if (evaluateCollectionPredicate(collection, sat)) {
      assets.push({ sat_number: Number(sat) });
    }
  }

  const nextCursorValue = cursor + BigInt(scanCount);
  return {
    assets,
    nextCursor: nextCursorValue < SAT_SUPPLY ? nextCursorValue.toString() : null,
    scanStartSat: cursor.toString(),
    scanCount,
  };
}
