# Registro de decisiones

Fuente del documento técnico final. Cada decisión lleva contexto, opciones consideradas y por qué se eligió una. Las decisiones D1 a D6 están en `BRIEF.md` (sección 4) y no se repiten acá. Las fechas son de ratificación por Julio.

---

## D7. Día de negocio por fuente, no por país (2026-08-26)

**Contexto.** El spike mostró que ENTSO-E alinea los documentos day-ahead al día CET/CEST para todas las zonas del acoplamiento europeo (SDAC). Para Rumania (hora local EET, UTC+2/+3) eso significa que el "día" publicado va de 01:00 a 01:00 hora de Bucarest. SMARD publica por día de Berlín y PSE por día de Varsovia.

**Opciones.**
1. `business_date_local` = día de mercado tal como lo publica la fuente. La zona se guarda por fila en `sources_config.market_tz` (ES: `Europe/Madrid`, RO: `CET`, DE: `Europe/Berlin`, PL: `Europe/Warsaw`). Un documento de la fuente equivale a un día de negocio y la detección de huecos es directa.
2. Día local estricto del país. Para Rumania obliga a pedir dos documentos y coser la primera hora del día desde el documento anterior. Más fiel al calendario civil rumano, sin beneficio para comparar precios entre mercados que de todos modos cotizan sobre el día CET.

**Elegida: 1.** El dato se guarda como lo define el mercado que lo produce. La zona es configuración, no código: agregar un país es agregar una fila con su `market_tz`.

**Consecuencia.** `business_date_local` se calcula siempre como la fecha de `ts_utc` convertido a `market_tz`. Para PSE la fuente ya trae `business_date`; el adaptador lo usa solo para verificar que la conversión coincide.

## D8. Solo day-ahead: se filtra `contract_MarketAgreement.type = A01` (2026-08-26)

**Contexto.** El documento A44 de ENTSO-E para España trae, además del day-ahead (`A01`), hasta tres TimeSeries de subastas intradiarias (`A07`, con `classificationSequence_AttributeInstanceComponent.position` 1, 2 y 3 para IDA1, IDA2 e IDA3). IDA3 cubre solo 12:00 → 24:00 CET. Rumania solo publica `A01`. Sin filtro, España produciría hasta cuatro precios distintos para la misma clave `(country_code, ts_utc)`.

**Opciones.**
1. Filtrar `A01` y descartar el resto.
2. Guardar las intradiarias como series adicionales con una columna de tipo de subasta.

**Elegida: 1.** La prueba pide precios day-ahead. Las intradiarias son otra fuente de negocio y agregarlas está fuera de alcance (CLAUDE.md, "no agregar fuentes"). El tipo de contrato que se acepta es un parámetro del adaptador (`params.contract_type`), así que si mañana se quisiera IDA sería otra fila de configuración, no otro parser.

## D9. Alemania en PT60M, cuarto-horario como evolución (2026-08-26)

**Contexto.** SMARD expone también `index_quarterhour.json` y `4169_DE_quarterhour_{ts}.json` con 96 puntos por día (el day-ahead alemán es cuarto-horario desde octubre 2025). La prueba especifica `index_hour` y PT60M.

**Elegida:** PT60M, como pide el enunciado. La resolución y el nombre del índice son parámetros de la fila de configuración (`params.index`, `params.block`, `resolution`), así que pasar Alemania a PT15M sería un cambio de configuración y un backfill, sin tocar código. Queda documentado como evolución posible.

## D10. Corrida diaria: 18:00 UTC, ventana [D-3, D+1], completitud por slots (2026-08-26)

**Contexto.** Las cuatro fuentes publican el día D+1 a distintas horas: ENTSO-E y PSE alrededor de las 12:45-13:00 CET, SMARD con retraso variable (a las 13:35Z del 26-ago el 27-ago aún venía en `null`). El BCE publica la tasa del día ~16:15 CET. Un watermark simple ("último día cargado") no sirve: un día puede estar parcialmente publicado y una fuente puede corregir datos.

**Decisión.**
- Schedule diario a las **18:00 UTC** (inicialmente 16:00; ver enmienda abajo). A esa hora D+1 está publicado en ENTSO-E y PSE con margen, la tasa del BCE del día ya salió y SMARD ya regeneró su bloque.
- En cada corrida se procesa la ventana **[D-3, D+1]** por país, donde D es la fecha UTC de la corrida. Toda escritura es upsert por `(country_code, ts_utc)`, así que reprocesar días ya completos es inocuo y absorbe correcciones tardías.
- Un día se marca **completo** solo cuando `slots cargados = slots esperados` para su granularidad y su calendario DST (96/92/100 para PT15M, 24/23/25 para PT60M), calculados desde `market_tz`.
- Si un día no tiene datos (D+1 antes de publicación) el estado es **pendiente**, no error. Se reintenta en la siguiente corrida. Un día con datos pero incompleto queda **incompleto** y también se reintenta.
- Esto reemplaza cualquier lógica de watermark.

**Enmienda (2026-08-26, ratificada por Julio).** Evidencia del smoke de Fase 3: a las 14:35Z el bloque semanal de SMARD seguía siendo el generado el 25-ago a 12:42Z (D+1 alemán en `null`), y en la ingestión real de las 17:36Z ya traía el 27-ago con `meta_data.created = 2026-08-26T17:10:42Z`. Con la corrida a las 16:00 UTC Alemania habría quedado `pending` cada día hasta la corrida siguiente. Se mueve a **18:00 UTC** para que los cuatro países entren el mismo día; la ventana [D-3, D+1] sigue cubriendo cualquier retraso mayor.

## D11. `ts_utc` es el inicio del intervalo en las cuatro fuentes (2026-08-26)

**Contexto.** PSE entrega `dtime_utc` como el **fin** del intervalo (`period_utc "22:00 - 22:15"` → `dtime_utc "22:15:00"`). ENTSO-E y SMARD entregan inicio.

**Decisión.** `ts_utc` = inicio del intervalo siempre. En el adaptador de PSE se calcula como `dtime_utc − resolución` (15 minutos). Los campos `dtime` y `period` de PSE no se parsean nunca: en la hora repetida del cambio de hora usan la notación `02a:15:00`.

## D12. `source_published_at` en `load_control` (2026-08-26)

Cada fuente expone un sello de publicación: `createdDateTime` del documento en ENTSO-E, `meta_data.created` del bloque en SMARD, `publication_ts_utc` en PSE. Se guarda como `source_published_at` (timestamp UTC) por fila de precio y en `load_control`. Sirve para saber qué versión de la fuente se cargó y para diagnosticar retrasos de publicación sin tener que mirar los datos.

**Matiz (2026-08-26, tras el smoke de Fase 1).** `createdDateTime` de ENTSO-E es la hora en que la API generó la respuesta, no la hora de publicación del day-ahead (A44 no expone un sello de publicación). Se decidió mantener el campo para ES y RO con significado **"as-of"**: cuándo se obtuvo el documento que produjo la fila. Para SMARD es la generación del bloque semanal y para PSE la publicación real del día. La columna es la misma; el significado por fuente queda documentado acá y en el docstring del adaptador.

## D13. La resolución se lee del documento, no de la configuración (2026-08-26)

ENTSO-E era PT60M para el day-ahead hasta septiembre 2025 (verificado con el 2025-09-15) y PT15M desde octubre. El parser lee `Period/resolution` y calcula los slots esperados como `(end − start) / resolución`. La columna `resolution` de cada fila guarda lo que dijo la fuente. `sources_config.resolution` es la resolución esperada, usada para calcular los slots de un día en `load_control`; si un documento antiguo viene en otra resolución, la fila se guarda igual con su resolución real.

## D14. El PDF de la prueba se versiona redactado (2026-08-26)

El PDF original contiene el token de ENTSO-E en texto plano. Se versiona `docs/prueba-tecnica-grenergy.pdf`, una copia con el token tapado mediante redacción real (se elimina el texto del contenido, no solo se cubre), y el original queda en `.gitignore`. Se verificó que el token no aparece ni en el texto extraíble ni en los bytes del PDF nuevo.

## D15. Decisiones menores del módulo de Fase 1 (2026-08-26)

- **Precios como `Decimal`**, nunca `float`. `price_eur` se redondea a 4 decimales (`ROUND_HALF_UP`) tras dividir por la tasa; `price_original` se guarda tal como llegó.
- **Filas en EUR**: `fx_rate = 1` y `fx_rate_date = business_date_local`. Se prefirió a `NULL` para que la API y la interfaz no tengan que tratar un caso especial.
- **Carry forward del BCE** = última fecha con tasa **menor o igual** al `business_date`, no "día anterior". Cubre fines de semana, festivos TARGET (Viernes Santo, Lunes de Pascua, 1 de mayo, etc.) y el día corriente antes de las 16:15 CET. La ventana de consulta al BCE arranca 10 días antes del primer día a cargar para garantizar una tasa previa.
- **Acknowledgement de ENTSO-E**: "sin datos" y "token inválido" traen el mismo `Reason/code = 999`; se distinguen por el status HTTP (200 vs 401) y por el texto. El parser lanza `EntsoeAcknowledgement` y quien orquesta decide: 200 + "No matching data" es pendiente, todo lo demás es error.
- **Forward fill A03**: por posición dentro de cada Period; la posición 1 es obligatoria (si falta, es error de la fuente, no se inventa un precio).
- **Deduplicación**: si un documento trae dos TimeSeries válidas para el mismo instante, gana la última. No se observó, pero el parser no debe explotar.
- **Módulo puro**: solo biblioteca estándar (`xml.etree`, `json`, `decimal`, `datetime`, `zoneinfo`). Sin `requests`, sin Spark. Las funciones reciben bytes/dicts y devuelven listas de `PriceRecord`; el notebook hace las llamadas HTTP. La paginación de PSE recibe una función `fetch` inyectada para poder testearse con fixtures.

## D16. El módulo llega al notebook como wheel en la carpeta Resources, instalado con `%pip` (2026-08-26)

**Contexto.** `etl/dayahead` es un paquete puro sin dependencias que se construye con `python -m build` en `dayahead-<versión>-py3-none-any.whl`. Julio opera Fabric a mano en el navegador; cada iteración de código cuesta una vuelta manual.

**Opciones evaluadas** (documentación oficial de Fabric, agosto 2026).

| | Reproducibilidad | Actualizar | Cómo lo ve el revisor |
|---|---|---|---|
| (a) Wheel como biblioteca personalizada en un **Entorno** | La más alta: modo Full crea un snapshot estable, "recomendado para pipelines" | Subir y **publicar**: modo Full 3-6 min de publicación más 1-3 min por sesión; modo Quick publica en 5 s pero instala al arrancar la sesión | Ítem Environment en el workspace con el notebook adjunto: la forma canónica |
| (b) Código en `Files/` del Lakehouse y `sys.path.insert` | Baja: corre lo que haya en Files, sin versión, código mezclado con datos | Arrastrar la carpeta de nuevo; frágil | Código suelto dentro de un Lakehouse |
| (c) Módulo inlineado en el notebook | Alta pero con dos fuentes de verdad (los tests cubren `etl/dayahead`, el notebook tiene una copia) | Regenerar y reimportar el notebook | Notebook largo con una biblioteca pegada |
| **(d) Wheel en Resources del notebook + `%pip install "builtin/dayahead-x.y.z-py3-none-any.whl"`** | Alta: versión en el nombre del archivo y en la celda; el wheel viaja con el notebook | `python -m build`, arrastrar el `.whl`, subir la versión en la celda, reiniciar sesión; sin espera de publicación | Notebook corto con una línea de instalación visible y el fuente en el repo; patrón documentado por Microsoft |

**Restricciones verificadas.** Los Entornos **no aplican a notebooks Python** ("Environment integration isn't available on Python notebooks"), así que (a) obliga a notebook Spark. En ejecuciones desde pipeline la instalación inline está desactivada por defecto y hay que activar el parámetro `_inlineInstallationEnabled = True` en la actividad Notebook. La documentación desaconseja `%pip` en pipelines porque el árbol de dependencias puede variar entre corridas; nuestro wheel no tiene dependencias, por lo que ese riesgo no existe y queda documentado.

**Elegida: (d).** (a) queda anotada como **paso opcional de cierre**: es el mismo wheel; adjuntar un Entorno en modo Full y borrar la línea `%pip` toma unos minutos y deja el ítem Environment visible para el revisor.

## D17. Notebook PySpark, con Spark solo como escritor Delta (2026-08-26)

**Contexto.** Cuatro países y unas 500 filas por día no necesitan cómputo distribuido. Fabric ofrece notebooks Python puros (un nodo de 2 vCores/16 GB, kernels 3.10-3.12, programables y orquestables desde pipeline, con `delta-rs` y `duckdb` preinstalados) y notebooks Spark.

**Tradeoffs.**

| | PySpark (Spark solo escribe) | Python puro (delta-rs) |
|---|---|---|
| Adecuación al tamaño | Sobredimensionado, pero la lógica no está en Spark: el módulo puro produce las filas y Spark solo hace `MERGE` | Tamaño justo |
| Escritura Delta / upsert | `DeltaTable.merge` maduro; tipos `decimal` y `timestamp`; compatibilidad garantizada con el SQL endpoint y Power BI | La doc advierte que "algunas funciones de Delta Lake podrían no estar totalmente soportadas"; particularidades conocidas (hipótesis no verificables sin acceso): `timestamp_ntz` no legible por el SQL endpoint, cuidado con decimales y versión de protocolo, sin V-Order, registro de tabla por carpeta |
| Riesgo con el plazo | Bajo | Medio: cada particularidad es depuración en vivo en el navegador |
| Revisor | Lo esperado para "ETL en Fabric" | Muestra criterio de dimensionamiento; menos convencional |
| Entornos | Compatibles | No disponibles |

**Elegida: PySpark.** Spark no hace cómputo: el notebook convierte las filas del módulo en un DataFrame y ejecuta `MERGE` por `(country_code, ts_utc)`. El notebook Python con delta-rs queda documentado como la alternativa más barata; migrar sería cambiar solo la celda de escritura, el módulo no cambia.

## D18. Endpoint de ingestión firmado con HMAC SHA256, timestamp y nonce (2026-08-26)

**Contexto.** Fabric publica hacia la API al final de cada corrida (D1, opción 1). El emisor es un notebook sin identidad propia; lo que puede tener es un secreto compartido.

**Decisión.** `POST /v1/ingest` con cabeceras `X-Timestamp` (segundos Unix), `X-Nonce` (UUID) y `X-Signature: sha256=HMAC_SHA256(secreto, "<timestamp>.<nonce>." + cuerpo)`. El cuerpo se firma byte a byte tal como se envía (JSON compacto con claves ordenadas, decimales como texto). El servidor rechaza timestamps a más de 300 s de su reloj y nonces ya vistos (tabla `ingest_nonces`, purgada a la hora), y hace el upsert en una transacción junto con el registro del nonce: o entra todo o no entra nada.

**Por qué así.** Firmar el cuerpo evita manipulación en tránsito además de autenticar; el timestamp acota el replay a una ventana corta y el nonce lo elimina dentro de ella. Es el esquema de webhooks de Stripe y GitHub, conocido por cualquier equipo. La implementación de referencia vive en `etl/dayahead/publish.py` (Python, lo usa el notebook) y `api/src/auth/hmac.ts`, con vectores de prueba compartidos para que no diverjan.

**Descartado.** API key para la ingestión: no protege el cuerpo ni evita replay. mTLS: imposible de configurar desde un notebook de Fabric.

## D19. API keys con hash, alcance de lectura y límite por clave (2026-08-26)

Detalle de D3. La clave (`dap_` + 24 bytes aleatorios en base64url) se muestra una sola vez al crearla (`npm run create-key`); en `api_keys` queda `sha256(clave)` y un prefijo de 8 caracteres para identificarla. Viaja en `Authorization: Bearer` o `X-API-Key`. Cada clave tiene su `rate_limit_per_minute`; el contador es una ventana fija de un minuto **en memoria del proceso**. Límite conocido: en Vercel cada instancia serverless cuenta por separado, así que el tope real es por instancia. Para los consumidores previstos (una interfaz vía BFF y agentes) alcanza; el paso siguiente sería un contador en Postgres o Redis. La interfaz nunca recibe la clave: la pone su BFF (Fase 4). Las keys validadas se cachean 60 s en memoria del proceso para ahorrar una ida a la base por petición (medido: ~250 ms por consulta desde `gru1`); revocar una key tarda hasta un minuto en hacerse efectiva. La función de la API se fija en la región `dub1`, junto a Supabase `eu-west-1`, y el pool mantiene las conexiones ociosas 5 minutos porque reabrir TLS hacia el pooler costaba varios segundos en la primera petición.

## D20. Lector detrás de una interfaz; resample en el servicio; una sola tabla en Postgres (2026-08-26)

- `PriceReader` con dos implementaciones elegidas por `DATA_READER`: `postgres` (activa) y `fabric-graphql` (BRIEF D1, opción 3). La segunda implementa client credentials contra Entra ID y las consultas GraphQL con la convención de la API for GraphQL de Fabric (tabla pluralizada, `filter`/`first`/`orderBy`, `items`). **Hipótesis**: los nombres exactos del esquema GraphQL se confirman al crear la API en Fabric, cosa que exige un service principal que la prueba no permite. Sin credenciales, `ping()` lo dice y las lecturas responden 503.
- El resample PT15M → PT60M (D5) se hace en el servicio de la API, no en SQL, para que los dos lectores compartan una sola implementación probada (promedio con enteros escalados, redondeo half-up a 4 decimales, `slots` por hora para señalar horas incompletas).
- Postgres replica las cuatro tablas de Fabric en una sola `prices` con clave `(country_code, ts_utc)` e índice por `(country_code, business_date_local)`. Una tabla por país tiene sentido en el Lakehouse (enunciado de la prueba, ingestión independiente); en la capa de servicio complica cada consulta multipaís sin aportar nada.
- `countries` en Postgres es el espejo de `sources_config`: agregar un país a la API es una fila (`002_seed_countries.sql` hace upsert, así que se puede reaplicar).
- Decimales viajan y se guardan como texto (`numeric` en Postgres, `string` en JSON): sin pérdida por coma flotante en ninguna capa.

## D21. Interfaz: BFF, gráfica escalonada en EUR, cinco estados, paleta por país (2026-08-26)

- **BFF en el mismo dominio** (`web/bff/handler.ts`): el navegador llama a `/api/*`; el BFF agrega la API key y reenvía solo rutas de lectura (allowlist), traduce 401/403 de la API a 403 ("sin permiso") y responde 503 si no está configurado. El mismo handler corre como middleware de Vite en desarrollo y como función serverless en Vercel, así no hay dos implementaciones.
- **Comparativa siempre en EUR.** El toggle de moneda cambia los paneles por país y la tabla (Polonia en PLN), nunca la comparativa: dos monedas sobre un mismo eje es un doble eje encubierto, la escala inventa una relación que no existe.
- **Líneas escalonadas** (`stepPath`): un precio day-ahead es constante durante su intervalo; interpolar entre puntos dibujaría valores que nunca existieron. La línea se corta en huecos reales en vez de unirlos.
- **Horas en UTC** en ejes, tooltip y tabla, igual que en la base de datos. Mostrar hora local de cada mercado en una comparativa de cuatro zonas induce a error; queda como evolución posible un selector de zona.
- **Cinco estados** (CLAUDE.md): `loading` conserva el render anterior atenuado (sin parpadeo), `empty` solo tras 200 con cero filas, `error`, `forbidden` (credencial del BFF rechazada) y **desactualizado** como banner sobre los datos cuando `/v1/status` marca más de 26 h sin corrida.
- **Paleta por país** validada con `dataviz/validate_palette.js` sobre la superficie `#fbfbf3` del design system (banda de luminosidad, piso de croma, separación CVD, contraste): ES `#0E9C8B`, RO `#E5431F`, DE `#7A5AA6`, PL `#B8860B`. El teal-500 de marca (`#0E8C7F`) no supera el piso de croma; ciruela y ámbar son extensión del producto porque el sistema solo trae tres familias. Asignación fija por país, nunca por orden de aparición; ocultar una serie no recolorea las demás.
- **Sin librerías de gráficas**: SVG a mano (~150 líneas), en línea con "sin librerías de componentes externas" y con la guía de marcas (líneas de 2 px, grilla hairline, marcadores con anillo de superficie, leyenda siempre presente con ≥ 2 series, etiquetas al final solo si no chocan, tabla gemela).

---

## Pendientes (deudas registradas, sin decidir)

- La Biblioteca de variables **no es un almacén de secretos**: no existe tipo secreto (tipos verificados: String, Integer, Number, Boolean, DateTime, Guid, referencias a ítems y conexiones). `ENTSOE_TOKEN` va como String, legible por quien tenga permiso de lectura sobre el ítem. Es lo que permite el acceso de la prueba; el paso siguiente en Grenergy sería Azure Key Vault con `notebookutils.credentials.getSecret`, que requiere registro de aplicación (D1).
- Hipótesis pendientes de confirmar en el navegador (marcadas también en `docs/fabric-setup.md`): que Fabric respete la etiqueta `parameters` de la celda al importar el `.ipynb` (si no, se marca a mano con "Toggle parameter cell"); que el formato JSON de `fabric/pipeline/pl_dayahead_daily.json` coincida con el de la integración Git de pipelines (es referencia, el pipeline se crea por UI); que `requests` esté en el runtime 1.3 (lo está en todos los runtimes de Fabric conocidos; la celda de imports fallaría de forma visible si no).
- El notebook evalúa la completitud **leyendo la tabla** después del `MERGE`, no con las filas que llegaron en la corrida. Así `load_control` refleja el estado real del Lakehouse aunque una corrida traiga menos filas que la anterior. La `source_published_at` de `load_control` se conserva si la corrida nueva no trae una (coalesce).
- PSE: `$select` no se probó en aislamiento. Rate limits de ENTSO-E (400 req/min documentados) no probados; la corrida hace una llamada por país y ventana, muy por debajo.
- Resample PT15M → PT60M y firma HMAC: lógica del lado de la API (Fase 3), con sus tests allá.
- Python local 3.9 vs runtime de Fabric 3.10/3.11. El módulo evita sintaxis posterior a 3.9.
- Backfill anterior al 2025-10-01 recibiría PT60M para ES y RO. El parser lo soporta; `load_control` calcularía 96 esperados contra 24 cargados y lo marcaría incompleto. No aplica a los 30 días de backfill previstos; si se ampliara, `sources_config.resolution` tendría que tener vigencia por fecha.
- `source_published_at` de SMARD es la generación del bloque semanal completo, no del día. Es lo mejor que expone la fuente.
- Retraso de D+1 observado el 26-ago a 14:35Z: SMARD seguía con el bloque generado el 25-ago 12:42Z (27-ago en `null`) y ENTSO-E aún no tenía el day-ahead rumano del 27. La ventana [D-3, D+1] lo absorbe al día siguiente; queda como evidencia de que "pendiente" es un estado normal, no una excepción.
