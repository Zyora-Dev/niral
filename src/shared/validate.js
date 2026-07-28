/**
 * Niral — validation (kills the Zod dependency for the 95% case).
 *
 *   export const save = withSchema({
 *     email: v.email(),
 *     age: v.int({ min: 13 }),
 *     bio: v.optional(v.string({ max: 500 })),
 *   }, async (data) => { ... data is validated AND coerced ... })
 *
 * Form fields arrive as strings — rules COERCE ("42" → 42, "on" → true)
 * so the same schema works for forms and RPC. Failures throw a
 * ValidationError: form actions surface it as `form.errors.<field>`,
 * RPC returns 400 with the same shape. Pure functions, isomorphic —
 * import it in components for instant client-side checks too.
 */

export class ValidationError extends Error {
  constructor(errors) {
    super("validation failed");
    this.errors = errors;
    this.__niralValidation = true;
  }
}

const rule = (check) => ({ __rule: check });

export const v = {
  string: ({ min = 0, max = 10_000, pattern, trim = true } = {}) =>
    rule((x, field) => {
      if (typeof x !== "string") return { error: `${field} must be text` };
      const s = trim ? x.trim() : x;
      if (s.length < min) return { error: min === 1 ? `${field} is required` : `${field} needs at least ${min} characters` };
      if (s.length > max) return { error: `${field} can't exceed ${max} characters` };
      if (pattern && !pattern.test(s)) return { error: `${field} has an invalid format` };
      return { value: s };
    }),

  email: () =>
    rule((x, field) => {
      const s = String(x ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) || s.length > 254) return { error: `${field} must be a valid email` };
      return { value: s };
    }),

  int: ({ min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) =>
    rule((x, field) => {
      const n = typeof x === "number" ? x : Number(String(x).trim());
      if (!Number.isInteger(n)) return { error: `${field} must be a whole number` };
      if (n < min) return { error: `${field} must be at least ${min}` };
      if (n > max) return { error: `${field} must be at most ${max}` };
      return { value: n };
    }),

  number: ({ min = -Infinity, max = Infinity } = {}) =>
    rule((x, field) => {
      const n = typeof x === "number" ? x : Number(String(x).trim());
      if (!Number.isFinite(n)) return { error: `${field} must be a number` };
      if (n < min) return { error: `${field} must be at least ${min}` };
      if (n > max) return { error: `${field} must be at most ${max}` };
      return { value: n };
    }),

  bool: () =>
    rule((x) => ({ value: x === true || x === "true" || x === "on" || x === "1" || x === 1 })),

  oneOf: (options) =>
    rule((x, field) =>
      options.includes(x) ? { value: x } : { error: `${field} must be one of: ${options.join(", ")}` }
    ),

  optional: (inner) =>
    rule((x, field) => {
      if (x === undefined || x === null || x === "") return { value: undefined };
      return inner.__rule(x, field);
    }),

  array: (inner, { min = 0, max = 100 } = {}) =>
    rule((x, field) => {
      const arr = Array.isArray(x) ? x : x === undefined || x === null || x === "" ? [] : [x];
      if (arr.length < min) return { error: `${field} needs at least ${min} item${min === 1 ? "" : "s"}` };
      if (arr.length > max) return { error: `${field} can't have more than ${max} items` };
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const r = inner.__rule(arr[i], `${field}[${i}]`);
        if (r.error) return { error: r.error };
        out.push(r.value);
      }
      return { value: out };
    }),

  file: ({ maxSize = 5 * 1024 * 1024, types } = {}) =>
    rule((x, field) => {
      if (!x || typeof x !== "object" || !("size" in x)) return { error: `${field} must be a file` };
      if (x.size > maxSize) return { error: `${field} can't exceed ${Math.round(maxSize / 1024 / 1024)}MB` };
      if (types && !types.some((t) => x.type === t || (t.endsWith("/*") && x.type?.startsWith(t.slice(0, -1))))) {
        return { error: `${field} must be ${types.join(" or ")}` };
      }
      return { value: x };
    }),

  object: (shape) =>
    rule((x, field) => {
      const r = validate(shape, x ?? {});
      return r.ok ? { value: r.value } : { error: `${field} is invalid`, nested: r.errors };
    }),
};

/** Validate `data` against `shape` → { ok, value, errors }. Unknown keys DROPPED. */
export function validate(shape, data) {
  const value = {};
  const errors = {};
  const src = data && typeof data === "object" ? data : {};
  for (const [field, r] of Object.entries(shape)) {
    const res = r.__rule(src[field], field);
    if (res.error) errors[field] = res.nested ?? res.error;
    else if (res.value !== undefined) value[field] = res.value;
  }
  return Object.keys(errors).length ? { ok: false, errors, value } : { ok: true, value, errors: null };
}

/** Wrap a server function: first argument is validated + coerced, unknown
 *  keys stripped. Invalid input never reaches your code. */
export function withSchema(shape, fn) {
  const wrapped = async (data, ...rest) => {
    const r = validate(shape, data);
    if (!r.ok) throw new ValidationError(r.errors);
    return fn(r.value, ...rest);
  };
  wrapped.__niralSchema = shape;
  return wrapped;
}
