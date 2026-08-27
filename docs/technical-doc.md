# Documento técnico — esqueleto con contenido

> Estructura y contenido ordenado para la redacción final (Fase 6). Cada punto remite a la decisión (`docs/decisions.md`) o al archivo donde está la evidencia. `[redactar]` marca transiciones o párrafos que faltan; el resto son hechos verificados.

## 0. Resumen ejecutivo

`[redactar: 6-8 líneas]` Ideas a incluir: cuatro fuentes con formatos, monedas y granularidades distintas convergen en un esquema único por país en Fabric; la API y la interfaz leen de una capa de servicio propia que Fabric alimenta; todo lo que tiene lógica está testeado contra respuestas reales (80 + 30 + 19 + 8 tests); cada decisión no obvia está registrada con sus alternativas.

## 1. Diseño del pipeline (Fabric)

### 1.1 Piezas y flujo
- Lakehouse `lh_dayahead`: `prices_es`, `prices_ro`, `prices_de`, `prices_pl` (mismo esquema), `sources_config`, `load_control`, `fx_rates`; opcional `prices_all` (gold, D24). DDL comentado columna a columna en `fabric/sql/01_create_tables.sql`.
- Notebook PySpark `nb_dayahead_ingest`: instala el módulo puro `dayahead` desde un wheel en su carpeta Resources (D16), lee el token de la biblioteca `vl_dayahead`, crea tablas si faltan, procesa la ventana por país, hace `MERGE` por `(country_code, ts_utc)` (D17: Spark solo escribe), evalúa cada día **leyendo la tabla** tras el merge, actualiza `load_control`, y con `publish_to_api=True` publica hacia la API firmando con HMAC (D18).
- Pipeline `pl_dayahead_daily`: actividad Notebook con `_inlineInstallationEnabled=true`, parámetros `start_date`, `end_date`, `countries` para backfill, schedule diario 18:00 UTC.
- `[redactar: por qué el módulo vive fuera del notebook: testeable con pytest sin Fabric, el notebook solo orquesta]` (CLAUDE.md, D15, D16).

### 1.2 Carga incremental sin huecos (D10)
- Ventana **[D-3, D+1]** en cada corrida; todo es upsert, así que reprocesar días completos es inocuo y absorbe correcciones tardías de las fuentes. Reemplaza cualquier watermark.
- Un día está **completo** solo si `slots cargados = slots esperados` para su resolución y su calendario DST: 96/92/100 (PT15M) o 24/23/25 (PT60M). Los esperados salen de convertir el día local en `market_tz` a una ventana UTC y dividir por la resolución (`etl/dayahead/gaps/slots.py`): sin tabla de excepciones.
- Estados: `complete`, `incomplete`, `pending` (la fuente no publicó nada: no es error, se reintenta), `error` (excepción de la fuente; los demás países siguen; la corrida falla al final para que el pipeline lo marque).
- **18:00 UTC** con evidencia: el 26-ago SMARD regeneró su bloque a las 17:10Z; a las 14:35Z el D+1 alemán venía en `null` (enmienda de D10).
- Backfill = la misma corrida con parámetros (`start_date`, `end_date`), no un notebook aparte.

### 1.3 Modelo de datos (D4, D7, D11, D12, D13)
- `ts_utc` = inicio del intervalo, siempre UTC. `business_date_local` = día de mercado según `sources_config.market_tz` de la fuente (ES `Europe/Madrid`, RO `CET`, DE `Europe/Berlin`, PL `Europe/Warsaw`).
- Cada fila guarda `price_original`, `currency_original`, `price_eur`, `fx_rate`, `fx_rate_date`, `source`, `source_published_at`, `ingested_at_utc`: trazabilidad completa, nada se sobreescribe sin rastro.
- `resolution` se lee de la fuente (ENTSO-E era PT60M hasta sep-2025), no de la configuración.
- `source_published_at`: publicación real en PSE, generación del bloque en SMARD, "as-of" en ENTSO-E (createdDateTime es hora de respuesta).

### 1.4 Configuración, no código
- `sources_config`: una fila por país con adaptador, `market_tz`, moneda, resolución, `params` JSON, `target_table`, `active`. Semilla desde `dayahead.config.DEFAULT_SOURCES` solo si la tabla está vacía.
- Agregar un país = insertar una fila; el notebook crea su tabla. `[redactar: ejemplo FR en docs/fabric-setup.md]`

### 1.5 Cómo se probó
- 80 tests de `etl/` sobre respuestas reales bajadas en el spike (2026-08-26), incluidos días de cambio de hora 2026-03-29 (92/23) y 2025-10-26 (100/25), un día PT60M de 2025, y los dos Acknowledgement de ENTSO-E.
- `fabric/build.py` comprueba que el DDL del notebook y el `.sql` no divergen y que la celda `%pip` apunta al wheel construido.
- Smoke en vivo del módulo (`etl/scripts/smoke_live.py`) y montaje real en Fabric con backfill de 30 días publicando hacia la API (web al 100 % de cobertura el 26-ago).

## 2. Gestión de las diferencias entre APIs

### 2.1 Tabla comparativa (spike, `spike/findings-2026-08-26.md`)

| | ENTSO-E (ES, RO) | SMARD (DE) | PSE (PL) | BCE |
|---|---|---|---|---|
| Auth | token en query | ninguna | ninguna | ninguna |
| Formato | XML `Publication_MarketDocument` | JSON índice + bloque semanal | JSON OData paginado (100 filas, `nextLink`) | CSV/JSON SDMX |
| Granularidad | PT15M (PT60M antes de oct-2025) | PT60M | PT15M | diaria, días hábiles |
| Día de mercado | **CET/CEST para todas las zonas** | Berlín | Varsovia | — |
| Moneda | EUR | EUR | PLN | PLN por EUR |
| "Sin datos" | HTTP 200 + `Acknowledgement` código 999 | `null` en horas futuras | 200 `{"value":[]}` | sin fila |
| Publicación D+1 | ~12:45 CET (RO a veces más tarde) | bloque regenerado hasta 17:10Z | ~13:46 hora local | tasa del día ~16:15 CET |

### 2.2 Trampas confirmadas y cómo se resuelven
- **ENTSO-E mezcla subastas**: el A44 de España trae day-ahead (`contract_MarketAgreement.type=A01`) y hasta tres intradiarias (`A07`, posiciones 1-3). Sin filtro se duplican claves. Se acepta solo el tipo configurado (D8).
- **ENTSO-E alinea al día CET** también para Rumania (día ENTSO-E = 01:00→01:00 Bucarest). Por eso `business_date_local` es el día de mercado de la fuente y `market_tz` de RO es `CET` (D7).
- **curveType A03**: omite posiciones cuyo precio repite la anterior. Verificado: cero pares consecutivos iguales en 9 series. Forward fill por posición, con posición 1 obligatoria; no es un hueco (`transform/forward_fill.py`).
- **Cambios de hora**: 92/100 y 23/25 confirmados en las tres fuentes; los esperados se calculan, no se tabulan.
- **SMARD**: bloques semanales que empiezan lunes 00:00 Berlín; se elige el mayor timestamp ≤ inicio del día; un rango puede necesitar varios bloques; `null` = no publicado.
- **PSE**: `dtime_utc` es el **fin** del intervalo → `ts_utc = dtime_utc − 15 min` (D11); `dtime`/`period` usan `02a:15:00` en la hora repetida y no se parsean; paginación por `nextLink` con cursor `$after`; `$top` no existe.
- **Acknowledgement**: "sin datos" y "token inválido" comparten el código 999; se distinguen por status HTTP y texto; el parser lanza y el orquestador decide (pendiente vs error).
- **Resolución por Period**: leída del documento; un backfill anterior a oct-2025 recibiría PT60M sin romper el parser.

### 2.3 Diseño del código
- Un adaptador por fuente con la misma forma: `build_request(config, start, end)` puro y `parse_*(respuesta, config)` → `list[PriceRecord]`. Sin `requests`, sin Spark; la paginación recibe `fetch` inyectado (D15).
- El mismo módulo corre en Fabric (wheel) y en local (scripts de smoke y publicación).

## 3. Conversión PLN → EUR (D15)
- Fuente: BCE, serie `EXR/D.PLN.EUR.SP00.A` (PLN por 1 EUR), sin token.
- Carry forward = **última fecha con tasa ≤ business_date** (fines de semana, festivos TARGET como Viernes Santo, Lunes de Pascua y 1 de mayo, y el día corriente antes de las 16:15 CET). La ventana de consulta arranca 10 días antes para garantizar una tasa previa.
- `price_eur = price_original / fx_rate`, `Decimal`, 4 decimales `ROUND_HALF_UP`; filas en EUR: `fx_rate = 1`, `fx_rate_date = business_date_local`. `fx_rates` guarda cada tasa con su fecha y fuente.
- La API devuelve siempre `price_eur` y `price_original` + `currency_original`; la interfaz muestra EUR y permite ver PLN en Polonia sin mezclar monedas en un mismo eje (D6, D21).
- Verificado: el sábado 23-ago usó la tasa del viernes 21 (4,3078).

## 4. Mecanismo de seguridad

### 4.1 Por qué Fabric publica hacia la API (D1)
- La cuenta de prueba no puede registrar aplicaciones en Entra (MFA obligatorio sin teléfono) → sin service principal → ningún servidor externo puede autenticarse contra Fabric correctamente. Usuario y contraseña en un servidor: descartado.
- Elegido: Fabric hace POST de las filas nuevas a un endpoint de ingestión propio; la API y la interfaz leen de Postgres. Beneficios laterales: la API sirve aunque Fabric esté caído o la Trial expire; el Lakehouse no recibe tráfico de aplicación; cambiar a GraphQL de Fabric es una variable de entorno (adaptador `fabric-graphql` implementado sin credenciales, D20).

### 4.2 Ingestión: HMAC SHA256 + timestamp + nonce (D18)
- `X-Signature: sha256=HMAC(secreto, "<timestamp>.<nonce>." + cuerpo)`, ventana ±300 s, nonce de un solo uso (`ingest_nonces`), upsert transaccional junto con el nonce.
- Dos implementaciones (Python `etl/dayahead/publish.py`, TS `api/src/auth/hmac.ts`) con **vectores de prueba compartidos** (`etl/tests/fixtures/hmac_vectors.json`) en ambas suites.
- Descartado: API key para ingestión (no protege el cuerpo ni evita replay), mTLS (imposible desde un notebook).

### 4.3 Lecturas: API keys con hash y rate limit (D3, D19)
- Clave `dap_…` mostrada una vez; en base solo `sha256(clave)` y un prefijo. Alcance solo lectura. Límite por minuto por clave (cabeceras `X-RateLimit-*`, 429). Caché de claves validadas 60 s (revocación diferida un minuto).
- Consumidores: sistemas y agentes, no personas. La interfaz nunca recibe la clave: va por un **BFF** en su mismo dominio que la agrega y solo expone rutas de lectura (D21). El servidor MCP usa su propia clave (D22).
- Paso siguiente en Grenergy: SSO con Entra ID sobre la misma API; Key Vault para los secretos de Fabric.

### 4.4 Secretos
- Nunca en el repo: `.env` ignorado, `.env.example` vacío, Biblioteca de variables en Fabric, variables de entorno en Vercel. Escáner antes de cada commit.
- El PDF de la prueba traía el token en texto plano: se versiona una copia **redactada** (eliminación real del texto, verificada) y el original queda fuera de git (D14).
- Git de Fabric **no se conecta** (D23): versiona la biblioteca de variables con sus valores y depende de un tenant switch ajeno.

## 5. Escalabilidad
- **Países**: fila en `sources_config` (Fabric) y en `countries` (Postgres); el notebook crea la tabla; la web y el MCP leen el catálogo. Sin nada hardcodeado por país (verificado con `grep`).
- **Fuentes**: un adaptador nuevo en `etl/dayahead/adapters` con la misma forma; el resto no cambia.
- **Capa de servicio**: una tabla `prices` con clave `(country_code, ts_utc)` e índice por país y día; una tabla por país tiene sentido en el Lakehouse (enunciado, ingestión independiente), no en la API (D20).
- **Granularidad**: resample PT15M→PT60M en el servicio, una sola implementación para ambos lectores (D20).
- **Dimensionamiento honesto**: 4 países × ≤ 96 filas/día; Spark solo como escritor Delta; notebook Python puro documentado como alternativa más barata (D17). Sin colas, sin Kubernetes.
- **Lo que habría que tocar con más volumen o más consumidores**: rate limit en Postgres/Redis en vez de memoria por instancia; caché HTTP en la API; particionar `prices` por mes; publicar por partes ya está (2000 filas por POST).

## 6. Infraestructura
`[usar el bloque "Infraestructura: contenido para el documento técnico" de decisions.md]`: regiones (Fabric North Europe, Supabase eu-west-1, función Vercel en dub1, edge cercano al cliente); pooler de Supabase por IPv6 de la conexión directa (session 5432 para migraciones, transaction 6543 para serverless); latencia medida antes (~6 s frío, ~0,5 s caliente desde gru1) y después (0,7–1,0 s de punta a punta, dominada por Chile↔Irlanda); lo que rompió en Vercel (detección automática de Express) y cómo se resolvió (`builds` + `routes` explícitos).

## 7. Interfaz, MCP y extras
- **Web** (D21): comparativa en líneas escalonadas siempre en EUR, crosshair con todas las series, leyenda que no recolorea, paneles por país, tabla gemela, filtros en una fila, cinco estados de lectura (cargando sin parpadeo, vacío tras 200, error, sin permiso, desactualizado), paleta por país validada (CVD, contraste) sobre el design system, sin librerías de gráficas.
- **Calidad de datos**: tiles por país, matriz países × días con icono + `cargados/esperados`, tabla de huecos; misma fuente que Power BI (`load_control`).
- **MCP** (D22): cuatro herramientas de solo lectura; `compare_prices` hace el trabajo que un modelo haría mal a mano; probado completo con transporte en memoria y en vivo contra Vercel.
- **Power BI** (D24): guía en `docs/fabric-powerbi.md`; modelo Direct Lake y tabla gold opcional `build_gold_table`.
- **Git de Fabric** (D23): no se conecta; guía de referencia en `docs/fabric-git.md`.
- **Agente de datos**: no realizado. `[redactar una línea si se hace el viernes]`

## 8. Verificación y evidencia
- Tests: `etl` 80 · `api` 30 · `web` 19 · `mcp` 8. Fixtures reales del 26-ago-2026 en `etl/tests/fixtures`.
- Spike: `spike/findings-2026-08-26.md` con todas las trampas del BRIEF confirmadas, matizadas o descubiertas.
- Smoke en producción (26-ago): `/v1/health` 200; lectura horaria con key; `POST /v1/ingest` firmado desde local (1560 filas, idempotente al repetir); Fabric publicando con `publish_to_api=True`; web con las cuatro series y calidad al 100 % tras el backfill.

## 9. Deudas y límites conocidos
- Rate limit en memoria por instancia serverless; caché de claves 60 s.
- `source_published_at` de SMARD es del bloque semanal; de ENTSO-E es "as-of".
- Backfill anterior a oct-2025 marcaría ES/RO incompletos (PT60M contra 96 esperados); `sources_config.resolution` tendría que tener vigencia por fecha.
- `$select` de PSE y rate limits de ENTSO-E sin probar.
- Zona horaria de la interfaz fija en UTC; selector de zona de mercado como evolución.
- Adaptador `fabric-graphql`: nombres del esquema GraphQL son hipótesis hasta tener un service principal.
- Modo oscuro no definido por el design system.
