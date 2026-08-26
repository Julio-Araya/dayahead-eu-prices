# Guía: reporte Power BI sobre el Lakehouse

Extra mile 4 del BRIEF. Paso a paso en el navegador. Verificado contra la documentación oficial (julio 2026): desde el 5 de septiembre de 2025 **los modelos semánticos por defecto ya no se crean automáticamente** al crear un Lakehouse; hay que crear uno a mano. Lo marcado **[hipótesis]** son etiquetas de la interfaz que pueden variar.

Tiempo estimado: 30-40 minutos.

## 0. Una tabla unida para la comparativa (opcional pero recomendado)

Direct Lake no permite consultas Power Query ni vistas SQL sin caer a DirectQuery, y el modelo tiene una tabla de precios por país. Para un visual multipaís en un solo gráfico conviene una tabla **gold** con las cuatro unidas. Es una celda al final de `nb_dayahead_ingest`, idempotente (se reescribe entera en cada corrida; son ~12.000 filas con 30 días):

```python
# Tabla gold para BI: unión de las tablas por país (D24). Se reescribe entera en cada corrida.
tables = [t for _, t in configs]
union_sql = " UNION ALL ".join(f"SELECT * FROM {t}" for t in tables)
spark.sql(f"CREATE OR REPLACE TABLE prices_all USING DELTA COMMENT 'Union de las tablas de precios por pais para Power BI (gold). Se regenera en cada corrida.' AS {union_sql}")
print(f"prices_all: {spark.table('prices_all').count()} filas desde {tables}")
```

Pégala como última celda de código antes del resumen, ejecuta el notebook una vez y comprueba que aparece `prices_all` en `Tables`. Si prefieres no tocar el notebook, el reporte funciona igual con una página por país (paso 3).

## 1. Crear el modelo semántico

1. Abre `lh_dayahead`. En la cinta, **New semantic model** (**[hipótesis]** puede estar bajo el botón *New Power BI semantic model* o en el menú del SQL analytics endpoint).
2. Nombre: `sm_dayahead_prices`. Workspace: el mismo.
3. Selecciona las tablas: `prices_all` (si la creaste), `prices_es`, `prices_ro`, `prices_de`, `prices_pl`, `load_control`, `sources_config`, `fx_rates`. **Confirm**.

Deberías ver: el modelo abierto en la vista de modelado web, con las tablas como cajas y modo de almacenamiento **Direct Lake** (aparece en la barra inferior o en las propiedades de cada tabla). No hay refresco que programar: Direct Lake lee los archivos Delta y se actualiza solo tras cada corrida del notebook.

## 2. Modelar lo mínimo

En la vista de modelado (**Open data model** si se cerró):

1. **Relación** `prices_all[country_code]` → `sources_config[country_code]` (muchos a uno, filtro en una dirección). Sirve para filtrar por país con nombre de adaptador y zona.
2. **Medidas** en `prices_all` (**New measure**):
   - `Precio medio EUR = AVERAGE(prices_all[price_eur])`
   - `Precio mínimo EUR = MIN(prices_all[price_eur])`
   - `Precio máximo EUR = MAX(prices_all[price_eur])`
   - `Slots cargados = COUNTROWS(prices_all)`
3. **Medidas** en `load_control`:
   - `Días completos = CALCULATE(COUNTROWS(load_control), load_control[status] = "complete")`
   - `Cobertura % = DIVIDE([Días completos], COUNTROWS(load_control))`
4. Formato: `price_eur` y las medidas de precio con 2 decimales; `ts_utc` como fecha/hora. No crees columnas calculadas: Direct Lake no las admite.

Guarda (el modelo se guarda solo).

## 3. Crear el reporte

1. Desde el modelo semántico: **New report** (o desde el workspace: **+ New item → Report → Pick a published semantic model → `sm_dayahead_prices`**).
2. Página **Comparativa**:
   - Gráfico de líneas: eje X `prices_all[ts_utc]` (como fecha/hora continua, no jerarquía), eje Y `Precio medio EUR`, leyenda `prices_all[country_code]`. Título "Precio day-ahead por país (EUR/MWh, UTC)".
   - Segmentador `prices_all[business_date_local]` (estilo *Relative date* o *Between*) y segmentador `country_code`.
   - Tres tarjetas: `Precio medio EUR`, `Precio mínimo EUR`, `Precio máximo EUR`.
3. Página **Por país**: cuatro gráficos de líneas pequeños, uno por tabla `prices_xx`, mismo eje X (`ts_utc`) y `price_eur`; o el mismo gráfico de la página anterior con *Small multiples* por `country_code`.
4. Página **Calidad de datos**: matriz con filas `load_control[country_code]`, columnas `business_date_local`, valores `loaded_slots` y formato condicional por `status`; tarjeta `Cobertura %`; tabla con `last_attempt_utc`, `run_id`, `last_error` filtrada a `status <> "complete"`.
5. **Save** como `rpt_dayahead_prices`.

Deberías ver: el reporte en el workspace junto al modelo; al abrirlo, los datos del rango cargado (el backfill de 30 días si ya corrió).

## 4. Verificación

- [ ] Tras una corrida del pipeline, el reporte muestra el nuevo día sin refrescar nada (Direct Lake: framing automático). Si no, en el modelo semántico → **Refresh now** (es solo metadatos, tarda segundos).
- [ ] El gráfico de Polonia en `prices_all` está en EUR (`price_eur`), no en PLN: la moneda original está en `price_original`/`currency_original` por si quieres una página en moneda local.
- [ ] La matriz de calidad coincide con la página "Calidad de datos" de la web (misma fuente: `load_control`).

## 5. Límites conocidos

- Direct Lake no admite columnas calculadas ni vistas SQL (caería a DirectQuery); por eso la unión se materializa como tabla.
- El modelo y el reporte tienen que estar en la misma región que el Lakehouse (North Europe), lo cual se cumple al crearlos en el mismo workspace.
- El SQL analytics endpoint puede tardar unos minutos en reflejar tablas nuevas; si `prices_all` no aparece al crear el modelo, espera y vuelve a **Edit tables**.

## 6. Para el documento técnico

Anota: modelo `sm_dayahead_prices` en Direct Lake sobre el Lakehouse (sin copia de datos ni refresco programado), la tabla gold `prices_all` como decisión (D24) y que el reporte es la tercera vista de los mismos datos (web, MCP, Power BI) sin duplicar lógica: todos leen lo que escribe el notebook.
