# %% [markdown]
# # nb_dayahead_ingest
#
# Ingesta diaria de precios day-ahead (ES, RO, DE, PL) al Lakehouse `lh_dayahead`.
#
# - Toda la lógica de parseo y transformación vive en el paquete puro `dayahead` (repo: `etl/`),
#   instalado desde el wheel que está en la carpeta **Resources** de este notebook (D16).
# - Spark se usa **solo para escribir**: `MERGE` en Delta por `(country_code, ts_utc)` (D17).
# - Corrida programada a las 18:00 UTC (D10; SMARD publicó D+1 a las 17:10Z el 26-ago) con ventana
#   `[D-3, D+1]`; un día queda `complete` solo
#   cuando los slots cargados igualan los esperados para su calendario DST. Si la fuente aún no
#   publicó, el día queda `pending`, no es error (D10).
# - El token de ENTSO-E se lee de la Biblioteca de variables del workspace. Nunca de una celda.
#
# Parámetros (celda siguiente): `start_date`, `end_date` (YYYY-MM-DD, vacíos = ventana por defecto),
# `countries` ("ES,RO", vacío = todos los activos en `sources_config`), `publish_to_api` (Fase 3),
# `build_gold_table` (D24: tabla `prices_all` para Power BI, apagada por defecto).

# %%
# Instala el paquete puro desde Resources. Debe ser la primera celda: en notebooks Spark, %pip
# reinicia el intérprete de Python y se pierden las variables definidas antes.
# Al actualizar el módulo: python fabric/build.py -> subir el .whl nuevo a Resources -> cambiar la versión acá.
# MAGIC %pip install "builtin/dayahead-0.2.0-py3-none-any.whl"

# %% parameters
# Celda de parámetros (marcada con "Toggle parameter cell"; el pipeline inserta una celda debajo
# con los valores de la actividad Notebook).
start_date = ""          # YYYY-MM-DD. Vacío = D-3 (D = fecha UTC de la corrida)
end_date = ""            # YYYY-MM-DD. Vacío = D+1
countries = ""           # Códigos separados por coma, p. ej. "ES,RO". Vacío = todos los activos
publish_to_api = False   # Fase 3: POST firmado con HMAC hacia la API. Apagado hasta entonces
build_gold_table = False # D24: regenerar prices_all (unión de las tablas por país) para Power BI
variable_library = "vl_dayahead"   # Nombre de la Biblioteca de variables con ENTSOE_TOKEN

# %%
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import requests
from delta.tables import DeltaTable
from pyspark.sql import functions as F
from pyspark.sql import types as T

import dayahead
from dayahead.adapters import entsoe, pse, smard
from dayahead.config import DEFAULT_SOURCES, SourceConfig
from dayahead.control import DayStatus, load_window
from dayahead.fx import ecb
from dayahead.gaps.slots import expected_slots, find_gaps
from dayahead.models import SourceNoData

# Los timestamps se manejan en UTC de punta a punta (CLAUDE.md, "Datos y pipeline").
spark.conf.set("spark.sql.session.timeZone", "UTC")

log = logging.getLogger("dayahead.ingest")
logging.getLogger().setLevel(logging.INFO)

RUN_STARTED = datetime.now(timezone.utc).replace(microsecond=0)
RUN_ID = RUN_STARTED.strftime("%Y%m%dT%H%M%SZ")
HTTP_HEADERS = {"User-Agent": "grenergy-dayahead/" + dayahead.__version__}
HTTP_TIMEOUT = 60
print(f"run_id={RUN_ID} dayahead={dayahead.__version__}")

# %%
# Token de ENTSO-E desde la Biblioteca de variables del workspace (mismo workspace, value set activo).
# Referencia verificada en la doc: notebookutils.variableLibrary.get("$(/**/<biblioteca>/<variable>)").
ENTSOE_TOKEN = notebookutils.variableLibrary.get(f"$(/**/{variable_library}/ENTSOE_TOKEN)")
if not ENTSOE_TOKEN or not isinstance(ENTSOE_TOKEN, str):
    raise RuntimeError(f"ENTSOE_TOKEN vacío o ausente en la Biblioteca de variables '{variable_library}'")
print(f"token leído de '{variable_library}' ({len(ENTSOE_TOKEN)} caracteres)")  # nunca imprimir el valor

# %% [markdown]
# ## Esquema: tablas de control y semilla de configuración
#
# Idempotente. Las sentencias son las mismas de `fabric/sql/01_create_tables.sql`
# (`fabric/build.py` comprueba que no diverjan). Las tablas de precios se crean por país a
# partir de `sources_config.target_table`, así que agregar un país no toca este notebook.

# %%
PRICE_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS {table} (
  country_code        STRING        COMMENT 'Codigo del mercado (ISO 3166 alfa-2): ES, RO, DE, PL',
  ts_utc              TIMESTAMP     COMMENT 'Inicio del intervalo de entrega, en UTC (D11)',
  resolution          STRING        COMMENT 'Duracion del intervalo tal como la publico la fuente: PT15M o PT60M (D13)',
  business_date_local DATE          COMMENT 'Dia de mercado segun sources_config.market_tz de la fuente (D7)',
  price_original      DECIMAL(14,4) COMMENT 'Precio publicado por la fuente, en currency_original por MWh',
  currency_original   STRING        COMMENT 'Moneda de price_original: EUR o PLN',
  price_eur           DECIMAL(14,4) COMMENT 'Precio en EUR/MWh = price_original / fx_rate, redondeado a 4 decimales',
  fx_rate             DECIMAL(14,6) COMMENT 'Unidades de currency_original por 1 EUR usadas en la conversion; 1 para EUR',
  fx_rate_date        DATE          COMMENT 'Fecha de la tasa del BCE usada (ultima fecha <= business_date_local); igual a business_date_local para EUR',
  source              STRING        COMMENT 'Adaptador de origen: entsoe, smard o pse',
  source_published_at TIMESTAMP     COMMENT 'Sello de la fuente (D12): createdDateTime as-of en ENTSO-E, meta_data.created del bloque en SMARD, publication_ts_utc en PSE',
  ingested_at_utc     TIMESTAMP     COMMENT 'Inicio de la corrida del notebook que escribio o actualizo la fila'
) USING DELTA
COMMENT '{comment}'
"""

PRICE_TABLE_COMMENTS = {
    "prices_es": "Precios day-ahead de Espana (ENTSO-E, dominio 10YES-REE------0). Upsert por (country_code, ts_utc).",
    "prices_ro": "Precios day-ahead de Rumania (ENTSO-E, dominio 10YRO-TEL------P; dia de mercado alineado a CET, D7). Upsert por (country_code, ts_utc).",
    "prices_de": "Precios day-ahead de Alemania (SMARD, filtro 4169, horario). Upsert por (country_code, ts_utc).",
    "prices_pl": "Precios day-ahead de Polonia (PSE rce-pln, PLN convertido a EUR con tasa BCE). Upsert por (country_code, ts_utc).",
}

CONTROL_TABLES_DDL = [
    """
CREATE TABLE IF NOT EXISTS sources_config (
  country_code   STRING    COMMENT 'Clave. Codigo del mercado',
  adapter        STRING    COMMENT 'Adaptador del modulo dayahead: entsoe, smard o pse',
  market_tz      STRING    COMMENT 'Zona IANA del dia de mercado que publica la fuente (D7): Europe/Madrid, CET, Europe/Berlin, Europe/Warsaw',
  currency       STRING    COMMENT 'Moneda en que publica la fuente: EUR o PLN',
  resolution     STRING    COMMENT 'Resolucion esperada, usada para calcular los slots de un dia: PT15M o PT60M',
  params         STRING    COMMENT 'JSON con parametros del adaptador: domain y contract_type (entsoe); filter, region, index, block (smard); endpoint, price_field (pse)',
  target_table   STRING    COMMENT 'Tabla Delta de destino en este Lakehouse, por ejemplo prices_es',
  active         BOOLEAN   COMMENT 'false = el pais se omite en la corrida sin borrar su configuracion',
  updated_at_utc TIMESTAMP COMMENT 'Ultima modificacion de la fila'
) USING DELTA
COMMENT 'Una fila por pais. Semilla: dayahead.config.DEFAULT_SOURCES. El notebook solo la carga si la tabla esta vacia.'
""",
    """
CREATE TABLE IF NOT EXISTS load_control (
  country_code        STRING    COMMENT 'Clave junto con business_date_local',
  business_date_local DATE      COMMENT 'Dia de mercado evaluado',
  expected_slots      INT       COMMENT 'Slots esperados segun resolucion y calendario DST de market_tz: 96, 92 o 100 para PT15M; 24, 23 o 25 para PT60M',
  loaded_slots        INT       COMMENT 'Slots presentes en la tabla de precios despues de la corrida',
  status              STRING    COMMENT 'complete, incomplete, pending o error (D10)',
  source_published_at TIMESTAMP COMMENT 'Sello de la fuente para las filas del dia (D12); null si pendiente',
  last_attempt_utc    TIMESTAMP COMMENT 'Ultima corrida que evaluo el dia',
  last_success_utc    TIMESTAMP COMMENT 'Ultima corrida en que el dia quedo complete; null si nunca',
  last_error          STRING    COMMENT 'Mensaje del ultimo error de la fuente; null si la ultima corrida no fallo',
  run_id              STRING    COMMENT 'Identificador de la corrida: fecha y hora UTC de inicio'
) USING DELTA
COMMENT 'Estado de carga por pais y dia. Reemplaza cualquier watermark: la ventana [D-3, D+1] se reevalua en cada corrida.'
""",
    """
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date      DATE          COMMENT 'Fecha de publicacion de la tasa. Clave junto con currency',
  currency       STRING        COMMENT 'Moneda cotizada contra EUR, por ejemplo PLN',
  rate_to_eur    DECIMAL(14,6) COMMENT 'Unidades de currency por 1 EUR (serie EXR/D.<currency>.EUR.SP00.A del BCE)',
  source         STRING        COMMENT 'Origen de la tasa: ecb',
  fetched_at_utc TIMESTAMP     COMMENT 'Corrida que obtuvo o refresco la tasa'
) USING DELTA
COMMENT 'Tasas diarias de referencia del BCE usadas para convertir a EUR. Upsert por (rate_date, currency).'
""",
]

SOURCES_SCHEMA = T.StructType([
    T.StructField("country_code", T.StringType(), False),
    T.StructField("adapter", T.StringType(), False),
    T.StructField("market_tz", T.StringType(), False),
    T.StructField("currency", T.StringType(), False),
    T.StructField("resolution", T.StringType(), False),
    T.StructField("params", T.StringType(), False),
    T.StructField("target_table", T.StringType(), False),
    T.StructField("active", T.BooleanType(), False),
    T.StructField("updated_at_utc", T.TimestampType(), False),
])


def ensure_price_table(table: str) -> None:
    comment = PRICE_TABLE_COMMENTS.get(table, "Precios day-ahead. Upsert por (country_code, ts_utc). Tabla creada por nb_dayahead_ingest.")
    spark.sql(PRICE_TABLE_DDL.format(table=table, comment=comment))


def ensure_tables() -> None:
    for ddl in CONTROL_TABLES_DDL:
        spark.sql(ddl)
    if spark.table("sources_config").count() == 0:
        rows = []
        for c in DEFAULT_SOURCES:
            r = c.to_row()
            r["target_table"] = f"prices_{c.country_code.lower()}"
            r["updated_at_utc"] = RUN_STARTED
            rows.append(r)
        spark.createDataFrame(rows, SOURCES_SCHEMA).write.format("delta").mode("append").saveAsTable("sources_config")
        print(f"sources_config sembrada con {len(rows)} filas desde dayahead.config.DEFAULT_SOURCES")


ensure_tables()

# %% [markdown]
# ## Ventana de carga y países

# %%
run_date = RUN_STARTED.date()
default_window = load_window(run_date)  # [D-3, D+1]
window_start = date.fromisoformat(start_date) if start_date else default_window[0]
window_end = date.fromisoformat(end_date) if end_date else default_window[-1]
if window_end < window_start:
    raise ValueError(f"end_date {window_end} anterior a start_date {window_start}")
days = [window_start + timedelta(days=i) for i in range((window_end - window_start).days + 1)]

config_rows = [r.asDict() for r in spark.table("sources_config").collect()]
wanted = {c.strip().upper() for c in countries.split(",") if c.strip()}
known = {r["country_code"] for r in config_rows}
if wanted - known:
    raise ValueError(f"países sin fila en sources_config: {sorted(wanted - known)}")
selected = [r for r in config_rows if r["active"] and (not wanted or r["country_code"] in wanted)]
configs = [(SourceConfig.from_row(r), r["target_table"]) for r in selected]
for cfg, table in configs:
    ensure_price_table(table)

print(f"ventana {window_start} -> {window_end} ({len(days)} días) | países: {[c.country_code for c, _ in configs]}")

# %% [markdown]
# ## Utilidades HTTP y escritura Delta

# %%
class HttpError(RuntimeError):
    pass


def http_get(url: str, params=None, retries: int = 3) -> requests.Response:
    """GET con reintentos ante 429/5xx y errores de red. Nunca registra los parámetros (llevan el token)."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, headers=HTTP_HEADERS, timeout=HTTP_TIMEOUT)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise HttpError(f"HTTP {resp.status_code} en {url}")
            return resp
        except (requests.RequestException, HttpError) as e:  # noqa: PERF203
            last = e
            log.warning("intento %d/%d falló: %s", attempt, retries, e)
            time.sleep(5 * attempt)
    raise HttpError(f"agotados {retries} intentos contra {url}: {last}")


PRICE_SCHEMA = T.StructType([
    T.StructField("country_code", T.StringType(), False),
    T.StructField("ts_utc", T.TimestampType(), False),
    T.StructField("resolution", T.StringType(), False),
    T.StructField("business_date_local", T.DateType(), False),
    T.StructField("price_original", T.DecimalType(14, 4), False),
    T.StructField("currency_original", T.StringType(), False),
    T.StructField("price_eur", T.DecimalType(14, 4), False),
    T.StructField("fx_rate", T.DecimalType(14, 6), False),
    T.StructField("fx_rate_date", T.DateType(), False),
    T.StructField("source", T.StringType(), False),
    T.StructField("source_published_at", T.TimestampType(), True),
    T.StructField("ingested_at_utc", T.TimestampType(), False),
])

CONTROL_SCHEMA = T.StructType([
    T.StructField("country_code", T.StringType(), False),
    T.StructField("business_date_local", T.DateType(), False),
    T.StructField("expected_slots", T.IntegerType(), False),
    T.StructField("loaded_slots", T.IntegerType(), False),
    T.StructField("status", T.StringType(), False),
    T.StructField("source_published_at", T.TimestampType(), True),
    T.StructField("last_attempt_utc", T.TimestampType(), False),
    T.StructField("last_success_utc", T.TimestampType(), True),
    T.StructField("last_error", T.StringType(), True),
    T.StructField("run_id", T.StringType(), False),
])

FX_SCHEMA = T.StructType([
    T.StructField("rate_date", T.DateType(), False),
    T.StructField("currency", T.StringType(), False),
    T.StructField("rate_to_eur", T.DecimalType(14, 6), False),
    T.StructField("source", T.StringType(), False),
    T.StructField("fetched_at_utc", T.TimestampType(), False),
])

Q4 = Decimal("0.0001")
Q6 = Decimal("0.000001")


def price_rows(records):
    for r in records:
        yield (
            r.country_code, r.ts_utc, r.resolution, r.business_date_local,
            r.price_original.quantize(Q4, rounding=ROUND_HALF_UP), r.currency_original,
            r.price_eur.quantize(Q4, rounding=ROUND_HALF_UP), r.fx_rate.quantize(Q6, rounding=ROUND_HALF_UP), r.fx_rate_date,
            r.source, r.source_published_at, RUN_STARTED,
        )


def merge_into(table: str, df, keys) -> None:
    """Upsert idempotente: mismas filas dos veces producen el mismo resultado."""
    cond = " AND ".join(f"t.{k} = s.{k}" for k in keys)
    (DeltaTable.forName(spark, table).alias("t")
        .merge(df.alias("s"), cond)
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute())


def merge_control(rows) -> None:
    """load_control: last_success_utc se conserva si la fila nueva no lo trae."""
    if not rows:
        return
    df = spark.createDataFrame(rows, CONTROL_SCHEMA)
    (DeltaTable.forName(spark, "load_control").alias("t")
        .merge(df.alias("s"), "t.country_code = s.country_code AND t.business_date_local = s.business_date_local")
        .whenMatchedUpdate(set={
            "expected_slots": "s.expected_slots",
            "loaded_slots": "s.loaded_slots",
            "status": "s.status",
            "source_published_at": "coalesce(s.source_published_at, t.source_published_at)",
            "last_attempt_utc": "s.last_attempt_utc",
            "last_success_utc": "coalesce(s.last_success_utc, t.last_success_utc)",
            "last_error": "s.last_error",
            "run_id": "s.run_id",
        })
        .whenNotMatchedInsertAll()
        .execute())


def loaded_timestamps(table: str, day: date):
    """ts_utc presentes en la tabla para un día, leídos como epoch para no depender de la zona del driver."""
    rows = (spark.table(table)
            .where(F.col("business_date_local") == F.lit(day))
            .select(F.unix_timestamp("ts_utc").alias("epoch"))
            .collect())
    return [datetime.fromtimestamp(r["epoch"], tz=timezone.utc) for r in rows]


def evaluate_from_table(cfg: SourceConfig, table: str, day: date):
    expected = expected_slots(day, cfg.market_tz, cfg.resolution)
    missing = find_gaps(loaded_timestamps(table, day), day, cfg.market_tz, cfg.resolution)
    loaded = expected - len(missing)
    if loaded == 0:
        status = DayStatus.PENDING
    elif missing:
        status = DayStatus.INCOMPLETE
    else:
        status = DayStatus.COMPLETE
    return expected, loaded, status

# %% [markdown]
# ## Tipo de cambio (BCE)
#
# Se piden 10 días antes de la ventana para garantizar una tasa previa (fines de semana, festivos TARGET).
# Solo para las monedas distintas de EUR que aparezcan en la configuración.

# %%
currencies = sorted({cfg.currency for cfg, _ in configs if cfg.currency != ecb.EUR})
rates_by_currency = {}
fx_rows = []
for cur in currencies:
    req = ecb.build_request(window_start, window_end, currency=cur)
    resp = http_get(req.url, req.params)
    if resp.status_code != 200:
        raise HttpError(f"BCE {cur}: HTTP {resp.status_code}")
    rates = ecb.parse_csv(resp.text)
    if not rates:
        raise HttpError(f"BCE {cur}: respuesta sin tasas entre {req.params['startPeriod']} y {req.params['endPeriod']}")
    rates_by_currency[cur] = rates
    fx_rows.extend((d, cur, v.quantize(Q6, rounding=ROUND_HALF_UP), ecb.FX_SOURCE, RUN_STARTED) for d, v in rates.items())
    print(f"BCE {cur}: {len(rates)} tasas, última {max(rates)} = {rates[max(rates)]}")
if fx_rows:
    merge_into("fx_rates", spark.createDataFrame(fx_rows, FX_SCHEMA), ["rate_date", "currency"])

# %% [markdown]
# ## Ingesta por país
#
# Por cada país: una llamada (o las mínimas) para toda la ventana, parseo con el módulo puro,
# conversión a EUR, `MERGE` en su tabla, y evaluación de cada día **leyendo la tabla** (no lo
# que llegó en esta corrida), para que `load_control` refleje el estado real tras el upsert.
# Un error en un país no detiene a los demás; al final la corrida falla si alguno falló.

# %%
def fetch_records(cfg: SourceConfig, d0: date, d1: date):
    if cfg.adapter == "entsoe":
        req = entsoe.build_request(cfg, d0, d1, ENTSOE_TOKEN)
        resp = http_get(req.url, req.params)
        try:
            return entsoe.parse_document(resp.content, cfg, resp.status_code)
        except entsoe.EntsoeAcknowledgement as ack:
            if ack.is_no_data:
                return []  # la fuente aún no publicó: días pendientes, no error (D10)
            raise
        except SourceNoData:
            return []
    if cfg.adapter == "smard":
        index = smard.parse_index(http_get(smard.index_request(cfg).url).json())
        blocks = smard.blocks_for_range(index, cfg, d0, d1)
        payloads = [http_get(smard.block_request(cfg, b).url).json() for b in blocks]
        return smard.parse_blocks(payloads, cfg, d0, d1)
    if cfg.adapter == "pse":
        def fetch(url, params):
            resp = http_get(url, params)
            if resp.status_code != 200:
                raise HttpError(f"PSE HTTP {resp.status_code}")
            return resp.json()
        return pse.fetch_all(pse.build_request(cfg, d0, d1), cfg, fetch)
    raise ValueError(f"adaptador desconocido: {cfg.adapter}")


summary = []      # (country, day, status, loaded, expected, published_at)
failures = {}     # country -> mensaje
all_records = []  # para publish_to_api (Fase 3)

for cfg, table in configs:
    cc = cfg.country_code
    try:
        records = fetch_records(cfg, window_start, window_end)
        if records:
            if cfg.currency != ecb.EUR:
                records = ecb.apply_fx(records, rates_by_currency[cfg.currency])
            else:
                records = ecb.apply_fx(records, {})
            df = spark.createDataFrame(list(price_rows(records)), PRICE_SCHEMA)
            merge_into(table, df, ["country_code", "ts_utc"])
            all_records.extend(records)
        published = {}
        for r in records:
            if r.source_published_at and (r.business_date_local not in published or r.source_published_at > published[r.business_date_local]):
                published[r.business_date_local] = r.source_published_at
        control_rows = []
        for day in days:
            expected, loaded, status = evaluate_from_table(cfg, table, day)
            control_rows.append((
                cc, day, expected, loaded, status.value, published.get(day), RUN_STARTED,
                RUN_STARTED if status == DayStatus.COMPLETE else None, None, RUN_ID,
            ))
            summary.append((cc, day, status.value, loaded, expected, published.get(day)))
        merge_control(control_rows)
        log.info("%s: %d filas recibidas, MERGE en %s", cc, len(records), table)
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:900]}"
        failures[cc] = msg
        log.error("%s falló: %s", cc, msg)
        control_rows = []
        for day in days:
            try:
                expected, loaded, _ = evaluate_from_table(cfg, table, day)
            except Exception:  # noqa: BLE001
                expected, loaded = 0, 0
            control_rows.append((cc, day, expected, loaded, "error", None, RUN_STARTED, None, msg, RUN_ID))
            summary.append((cc, day, "error", loaded, expected, None))
        merge_control(control_rows)

# %% [markdown]
# ## Publicación hacia la API (Fase 3)
#
# Con `publish_to_api=True` el notebook envía las filas de la corrida y las filas de `load_control`
# al endpoint `POST /v1/ingest` de la API, firmadas con HMAC SHA256 (D18). Necesita dos variables más
# en la Biblioteca de variables: `INGEST_API_URL` (String) e `INGEST_HMAC_SECRET` (String). El módulo
# `dayahead.publish` construye cuerpo, cabeceras y firma; acá solo se hace el POST.

# %%
def publish_run(records, control_rows) -> None:
    import uuid
    from dayahead import publish  # requiere wheel >= 0.2.0

    api_url = notebookutils.variableLibrary.get(f"$(/**/{variable_library}/INGEST_API_URL)")
    secret = notebookutils.variableLibrary.get(f"$(/**/{variable_library}/INGEST_HMAC_SECRET)")
    if not api_url or not secret:
        raise RuntimeError(f"faltan INGEST_API_URL o INGEST_HMAC_SECRET en la Biblioteca de variables '{variable_library}'")
    payloads = publish.build_payloads(RUN_ID, RUN_STARTED, records, control_rows)
    for payload in payloads:
        req = publish.build_ingest_request(api_url, secret, payload, int(time.time()), str(uuid.uuid4()))
        last = None
        for attempt in range(1, 4):
            resp = requests.post(req.url, data=req.body, headers=req.headers, timeout=HTTP_TIMEOUT)
            if resp.status_code == 200:
                body = resp.json()
                print(f"publicado parte {payload['part']}/{payload['parts']}: {body.get('prices_upserted')} precios, {body.get('load_control_upserted')} control")
                break
            last = f"HTTP {resp.status_code}: {resp.text[:300]}"
            if resp.status_code in (400, 401, 409):
                break  # firma, cuerpo o replay: reintentar no ayuda
            time.sleep(5 * attempt)
        else:
            raise HttpError(f"publicación parte {payload['part']}: {last}")
        if last and resp.status_code != 200:
            raise HttpError(f"publicación parte {payload['part']}: {last}")


if publish_to_api:
    control_payload = [
        {"country_code": cc, "business_date_local": day, "expected_slots": expected, "loaded_slots": loaded, "status": status,
         "source_published_at": published, "last_attempt_utc": RUN_STARTED,
         "last_success_utc": RUN_STARTED if status == "complete" else None, "last_error": failures.get(cc), "run_id": RUN_ID}
        for cc, day, status, loaded, expected, published in summary
    ]
    publish_run(all_records, control_payload)
else:
    print("publish_to_api=False: no se publica hacia la API")

# %% [markdown]
# ## Tabla gold para Power BI (opcional, D24)
#
# `prices_all` = unión de las tablas de precios por país, reescrita entera en cada corrida
# (~12.000 filas con 30 días). Direct Lake no admite vistas SQL sin caer a DirectQuery, por eso
# se materializa. Las tablas por país siguen siendo la fuente de verdad.

# %%
GOLD_TABLE = "prices_all"

def build_gold(tables) -> int:
    union_sql = " UNION ALL ".join(f"SELECT * FROM {t}" for t in tables)
    spark.sql(
        f"CREATE OR REPLACE TABLE {GOLD_TABLE} USING DELTA "
        f"COMMENT 'Union de las tablas de precios por pais para Power BI (gold, D24). Se regenera entera en cada corrida.' "
        f"AS {union_sql}"
    )
    return spark.table(GOLD_TABLE).count()


if build_gold_table:
    gold_sources = [t for _, t in configs]
    print(f"{GOLD_TABLE}: {build_gold(gold_sources)} filas desde {gold_sources}")
else:
    print(f"build_gold_table=False: no se regenera {GOLD_TABLE}")

# %% [markdown]
# ## Resumen de la corrida

# %%
print(f"\nrun_id={RUN_ID}  ventana {window_start} -> {window_end}\n")
print(f"{'país':4} | {'día':10} | {'estado':10} | {'cargados/esperados':18} | source_published_at")
print("-" * 80)
for cc, day, status, loaded, expected, published in summary:
    print(f"{cc:4} | {day.isoformat()} | {status:10} | {loaded:>7}/{expected:<10} | {published.isoformat() if published else '-'}")

exit_value = {
    "run_id": RUN_ID,
    "window": [window_start.isoformat(), window_end.isoformat()],
    "countries": [c.country_code for c, _ in configs],
    "complete": sum(1 for s in summary if s[2] == "complete"),
    "incomplete": sum(1 for s in summary if s[2] == "incomplete"),
    "pending": sum(1 for s in summary if s[2] == "pending"),
    "error": sorted(failures),
}
print("\n" + json.dumps(exit_value))

if failures:
    # Se escribió todo lo que se pudo; ahora sí la corrida falla para que el pipeline lo muestre.
    raise RuntimeError("fuentes con error: " + "; ".join(f"{k}: {v}" for k, v in failures.items()))

notebookutils.notebook.exit(json.dumps(exit_value))
