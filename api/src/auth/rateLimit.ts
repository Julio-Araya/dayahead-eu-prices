/**
 * Límite por clave: ventana fija de un minuto en memoria del proceso.
 *
 * Límite conocido: en Vercel cada instancia serverless tiene su propia memoria, así que el tope es
 * por instancia, no global. Para esta prueba (consumidores: una interfaz y agentes) es suficiente;
 * el paso siguiente sería un contador en Postgres o Redis. Documentado en decisions.md (D19).
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch seconds
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private windowSeconds = 60, private now: () => number = () => Date.now() / 1000) {}

  check(key: string, limit: number): RateLimitResult {
    const t = this.now();
    const windowStart = Math.floor(t / this.windowSeconds) * this.windowSeconds;
    let b = this.buckets.get(key);
    if (!b || b.windowStart !== windowStart) {
      b = { windowStart, count: 0 };
      this.buckets.set(key, b);
    }
    const resetAt = windowStart + this.windowSeconds;
    if (b.count >= limit) return { allowed: false, limit, remaining: 0, resetAt };
    b.count += 1;
    return { allowed: true, limit, remaining: limit - b.count, resetAt };
  }

  /** Evita crecimiento sin límite: descarta ventanas viejas. */
  prune(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t - b.windowStart > 2 * this.windowSeconds) this.buckets.delete(k);
  }
}
