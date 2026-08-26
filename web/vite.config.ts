import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { readRootEnv } from "./bff/env";
import { proxy } from "./bff/handler";

const here = path.dirname(fileURLToPath(import.meta.url));

/** BFF en desarrollo: mismo handler que la función de Vercel, con la key del .env de la raíz. */
function bffDev(): Plugin {
  return {
    name: "dayahead-bff-dev",
    configureServer(server) {
      const env = { ...readRootEnv(here), ...process.env };
      server.middlewares.use("/api", async (req, res) => {
        const result = await proxy(req.method ?? "GET", "/api" + (req.url ?? "/"), { baseUrl: env.WEB_API_BASE_URL, apiKey: env.WEB_API_KEY });
        res.statusCode = result.status;
        res.setHeader("content-type", result.contentType);
        res.setHeader("cache-control", "no-store");
        res.end(result.body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), bffDev()],
  server: { port: 5173 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
