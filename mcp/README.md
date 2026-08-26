# mcp — servidor MCP de precios day-ahead

Servidor [Model Context Protocol](https://modelcontextprotocol.io) en TypeScript, transporte stdio, **solo lectura**, sobre la API REST (`api/`). Autentica contra la API con una API key propia (`mcp`, 60 req/min) que nunca sale del entorno del proceso.

## Herramientas

| Herramienta | Qué devuelve |
|---|---|
| `list_countries` | catálogo de mercados (código, nombre, zona del día de mercado, moneda, resolución, fuente) |
| `get_prices` | precios por países y rango de días: resumen por país (media, mínimo y máximo en EUR/MWh con su instante, slots negativos) y, con `include_rows`, hasta 2000 filas con precio en EUR y en moneda original |
| `compare_prices` | un día, varios países, hora a hora: precio por país, país más barato, dispersión máx−mín, medias y horas ganadas |
| `get_load_status` | calidad de datos: último día completo, última corrida, desactualizado, y los días no completos del rango con cargados/esperados y error |

Todas llevan `readOnlyHint`. Los errores de la API vuelven como resultado con `isError` y el código HTTP, nunca como excepción del servidor.

## Instalar y probar

```
cd mcp
npm install
npm run build          # dist/index.js
npm test
DAYAHEAD_API_URL=https://dayahead-api.vercel.app DAYAHEAD_API_KEY=dap_... npm start
```

Crear la key en la API: `cd api && npm run create-key -- --name mcp --limit 60` (se imprime una sola vez).

## Conectar a Claude Desktop

1. Compila: `cd mcp && npm install && npm run build`.
2. Abre la configuración de Claude Desktop: **Settings → Developer → Edit Config**. Es el archivo `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`).
3. Agrega el servidor con la **ruta absoluta** a `dist/index.js` y la key en `env`:

```json
{
  "mcpServers": {
    "dayahead-prices": {
      "command": "node",
      "args": ["/RUTA/ABSOLUTA/al/repo/mcp/dist/index.js"],
      "env": {
        "DAYAHEAD_API_URL": "https://dayahead-api.vercel.app",
        "DAYAHEAD_API_KEY": "dap_..."
      }
    }
  }
}
```

4. Reinicia Claude Desktop. En el chat aparece el icono de herramientas con `dayahead-prices` y sus cuatro herramientas.
5. Prueba: *"¿Qué país tuvo la electricidad más barata ayer y en cuántas horas?"* → Claude llama a `compare_prices`. *"¿Están completos los datos de esta semana?"* → `get_load_status`.

Si Claude Desktop no encuentra `node`, pon la ruta completa del binario en `command` (`which node`). Los logs del servidor están en **Settings → Developer → Open Logs Folder** (`mcp-server-dayahead-prices.log`).

## Conectar a Claude Code

```
claude mcp add dayahead-prices -e DAYAHEAD_API_URL=https://dayahead-api.vercel.app -e DAYAHEAD_API_KEY=dap_... -- node /RUTA/ABSOLUTA/mcp/dist/index.js
```

## Estructura

```
src/index.ts    entrada stdio; lee DAYAHEAD_API_URL y DAYAHEAD_API_KEY
src/server.ts   createServer(client): registra las herramientas (testeable con un cliente falso)
src/client.ts   cliente HTTP de la API con la key
src/summary.ts  lógica pura: resúmenes, comparación horaria, tablas markdown
test/           vitest: lógica pura y servidor completo con transporte en memoria
```
