import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/auth/rateLimit.js";

describe("rate limit por clave", () => {
  it("permite hasta el límite por ventana y se reinicia en la siguiente", () => {
    let t = 1000;
    const rl = new FixedWindowRateLimiter(60, () => t);
    expect(rl.check("k", 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rl.check("k", 2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.check("k", 2)).toMatchObject({ allowed: false, remaining: 0, resetAt: 1020 });
    expect(rl.check("otra", 2).allowed).toBe(true);
    t = 1020;
    expect(rl.check("k", 2)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("prune descarta ventanas viejas", () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter(60, () => t);
    rl.check("k", 5);
    t = 200;
    rl.prune();
    expect(rl.check("k", 1)).toMatchObject({ allowed: true });
  });
});
