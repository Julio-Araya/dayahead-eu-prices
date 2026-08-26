import type { Config } from "../config.js";
import { getPool } from "../db/pool.js";
import { FabricGraphqlPriceReader } from "./fabricGraphql.js";
import { PostgresPriceReader } from "./postgres.js";
import type { PriceReader } from "./types.js";

export function createReader(cfg: Config): PriceReader {
  if (cfg.dataReader === "fabric-graphql") return new FabricGraphqlPriceReader(cfg.fabric);
  if (!cfg.databaseUrl) throw new Error("DATA_READER=postgres requiere DATABASE_URL");
  return new PostgresPriceReader(getPool(cfg.databaseUrl));
}
