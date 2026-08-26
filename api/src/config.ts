import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .env vive en la raíz del repo (compartido con etl/ y fabric/), no en api/.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, "../../.env") });
loadDotenv(); // y, si existe, el del directorio actual (no sobreescribe)

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`falta la variable de entorno ${name}`);
  }
  return value;
}

export type DataReaderKind = "postgres" | "fabric-graphql";

export interface Config {
  port: number;
  databaseUrl: string;
  ingestHmacSecret: string;
  ingestMaxSkewSeconds: number;
  dataReader: DataReaderKind;
  defaultRateLimitPerMinute: number;
  corsOrigin: string | null;
  fabric: { endpoint: string | null; tenantId: string | null; clientId: string | null; clientSecret: string | null };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const reader = (env.DATA_READER ?? "postgres") as DataReaderKind;
  if (reader !== "postgres" && reader !== "fabric-graphql") {
    throw new Error(`DATA_READER inválido: ${reader} (postgres | fabric-graphql)`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "",
    ingestHmacSecret: env.INGEST_HMAC_SECRET ?? "",
    ingestMaxSkewSeconds: Number(env.INGEST_MAX_SKEW_SECONDS ?? 300),
    dataReader: reader,
    defaultRateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    corsOrigin: env.CORS_ORIGIN ?? null,
    fabric: {
      endpoint: env.FABRIC_GRAPHQL_ENDPOINT ?? null,
      tenantId: env.FABRIC_TENANT_ID ?? null,
      clientId: env.FABRIC_CLIENT_ID ?? null,
      clientSecret: env.FABRIC_CLIENT_SECRET ?? null,
    },
  };
}

export { required };
