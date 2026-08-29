# Documento técnico de Day-Ahead Prices

Prueba técnica de Data & AI Engineer, Grenergy. Este documento sigue las secciones que pide la prueba. El detalle de cada decisión, con su contexto y las alternativas que descarté, está en `docs/decisions.md` (D1 a D24). Acá cito cada decisión por su número.

## 1. Resumen ejecutivo

Cuatro fuentes oficiales publican los precios day-ahead de España, Rumania, Alemania y Polonia, cada una con su formato, su moneda, su granularidad y sus rarezas. Este proyecto las carga todos los días a Microsoft Fabric con un pipeline que reevalúa una ventana de cinco días y marca cada día como completo solo cuando los slots cargados igualan los esperados. Al final de cada corrida, Fabric publica las filas hacia una capa de servicio propia, y de ahí leen la API REST, la interfaz web y el servidor MCP. La conversión de zloty a euro queda trazada fila a fila con la tasa del BCE. Toda la lógica está testeada contra respuestas reales de las APIs (137 tests entre los cuatro componentes) y cada decisión que no era obvia quedó registrada con sus alternativas.

## 2. Diseño del pipeline (Fabric)

### 2.1 Piezas y flujo
- Lakehouse `lh_dayahead`: `prices_es`, `prices_ro`, `prices_de`, `prices_pl` (mismo esquema), `sources_config`, `load_control`, `fx_rates`; opcional `prices_all` (gold, D24). DDL comentado columna a columna en `fabric/sql/01_create_tables.sql`.
- Notebook PySpark `nb_dayahead_ingest`: instala el módulo `dayahead` desde un wheel en su carpeta Resources (D16), lee el token de la biblioteca `vl_dayahead`, crea tablas si faltan, procesa la ventana por país, hace `MERGE` por `(country_code, ts_utc)` (D17: Spark solo escribe), evalúa cada día **leyendo la tabla** tras el merge, actualiza `load_control`, y con `publish_to_api=True` publica hacia la API firmando con HMAC (D18).
- Pipeline `pl_dayahead_daily`: actividad Notebook con `_inlineInstallationEnabled=true`, parámetros `start_date`, `end_date`, `countries` para backfill, schedule diario 18:00 UTC.
- El módulo `dayahead` vive fuera del notebook y se instala como wheel. La razón es poder probarlo sin Fabric de por medio. El parseo, el forward fill, la conversión de moneda y el cálculo de slots esperados se testean con pytest en local contra respuestas reales, y el notebook queda solo como orquestador (D15, D16). El mismo wheel corre en Fabric y en los scripts locales de smoke y publicación.

### 2.2 Carga incremental sin huecos (D10)
- Ventana **[D-3, D+1]** en cada corrida; todo es upsert, así que reprocesar días completos es inocuo y absorbe correcciones tardías de las fuentes. Reemplaza cualquier watermark.
- Un día está **completo** solo si `slots cargados = slots esperados` para su resolución y su calendario DST: 96/92/100 (PT15M) o 24/23/25 (PT60M). Los esperados salen de convertir el día local en `market_tz` a una ventana UTC y dividir por la resolución (`etl/dayahead/gaps/slots.py`): sin tabla de excepciones.
- Estados: `complete`, `incomplete`, `pending` (la fuente no publicó nada: no es error, se reintenta), `error` (excepción de la fuente; los demás países siguen; la corrida falla al final para que el pipeline lo marque).
- **18:00 UTC** con evidencia: el 26-ago SMARD regeneró su bloque a las 17:10Z; a las 14:35Z el D+1 alemán venía en `null` (enmienda de D10).
- Backfill = la misma corrida con parámetros (`start_date`, `end_date`), no un notebook aparte.

### 2.3 Modelo de datos (D4, D7, D11, D12, D13)
- `ts_utc` = inicio del intervalo, siempre UTC. `business_date_local` = día de mercado según `sources_config.market_tz` de la fuente (ES `Europe/Madrid`, RO `CET`, DE `Europe/Berlin`, PL `Europe/Warsaw`).
- Cada fila guarda `price_original`, `currency_original`, `price_eur`, `fx_rate`, `fx_rate_date`, `source`, `source_published_at`, `ingested_at_utc`: trazabilidad completa, nada se sobreescribe sin rastro.
- `resolution` se lee de la fuente (ENTSO-E era PT60M hasta sep-2025), no de la configuración.
- `source_published_at`: publicación real en PSE, generación del bloque en SMARD, "as-of" en ENTSO-E (createdDateTime es hora de respuesta).

### 2.4 Configuración, no código
- `sources_config`: una fila por país con adaptador, `market_tz`, moneda, resolución, `params` JSON, `target_table`, `active`. Semilla desde `dayahead.config.DEFAULT_SOURCES` solo si la tabla está vacía.
- Agregar un país es insertar una fila; el notebook crea su tabla. El ejemplo completo de cómo se agregaría Francia está en `docs/fabric-setup.md`.

### 2.5 Cómo se probó
- 80 tests de `etl/` sobre respuestas reales bajadas en el spike (2026-08-26), incluidos días de cambio de hora 2026-03-29 (92/23) y 2025-10-26 (100/25), un día PT60M de 2025, y los dos Acknowledgement de ENTSO-E.
- `fabric/build.py` comprueba que el DDL del notebook y el `.sql` no divergen y que la celda `%pip` apunta al wheel construido.
- Smoke en vivo del módulo (`etl/scripts/smoke_live.py`) y montaje real en Fabric con backfill de 30 días publicando hacia la API (web al 100 % de cobertura el 26-ago).

## 3. Gestión de las diferencias entre APIs

### 3.1 Tabla comparativa (spike, `spike/findings-2026-08-26.md`)

| | ENTSO-E (ES, RO) | SMARD (DE) | PSE (PL) | BCE |
|---|---|---|---|---|
| Auth | token en query | ninguna | ninguna | ninguna |
| Formato | XML `Publication_MarketDocument` | JSON índice + bloque semanal | JSON OData paginado (100 filas, `nextLink`) | CSV/JSON SDMX |
| Granularidad | PT15M (PT60M antes de oct-2025) | PT60M | PT15M | diaria, días hábiles |
| Día de mercado | **CET/CEST para todas las zonas** | Berlín | Varsovia | — |
| Moneda | EUR | EUR | PLN | PLN por EUR |
| "Sin datos" | HTTP 200 + `Acknowledgement` código 999 | `null` en horas futuras | 200 `{"value":[]}` | sin fila |
| Publicación D+1 | ~12:45 CET (RO a veces más tarde) | bloque regenerado hasta 17:10Z | ~13:46 hora local | tasa del día ~16:15 CET |

### 3.2 Trampas confirmadas y cómo se resuelven
- **ENTSO-E mezcla subastas**: el A44 de España trae day-ahead (`contract_MarketAgreement.type=A01`) y hasta tres intradiarias (`A07`, posiciones 1-3). Sin filtro se duplican claves. Se acepta solo el tipo configurado (D8).
- **ENTSO-E alinea al día CET** también para Rumania (día ENTSO-E = 01:00→01:00 Bucarest). Por eso `business_date_local` es el día de mercado de la fuente y `market_tz` de RO es `CET` (D7).
- **curveType A03**: omite posiciones cuyo precio repite la anterior. Verificado: cero pares consecutivos iguales en 9 series. Forward fill por posición, con posición 1 obligatoria; no es un hueco (`transform/forward_fill.py`).
- **Cambios de hora**: 92/100 y 23/25 confirmados en las tres fuentes; los esperados se calculan, no se tabulan.
- **SMARD**: bloques semanales que empiezan lunes 00:00 Berlín; se elige el mayor timestamp ≤ inicio del día; un rango puede necesitar varios bloques; `null` = no publicado.
- **PSE**: `dtime_utc` es el **fin** del intervalo → `ts_utc = dtime_utc − 15 min` (D11); `dtime`/`period` usan `02a:15:00` en la hora repetida y no se parsean; paginación por `nextLink` con cursor `$after`; `$top` no existe.
- **Acknowledgement**: "sin datos" y "token inválido" comparten el código 999; se distinguen por status HTTP y texto; el parser lanza y el orquestador decide (pendiente vs error).
- **Resolución por Period**: leída del documento; un backfill anterior a oct-2025 recibiría PT60M sin romper el parser.

### 3.3 Diseño del código
- Un adaptador por fuente con la misma forma: `build_request(config, start, end)`, que no hace red, y `parse_*(respuesta, config)` → `list[PriceRecord]`. Sin `requests`, sin Spark; la paginación recibe `fetch` inyectado (D15).
- El mismo módulo corre en Fabric (wheel) y en local (scripts de smoke y publicación).

## 4. Conversión PLN → EUR (D15)
- Fuente: BCE, serie `EXR/D.PLN.EUR.SP00.A` (PLN por 1 EUR), sin token.
- Carry forward = **última fecha con tasa ≤ business_date** (fines de semana, festivos TARGET como Viernes Santo, Lunes de Pascua y 1 de mayo, y el día corriente antes de las 16:15 CET). La ventana de consulta arranca 10 días antes para garantizar una tasa previa.
- `price_eur = price_original / fx_rate`, `Decimal`, 4 decimales `ROUND_HALF_UP`; filas en EUR: `fx_rate = 1`, `fx_rate_date = business_date_local`. `fx_rates` guarda cada tasa con su fecha y fuente.
- La API devuelve siempre `price_eur` y `price_original` + `currency_original`; la interfaz muestra EUR y permite ver PLN en Polonia sin mezclar monedas en un mismo eje (D6, D21).
- Verificado: el sábado 23-ago usó la tasa del viernes 21 (4,3078).

## 5. Mecanismo de seguridad

### 5.1 Por qué Fabric publica hacia la API (D1)
- La cuenta de prueba no puede registrar aplicaciones en Entra (MFA obligatorio sin teléfono) → sin service principal → ningún servidor externo puede autenticarse contra Fabric correctamente. Usuario y contraseña en un servidor: descartado.
- Elegido: Fabric hace POST de las filas nuevas a un endpoint de ingestión propio; la API y la interfaz leen de Postgres. Beneficios laterales: la API sirve aunque Fabric esté caído o la Trial expire; el Lakehouse no recibe tráfico de aplicación; cambiar a GraphQL de Fabric es una variable de entorno (adaptador `fabric-graphql` implementado sin credenciales, D20).

### 5.2 Ingestión: HMAC SHA256 + timestamp + nonce (D18)
- `X-Signature: sha256=HMAC(secreto, "<timestamp>.<nonce>." + cuerpo)`, ventana ±300 s, nonce de un solo uso (`ingest_nonces`), upsert transaccional junto con el nonce.
- Dos implementaciones (Python `etl/dayahead/publish.py`, TS `api/src/auth/hmac.ts`) con **vectores de prueba compartidos** (`etl/tests/fixtures/hmac_vectors.json`) en ambas suites. Si una diverge de la otra, falla un test antes de llegar a producción.
- Descartado: API key para ingestión (no protege el cuerpo ni evita replay), mTLS (imposible desde un notebook).

### 5.3 Lecturas: API keys con hash y rate limit (D3, D19)
- Clave `dap_…` mostrada una vez; en base solo `sha256(clave)` y un prefijo. Alcance solo lectura. Límite por minuto por clave (cabeceras `X-RateLimit-*`, 429). Caché de claves validadas 60 s (revocación diferida un minuto).
- Consumidores: sistemas y agentes, no personas. La interfaz nunca recibe la clave: va por un **BFF** en su mismo dominio que la agrega y solo expone rutas de lectura (D21). El servidor MCP usa su propia clave (D22).
- Paso siguiente en Grenergy: SSO con Entra ID sobre la misma API; Key Vault para los secretos de Fabric.

### 5.4 Secretos
- Nunca en el repo: `.env` ignorado, `.env.example` vacío, Biblioteca de variables en Fabric, variables de entorno en Vercel. Escáner antes de cada commit.
- El PDF de la prueba traía el token en texto plano: se versiona una copia **redactada** (eliminación real del texto, verificada) y el original queda fuera de git (D14).
- Git de Fabric **no se conecta** (D23): versiona la biblioteca de variables con sus valores y depende de un tenant switch ajeno.

## 6. Escalabilidad
- **Países**: fila en `sources_config` (Fabric) y en `countries` (Postgres); el notebook crea la tabla; la web y el MCP leen el catálogo. Sin nada hardcodeado por país (verificado con `grep`).
- **Fuentes**: un adaptador nuevo en `etl/dayahead/adapters` con la misma forma; el resto no cambia.
- **Capa de servicio**: una tabla `prices` con clave `(country_code, ts_utc)` e índice por país y día; una tabla por país tiene sentido en el Lakehouse (enunciado, ingestión independiente), no en la API (D20).
- **Granularidad**: resample PT15M→PT60M en el servicio, una sola implementación para ambos lectores (D20).
- **Dimensionamiento honesto**: 4 países × ≤ 96 filas/día; Spark solo como escritor Delta; notebook en Python sin Spark documentado como alternativa más barata (D17). Sin colas, sin Kubernetes.
- **Lo que habría que tocar con más volumen o más consumidores**: rate limit en Postgres/Redis en vez de memoria por instancia; caché HTTP en la API; particionar `prices` por mes; publicar por partes ya está (2000 filas por POST).

## 7. Infraestructura

### 7.1 Regiones y dónde corre cada pieza

Todo corre en Europa, cerca del dato y de sus consumidores naturales.

| Pieza | Dónde | Por qué |
|---|---|---|
| Fabric (Lakehouse, notebook, pipeline) | Capacidad Trial del tenant de Grenergy, región **North Europe** | Es la capacidad que da la prueba; no se elige |
| Supabase Postgres (capa de servicio) | **eu-west-1** (Irlanda), Postgres 17 | Región europea más cercana a Fabric y a los consumidores (España) |
| API (Vercel, función serverless) | Función fijada en **dub1** (Dublín) vía `vercel.json`; el edge que recibe la petición es el más cercano al cliente | Sin fijarla, Vercel la desplegó en `gru1` (São Paulo) y cada consulta a la base cruzaba el Atlántico |
| Web (Vercel, estático + función BFF) | Estático en el edge global; el BFF llama a la API | El BFF solo reenvía; su región importa poco |

La única pieza sin elección es Fabric. El resto se ordenó a partir de ahí. La base se puso en la región europea más cercana y la función de la API se fijó al lado de la base, porque una petición a la API puede hacer más de una consulta a Postgres y cada una paga el viaje completo entre función y base.

### 7.2 Conexión a la base
- La conexión directa `db.<ref>.supabase.co:5432` solo publica registro **AAAA (IPv6)**. Desde una red sin IPv6 da `ENOTFOUND`. Verificado con `dig`: sin registro A.
- La solución es el **pooler** de Supabase, que sí tiene IPv4: host `aws-1-eu-west-1.pooler.supabase.com`, usuario `postgres.<ref>`.
- Dos modos del pooler, dos usos. **Session** (puerto 5432) para migraciones y scripts locales. **Transaction** (puerto 6543) para la función serverless, porque cada instancia abre y cierra conexiones y el modo transaction las reparte. Con transaction no se pueden usar sentencias preparadas con nombre; la API no las usa.
- Pool de `pg` por instancia: máximo 5 conexiones, ociosas hasta 5 minutos, porque reabrir TLS hacia el pooler costaba segundos.

### 7.3 Latencia medida (2026-08-26, desde Santiago de Chile)

| Momento | Medición | Causa |
|---|---|---|
| API en `gru1`, primera petición tras > 10 s de inactividad | **~6 s** | El pool cerraba conexiones ociosas a los 10 s; cada petición nueva reabría TLS hacia el pooler en Irlanda |
| API en `gru1`, en caliente | **~0,5 s** por petición | Dos idas a la base por petición (validar la API key y la consulta) a ~250 ms de RTT cada una |
| Consultas SQL directas contra Supabase | `connect` 1,45 s; consultas ~250 ms cada una | RTT Chile↔Irlanda, no tiempo de ejecución (tablas de decenas o miles de filas) |
| Tras los cambios (función en `dub1`, caché de keys 60 s, pool 5 min) | raíz 0,68 s; `/v1/health` 0,69–0,95 s; `/v1/status` con key 0,78–1,07 s | Lo que queda es el salto Chile↔Irlanda; función y base están en la misma región |

La lección quedó clara midiendo. En serverless la latencia la fijan los saltos de red entre función y base, no el cómputo. Poner la función junto a la base y no pagar una ida a la base para autenticar cada petición vale más que cualquier optimización de consulta.

### 7.4 Lo que rompió en Vercel
- Vercel detecta `express` en `package.json` y aplica su configuración automática: busca un entry (`src/app.ts`) y lo invoca como servidor para `/`. Pero `src/app.ts` exporta la fábrica `createApp` (para poder testear sin base), no la app. Resultado: `Invalid export found in module` solo en la raíz, porque las demás rutas caían en el rewrite hacia `api/index.ts`. Se resolvió declarando la función de forma explícita (`builds` + `routes` en `vercel.json`), que desactiva la detección.
- La API y la web son dos proyectos de Vercel sobre el mismo repositorio, con Root Directory `api` y `web`. Variables por proyecto documentadas en `docs/deploy-vercel.md`; los secretos nunca están en el repo.

## 8. Interfaz, MCP y extras
- **Web** (D21): comparativa en líneas escalonadas siempre en EUR, crosshair con todas las series, leyenda que no recolorea, paneles por país, tabla gemela, filtros en una fila, cinco estados de lectura (cargando sin parpadeo, vacío tras 200, error, sin permiso, desactualizado), paleta por país validada (CVD, contraste) sobre el design system, sin librerías de gráficas.
- **Calidad de datos**: tiles por país, matriz países × días con icono y `cargados/esperados`, tabla de huecos; misma fuente que Power BI (`load_control`).
- **MCP** (D22): cuatro herramientas de solo lectura; `compare_prices` hace el trabajo que un modelo haría mal a mano (alinear por hora, calcular el más barato y la dispersión); probado completo con transporte en memoria y en vivo contra Vercel.
- **Power BI** (D24): modelo `sm_dayahead_prices` en Direct Lake y reporte `rpt_dayahead_prices`; tabla gold opcional `prices_all` detrás del parámetro `build_gold_table`. Guía en `docs/fabric-powerbi.md`.
- **Git de Fabric** (D23): no se conecta; guía de referencia en `docs/fabric-git.md`.
- **Agente de datos**: no lo hice. Prioricé el servidor MCP como extra, que cubre el mismo caso de consultar los datos en lenguaje natural, sobre la misma API y con su propia key.

## 9. Verificación y evidencia
- Tests: `etl` 80 · `api` 30 · `web` 19 · `mcp` 8. Fixtures reales del 26-ago-2026 en `etl/tests/fixtures`.
- Spike: `spike/findings-2026-08-26.md` con todas las trampas del enunciado confirmadas, matizadas o descubiertas.
- Smoke en producción (26-ago): `/v1/health` 200; lectura horaria con key; `POST /v1/ingest` firmado desde local (1560 filas, idempotente al repetir); Fabric publicando con `publish_to_api=True`; web con las cuatro series y calidad al 100 % tras el backfill.
- Pipeline corriendo solo desde el 27-ago a las 18:00 UTC, con corridas diarias en verde.

## 10. Deudas y límites conocidos
- Rate limit en memoria por instancia serverless; caché de claves 60 s.
- `source_published_at` de SMARD es del bloque semanal; de ENTSO-E es "as-of".
- Backfill anterior a oct-2025 marcaría ES/RO incompletos (PT60M contra 96 esperados); `sources_config.resolution` tendría que tener vigencia por fecha.
- `$select` de PSE y rate limits de ENTSO-E sin probar.
- Zona horaria de la interfaz fija en UTC; selector de zona de mercado como evolución.
- Adaptador `fabric-graphql`: los nombres del esquema GraphQL son hipótesis hasta tener un service principal.
- Modo oscuro no definido por el design system.

---

Julio Araya Palacios. Agosto 2026.
