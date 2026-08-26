import pg from "pg";

const { Pool, types } = pg;

// numeric y timestamptz llegan como texto: sin pérdida de precisión y sin zonas ambiguas.
types.setTypeParser(1700, (v: string) => v); // numeric
types.setTypeParser(1184, (v: string) => new Date(v).toISOString()); // timestamptz -> ISO UTC
types.setTypeParser(1082, (v: string) => v); // date -> YYYY-MM-DD

let pool: pg.Pool | null = null;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5, // serverless: pocas conexiones por instancia; Supabase recomienda el pooler (puerto 6543)
      idleTimeoutMillis: 10_000,
      ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
