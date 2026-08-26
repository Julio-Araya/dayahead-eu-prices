# fabric — artefactos de la Fase 2

Lo que se crea en el workspace de Fabric y cómo se regenera desde el repo. La guía paso a paso para hacerlo en el navegador está en `docs/fabric-setup.md`.

```
fabric/
  build.py                          genera los .ipynb, comprueba el DDL y construye el wheel
  sql/01_create_tables.sql          DDL de referencia con comentarios por columna (7 tablas)
  notebooks/nb_dayahead_ingest.py   fuente del notebook de ingesta (formato percent, compilable)
  notebooks/nb_dayahead_ingest.ipynb  generado: es el que se importa en Fabric
  pipeline/pl_dayahead_daily.json   referencia de la configuración del pipeline
  dist/                             (ignorado por git) wheel construido: dayahead-<versión>-py3-none-any.whl
```

## Regenerar

```
python3 -m pip install build
python3 fabric/build.py
```

`build.py` falla si el DDL del notebook y el `.sql` divergen, o si la celda `%pip` del notebook no referencia el wheel que acaba de construir. Cuando cambie `etl/dayahead`: subir la versión en `etl/pyproject.toml` y en la celda `%pip` del notebook, correr `build.py`, subir el wheel nuevo a Resources del notebook y reimportar (o pegar) el notebook.

## Elementos del workspace

| Elemento | Nombre | Función |
|---|---|---|
| Lakehouse | `lh_dayahead` | 4 tablas de precios, `sources_config`, `load_control`, `fx_rates` |
| Biblioteca de variables | `vl_dayahead` | `ENTSOE_TOKEN` (String) |
| Notebook | `nb_dayahead_ingest` | ingesta; crea las tablas si faltan y siembra `sources_config` |
| Pipeline | `pl_dayahead_daily` | actividad Notebook, schedule diario 18:00 UTC, parámetros para backfill |
