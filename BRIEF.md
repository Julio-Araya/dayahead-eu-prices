# BRIEF

## 1. El problema

Grenergy pide un pipeline ETL en Microsoft Fabric que consuma precios Day Ahead de cuatro países europeos desde sus APIs oficiales, los guarde en tablas separadas por país de forma incremental y sin huecos, y después los exponga por una API REST propia con una interfaz para comparar precios entre países.

Fuente completa: `/docs/prueba-tecnica-grenergy.pdf` (copia redactada; el original trae el token de ENTSO-E y queda fuera de git). Leerla entera antes de empezar.

Qué evalúan, en sus palabras: coherencia técnica, capacidad de razonar sobre los problemas y claridad al comunicar decisiones. No esperan cobertura de todos los casos extremos.

## 2. Las fuentes

| País | Fuente | Auth | Formato | Moneda | Granularidad |
|---|---|---|---|---|---|
| ES | ENTSO-E, documentType A44, domain 10YES-REE------0 | securityToken como query param | XML | EUR | PT15M |
| RO | ENTSO-E, documentType A44, domain 10YRO-TEL------P | securityToken como query param | XML | EUR | PT15M |
| DE | SMARD, filtro 4169, región DE, dos pasos (índice de bloques y bloque semanal) | Ninguna | JSON | EUR | PT60M |
| PL | PSE, endpoint rce-pln filtrado por business_date | Ninguna | JSON | PLN | PT15M |

Tipo de cambio PLN a EUR: tasa de referencia del BCE, serie EXR/D.PLN.EUR.SP00.A. Gratis, sin token. Carry forward en fines de semana y feriados.

## 3. Trampas conocidas por fuente

Verificarlas con el spike antes de diseñar el parser. Están documentadas en foros y repos, pero hay que confirmarlas con datos reales de esta semana.

ENTSO-E
- Desde octubre 2025 el day ahead es en cuartos de hora. El XML trae Period con resolution PT15M.
- Un documento puede traer varios TimeSeries y varios Period. No asumir uno.
- curveType A03 omite posiciones cuando el precio es igual al anterior. Contar 96 puntos y encontrar menos no es un hueco. Hay que rellenar por posición con el último valor conocido.
- Días de cambio horario traen 92 o 100 puntos.
- timeInterval viene en UTC. periodStart y periodEnd del request también van en UTC, formato yyyyMMddHHmm.
- Para pedir un día local completo hay que convertir la ventana local a UTC (Madrid y Bucarest tienen offsets distintos).

SMARD
- index_hour.json devuelve una lista de timestamps en milisegundos, cada uno es el inicio de un bloque semanal.
- Para una fecha hay que elegir el bloque cuyo timestamp es el mayor menor o igual al inicio del día buscado.
- El bloque devuelve series como [ts_ms, valor]. Las horas futuras vienen como null.
- Es horario. 24 registros por día, 23 o 25 en cambio de hora.

PSE
- La respuesta trae dtime_utc, rce_pln, business_date, period y udtczas_oreb. Confirmar los nombres exactos con el spike, la API tuvo cambios entre versiones.
- Es OData. Puede paginar. Revisar si viene nextLink.
- Precio en PLN/MWh, convertir a EUR.

BCE
- Publica días hábiles alrededor de las 16:00 CET. Para un business_date sábado o domingo se usa la tasa del viernes. Para el día actual, si aún no está publicada, la del día anterior.
- Guardar la fecha de la tasa usada en la fila.

## 4. Decisiones cerradas

### D1. Fabric es la fuente de verdad, la API lee desde una capa de servicio propia

La cuenta de prueba en el tenant de Grenergy no permite registrar aplicaciones en Entra (los portales de Azure y Entra exigen MFA obligatorio y la instrucción de la prueba es no registrar teléfono). Sin registro de aplicación no hay service principal, y sin service principal ningún servidor externo puede autenticarse contra Fabric de forma correcta.

Opciones evaluadas:
1. Fabric publica hacia la capa de servicio. Al final de cada corrida el notebook hace POST de las filas nuevas a un endpoint de ingestión de la API, firmado con HMAC. La API y la interfaz leen desde Postgres. Elegida.
2. Servidor externo lee el SQL endpoint de Fabric con usuario y contraseña. Descartada por seguridad. Credenciales de persona en un runtime de servidor, sin MFA, no es aceptable.
3. Fabric API for GraphQL con service principal. Correcta en un entorno real. Imposible con el acceso actual. Queda implementada como adaptador alternativo, documentada, sin credenciales.

Beneficios laterales de la opción 1 que van al documento técnico: la API sirve tráfico aunque Fabric esté caído o la capacidad trial expire; el lakehouse no recibe tráfico de aplicación; el cambio a la opción 3 es una variable de entorno.

### D2. Stack

- Fabric: Lakehouse, notebooks en Python, pipeline programado, Biblioteca de variables para el token.
- Capa de servicio: Supabase Postgres.
- API: Express + TypeScript en Vercel.
- Interfaz: React + Vite + TypeScript en Vercel, con el design system de Relevo Studio sin marca.
- MCP: servidor MCP sobre la API, en TypeScript.

### D3. Seguridad de la API

API keys con hash en base de datos, alcance solo lectura, rate limit por key. La interfaz no recibe la key, va por un backend for frontend en el mismo dominio. Justificación: los consumidores son sistemas y agentes, no personas. Se documenta que el paso siguiente en Grenergy sería SSO con Entra ID sobre la misma API.

El endpoint de ingestión (el que Fabric llama) usa HMAC SHA256 sobre el cuerpo con secreto compartido y timestamp para evitar replay. Es un endpoint distinto de los de lectura.

### D4. Modelo de datos

Fabric, una tabla Delta por país con el mismo esquema:

- country_code (ES, RO, DE, PL)
- ts_utc (timestamp, inicio del intervalo)
- resolution (PT15M o PT60M)
- business_date_local (date)
- price_original (decimal)
- currency_original (EUR o PLN)
- price_eur (decimal)
- fx_rate (decimal, 1.0 para EUR)
- fx_rate_date (date)
- source (entsoe, smard, pse)
- ingested_at_utc (timestamp)

Más dos tablas de control en Fabric:
- sources_config: una fila por país con tipo de adaptador, parámetros, zona horaria, moneda, granularidad, activo.
- load_control: por país y business_date, slots esperados, slots cargados, estado, último intento, último error.

Y una tabla fx_rates con fecha, moneda, tasa, fuente.

En Postgres se replica el mismo esquema de precios en una sola tabla `prices` con índice único en (country_code, ts_utc), más `load_control` y `api_keys`.

### D5. Granularidad en la interfaz

Comparación entre países en dos modos. Nativo (cada país con su resolución) y horario (PT15M promediado a PT60M). Toggle visible. La API expone ambos por parámetro.

### D6. Todo en EUR, con PLN disponible

La API devuelve price_eur por defecto y price_original con currency_original siempre presentes. La interfaz muestra EUR y permite ver PLN para Polonia.

## 5. Extra miles, en orden

Solo después de que lo obligatorio esté completo y probado.

1. Servidor MCP sobre la API. La vacante lo pide con esas palabras.
2. Página de calidad de datos en la interfaz. Última corrida por país, cobertura, huecos detectados.
3. Despliegue en producción en Vercel (interfaz y API).
4. Reporte Power BI sobre el Lakehouse.
5. Integración Git del workspace de Fabric con el repo.
6. Agente de datos de Fabric sobre el Lakehouse.

## 6. Plan por fases

Fase 0. Spike. Correr `/spike/spike_apis.py` contra las cuatro APIs y el BCE con datos de esta semana. Reportar formato real de cada respuesta, nombres de campos, cantidad de puntos por día, y confirmar o descartar cada trampa de la sección 3. Sin esto no se diseña el parser.

Fase 1. Módulo puro de parseo y transformación en Python, con tests. Un adaptador por fuente, forward fill, conversión de moneda, detección de huecos. Todo testeable sin Fabric.

Fase 2. Fabric. Lakehouse, tablas, notebook de ingesta que usa el módulo de la fase 1, tabla de configuración, tabla de control, pipeline con schedule diario, backfill de los últimos 30 días. Publicación hacia la API al final de cada corrida.

Fase 3. Capa de servicio y API. Migraciones en Supabase, endpoint de ingestión con HMAC, endpoints de lectura con API key, adaptador de lectura con las dos implementaciones, tests.

Fase 4. Interfaz. Gráfica por país, comparativa multi país, filtros por fecha y país, toggle de granularidad, toggle EUR/PLN, cinco estados de lectura. Design system sin marca.

Fase 5. Extra miles en el orden de la sección 5.

Fase 6. Documentación técnica ordenada en `/docs/decisions.md` para que Julio redacte el README. Smoke final. Revisión del workspace de Fabric (nombres, sin elementos sueltos).

## 7. Estructura del repo

```
/
  CLAUDE.md
  BRIEF.md
  README.md              (lo escribe Julio al final)
  .env.example
  /docs
    prueba-tecnica-grenergy.pdf
    decisions.md
  /design
    design-system.html
  /spike
    spike_apis.py
  /etl                   (módulo Python puro + tests)
    /dayahead
      adapters/
      transform/
      fx/
      gaps/
    /tests
  /fabric                (notebooks exportados, definición del pipeline, SQL de tablas)
  /db
    /migrations
  /api                   (Express + TS)
  /web                   (React + Vite)
  /mcp                   (servidor MCP)
```

## 8. Contexto de la empresa, para el tono de la documentación

Grenergy es un productor independiente de energía renovable, cotiza en Madrid, presencia en 12 países incluyendo los cuatro de la prueba. El equipo de Digital construye la capa de datos para energía y PPAs. Los evaluadores son el CIO/CDO (Gerardo Álvarez Coronado) y el equipo de Digital. La prueba dice que es parte del trabajo real. Escribir la documentación como si fuera para un compañero de equipo que va a mantener esto, no como si fuera para un examen.
