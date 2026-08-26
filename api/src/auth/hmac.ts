/**
 * Firma HMAC del endpoint de ingestión (D18). Espejo exacto de etl/dayahead/publish.py.
 *
 *   mensaje = `${timestamp}.${nonce}.` + cuerpo (bytes tal como llegaron)
 *   firma   = HMAC-SHA256(secreto, mensaje) en hex minúscula, cabecera X-Signature: "sha256=<hex>"
 *
 * Además del secreto: ventana de timestamp (anti-replay grueso) y nonce único (anti-replay fino).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_PREFIX = "sha256=";

export function sign(secret: string, timestamp: number, nonce: string, body: Buffer): string {
  const h = createHmac("sha256", secret);
  h.update(`${timestamp}.${nonce}.`);
  h.update(body);
  return h.digest("hex");
}

export type HmacFailure = "missing_headers" | "bad_timestamp" | "skew" | "bad_signature";

export interface HmacCheck {
  ok: boolean;
  reason?: HmacFailure;
  timestamp?: number;
  nonce?: string;
}

export function verifySignature(opts: {
  secret: string;
  body: Buffer;
  timestampHeader: string | undefined;
  nonceHeader: string | undefined;
  signatureHeader: string | undefined;
  now?: number;
  maxSkewSeconds?: number;
}): HmacCheck {
  const { secret, body, timestampHeader, nonceHeader, signatureHeader } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const maxSkew = opts.maxSkewSeconds ?? 300;
  if (!timestampHeader || !nonceHeader || !signatureHeader) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestampHeader)) return { ok: false, reason: "bad_timestamp" };
  const timestamp = Number(timestampHeader);
  if (Math.abs(now - timestamp) > maxSkew) return { ok: false, reason: "skew", timestamp, nonce: nonceHeader };
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return { ok: false, reason: "bad_signature", timestamp, nonce: nonceHeader };
  const expected = Buffer.from(sign(secret, timestamp, nonceHeader, body), "utf8");
  const given = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature", timestamp, nonce: nonceHeader };
  }
  return { ok: true, timestamp, nonce: nonceHeader };
}
