# Despliegue en Vercel

Dos proyectos desde el mismo repositorio (`Julio-Araya/dayahead-eu-prices`), cada uno con su **Root Directory**. Los secretos nunca van al repo: se cargan en **Settings → Environment Variables** de cada proyecto, para los entornos Production y Preview.

## Proyecto 1: `dayahead-api` (Root Directory = `api`)

- Framework Preset: **Other**. Build Command y Output Directory: por defecto (`npm run build` compila con `tsc`; la función es `api/index.ts` y `vercel.json` reenvía toda ruta a ella). Node 20 o superior.
- Región de la función: `vercel.json` fija `dub1` (Dublín, la misma región `eu-west-1` de Supabase). Sin eso Vercel la ponía en `gru1` (São Paulo) y cada consulta pagaba ~250 ms de ida y vuelta al pooler; con la región junto a la base son unos milisegundos.

| Variable | Valor | De dónde sale |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.<ref>:<pwd>@aws-1-eu-west-1.pooler.supabase.com:6543/postgres` | `DATABASE_URL_POOLER_TRANSACTION` del `.env` local (pooler en modo **transaction**, puerto 6543; la directa es solo IPv6 y la de sesión 5432 se reserva para migraciones) |
| `INGEST_HMAC_SECRET` | el secreto compartido | `INGEST_HMAC_SECRET` del `.env` local; el mismo valor va en `vl_dayahead.INGEST_HMAC_SECRET` en Fabric |
| `DATA_READER` | `postgres` | fijo |
| `INGEST_MAX_SKEW_SECONDS` | `300` | opcional (default 300) |
| `RATE_LIMIT_PER_MINUTE` | `120` | opcional (default 120; cada key tiene además el suyo en `api_keys`) |
| `CORS_ORIGIN` | vacío / no definir | la interfaz va por su BFF, no necesita CORS |

No definir `PORT` (lo pone Vercel). Las migraciones no se corren desde Vercel: ya están aplicadas con `npm run migrate` desde local (session pooler).

## Proyecto 2: `dayahead-web` (Root Directory = `web`)

- Framework Preset: **Vite** (lo detecta solo). Build `npm run build`, Output `dist`. La función serverless del BFF es `web/api/[...path].ts`.

| Variable | Valor | De dónde sale |
|---|---|---|
| `WEB_API_BASE_URL` | `https://<dominio-del-proyecto-api>.vercel.app` | la URL de producción del proyecto 1, sin barra final |
| `WEB_API_KEY` | `dap_…` | `WEB_API_KEY` del `.env` local (key `web-bff` creada con `npm run create-key`) |

## Fabric (Biblioteca de variables `vl_dayahead`)

| Variable | Valor |
|---|---|
| `INGEST_API_URL` | la misma URL del proyecto 1 |
| `INGEST_HMAC_SECRET` | el mismo secreto que en el proyecto 1 |

Con esas dos, `publish_to_api=True` en el notebook publica cada corrida hacia la API.

## Smoke tras desplegar

Desde la raíz del repo, con `INGEST_API_URL` apuntando a la URL real:

```
curl -s https://<api>.vercel.app/v1/health
curl -s -H "X-API-Key: $WEB_API_KEY" "https://<api>.vercel.app/v1/prices?countries=ES,PL&from=<ayer>&to=<ayer>&granularity=hourly" | head -c 400
set -a; source .env; set +a
python3 etl/scripts/publish_live.py --api https://<api>.vercel.app      # POST /v1/ingest firmado
```

Esperado: `{"ok":true,"reader":"postgres",…}`; 200 con filas; `HTTP 200 {"ok":true,…,"prices_upserted":…}`. Después, abrir `https://<web>.vercel.app` y comprobar que la comparativa carga (el BFF usa la key del proyecto 2).

## Límites conocidos

- Rate limit por key en memoria de cada instancia serverless (D19).
- `pg` con pooler en modo transaction: sin sentencias preparadas con nombre (la API no las usa) y `pool.max = 5` por instancia.
