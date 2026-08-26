// Punto de entrada en Vercel: vercel.json reescribe todo a /api y Express atiende.
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../src/wiring.js";

const app = buildApp();

// Cualquier excepción fuera del ciclo de Express queda en los logs de la función con su stack.
process.on("uncaughtException", (e) => console.error("uncaughtException", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  // Tras el rewrite, la raíz puede llegar con url vacía o sin barra inicial; Express exige "/...".
  if (!req.url || !req.url.startsWith("/")) req.url = "/" + (req.url ?? "");
  try {
    app(req, res);
  } catch (e) {
    console.error("handler", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal", message: "error interno" } }));
    }
  }
}
