-- 001_init: capa de servicio en Supabase Postgres (BRIEF D4, decisiones D18-D20).
-- Idempotente: se puede aplicar tantas veces como haga falta.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- Réplica de las tablas de precios de Fabric en una sola tabla. Misma semántica de columnas
-- que fabric/sql/01_create_tables.sql. Clave única (country_code, ts_utc); toda escritura es upsert.
CREATE TABLE IF NOT EXISTS prices (
  country_code         text          NOT NULL,
  ts_utc               timestamptz   NOT NULL,
  resolution           text          NOT NULL,
  business_date_local  date          NOT NULL,
  price_original       numeric(14,4) NOT NULL,
  currency_original    text          NOT NULL,
  price_eur            numeric(14,4) NOT NULL,
  fx_rate              numeric(14,6) NOT NULL,
  fx_rate_date         date          NOT NULL,
  source               text          NOT NULL,
  source_published_at  timestamptz,
  ingested_at_utc      timestamptz   NOT NULL,
  received_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, ts_utc)
);
CREATE INDEX IF NOT EXISTS prices_country_business_date_idx ON prices (country_code, business_date_local);

COMMENT ON TABLE prices IS 'Precios day-ahead publicados por Fabric (POST /v1/ingest firmado con HMAC). Upsert por (country_code, ts_utc).';
COMMENT ON COLUMN prices.ts_utc IS 'Inicio del intervalo de entrega, UTC (D11)';
COMMENT ON COLUMN prices.resolution IS 'PT15M o PT60M, tal como lo publico la fuente (D13)';
COMMENT ON COLUMN prices.business_date_local IS 'Dia de mercado segun la zona de la fuente (D7)';
COMMENT ON COLUMN prices.price_eur IS 'price_original / fx_rate, 4 decimales';
COMMENT ON COLUMN prices.fx_rate_date IS 'Fecha de la tasa BCE usada; = business_date_local para EUR';
COMMENT ON COLUMN prices.source_published_at IS 'Sello de la fuente (D12); as-of para ENTSO-E';
COMMENT ON COLUMN prices.received_at IS 'Cuando la API recibio la fila (ultimo upsert)';

-- Réplica de load_control para la página de calidad de datos y el estado "desactualizado" de la interfaz.
CREATE TABLE IF NOT EXISTS load_control (
  country_code         text        NOT NULL,
  business_date_local  date        NOT NULL,
  expected_slots       integer     NOT NULL,
  loaded_slots         integer     NOT NULL,
  status               text        NOT NULL CHECK (status IN ('complete', 'incomplete', 'pending', 'error')),
  source_published_at  timestamptz,
  last_attempt_utc     timestamptz NOT NULL,
  last_success_utc     timestamptz,
  last_error           text,
  run_id               text        NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, business_date_local)
);

COMMENT ON TABLE load_control IS 'Estado de carga por pais y dia, replicado desde Fabric (D10).';

-- Catálogo de países expuesto por la API. Configuración, no código: agregar un país es una fila.
CREATE TABLE IF NOT EXISTS countries (
  country_code  text PRIMARY KEY,
  name          text NOT NULL,
  market_tz     text NOT NULL,
  currency      text NOT NULL,
  resolution    text NOT NULL,
  source        text NOT NULL,
  active        boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE countries IS 'Catalogo de mercados para la API y la interfaz. Espejo de sources_config en Fabric.';

-- API keys de solo lectura. Se guarda el hash SHA-256 de la clave, nunca la clave (D19).
CREATE TABLE IF NOT EXISTS api_keys (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text        NOT NULL,
  key_hash               text        NOT NULL UNIQUE,
  key_prefix             text        NOT NULL,
  scope                  text        NOT NULL DEFAULT 'read' CHECK (scope IN ('read')),
  rate_limit_per_minute  integer     NOT NULL DEFAULT 120,
  active                 boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at           timestamptz
);

COMMENT ON TABLE api_keys IS 'Claves de lectura. key_hash = sha256(clave) en hex; key_prefix = primeros 8 caracteres, solo para identificarla.';

-- Nonces vistos por el endpoint de ingestión (anti-replay, junto con la ventana de timestamp, D18).
CREATE TABLE IF NOT EXISTS ingest_nonces (
  nonce     text PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingest_nonces_seen_at_idx ON ingest_nonces (seen_at);

-- Bitácora de ingestiones recibidas, para diagnóstico y para la página de calidad de datos.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id            bigserial PRIMARY KEY,
  run_id        text        NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  prices_rows   integer     NOT NULL,
  control_rows  integer     NOT NULL,
  countries     text[]      NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_runs_received_at_idx ON ingest_runs (received_at DESC);
