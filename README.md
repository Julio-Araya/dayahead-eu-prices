# Day-Ahead Prices — precios day-ahead de ES, RO, DE y PL

> **Esqueleto para redacción (Fase 6).** Estructura y contenido técnico ordenado; la redacción final la hace Julio. Los bloques marcados `[redactar]` son párrafos que faltan; el resto son datos verificados. Detalle de cada decisión en `docs/decisions.md` (D1–D24) y desarrollo en `docs/technical-doc.md`.

`[redactar: 3-4 líneas: qué es, para quién, y que es la prueba técnica de Grenergy para Data & AI Engineer]`

| Entregable | Dónde |
|---|---|
| Interfaz web | https://dayahead-web.vercel.app |
| API REST | https://dayahead-api.vercel.app (`/v1/health` público; lecturas con API key) |
| ETL en Microsoft Fabric | workspace `Day Ahead Prices - Julio Araya` (Lakehouse `lh_dayahead`, notebook `nb_dayahead_ingest`, pipeline `pl_dayahead_daily`, biblioteca `vl_dayahead`) |
| Servidor MCP | `mcp/` (stdio; instrucciones para Claude Desktop en `mcp/README.md`) |
| Documento técnico | `docs/technical-doc.md` |

## Arquitectura en una vista

```
ENTSO-E (ES, RO)  SMARD (DE)  PSE (PL)  BCE (EUR/PLN)
        │             │          │          │
        └─────────────┴──────────┴──────────┘
                      ▼
   Fabric · notebook PySpark nb_dayahead_ingest (18:00 UTC, ventana [D-3, D+1])
   módulo puro `dayahead` (wheel) ── parseo, forward fill, FX, slots esperados
                      ▼
   Lakehouse lh_dayahead · Delta: prices_es/ro/de/pl · sources_config · load_control · fx_rates
                      │  POST /v1/ingest firmado (HMAC SHA256 + timestamp + nonce)
                      ▼
   Supabase Postgres (eu-west-1) · prices · load_control · countries · api_keys · ingest_nonces
                      ▼
   API Express en Vercel (función en dub1) · API keys con hash · rate limit · resample PT15M→PT60M
        │                       │                      │
   Web React+Vite (BFF)    Servidor MCP (stdio)    Power BI (Direct Lake sobre el Lakehouse)
```

`[redactar: por qué Fabric publica hacia la API en lugar de que la API lea Fabric (D1): la cuenta de prueba no puede registrar aplicaciones en Entra, sin service principal no hay acceso correcto desde un servidor externo; beneficios laterales]`

## Reproducir desde cero

Prerrequisitos: Python ≥ 3.9, Node ≥ 20, cuenta de Fabric con capacidad Trial, proyecto de Supabase, cuenta de Vercel, token de ENTSO-E.

```bash
git clone https://github.com/Julio-Araya/dayahead-eu-prices.git
cd dayahead-eu-prices
cp .env.example .env            # completar: ENTSOE_TOKEN, DATABASE_URL, INGEST_HMAC_SECRET (openssl rand -hex 32), INGEST_API_URL
```

**1. Módulo puro y spike (no necesita nada externo salvo el token para el spike)**

```bash
cd etl && python3 -m pip install pytest build && python3 -m pytest      # 80 tests sobre respuestas reales
cd .. && set -a && source .env && set +a
python3 spike/spike_apis.py                   # opcional: ver las APIs en crudo (guarda en spike/raw, ignorado)
python3 etl/scripts/smoke_live.py             # opcional: flujo completo sin escribir nada
```

**2. Artefactos de Fabric y montaje a mano** (`docs/fabric-setup.md`, ~1 h)

```bash
python3 fabric/build.py                       # genera el .ipynb, comprueba el DDL, construye fabric/dist/dayahead-0.2.0-py3-none-any.whl
```

Luego en el navegador: Lakehouse `lh_dayahead`, biblioteca `vl_dayahead` (`ENTSOE_TOKEN`, y para publicar `INGEST_API_URL` + `INGEST_HMAC_SECRET`), importar el notebook, subir el wheel a Resources, pipeline con `_inlineInstallationEnabled=true`, schedule 18:00 UTC, backfill de 30 días con parámetros.

**3. Capa de servicio y API**

```bash
cd api && npm install
npm run migrate                                  # db/migrations, idempotente (usar el pooler de sesión, puerto 5432)
npm run create-key -- --name web-bff             # imprime la key una vez → WEB_API_KEY en .env
npm run create-key -- --name mcp --limit 60      # → MCP_API_KEY en .env
npm test                                         # 30 tests sin base de datos
PORT=3100 npm run dev                            # http://localhost:3100/v1/health
```

**4. Ingestión real firmada (desde local, sin Fabric)**

```bash
python3 etl/scripts/publish_live.py --api http://localhost:3100     # baja [D-3, D+1], firma y hace POST /v1/ingest
```

**5. Interfaz**

```bash
cd web && npm install && npm test && npm run dev                    # http://localhost:5173, BFF en /api/* con WEB_API_KEY
```

**6. Servidor MCP**

```bash
cd mcp && npm install && npm test && npm run build
DAYAHEAD_API_URL=http://localhost:3100 DAYAHEAD_API_KEY=$MCP_API_KEY npm start   # o configurar Claude Desktop (mcp/README.md)
```

**7. Despliegue** (`docs/deploy-vercel.md`): dos proyectos de Vercel desde el repo, Root Directory `api` y `web`, variables por proyecto; smoke con `curl /v1/health`, una lectura con key y `publish_live.py --api https://…`.

## Estructura del repositorio

```
etl/        módulo puro dayahead (adaptadores, forward fill, FX, slots, firma HMAC) + tests con fixtures reales + scripts
fabric/     notebook fuente y generado, DDL, pipeline de referencia, build.py
db/         migraciones SQL de Supabase
api/        Express + TypeScript: ingestión HMAC, lecturas con API key, lectores postgres / fabric-graphql
web/        React + Vite: BFF, comparativa, paneles, calidad de datos
mcp/        servidor MCP de solo lectura
spike/      spike de Fase 0 y hallazgos
docs/       decisiones, documento técnico, guías (Fabric, Vercel, Power BI, Git)
design/     design system usado por la interfaz (sin marca)
```

## Decisiones relevantes (resumen; desarrollo en `docs/technical-doc.md`)

- **Diseño del pipeline**: configuración por país en tabla, ventana [D-3, D+1] reevaluada en cada corrida, día completo solo si `cargados = esperados` con calendario DST, `pending` no es error, upsert idempotente, módulo puro testeado fuera de Fabric (D4, D7, D10, D13, D16, D17).
- **Diferencias entre APIs**: ENTSO-E mezcla intradiarias con day-ahead y alinea a CET; A03 es forward fill, no hueco; PSE entrega el fin del intervalo; SMARD publica D+1 tarde (D8, D11, D12, spike).
- **PLN → EUR**: tasa BCE con carry forward "última fecha ≤ día", trazada en cada fila (D15).
- **Seguridad**: Fabric publica hacia la API con HMAC; lecturas con API keys con hash y rate limit; la interfaz nunca ve la key (BFF); secretos fuera del repo, incluido el PDF de la prueba (D1, D3, D14, D18, D19, D23).
- **Escalabilidad**: agregar un país es una fila; lector detrás de una interfaz con dos adaptadores; resample en el servicio; Spark solo como escritor (D7, D9, D17, D20).
- **Infraestructura**: Fabric North Europe, Supabase eu-west-1, función en dub1; pooler IPv4; latencia medida antes y después (sección de infraestructura en `decisions.md`).

## Estado y límites conocidos

`[redactar desde docs/technical-doc.md § 9: rate limit por instancia, caché de keys 60 s, Git de Fabric no conectado, agente de datos no hecho, cobertura de fixtures]`

## Documentación

- `docs/technical-doc.md` — documento técnico (secciones que pide la prueba)
- `docs/decisions.md` — registro de decisiones D7–D24 con contexto y alternativas
- `docs/fabric-setup.md`, `docs/deploy-vercel.md`, `docs/fabric-powerbi.md`, `docs/fabric-git.md`
- `spike/findings-2026-08-26.md` — lo que dijeron las APIs de verdad
