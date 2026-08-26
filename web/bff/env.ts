/** Lee el .env de la raíz del repo (compartido con api/ y etl/) sin dependencias. Solo para desarrollo local. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function readRootEnv(startDir: string): Record<string, string> {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return parseEnv(readFileSync(candidate, "utf8"));
    dir = path.dirname(dir);
  }
  return {};
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
