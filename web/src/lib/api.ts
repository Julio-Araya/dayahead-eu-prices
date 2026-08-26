import type { CountryRow, Granularity, LoadControlRow, PriceRow, Remote, StatusRow } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "no se pudo contactar al servidor");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export interface PricesQuery {
  countries: string[];
  from: string;
  to: string;
  granularity: Granularity;
}

export function pricesPath(q: PricesQuery): string {
  const p = new URLSearchParams({ countries: q.countries.join(","), from: q.from, to: q.to, granularity: q.granularity });
  return `prices?${p.toString()}`;
}

export const api = {
  countries: (signal?: AbortSignal) => getJson<{ count: number; rows: CountryRow[] }>("countries", signal),
  prices: (q: PricesQuery, signal?: AbortSignal) => getJson<{ count: number; rows: PriceRow[] }>(pricesPath(q), signal),
  status: (signal?: AbortSignal) => getJson<{ reader: string; generated_at: string; rows: StatusRow[] }>("status", signal),
  loadControl: (q: Omit<PricesQuery, "granularity">, signal?: AbortSignal) =>
    getJson<{ count: number; rows: LoadControlRow[] }>(`load-control?${new URLSearchParams({ countries: q.countries.join(","), from: q.from, to: q.to })}`, signal),
};

/** Traduce una excepción al estado remoto correspondiente. */
export function toRemoteError<T>(prev: Remote<T>, e: unknown): Remote<T> {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { status: "forbidden", data: prev.data, error: e.message };
  return { status: "error", data: prev.data, error: e instanceof Error ? e.message : String(e) };
}
