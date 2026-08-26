/**
 * Backend for frontend (D3): la interfaz nunca ve la API key. Este handler recibe /api/<ruta>,
 * la reenvía a la API con la key y devuelve la respuesta. Lo usan el middleware de Vite en
 * desarrollo y la función serverless de Vercel en producción.
 *
 * Solo GET y solo rutas de lectura. 401/403 de la API se traducen a 403 para que la interfaz
 * muestre "sin permiso"; si el BFF no está configurado responde 503.
 */
export interface BffConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}

export interface BffResult {
  status: number;
  body: string;
  contentType: string;
}

const ALLOWED = new Set(["prices", "countries", "load-control", "status", "health"]);

export function resolveTarget(pathWithQuery: string, baseUrl: string): string | null {
  const [pathname, query = ""] = pathWithQuery.split("?");
  const segment = pathname.replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!ALLOWED.has(segment)) return null;
  return `${baseUrl.replace(/\/$/, "")}/v1/${segment}${query ? `?${query}` : ""}`;
}

export async function proxy(method: string, pathWithQuery: string, cfg: BffConfig): Promise<BffResult> {
  const json = (status: number, obj: unknown): BffResult => ({ status, body: JSON.stringify(obj), contentType: "application/json; charset=utf-8" });
  if (method !== "GET") return json(405, { error: { code: "method_not_allowed", message: "solo GET" } });
  if (!cfg.baseUrl || !cfg.apiKey) return json(503, { error: { code: "bff_not_configured", message: "faltan WEB_API_BASE_URL o WEB_API_KEY en el entorno del BFF" } });
  const target = resolveTarget(pathWithQuery, cfg.baseUrl);
  if (!target) return json(404, { error: { code: "not_found", message: "ruta no expuesta por el BFF" } });
  const f = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(target, { headers: { "x-api-key": cfg.apiKey, accept: "application/json" } });
  } catch (e) {
    return json(502, { error: { code: "upstream_unreachable", message: (e as Error).message } });
  }
  const body = await res.text();
  if (res.status === 401 || res.status === 403) return json(403, { error: { code: "forbidden", message: "la API rechazó la credencial del BFF" } });
  return { status: res.status, body, contentType: res.headers.get("content-type") ?? "application/json; charset=utf-8" };
}
