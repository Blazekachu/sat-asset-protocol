const DEFAULT_ORD_BASE_URL = "http://127.0.0.1:8080";
const ORD_BASE_URL_ENV = "SAT_ASSET_ORD_BASE_URL";
const QUORUM_NODE_URLS_ENV = "SAT_ASSET_QUORUM_NODE_URLS";

const MIN_RELAY_FEE_SAT_PER_VB_ENV = "SAT_ASSET_MIN_RELAY_FEE_SAT_PER_VB";
const BARE_SAT_POSTAGE_SATS_ENV = "SAT_ASSET_BARE_SAT_POSTAGE_SATS";
const INSCRIBED_POSTAGE_SATS_ENV = "SAT_ASSET_INSCRIBED_POSTAGE_SATS";
const BUMP_SIZE_SATS_ENV = "SAT_ASSET_BUMP_SIZE_SATS";

const DEFAULT_MIN_RELAY_FEE_SAT_PER_VB = 3;
const DEFAULT_BARE_SAT_POSTAGE_SATS = 546;
const DEFAULT_INSCRIBED_POSTAGE_SATS = 330;
const DEFAULT_BUMP_SIZE_SATS = 600;

export interface ProtocolConfig {
  ordBaseUrl: URL;
  quorumNodeUrls: URL[];
  minRelayFeeSatPerVb: number;
  bareSatPostageSats: number;
  inscribedPostageSats: number;
  bumpSizeSats: number;
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  label: string,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const trimmed = rawValue.trim();
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }

  return parsed;
}

function parseQuorumNodeUrls(
  rawQuorumNodeUrls: string | undefined,
  fallbackOrdBaseUrl: URL,
): URL[] {
  if (!rawQuorumNodeUrls || rawQuorumNodeUrls.trim() === "") {
    return [fallbackOrdBaseUrl];
  }

  return rawQuorumNodeUrls
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry, index) => parseUrl(entry, `${QUORUM_NODE_URLS_ENV}[${index}]`));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProtocolConfig {
  const ordBaseUrl = parseUrl(env[ORD_BASE_URL_ENV] ?? DEFAULT_ORD_BASE_URL, ORD_BASE_URL_ENV);
  const quorumNodeUrls = parseQuorumNodeUrls(env[QUORUM_NODE_URLS_ENV], ordBaseUrl);

  const minRelayFeeSatPerVb = parsePositiveInteger(
    env[MIN_RELAY_FEE_SAT_PER_VB_ENV],
    DEFAULT_MIN_RELAY_FEE_SAT_PER_VB,
    MIN_RELAY_FEE_SAT_PER_VB_ENV,
  );
  const bareSatPostageSats = parsePositiveInteger(
    env[BARE_SAT_POSTAGE_SATS_ENV],
    DEFAULT_BARE_SAT_POSTAGE_SATS,
    BARE_SAT_POSTAGE_SATS_ENV,
  );
  const inscribedPostageSats = parsePositiveInteger(
    env[INSCRIBED_POSTAGE_SATS_ENV],
    DEFAULT_INSCRIBED_POSTAGE_SATS,
    INSCRIBED_POSTAGE_SATS_ENV,
  );
  const bumpSizeSats = parsePositiveInteger(
    env[BUMP_SIZE_SATS_ENV],
    DEFAULT_BUMP_SIZE_SATS,
    BUMP_SIZE_SATS_ENV,
  );

  return {
    ordBaseUrl,
    quorumNodeUrls,
    minRelayFeeSatPerVb,
    bareSatPostageSats,
    inscribedPostageSats,
    bumpSizeSats,
  };
}

export const configEnv = {
  defaultOrdBaseUrl: DEFAULT_ORD_BASE_URL,
  ordBaseUrlEnv: ORD_BASE_URL_ENV,
  quorumNodeUrlsEnv: QUORUM_NODE_URLS_ENV,
  minRelayFeeSatPerVbEnv: MIN_RELAY_FEE_SAT_PER_VB_ENV,
  bareSatPostageSatsEnv: BARE_SAT_POSTAGE_SATS_ENV,
  inscribedPostageSatsEnv: INSCRIBED_POSTAGE_SATS_ENV,
  bumpSizeSatsEnv: BUMP_SIZE_SATS_ENV,
  defaultMinRelayFeeSatPerVb: DEFAULT_MIN_RELAY_FEE_SAT_PER_VB,
  defaultBareSatPostageSats: DEFAULT_BARE_SAT_POSTAGE_SATS,
  defaultInscribedPostageSats: DEFAULT_INSCRIBED_POSTAGE_SATS,
  defaultBumpSizeSats: DEFAULT_BUMP_SIZE_SATS,
};
