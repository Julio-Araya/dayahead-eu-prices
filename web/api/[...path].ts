// Función serverless de Vercel: /api/* -> API con la key del entorno (WEB_API_KEY, WEB_API_BASE_URL).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proxy } from "../bff/handler.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const url = req.url ?? "/";
  const result = await proxy(req.method ?? "GET", url, { baseUrl: process.env.WEB_API_BASE_URL, apiKey: process.env.WEB_API_KEY });
  res.status(result.status).setHeader("content-type", result.contentType).setHeader("cache-control", "no-store").send(result.body);
}
