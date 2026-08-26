# db — migraciones de la capa de servicio (Supabase Postgres)

SQL escrito a mano, idempotente, aplicado en orden por nombre. El runner (`api/src/db/migrate.ts`) registra cada archivo en `schema_migrations` y salta los ya aplicados.

```
cd api
cp ../.env.example ../.env     # si no existe; completar DATABASE_URL
npm run migrate
```

Alternativa sin Node: pegar cada archivo en el SQL editor de Supabase en orden. Como son idempotentes, aplicarlos dos veces no rompe nada (solo `schema_migrations` no se actualizaría, y `migrate` los volvería a aplicar sin efecto).

| Archivo | Contenido |
|---|---|
| `001_init.sql` | `prices`, `load_control`, `countries`, `api_keys`, `ingest_nonces`, `ingest_runs`, `schema_migrations` |
| `002_seed_countries.sql` | catálogo ES, RO, DE, PL |
