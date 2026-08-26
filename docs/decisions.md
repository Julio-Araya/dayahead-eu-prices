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

## D10. Corrida diaria: 16:00 UTC, ventana [D-3, D+1], completitud por slots (2026-08-26)

**Contexto.** Las cuatro fuentes publican el día D+1 a distintas horas: ENTSO-E y PSE alrededor de las 12:45-13:00 CET, SMARD con retraso variable (a las 13:35Z del 26-ago el 27-ago aún venía en `null`). El BCE publica la tasa del día ~16:15 CET. Un watermark simple ("último día cargado") no sirve: un día puede estar parcialmente publicado y una fuente puede corregir datos.

**Decisión.**
- Schedule diario a las **16:00 UTC**. A esa hora D+1 está publicado en ENTSO-E y PSE con margen, SMARD suele estarlo, y la tasa del BCE del día ya salió.
- En cada corrida se procesa la ventana **[D-3, D+1]** por país, donde D es la fecha UTC de la corrida. Toda escritura es upsert por `(country_code, ts_utc)`, así que reprocesar días ya completos es inocuo y absorbe correcciones tardías.
- Un día se marca **completo** solo cuando `slots cargados = slots esperados` para su granularidad y su calendario DST (96/92/100 para PT15M, 24/23/25 para PT60M), calculados desde `market_tz`.
- Si un día no tiene datos (D+1 antes de publicación) el estado es **pendiente**, no error. Se reintenta en la siguiente corrida. Un día con datos pero incompleto queda **incompleto** y también se reintenta.
- Esto reemplaza cualquier lógica de watermark.

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

---

## Pendientes (deudas registradas, sin decidir)

- PSE: `$select` no se probó en aislamiento. Rate limits de ENTSO-E (400 req/min documentados) no probados; la corrida hace una llamada por país y ventana, muy por debajo.
- Resample PT15M → PT60M y firma HMAC: lógica del lado de la API (Fase 3), con sus tests allá.
- Python local 3.9 vs runtime de Fabric 3.10/3.11. El módulo evita sintaxis posterior a 3.9.
- Backfill anterior al 2025-10-01 recibiría PT60M para ES y RO. El parser lo soporta; `load_control` calcularía 96 esperados contra 24 cargados y lo marcaría incompleto. No aplica a los 30 días de backfill previstos; si se ampliara, `sources_config.resolution` tendría que tener vigencia por fecha.
- `source_published_at` de SMARD es la generación del bloque semanal completo, no del día. Es lo mejor que expone la fuente.
- Retraso de D+1 observado el 26-ago a 14:35Z: SMARD seguía con el bloque generado el 25-ago 12:42Z (27-ago en `null`) y ENTSO-E aún no tenía el day-ahead rumano del 27. La ventana [D-3, D+1] lo absorbe al día siguiente; queda como evidencia de que "pendiente" es un estado normal, no una excepción.
