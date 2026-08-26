import { Router, json } from "express";
import type { Request, Response } from "express";
import { verifySignature } from "../auth/hmac.js";
import { IngestPayload, type IngestWriter } from "../ingest/writer.js";
import { sendError } from "./middleware.js";

export function ingestRouter(opts: { secret: string; writer: IngestWriter; maxSkewSeconds: number; now?: () => number }): Router {
  const r = Router();
  const parser = json({ limit: "20mb", verify: (req, _res, buf) => ((req as Request).rawBody = buf) });

  r.post("/v1/ingest", parser, async (req: Request, res: Response) => {
    if (!opts.secret) return sendError(res, { status: 503, code: "ingest_disabled", message: "INGEST_HMAC_SECRET no configurado" });
    const check = verifySignature({
      secret: opts.secret,
      body: req.rawBody ?? Buffer.alloc(0),
      timestampHeader: req.header("x-timestamp"),
      nonceHeader: req.header("x-nonce"),
      signatureHeader: req.header("x-signature"),
      now: opts.now?.(),
      maxSkewSeconds: opts.maxSkewSeconds,
    });
    if (!check.ok) return sendError(res, { status: 401, code: `hmac_${check.reason}`, message: "firma inválida o expirada" });

    const parsed = IngestPayload.safeParse(req.body);
    if (!parsed.success) return sendError(res, { status: 400, code: "bad_payload", message: "cuerpo inválido", details: parsed.error.issues.slice(0, 10) });

    const result = await opts.writer.write(parsed.data, check.nonce!);
    if (result === "replay") return sendError(res, { status: 409, code: "replay", message: "nonce ya utilizado" });
    res.status(200).json({ ok: true, run_id: parsed.data.run_id, part: parsed.data.part ?? 1, parts: parsed.data.parts ?? 1, ...result });
  });
  return r;
}
