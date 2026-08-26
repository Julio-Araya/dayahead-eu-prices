/**
 * Crea una API key de lectura y la imprime UNA sola vez. En la base queda solo el hash.
 *   cd api && npm run create-key -- --name "interfaz web" [--limit 120]
 */
import { generateApiKey, hashApiKey, keyPrefix } from "../src/auth/apiKey.js";
import { loadConfig } from "../src/config.js";
import { closePool, getPool } from "../src/db/pool.js";

const args = process.argv.slice(2);
const opt = (flag: string, fallback?: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const name = opt("--name");
const limit = Number(opt("--limit", "120"));
if (!name) {
  console.error('uso: npm run create-key -- --name "<nombre>" [--limit 120]');
  process.exit(2);
}
const cfg = loadConfig();
const key = generateApiKey();
getPool(cfg.databaseUrl)
  .query("INSERT INTO api_keys (name, key_hash, key_prefix, rate_limit_per_minute) VALUES ($1, $2, $3, $4) RETURNING id", [name, hashApiKey(key), keyPrefix(key), limit])
  .then((r) => {
    console.log(`API key creada (id ${r.rows[0].id}, prefijo ${keyPrefix(key)}, ${limit} req/min).`);
    console.log("Guárdala ahora; no se puede recuperar:\n");
    console.log(key);
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
