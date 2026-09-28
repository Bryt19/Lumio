import "server-only";

import { Horizon, Keypair } from "@stellar/stellar-sdk";

export type StellarNetwork = "testnet" | "mainnet";

export const STELLAR_NETWORK: StellarNetwork =
  process.env.STELLAR_NETWORK === "mainnet"
    ? "mainnet"
    : "testnet";

export const STELLAR_HOST =
  process.env.STELLAR_HOST ??
  (STELLAR_NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

export const STELLAR_NETWORK_NAME =
  STELLAR_NETWORK === "mainnet" ? "Mainnet" : "Testnet";

export const STELLAR_EXPLORER_URL =
  STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

export const horizon = new Horizon.Server(STELLAR_HOST);

const TIMEOUT_MS = 15_000;

/**
 * The JSON shape returned by Horizon endpoints.
 */
export type Json = Record<string, unknown>;

/**
 * Fetch a Horizon endpoint using the native fetch adapter instead of the
 * SDK's internal HTTP client. Under Next server runtimes the SDK's fetch
 * can fail with "fetch failed", so we perform the request ourselves with
 * an explicit timeout and a clear error message.
 */
export async function fetchHorizon(
  path: string,
  init?: RequestInit
): Promise<Json> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${STELLAR_HOST}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      let body = "";

      try {
        body = await response.text();
      } catch {
        // Ignore body read errors.
      }

      const message =
        body || `Horizon request failed with status ${response.status}`;

      throw new Error(`Horizon ${response.status}: ${message}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json") && !contentType.includes("application/hal+json")) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    const data = (await response.json()) as Json;

    // Horizon returns HAL+JSON with records nested under _embedded.<resource>.
    // Unwrap so callers always see a top-level `records` array.
    if (data._embedded && typeof data._embedded === "object") {
      const embedded = data._embedded as Record<string, unknown>;
      for (const key of Object.keys(embedded) as (keyof Json)[]) {
        if (!Array.isArray(data[key]) && Array.isArray(embedded[key])) {
          data[key] = embedded[key] as Json[keyof Json];
        }
      }
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export type HorizonLedger = Json & {
  sequence: number;
  base_reserve_in_stroops: number;
  base_fee_in_stroops: number;
};

export type HorizonAccount = Json & {
  account_id: string;
  balances: Array<Json & { asset_type: string }>;
  subentry_count: number;
};

export async function getLatestLedger() {
  const data = await fetchHorizon("/ledgers?order=desc&limit=1");
  const records = (data.records ?? []) as Array<Json>;

  return records[0] as HorizonLedger | undefined;
}

export async function getAccount(publicKey: string) {
  return fetchHorizon(
    `/accounts/${encodeURIComponent(publicKey)}`
  ) as Promise<HorizonAccount>;
}

export async function getNetworkFee(): Promise<number | undefined> {
  const ledger = await getLatestLedger();

  return ledger?.base_fee_in_stroops as number | undefined;
}

export function getLumioKeypair() {
  const secretKey = process.env.STELLAR_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STELLAR_SECRET_KEY is not configured");
  }

  return Keypair.fromSecret(secretKey);
}

export function getLumioPublicKey() {
  const publicKey = process.env.STELLAR_PUBLIC_KEY;

  if (!publicKey) {
    throw new Error("STELLAR_PUBLIC_KEY is not configured");
  }

  return publicKey;
}