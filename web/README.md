# web — interfaz "Day-Ahead Prices"

React + Vite + TypeScript. Consume la API a través de un **BFF** en el mismo dominio (`/api/*`), así la API key nunca llega al navegador (D3). Design system de `design/relevo-design-system-v1.html` aplicado como tokens CSS, sin marca.

## Qué muestra

- **Comparativa entre países**: líneas escalonadas (cada precio es constante durante su intervalo), siempre en EUR/MWh, con leyenda, etiquetas al final de cada línea, crosshair imantado y tooltip con todas las series. Un clic en la leyenda oculta o muestra un país sin cambiar los colores de los demás.
- **Paneles por país** (small multiples) con el mismo eje de tiempo; en modo "Original (PLN)" Polonia se ve en PLN.
- **Tabla** con una fila por instante y una columna por país (la versión accesible de la gráfica).
- **Filtros** en una sola fila: presets de fecha (hoy, mañana, 7, 30 días) o rango personalizado, países, granularidad (nativa u horaria: PT15M promediado a PT60M por la API) y moneda.
- **Cinco estados de lectura**: cargando (mantiene el render anterior atenuado), vacío (solo tras respuesta 200 sin filas), error de red/servidor, sin permiso (la API rechazó la credencial del BFF) y desactualizado (banner cuando `/status` marca más de 26 h sin corrida; los datos se muestran igual).
- Colores por país validados con el validador de la guía de visualización sobre la superficie del design system; asignación fija por país.

## Correr en local

```
cd web
npm install
npm run dev          # http://localhost:5173, BFF en /api/* con WEB_API_KEY y WEB_API_BASE_URL del .env de la raíz
npm test
npm run build
```

Necesita la API corriendo (`cd api && PORT=3100 npm run dev`) y en `.env` de la raíz: `WEB_API_BASE_URL=http://localhost:3100` y `WEB_API_KEY=dap_...` (creada con `npm run create-key -- --name web-bff`).

## Desplegar en Vercel

Proyecto con **Root Directory** = `web`, framework Vite. `api/[...path].ts` es la función serverless del BFF; variables de entorno: `WEB_API_BASE_URL` (URL de la API desplegada) y `WEB_API_KEY`.

## Estructura

```
bff/handler.ts        proxy de lectura: allowlist de rutas, agrega la key, 401/403 -> 403, sin key -> 503
bff/env.ts            lee el .env de la raíz en desarrollo
api/[...path].ts      función de Vercel que usa el handler
vite.config.ts        plugin que monta el mismo handler en /api durante `vite dev`
src/lib/              api.ts (cliente + estados), dates.ts (presets UTC), series.ts (series, escalas, path escalonado, snap)
src/components/       Filters, PriceChart (SVG), DataTable, StateView, Header
src/pages/            PricesPage; QualityPage (siguiente paso)
src/styles/tokens.css tokens del design system + paleta por país
test/                 vitest: series, fechas, BFF
```
