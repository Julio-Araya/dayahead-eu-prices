-- 002_seed_countries: catálogo inicial. Idempotente (ON CONFLICT actualiza).
INSERT INTO countries (country_code, name, market_tz, currency, resolution, source, active) VALUES
  ('ES', 'España',   'Europe/Madrid', 'EUR', 'PT15M', 'entsoe', true),
  ('RO', 'Rumania',  'CET',           'EUR', 'PT15M', 'entsoe', true),
  ('DE', 'Alemania', 'Europe/Berlin', 'EUR', 'PT60M', 'smard',  true),
  ('PL', 'Polonia',  'Europe/Warsaw', 'PLN', 'PT15M', 'pse',    true)
ON CONFLICT (country_code) DO UPDATE SET
  name = EXCLUDED.name, market_tz = EXCLUDED.market_tz, currency = EXCLUDED.currency,
  resolution = EXCLUDED.resolution, source = EXCLUDED.source;
