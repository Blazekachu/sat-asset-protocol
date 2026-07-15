import type { OrdOutput, OrdSat, OrdStatus } from "./types.ts";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`ord request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export class OrdClient {
  readonly #baseUrl: URL;
  readonly #fetchImpl: typeof fetch;

  constructor(baseUrl: URL | string, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = new URL(baseUrl);
    this.#fetchImpl = fetchImpl;
  }

  async status(): Promise<OrdStatus> {
    return this.#getJson<OrdStatus>("status");
  }

  async sat(number: number | bigint): Promise<OrdSat> {
    return this.#getJson<OrdSat>(`sat/${number.toString()}`);
  }

  async output(outpoint: string): Promise<OrdOutput> {
    return this.#getJson<OrdOutput>(`output/${outpoint}`);
  }

  async #getJson<T>(path: string): Promise<T> {
    const response = await this.#fetchImpl(new URL(path, this.#baseUrl), {
      headers: {
        accept: "application/json",
      },
    });

    return parseJsonResponse<T>(response);
  }
}
