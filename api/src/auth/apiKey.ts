/**
 * API keys de solo lectura (D3, D19). La clave viaja en `Authorization: Bearer <clave>` o `X-API-Key`.
 * En base de datos solo vive sha256(clave). El prefijo (8 caracteres) sirve para identificarla en logs.
 */
import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "dap_"; // day-ahead prices

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function keyPrefix(key: string): string {
  return key.slice(0, 8);
}

export function extractApiKey(headers: { authorization?: string; "x-api-key"?: string }): string | null {
  const auth = headers.authorization;
  if (auth && /^Bearer\s+\S+$/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const direct = headers["x-api-key"];
  if (direct && direct.trim()) return direct.trim();
  return null;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  scope: "read";
  rateLimitPerMinute: number;
  active: boolean;
}

export interface ApiKeyStore {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  touch(id: string): Promise<void>;
}
