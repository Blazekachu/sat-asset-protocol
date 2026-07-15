const DEFAULT_ORD_BASE_URL = "http://127.0.0.1:8080";
const ORD_BASE_URL_ENV = "SAT_ASSET_ORD_BASE_URL";
const QUORUM_NODE_URLS_ENV = "SAT_ASSET_QUORUM_NODE_URLS";

export interface ProtocolConfig {
  ordBaseUrl: URL;
  quorumNodeUrls: URL[];
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
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

  return {
    ordBaseUrl,
    quorumNodeUrls,
  };
}

export const configEnv = {
  defaultOrdBaseUrl: DEFAULT_ORD_BASE_URL,
  ordBaseUrlEnv: ORD_BASE_URL_ENV,
  quorumNodeUrlsEnv: QUORUM_NODE_URLS_ENV,
};
