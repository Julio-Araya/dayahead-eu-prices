# Guía de montaje en Fabric

Paso a paso, en el orden en que se hace en el navegador. Cada paso dice qué crear, con qué nombre y qué deberías ver al terminar. Los nombres importan: el notebook lee la Biblioteca de variables por nombre y la guía asume estos.

| Elemento | Tipo | Nombre |
|---|---|---|
| Área de trabajo | Workspace | `Day Ahead Prices - Julio Araya` (ya existe, asignado a la capacidad Trial) |
| Lakehouse | Lakehouse | `lh_dayahead` |
| Biblioteca de variables | Variable library | `vl_dayahead` |
| Notebook | Notebook (PySpark) | `nb_dayahead_ingest` |
| Pipeline | Data pipeline | `pl_dayahead_daily` |

Marcado como **[hipótesis]**: comportamiento que no pude verificar en la documentación oficial y que conviene confirmar al hacerlo. Todo lo demás está verificado en docs de Microsoft (agosto 2026).

Tiempo estimado: 45-60 minutos, más la espera de las corridas.

---

## 0. Antes de abrir el navegador

En tu máquina, desde la raíz del repo:

```bash
python3 -m pip install build
python3 fabric/build.py
```

Debes ver tres líneas: el `.ipynb` generado con 19 celdas y 1 de parámetros, "DDL: 7 sentencias idénticas", y "wheel: fabric/dist/dayahead-0.2.0-py3-none-any.whl (coincide con la celda %pip)". Deja a mano:

- `fabric/dist/dayahead-0.2.0-py3-none-any.whl`
- `fabric/notebooks/nb_dayahead_ingest.ipynb`
- el valor de `ENTSOE_TOKEN` de tu `.env` (lo vas a pegar una sola vez, en el paso 3).

## 1. Workspace y capacidad Trial

1. Entra a https://app.fabric.microsoft.com con el usuario de la prueba. Si aparece la pantalla de agregar teléfono, **Omitir configuración** (instrucción de la prueba).
2. Abre el workspace `Day Ahead Prices - Julio Araya`. Confirma en **Workspace settings → License info** que está en la capacidad **Trial** (la `Trial-…` que muestra la prueba en su captura); si no, cámbiala ahí y **Apply**.
3. Verifica el runtime: **Workspace settings → Data Engineering/Science → Spark settings → Environment → Runtime version**. Debe decir **1.3 (Spark 3.5, Delta 3.2)**. Si no, selecciónalo y guarda.

Deberías ver: el workspace vacío, con el icono de diamante de Trial junto al nombre.

## 2. Lakehouse `lh_dayahead`

1. **+ New item → Lakehouse**. Nombre `lh_dayahead`.
2. Si aparece la casilla **Lakehouse schemas (Public Preview)**, **déjala desmarcada**. Con esquemas activados las tablas se llamarían `dbo.prices_es` y el notebook usa nombres sin esquema.
3. **Create**.

Deberías ver: el explorador del Lakehouse con `Tables` y `Files` vacíos.

## 3. Biblioteca de variables `vl_dayahead`

1. **+ New item → Variable library** (está en la sección Develop data / Data Factory). Nombre `vl_dayahead`. **Create**.
2. **+ New variable**: nombre `ENTSOE_TOKEN`, tipo **String**, valor: pega el token. Nota (opcional): "Token de la ENTSO-E Transparency Platform. Lo lee nb_dayahead_ingest".
3. **Save**.

4. Para la Fase 3 (publicación hacia la API), dos variables más, ambas **String**: `INGEST_API_URL` (URL base de la API desplegada, p. ej. `https://<proyecto>.vercel.app`) e `INGEST_HMAC_SECRET` (el mismo valor que `INGEST_HMAC_SECRET` en el entorno de la API; se genera con `openssl rand -hex 32`). Hasta que la API exista pueden quedar vacías: el notebook solo las lee si `publish_to_api=True`.

Deberías ver: `ENTSOE_TOKEN | String | ●●●` (y, si ya las creaste, `INGEST_API_URL` e `INGEST_HMAC_SECRET`) en el value set **Default**, marcado como activo.

Importante:
- El notebook la busca como `$(/**/vl_dayahead/ENTSOE_TOKEN)`. La documentación dice que la referencia es sensible a mayúsculas: escribe los dos nombres exactamente así.
- La biblioteca tiene que estar en el **mismo workspace** que el notebook. No hay nada más que "asociar".
- No existe un tipo secreto en las bibliotecas de variables (tipos: String, Integer, Number, Boolean, DateTime, Guid, referencias). El valor es visible para quien tenga permiso de lectura sobre el ítem. Es lo que permite el acceso de la prueba; en Grenergy el paso siguiente sería Azure Key Vault vía `notebookutils.credentials.getSecret`, que necesita un registro de aplicación (D1).

## 4. Notebook `nb_dayahead_ingest`

### 4.1 Importar

1. En el workspace: **Import → Notebook → From this computer**, elige `fabric/notebooks/nb_dayahead_ingest.ipynb`. **Upload**.
2. Ábrelo. Arriba a la izquierda, en el selector de lenguaje, debe decir **PySpark (Python)**.

Deberías ver: 19 celdas; la primera de texto con el título, la segunda con `%pip install "builtin/dayahead-0.2.0-py3-none-any.whl"`, la tercera con los parámetros.

### 4.2 Marcar la celda de parámetros

**[hipótesis]** Al importar un `.ipynb` con la etiqueta `parameters` en la celda, Fabric debería mostrarla ya marcada como celda de parámetros. Comprueba: la tercera celda (la que empieza con `start_date = ""`) tiene que mostrar la etiqueta **Parameters** en su esquina. Si no la muestra: menú **…** de la celda → **Toggle parameter cell**.

### 4.3 Subir el wheel a Resources

1. Panel izquierdo del notebook → pestaña **Resources** (icono de carpeta) → carpeta **Built-in**.
2. Arrastra `fabric/dist/dayahead-0.2.0-py3-none-any.whl` a esa carpeta (o **Upload**).

Deberías ver: `dayahead-0.2.0-py3-none-any.whl` dentro de `Built-in`. El nombre tiene que coincidir letra por letra con el de la celda `%pip`.

### 4.4 Anclar el Lakehouse

1. Panel izquierdo → **Lakehouses → Add lakehouse → Existing lakehouse** → `lh_dayahead` → **Add**.
2. Si el notebook ya tenía otro, ánclalo como predeterminado (icono de chincheta) y **reinicia la sesión** (la doc exige reiniciar tras cambiar el lakehouse por defecto).

Deberías ver: `lh_dayahead` con la chincheta, y debajo `Tables` y `Files`.

### 4.5 Primera corrida (interactiva)

**Run all**. La primera vez tarda unos minutos: arranque de sesión Spark, instalación del wheel (reinicia el intérprete de Python, es normal), creación de tablas y las llamadas a las cuatro APIs.

Deberías ver, celda por celda:

- `%pip`: "Successfully installed dayahead-0.2.0".
- Token: `token leído de 'vl_dayahead' (36 caracteres)`. Nunca el valor.
- Esquema: `sources_config sembrada con 4 filas desde dayahead.config.DEFAULT_SOURCES`.
- Ventana: `ventana <D-3> -> <D+1> (5 días) | países: ['ES', 'RO', 'DE', 'PL']`.
- BCE: `BCE PLN: N tasas, última <fecha> = 4.xxxx`.
- Resumen: una tabla con 20 líneas (4 países × 5 días). Lo esperable a la hora en que lo corras:
  - D-3, D-2, D-1 y D: `complete` con 96/96 (ES, RO, PL) y 24/24 (DE).
  - D+1: `complete` si la fuente ya publicó, `pending 0/96` (o `0/24`) si todavía no. **Pendiente no es error.** En el spike, a las 14:35Z, ES y PL ya tenían D+1 y RO y DE no.
- Última línea: el JSON de salida y el mensaje de `notebookutils.notebook.exit`.

Si una fuente falla, verás `error` en sus cinco días, el resto de países se carga igual, y la última celda termina con `RuntimeError: fuentes con error: …`. Ese comportamiento es deliberado: escribe todo lo que pudo y después falla para que el pipeline lo marque.

En el explorador del Lakehouse (puede que haya que **Refresh** en `Tables`) deberías ver 7 tablas: `prices_es`, `prices_ro`, `prices_de`, `prices_pl`, `sources_config`, `load_control`, `fx_rates`.

### 4.6 Comprobar idempotencia

Vuelve a ejecutar **Run all**. El resumen tiene que ser idéntico y el conteo de filas de cada tabla no cambia (lo verificas en el paso 7). Ésa es la prueba de que el `MERGE` por `(country_code, ts_utc)` es idempotente.

## 5. Pipeline `pl_dayahead_daily`

1. **+ New item → Data pipeline**. Nombre `pl_dayahead_daily`. **Create**.
2. En el lienzo, **Add pipeline activity → Notebook**. Selecciona la actividad.
3. Pestaña **General**: nombre `Ingest day-ahead prices`. **Retry** = 1, **Retry interval** = 300 segundos, **Timeout** = 1 hora.
4. Pestaña **Settings**:
   - **Workspace**: el actual. **Notebook**: `nb_dayahead_ingest`.
   - **Base parameters**: si aparece **Auto-populate** al elegir el notebook, úsalo: rellena `start_date`, `end_date`, `countries`, `publish_to_api`, `build_gold_table`, `variable_library` con sus tipos. Si no, agrégalos a mano con **+ New**:

     | Nombre | Tipo | Valor |
     |---|---|---|
     | `start_date` | String | `@pipeline().parameters.start_date` |
     | `end_date` | String | `@pipeline().parameters.end_date` |
     | `countries` | String | `@pipeline().parameters.countries` |
     | `publish_to_api` | Bool | `false` (true cuando la API esté desplegada y las variables cargadas) |
     | `build_gold_table` | Bool | `false` (true si vas a hacer el reporte Power BI; ver `docs/fabric-powerbi.md`) |
     | `_inlineInstallationEnabled` | Bool | `true` |

     El último es obligatorio: en ejecuciones desde pipeline la instalación inline (`%pip`) está desactivada por defecto y sin este parámetro la primera celda no instala el wheel. Para escribir `@pipeline().parameters.x` haz clic en el valor y elige **Add dynamic content**.
5. Parámetros del pipeline: haz clic en el lienzo vacío (fuera de la actividad) → pestaña **Parameters** → **+ New** tres veces:

   | Nombre | Tipo | Default |
   |---|---|---|
   | `start_date` | String | (vacío) |
   | `end_date` | String | (vacío) |
   | `countries` | String | (vacío) |

   Con los tres vacíos el notebook usa la ventana `[D-3, D+1]` y todos los países activos.
6. **Save** (pestaña Home).
7. **Run** → en el diálogo deja los tres parámetros vacíos → **OK**. Sigue la ejecución en la pestaña **Output** de abajo.

Deberías ver: la actividad en verde, estado **Succeeded**, y si abres el detalle, el snapshot del notebook con el mismo resumen del paso 4.5. Si falla en la primera celda con un error de `%pip`, falta `_inlineInstallationEnabled`.

## 6. Programación diaria a las 18:00 UTC

1. En el editor del pipeline, **Home → Schedule**.
2. **Scheduled run**: On. **Repeat**: Daily. **Time**: 18:00. **Start date/time**: hoy. **End**: una fecha lejana (por ejemplo dentro de un año). **Time zone**: **(UTC) Coordinated Universal Time**.
3. **Apply**.

Deberías ver: junto al botón Schedule, "Next run: <mañana> 18:00 UTC".

Por qué 18:00 UTC (D10): ENTSO-E y PSE publican D+1 alrededor de las 12:00Z y el BCE la tasa del día a las ≈14:15Z, pero SMARD regeneró su bloque semanal a las **17:10Z** el 26-ago-2026 (a las 14:35Z el D+1 alemán venía todo `null`). A las 18:00 UTC entran los cuatro países el mismo día. Lo que aun así no esté, queda `pending` y entra al día siguiente porque la ventana empieza en D-3.

## 7. Backfill de 30 días

Es la misma corrida con parámetros, no un notebook aparte.

1. En el pipeline: **Run** → en el diálogo de parámetros:
   - `start_date` = fecha de hoy menos 30 días (formato `YYYY-MM-DD`)
   - `end_date` = ayer
   - `countries` = vacío
2. **OK**. Tarda unos minutos: ENTSO-E devuelve los 30 días en una llamada por país, PSE pagina de a 100 filas (≈29 páginas), SMARD baja 5 o 6 bloques semanales.

Deberías ver: **Succeeded**, y en `load_control` 4 × 30 filas nuevas, todas `complete` salvo que alguna fuente tenga un hueco real (entonces `incomplete`, y la fila dice cuántos slots faltan).

Para repetir un tramo (por ejemplo, tras una corrección de la fuente) se vuelve a correr con ese rango: el `MERGE` reescribe las filas sin duplicarlas.

## 8. Smoke final en el SQL analytics endpoint

1. En el workspace, abre `lh_dayahead` y arriba a la derecha cambia **Lakehouse → SQL analytics endpoint**. Puede tardar unos minutos en reflejar tablas recién creadas; si no aparecen, espera y **Refresh**.
2. **New SQL query** y ejecuta, una por una:

**a. Las cuatro tablas tienen datos y cubren el rango esperado**

```sql
SELECT 'ES' AS country_code, COUNT(*) AS rows_, MIN(business_date_local) AS first_day, MAX(business_date_local) AS last_day, MAX(ingested_at_utc) AS last_ingest FROM prices_es
UNION ALL SELECT 'RO', COUNT(*), MIN(business_date_local), MAX(business_date_local), MAX(ingested_at_utc) FROM prices_ro
UNION ALL SELECT 'DE', COUNT(*), MIN(business_date_local), MAX(business_date_local), MAX(ingested_at_utc) FROM prices_de
UNION ALL SELECT 'PL', COUNT(*), MIN(business_date_local), MAX(business_date_local), MAX(ingested_at_utc) FROM prices_pl;
```

Esperado tras el backfill: 4 filas; ES, RO y PL con ≈ 96 × días cargados, DE con 24 × días; `first_day` = hoy − 30, `last_day` = D o D+1.

**b. Sin huecos: ningún día cargado difiere de lo esperado**

```sql
SELECT country_code, business_date_local, expected_slots, loaded_slots, status, last_error
FROM load_control
WHERE status <> 'complete'
ORDER BY country_code, business_date_local;
```

Esperado: cero filas, o solo filas `pending` de D+1 (fuente que aún no publicó). Cualquier `incomplete` o `error` es algo que mirar.

**c. Verificación independiente de (b), contando en las tablas de precios**

```sql
WITH p AS (
  SELECT country_code, business_date_local, COUNT(*) AS n FROM prices_es GROUP BY country_code, business_date_local
  UNION ALL SELECT country_code, business_date_local, COUNT(*) FROM prices_ro GROUP BY country_code, business_date_local
  UNION ALL SELECT country_code, business_date_local, COUNT(*) FROM prices_de GROUP BY country_code, business_date_local
  UNION ALL SELECT country_code, business_date_local, COUNT(*) FROM prices_pl GROUP BY country_code, business_date_local
)
SELECT p.country_code, p.business_date_local, p.n AS rows_in_table, c.expected_slots, c.status
FROM p JOIN load_control c ON c.country_code = p.country_code AND c.business_date_local = p.business_date_local
WHERE p.n <> c.expected_slots
ORDER BY 1, 2;
```

Esperado: cero filas. Si el rango incluye un cambio de hora (último domingo de marzo u octubre), ese día tiene 92/100 o 23/25 y sigue sin aparecer acá, porque `expected_slots` ya lo contempla.

**d. Sin duplicados por clave**

```sql
SELECT 'ES' AS c, COUNT(*) - COUNT(DISTINCT ts_utc) AS dups FROM prices_es
UNION ALL SELECT 'RO', COUNT(*) - COUNT(DISTINCT ts_utc) FROM prices_ro
UNION ALL SELECT 'DE', COUNT(*) - COUNT(DISTINCT ts_utc) FROM prices_de
UNION ALL SELECT 'PL', COUNT(*) - COUNT(DISTINCT ts_utc) FROM prices_pl;
```

Esperado: `dups = 0` en las cuatro, también después de correr el notebook dos veces.

**e. La conversión a EUR está trazada**

```sql
SELECT TOP 5 ts_utc, price_original, currency_original, fx_rate, fx_rate_date, price_eur
FROM prices_pl ORDER BY ts_utc DESC;
```

Esperado: `currency_original = PLN`, `fx_rate` ≈ 4.3, `fx_rate_date` igual al día o al viernes anterior si es fin de semana, `price_eur = price_original / fx_rate`.

## 9. Cierre opcional: Entorno con el mismo wheel (D16, opción a)

Solo si queda tiempo y quieres que el revisor vea un ítem Environment:

1. **+ New item → Environment**, nombre `env_dayahead`. **Custom libraries → Upload** el mismo `.whl`. **Publish** en modo **Full** (3-6 minutos).
2. En el notebook: **Environment** (barra superior) → `env_dayahead`. Borra la celda `%pip`. Guarda.
3. En el pipeline, borra el parámetro `_inlineInstallationEnabled`. Corre una vez para verificar.

Al actualizar el módulo tendrías que republicar el Entorno; con la opción (d) basta con subir el wheel nuevo.

## 10. Lista de control antes de dar por cerrada la fase

- [ ] El token no aparece en ninguna celda ni en ninguna salida (busca `securityToken` en el notebook: solo debe estar dentro del wheel).
- [ ] `sources_config` tiene 4 filas con `active = true`.
- [ ] `load_control` no tiene `error`; los `pending`, si hay, son de D+1.
- [ ] La consulta (c) devuelve cero filas.
- [ ] El pipeline muestra "Next run" a las 18:00 UTC.
- [ ] Nombres del workspace sin elementos sueltos (sin notebooks "Notebook 1" ni lakehouses de prueba).

## Cuando cambie el código del módulo

1. Sube la versión en `etl/pyproject.toml` y en la celda `%pip` del notebook (`fabric/notebooks/nb_dayahead_ingest.py`).
2. `python3 fabric/build.py` (falla si los dos no coinciden).
3. Sube el wheel nuevo a Resources del notebook y borra el viejo.
4. Reimporta el `.ipynb` (o pega la celda cambiada) y reinicia la sesión.

## Agregar un país

No se toca el notebook. Una fila nueva en `sources_config` (desde un notebook, en una celda `%%sql`):

```sql
INSERT INTO sources_config VALUES
('FR', 'entsoe', 'Europe/Paris', 'EUR', 'PT15M', '{"domain": "10YFR-RTE------C", "contract_type": "A01"}', 'prices_fr', true, current_timestamp());
```

En la siguiente corrida el notebook crea `prices_fr` y la carga. El país nuevo tiene que tener un adaptador existente; una fuente nueva sí sería código (un adaptador más en `etl/dayahead/adapters`).
