/**
 * Niral server — in-memory rate limiter (fixed window per key).
 * Applied to /@niral/rpc in dev and prod: cheap protection against a
 * misbehaving loop or a lazy abuse script. Not a substitute for real
 * infrastructure limits — a seatbelt, not a cage.
 */

export function createLimiter({ limit = 120, windowMs = 60_000 } = {}) {
  let windowStart = Date.now();
  let counts = new Map();

  return {
    /** true = allowed, false = over the limit */
    check(key) {
      const now = Date.now();
      if (now - windowStart >= windowMs) {
        windowStart = now;
        counts = new Map();
      }
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n <= limit;
    },
  };
}
