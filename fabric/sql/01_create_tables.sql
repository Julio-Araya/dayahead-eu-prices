-- =============================================================================
-- Lakehouse lh_dayahead: tablas Delta del pipeline de precios day-ahead.
-- Spark SQL. Idempotente (CREATE TABLE IF NOT EXISTS). Referencia legible del
-- esquema; el notebook nb_dayahead_ingest ejecuta exactamente estas sentencias
-- en su celda "ensure_tables" (fabric/build.py comprueba que no diverjan).
--
-- Decisiones citadas: D4 (modelo), D7 (día de mercado), D10 (corrida),
-- D11 (ts_utc), D12 (source_published_at), D13 (resolución). Ver docs/decisions.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tablas de precios: una por país, mismo esquema. Clave lógica (country_code, ts_utc).
-- Toda escritura es MERGE por esa clave: correr dos veces produce el mismo resultado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prices_es (
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
COMMENT 'Precios day-ahead de Espana (ENTSO-E, dominio 10YES-REE------0). Upsert por (country_code, ts_utc).';

CREATE TABLE IF NOT EXISTS prices_ro (
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
COMMENT 'Precios day-ahead de Rumania (ENTSO-E, dominio 10YRO-TEL------P; dia de mercado alineado a CET, D7). Upsert por (country_code, ts_utc).';

CREATE TABLE IF NOT EXISTS prices_de (
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
COMMENT 'Precios day-ahead de Alemania (SMARD, filtro 4169, horario). Upsert por (country_code, ts_utc).';

CREATE TABLE IF NOT EXISTS prices_pl (
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
COMMENT 'Precios day-ahead de Polonia (PSE rce-pln, PLN convertido a EUR con tasa BCE). Upsert por (country_code, ts_utc).';

-- -----------------------------------------------------------------------------
-- Configuracion de fuentes. Una fila por pais. Nada hardcodeado por pais en el codigo:
-- agregar un pais es agregar una fila; el notebook crea su tabla de destino si no existe.
-- -----------------------------------------------------------------------------
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
COMMENT 'Una fila por pais. Semilla: dayahead.config.DEFAULT_SOURCES. El notebook solo la carga si la tabla esta vacia.';

-- -----------------------------------------------------------------------------
-- Control de carga por pais y dia (D10). Un dia se marca complete solo cuando
-- loaded_slots = expected_slots. pending = la fuente aun no publico nada.
-- -----------------------------------------------------------------------------
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
COMMENT 'Estado de carga por pais y dia. Reemplaza cualquier watermark: la ventana [D-3, D+1] se reevalua en cada corrida.';

-- -----------------------------------------------------------------------------
-- Tasas de referencia del BCE. Sin filas en fines de semana ni festivos TARGET;
-- el carry forward (ultima fecha <= business_date) se resuelve al convertir.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date      DATE          COMMENT 'Fecha de publicacion de la tasa. Clave junto con currency',
  currency       STRING        COMMENT 'Moneda cotizada contra EUR, por ejemplo PLN',
  rate_to_eur    DECIMAL(14,6) COMMENT 'Unidades de currency por 1 EUR (serie EXR/D.<currency>.EUR.SP00.A del BCE)',
  source         STRING        COMMENT 'Origen de la tasa: ecb',
  fetched_at_utc TIMESTAMP     COMMENT 'Corrida que obtuvo o refresco la tasa'
) USING DELTA
COMMENT 'Tasas diarias de referencia del BCE usadas para convertir a EUR. Upsert por (rate_date, currency).';
