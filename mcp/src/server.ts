/** Servidor MCP de solo lectura sobre la API. `createServer` recibe el cliente para poder testearse con uno falso. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, ApiError } from "./client.js";
import { addDays, compareHourly, describeLoad, isoDate, markdownTable, statsByCountry } from "./summary.js";

const MAX_ROWS = 2000;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD");
const countriesArg = z.array(z.string().length(2)).min(1).max(20).describe("Códigos ISO de país, p. ej. [\"ES\",\"PL\"]. Disponibles: ES, RO, DE, PL");

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function fail(e: unknown) {
  const msg = e instanceof ApiError ? `API ${e.status} ${e.code}: ${e.message}` : (e as Error).message;
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function createServer(client: ApiClient, today: () => string = () => isoDate(new Date())): McpServer {
  const server = new McpServer({ name: "dayahead-prices", version: "0.1.0" }, {
    instructions:
      "Precios day-ahead de electricidad (España, Rumania, Alemania, Polonia) en EUR/MWh y moneda original. " +
      "Los instantes son inicio de intervalo en UTC; las fechas son el día de mercado local. " +
      "Usa get_prices para series, compare_prices para comparar países en un día, get_load_status para saber si los datos están completos y al día.",
  });

  server.registerTool(
    "list_countries",
    { title: "Países disponibles", description: "Catálogo de mercados: código, nombre, zona horaria del día de mercado, moneda, resolución nativa y fuente.", annotations: { readOnlyHint: true } },
    async () => {
      try {
        const r = await client.countries();
        return text(markdownTable(["code", "name", "market_tz", "currency", "resolution", "source", "active"], r.rows.map((c) => [c.country_code, c.name, c.market_tz, c.currency, c.resolution, c.source, String(c.active)])));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_prices",
    {
      title: "Precios por país y rango",
      description:
        "Precios day-ahead para uno o varios países entre dos días de mercado (inclusive). Devuelve un resumen por país (media, mínimo y máximo en EUR/MWh con su instante, slots negativos) y, si include_rows es true, las filas (máximo 2000) con precio en EUR y en moneda original.",
      inputSchema: {
        countries: countriesArg,
        from: isoDay.describe("Primer día de mercado, YYYY-MM-DD"),
        to: isoDay.describe("Último día de mercado, YYYY-MM-DD (máximo 366 días de rango)"),
        granularity: z.enum(["native", "hourly"]).default("native").describe("native = resolución de cada fuente (15 min ES/RO/PL, 60 min DE); hourly = todo promediado a la hora"),
        include_rows: z.boolean().default(false).describe("Incluir las filas además del resumen"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ countries, from, to, granularity, include_rows }) => {
      try {
        const r = await client.prices({ countries, from, to, granularity });
        if (!r.rows.length) return text(`Sin datos para ${countries.join(",")} entre ${from} y ${to}. Si es el día siguiente (D+1), la fuente puede no haber publicado todavía.`);
        const stats = statsByCountry(r.rows);
        const summary = markdownTable(
          ["país", "moneda", "resolución", "n", "media EUR", "mín EUR", "mín en (UTC)", "máx EUR", "máx en (UTC)", "slots < 0"],
          stats.map((s) => [s.country_code, s.currency, s.resolution, s.count, s.avg_eur, s.min_eur, s.min_at, s.max_eur, s.max_at, s.negative_slots]),
        );
        let out = `Precios ${granularity} ${from} → ${to} (${r.count} filas)\n\n${summary}`;
        if (include_rows) {
          const rows = r.rows.slice(0, MAX_ROWS);
          out += `\n\nFilas (${rows.length}${r.rows.length > MAX_ROWS ? ` de ${r.rows.length}, truncadas` : ""}):\n` + markdownTable(
            ["país", "ts_utc", "res", "price_eur", "price_original", "moneda", "fx_rate", "fx_rate_date"],
            rows.map((p) => [p.country_code, p.ts_utc, p.resolution, p.price_eur, p.price_original, p.currency_original, p.fx_rate, p.fx_rate_date]),
          );
        }
        return text(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "compare_prices",
    {
      title: "Comparativa entre países",
      description:
        "Compara varios países en un día de mercado, hora a hora (PT15M promediado a PT60M): precio por país en EUR/MWh, país más barato por hora, dispersión (máximo − mínimo), medias y cuántas horas fue más barato cada país.",
      inputSchema: {
        countries: countriesArg,
        date: isoDay.describe("Día de mercado, YYYY-MM-DD"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ countries, date }) => {
      try {
        const r = await client.prices({ countries, from: date, to: date, granularity: "hourly" });
        if (!r.rows.length) return text(`Sin datos para ${countries.join(",")} el ${date}.`);
        const cmp = compareHourly(r.rows);
        const table = markdownTable(
          ["hora (UTC)", ...cmp.countries, "más barato", "dispersión"],
          cmp.hours.map((h) => [h.ts_utc.slice(11, 16), ...cmp.countries.map((c) => h.prices[c]), h.cheapest, h.spread]),
        );
        const avgs = cmp.countries.map((c) => `${c} ${cmp.avg_by_country[c]}`).join(", ");
        const wins = cmp.countries.map((c) => `${c} ${cmp.cheapest_count[c]} h`).join(", ");
        return text(`Comparativa ${date} (EUR/MWh, horario, ${cmp.hours.length} horas)\n\nMedia por país: ${avgs}\nHoras más barato: ${wins}\nDispersión media máx−mín: ${cmp.avg_spread ?? "—"}\n\n${table}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_load_status",
    {
      title: "Estado de carga",
      description:
        "Calidad de los datos: por país, último día completo, última corrida, si está desactualizado (más de 26 h sin corrida) y, para un rango de días, los días no completos con slots cargados/esperados y error. Sin parámetros usa todos los países y los últimos 7 días más D+1.",
      inputSchema: {
        countries: countriesArg.optional(),
        from: isoDay.optional(),
        to: isoDay.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ countries, from, to }) => {
      try {
        const st = await client.status();
        const codes = countries ?? st.rows.map((s) => s.country_code);
        const t = today();
        const f = from ?? addDays(t, -7);
        const u = to ?? addDays(t, 1);
        const lc = await client.loadControl({ countries: codes, from: f, to: u });
        const d = describeLoad(st.rows.filter((s) => codes.includes(s.country_code)), lc.rows);
        const per = markdownTable(
          ["país", "último día completo", "última corrida (UTC)", "desactualizado", "días completos en rango", "pendientes", "incompletos", "errores"],
          d.per_country.map((s) => [s.country_code, s.last_complete_date, s.last_attempt_utc, s.stale ? "sí" : "no", `${s.complete_days}/${s.days_in_range}`, s.pending_days, s.incomplete_days, s.error_days]),
        );
        const att = d.attention.length
          ? markdownTable(["día", "país", "estado", "cargados/esperados", "fuente publicó", "error"], d.attention.map((c) => [c.business_date_local, c.country_code, c.status, `${c.loaded_slots}/${c.expected_slots}`, c.source_published_at, c.last_error]))
          : "Ningún día del rango necesita atención.";
        return text(`Estado de carga, rango ${f} → ${u} (generado ${st.generated_at})\n\n${per}\n\nDías no completos:\n${att}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
