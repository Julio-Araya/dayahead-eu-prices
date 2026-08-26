#!/usr/bin/env node
/**
 * Entrada stdio del servidor MCP. Configuración por entorno:
 *   DAYAHEAD_API_URL  URL base de la API (p. ej. https://dayahead-api.vercel.app)
 *   DAYAHEAD_API_KEY  API key de solo lectura (creada con `npm run create-key -- --name mcp` en api/)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./client.js";
import { createServer } from "./server.js";

const baseUrl = process.env.DAYAHEAD_API_URL;
const apiKey = process.env.DAYAHEAD_API_KEY;
if (!baseUrl || !apiKey) {
  console.error("faltan DAYAHEAD_API_URL o DAYAHEAD_API_KEY en el entorno");
  process.exit(2);
}

const server = createServer(new ApiClient({ baseUrl, apiKey }));
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`dayahead-mcp listo (API ${baseUrl})`);
