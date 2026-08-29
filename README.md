# Day-Ahead Prices

Precios day-ahead de España, Rumania, Alemania y Polonia, cargados todos los días desde sus APIs oficiales a Microsoft Fabric, y expuestos por una API REST, una interfaz web y un servidor MCP.

Es mi entrega para la prueba técnica de Data & AI Engineer de Grenergy. Está escrita pensando en que alguien del equipo de Digital la pueda levantar, mantener y extender sin hablar conmigo. Si algo no queda claro, avísame.

| Entregable | Dónde |
|---|---|
| Interfaz web | https://dayahead-web.vercel.app |
| API REST | https://dayahead-api.vercel.app (`/v1/health` es público, las lecturas van con API key) |
| ETL en Microsoft Fabric | workspace `Day Ahead Prices - Julio Araya` (Lakehouse `lh_dayahead`, notebook `nb_dayahead_ingest`, pipeline `pl_dayahead_daily`, biblioteca `vl_dayahead`, modelo `sm_dayahead_prices`, reporte `rpt_dayahead_prices`) |
| Servidor MCP | `mcp/` (stdio, instrucciones para Claude Desktop en `mcp/README.md`) |
| Documento técnico | `docs/technical-doc.md` |

## Cómo está armado

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

Fabric es la fuente de verdad. Ahí corre el pipeline, ahí viven las tablas por país y ahí lee Power BI. La API y la interfaz no leen Fabric directo, leen una base Postgres propia que Fabric alimenta al final de cada corrida.

Esa decisión tiene una razón concreta. La cuenta de prueba no puede registrar aplicaciones en Entra (los portales de Azure exigen MFA y la instrucción de la prueba era no registrar teléfono). Sin registro de aplicación no hay service principal, y sin service principal un servidor externo no tiene forma correcta de autenticarse contra Fabric. La alternativa de poner usuario y contraseña en un servidor la descarté. Entonces invertí la dirección. Fabric publica hacia la API con una firma HMAC y la API sirve desde Postgres.

De paso salieron dos cosas buenas. La API sigue respondiendo aunque Fabric esté caído o la capacidad Trial expire, y el Lakehouse no recibe tráfico de aplicación. Si mañana existe un service principal, el lector de la API tiene un segundo adaptador (`fabric-graphql`) que se activa con una variable de entorno. El detalle está en `docs/decisions.md`, decisión D1.

## Reproducir desde cero

Prerrequisitos. Python 3.9 o superior, Node 20 o superior, una cuenta de Fabric con capacidad Trial, un proyecto de Supabase, una cuenta de Vercel y un token de ENTSO-E (se pide en transparency.entsoe.eu).

```bash
git clone https://github.com/Julio-Araya/dayahead-eu-prices.git
cd dayahead-eu-prices
cp .env.example .env
# completar: ENTSOE_TOKEN, DATABASE_URL, INGEST_HMAC_SECRET (openssl rand -hex 32), INGEST_API_URL
```

**1. Módulo puro y spike.** No necesita nada externo salvo el token para el spike.

```bash
cd etl && python3 -m pip install pytest build && python3 -m pytest      # 80 tests sobre respuestas reales
cd .. && set -a && source .env && set +a
python3 spike/spike_apis.py                   # opcional: ver las APIs en crudo (guarda en spike/raw, ignorado por git)
python3 etl/scripts/smoke_live.py             # opcional: flujo completo sin escribir nada
```

**2. Artefactos de Fabric y montaje a mano.** Guía en `docs/fabric-setup.md`, toma cerca de una hora.

```bash
python3 fabric/build.py                       # genera el .ipynb, comprueba el DDL y construye fabric/dist/dayahead-0.2.0-py3-none-any.whl
```

Después en el navegador. Lakehouse `lh_dayahead`, biblioteca `vl_dayahead` con `ENTSOE_TOKEN` (para publicar se agregan `INGEST_API_URL` e `INGEST_HMAC_SECRET`), importar el notebook, subir el wheel a Resources, pipeline con `_inlineInstallationEnabled=true` y schedule a las 18:00 UTC, backfill de 30 días pasando parámetros.

**3. Capa de servicio y API.**

```bash
cd api && npm install
npm run migrate                                  # db/migrations, idempotente (usar el pooler de sesión, puerto 5432)
npm run create-key -- --name web-bff             # imprime la key una vez, va a WEB_API_KEY en .env
npm run create-key -- --name mcp --limit 60      # va a MCP_API_KEY en .env
npm test                                         # 30 tests sin base de datos
PORT=3100 npm run dev                            # http://localhost:3100/v1/health
```

**4. Ingestión real firmada desde local, sin Fabric.**

```bash
python3 etl/scripts/publish_live.py --api http://localhost:3100     # baja [D-3, D+1], firma y hace POST /v1/ingest
```

**5. Interfaz.**

```bash
cd web && npm install && npm test && npm run dev                    # http://localhost:5173, BFF en /api/* con WEB_API_KEY
```

**6. Servidor MCP.**

```bash
cd mcp && npm install && npm test && npm run build
DAYAHEAD_API_URL=http://localhost:3100 DAYAHEAD_API_KEY=$MCP_API_KEY npm start   # o configurar Claude Desktop (mcp/README.md)
```

**7. Despliegue.** Guía en `docs/deploy-vercel.md`. Dos proyectos de Vercel desde este repo, Root Directory `api` y `web`, variables por proyecto. Smoke con `curl /v1/health`, una lectura con key y `publish_live.py --api https://…`.

## Estructura del repositorio

```
etl/        módulo puro dayahead (adaptadores, forward fill, FX, slots, firma HMAC), tests con fixtures reales, scripts
fabric/     notebook fuente y generado, DDL, pipeline de referencia, build.py
db/         migraciones SQL de Supabase
api/        Express + TypeScript: ingestión HMAC, lecturas con API key, lectores postgres y fabric-graphql
web/        React + Vite: BFF, comparativa, paneles por país, calidad de datos
mcp/        servidor MCP de solo lectura
spike/      spike de Fase 0 y hallazgos
docs/       decisiones, documento técnico, guías (Fabric, Vercel, Power BI, Git)
design/     design system usado por la interfaz (sin marca)
```

## Decisiones importantes

El detalle completo de cada una, con las alternativas que descarté, está en `docs/technical-doc.md` y en `docs/decisions.md`. Acá el resumen.

**Diseño del pipeline.** La configuración de cada país es una fila en una tabla, no código. Cada corrida reevalúa la ventana [D-3, D+1] entera con upsert, así que repetir un día no duplica nada y las correcciones tardías de las fuentes entran solas. Un día se marca completo solo cuando los slots cargados igualan los esperados para su resolución y su calendario de cambio de hora. Si una fuente todavía no publicó, el día queda pendiente, no en error. Toda la lógica de parseo vive en un módulo Python que se testea con pytest fuera de Fabric; el notebook solo orquesta y escribe.

**Diferencias entre APIs.** Las cuatro tienen rarezas que solo aparecen con datos reales, así que antes de diseñar corrí un spike contra cada una (`spike/findings-2026-08-26.md`). Las que más importaron: ENTSO-E mezcla subastas intradiarias con el day-ahead en el mismo documento, alinea el día al horario CET también para Rumania, y omite posiciones cuando el precio se repite (eso es forward fill, no un hueco). PSE entrega el fin del intervalo, no el inicio. SMARD publica el día siguiente tarde, por eso la corrida va a las 18:00 UTC.

**PLN a EUR.** Tasa de referencia del BCE con carry forward a la última fecha publicada (fines de semana, feriados TARGET y el mismo día antes de las 16:15 CET). Cada fila guarda el precio original, la moneda, el precio en EUR, la tasa y la fecha de la tasa. Nada se convierte sin dejar rastro.

**Seguridad.** Fabric publica hacia la API con HMAC SHA256 más timestamp y nonce, con vectores de prueba compartidos entre Python y TypeScript para que las dos firmas no puedan divergir sin que falle un test. Las lecturas van con API keys guardadas como hash, con alcance de solo lectura y rate limit por key. La interfaz nunca ve la key, va por un BFF en su mismo dominio. Los secretos no están en el repo. Viven en variables de entorno, en Vercel y en la Biblioteca de variables de Fabric. El PDF de la prueba traía el token en texto plano, así que la copia versionada está redactada. El repositorio se publica para facilitar la revisión; no contiene ningún secreto.

**Escalabilidad.** Agregar un país es insertar una fila en `sources_config`, el notebook crea la tabla. Agregar una fuente es un adaptador nuevo con la misma forma que los otros cuatro. Con más volumen o más consumidores lo primero que cambiaría es el rate limit (hoy en memoria por instancia) y el particionado de `prices`. Para 4 países y 96 filas por día, Spark solo escribe Delta y no computa nada, y está documentado como decisión.

**Infraestructura.** Todo en Europa. Fabric en North Europe, Supabase en eu-west-1 y la función de Vercel fijada en Dublín, con el edge cerca del cliente. La conexión directa de Supabase es solo IPv6, por eso la API usa el pooler. La latencia de punta a punta bajó de unos 6 segundos en frío a alrededor de un segundo después de fijar la región y cachear la validación de keys.

## Estado y límites

Funcionando en producción desde el 26 de agosto. El pipeline corrió solo por primera vez el 27 de agosto a las 18:00 UTC y terminó en verde. La web muestra más de 30 días de las cuatro fuentes con cobertura al 100%.

Lo que sé que falta o que dejé en un punto intermedio:

1. Rate limit en memoria por instancia serverless, y caché de keys de 60 segundos (revocar una key tarda hasta un minuto en verse). Para esta escala sobra; con más instancias iría a Postgres o Redis.
2. Git de Fabric no está conectado. La integración versiona la Biblioteca de variables con sus valores, o sea el token y el secreto HMAC, y además depende de un switch del tenant que la cuenta de prueba no controla. Está documentado en `docs/fabric-git.md` cómo se haría cuando los secretos vivan en Key Vault.
3. El adaptador `fabric-graphql` está implementado pero sin probar contra un endpoint real, porque requiere el service principal que no pude crear.
4. Un backfill anterior a octubre de 2025 marcaría España y Rumania como incompletos, porque ENTSO-E era horario y hoy los esperados son 96. Falta vigencia por fecha en la resolución de `sources_config`.
5. La interfaz muestra horas en UTC. Un selector de zona de mercado queda como evolución.
6. El agente de datos de Fabric no lo hice.

## Cómo se hizo

El código lo escribieron agentes de Claude Code. Yo definí el problema, corrí el spike, tomé cada decisión de arquitectura y alcance, revisé cada PR y monté Fabric a mano. El proceso está en `CLAUDE.md` y `BRIEF.md` en la raíz, que son las reglas y el brief con que trabajaron los agentes. Lo digo porque creo que es parte de lo que se evalúa, y porque es como trabajo hoy.

## Documentación

- `docs/technical-doc.md`, el documento técnico ordenado según las secciones que pide la prueba
- `docs/decisions.md`, registro de decisiones con contexto y alternativas
- `docs/fabric-setup.md`, `docs/deploy-vercel.md`, `docs/fabric-powerbi.md`, `docs/fabric-git.md`
- `spike/findings-2026-08-26.md`, lo que dijeron las APIs de verdad

Julio Araya Palacios. Agosto 2026.
