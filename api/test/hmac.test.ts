import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sign, verifySignature } from "../src/auth/hmac.js";

const VECTORS = JSON.parse(readFileSync(path.resolve(__dirname, "../../etl/tests/fixtures/hmac_vectors.json"), "utf8")).vectors as Array<{
  secret: string; timestamp: number; nonce: string; body: string; signature: string;
}>;

describe("HMAC compartido con etl/dayahead/publish.py", () => {
  it("produce las mismas firmas que Python para los vectores", () => {
    for (const v of VECTORS) {
      expect("sha256=" + sign(v.secret, v.timestamp, v.nonce, Buffer.from(v.body, "utf8"))).toBe(v.signature);
    }
  });

  it("verifica firmas válidas dentro de la ventana", () => {
    const v = VECTORS[1];
    const r = verifySignature({ secret: v.secret, body: Buffer.from(v.body), timestampHeader: String(v.timestamp), nonceHeader: v.nonce, signatureHeader: v.signature, now: v.timestamp + 299 });
    expect(r).toEqual({ ok: true, timestamp: v.timestamp, nonce: v.nonce });
  });

  it("rechaza skew, cabeceras faltantes, cuerpo alterado, secreto distinto y prefijo malo", () => {
    const v = VECTORS[0];
    const base = { secret: v.secret, body: Buffer.from(v.body), timestampHeader: String(v.timestamp), nonceHeader: v.nonce, signatureHeader: v.signature };
    expect(verifySignature({ ...base, now: v.timestamp + 301 }).reason).toBe("skew");
    expect(verifySignature({ ...base, now: v.timestamp - 301 }).reason).toBe("skew");
    expect(verifySignature({ ...base, now: v.timestamp, signatureHeader: undefined }).reason).toBe("missing_headers");
    expect(verifySignature({ ...base, now: v.timestamp, timestampHeader: "abc" }).reason).toBe("bad_timestamp");
    expect(verifySignature({ ...base, now: v.timestamp, body: Buffer.from(v.body + " ") }).reason).toBe("bad_signature");
    expect(verifySignature({ ...base, now: v.timestamp, secret: "otro" }).reason).toBe("bad_signature");
    expect(verifySignature({ ...base, now: v.timestamp, signatureHeader: v.signature.replace("sha256=", "md5=") }).reason).toBe("bad_signature");
    expect(verifySignature({ ...base, now: v.timestamp, signatureHeader: "sha256=00" }).reason).toBe("bad_signature");
  });
});
