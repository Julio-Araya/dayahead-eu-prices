# api — API REST de precios day-ahead

Express + TypeScript. Lee de Supabase Postgres (lector `postgres`, activo) o del Lakehouse vía Fabric API for GraphQL (lector `fabric-graphql`, implementado sin credenciales). Recibe las filas desde Fabric por un endpoint de ingestión firmado con HMAC. Desplegable en Vercel.

## Endpoints

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| GET | `/v1/health` | ninguna | `ok`, lector activo, ping a la base |
| POST | `/v1/ingest` | HMAC (D18) | upsert de `prices` y `load_control`; anti-replay por timestamp y nonce |
| GET | `/v1/countries` | API key | catálogo de mercados |
| GET | `/v1/prices?countries=ES,PL&from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=native\|hourly` | API key | precios; `hourly` promedia PT15M a PT60M (D5); siempre `price_eur` y `price_original` + `currency_original` (D6) |
| GET | `/v1/load-control?countries=&from=&to=` | API key | estado de carga por país y día (calidad de datos) |
| GET | `/v1/status` | API key | por país: último día completo, último intento, `stale` (> 26 h sin intento) |

Errores siempre como `{ "error": { "code", "message", "details?" } }`. Lecturas con cabeceras `X-RateLimit-Limit/Remaining/Reset` y `429` + `Retry-After` al exceder el límite por key.

API key: `Authorization: Bearer <key>` o `X-API-Key: <key>`. En base de datos vive solo `sha256(key)` (D19).

## Firma de la ingestión

```
X-Timestamp: <segundos Unix>
X-Nonce:     <UUID>
X-Signature: sha256=HMAC_SHA256(secreto, "<timestamp>.<nonce>." + cuerpo)
```

El cuerpo se firma byte a byte tal como se envía. Ventana ±300 s; un nonce solo se acepta una vez. Implementación de referencia y vectores de prueba compartidos con Python en `etl/dayahead/publish.py` y `etl/tests/fixtures/hmac_vectors.json`.

## Correr en local

```
cd api
npm install
cp ../.env.example ../.env        # completar DATABASE_URL e INGEST_HMAC_SECRET
npm run migrate                   # aplica db/migrations en orden
npm run create-key -- --name "interfaz web"   # imprime la key una sola vez
npm run dev                       # http://localhost:3000
npm test
```

Prueba manual de lectura:

```
curl -H "X-API-Key: dap_..." "http://localhost:3000/v1/prices?countries=PL&from=2026-08-25&to=2026-08-25&granularity=hourly"
```

## Desplegar en Vercel

Proyecto con **Root Directory** = `api`. `vercel.json` reescribe todo a `api/index.ts`, que exporta la app de Express. Variables de entorno: `DATABASE_URL` (pooler de Supabase, puerto 6543), `INGEST_HMAC_SECRET`, `DATA_READER=postgres`. Opcionales: `RATE_LIMIT_PER_MINUTE`, `CORS_ORIGIN`.

Límite conocido: el rate limit vive en memoria de cada instancia serverless (D19).

## Estructura

```
src/
  app.ts            ensamblado de Express (health, ingest, lecturas, errores)
  wiring.ts         dependencias reales (pool, lector, writer, store de keys)
  server.ts         arranque local; api/index.ts es la entrada en Vercel
  config.ts         variables de entorno
  auth/hmac.ts      firma y verificación (espejo de etl/dayahead/publish.py)
  auth/apiKey.ts    generación, hash y extracción de keys
  auth/rateLimit.ts ventana fija por key
  ingest/writer.ts  validación (zod) y upsert transaccional con nonce
  readers/          interfaz PriceReader; postgres.ts (activo) y fabricGraphql.ts (alternativo)
  services/         validación de consultas y resample PT15M -> PT60M
  routes/           ingest, lecturas, middleware de key y errores
  db/               pool de pg y runner de migraciones
scripts/create-api-key.ts
test/               vitest + supertest, sin base de datos (lectores y writer falsos)
```
