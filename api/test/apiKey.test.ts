import { describe, expect, it } from "vitest";
import { KEY_PREFIX, extractApiKey, generateApiKey, hashApiKey, keyPrefix } from "../src/auth/apiKey.js";

describe("API keys", () => {
  it("genera claves con prefijo y alta entropía, y hashes estables", () => {
    const k = generateApiKey();
    expect(k.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.length).toBeGreaterThan(30);
    expect(generateApiKey()).not.toBe(k);
    expect(hashApiKey(k)).toBe(hashApiKey(k));
    expect(hashApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPrefix(k)).toBe(k.slice(0, 8));
  });

  it("extrae la clave de Bearer o X-API-Key", () => {
    expect(extractApiKey({ authorization: "Bearer abc" })).toBe("abc");
    expect(extractApiKey({ authorization: "bearer abc" })).toBe("abc");
    expect(extractApiKey({ "x-api-key": " abc " })).toBe("abc");
    expect(extractApiKey({ authorization: "Basic abc" })).toBeNull();
    expect(extractApiKey({})).toBeNull();
  });
});
