export interface DurationValue {
  secs: number;
  nanos: number;
}

export interface OrdStatus {
  address_index: boolean;
  blessed_inscriptions: number;
  chain: string;
  cursed_inscriptions: number;
  height: number | null;
  initial_sync_time: DurationValue;
  inscription_index: boolean;
  inscriptions: number;
  json_api: boolean;
  lost_sats: number;
  minimum_rune_for_next_block: string;
  rune_index: boolean;
  runes: number;
  sat_index: boolean;
  started: string;
  transaction_index: boolean;
  unrecoverably_reorged: boolean;
  uptime: DurationValue;
}

export interface OrdSat {
  address: string | null;
  block: number;
  charms: string[];
  cycle: number;
  decimal: string;
  degree: string;
  epoch: number;
  inscriptions: string[];
  name: string;
  number: number;
  offset: number;
  percentile: string;
  period: number;
  rarity: string;
  satpoint: string | null;
  timestamp: number;
}

export interface OrdOutput {
  address: string | null;
  confirmations: number;
  indexed: boolean;
  inscriptions: string[] | null;
  outpoint: string;
  runes: Record<string, unknown> | null;
  sat_ranges: Array<[number, number]> | null;
  script_pubkey: string;
  spent: boolean;
  transaction: string;
  value: number;
}
