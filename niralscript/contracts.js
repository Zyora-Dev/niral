export function emitContractValidator(type) {
  const functions = [];
  function generate(value, depth = 0) {
    if (depth > 64 || functions.length >= 1024) throw new TypeError("Runtime contracts are limited to 64 levels and 1024 type nodes");
    const name = `__check${functions.length}`;
    const index = functions.push("") - 1;
    let body;
    const fail = expected => `throw new __ContractError(__path, ${JSON.stringify(expected)});`;
    if (["string", "boolean", "number"].includes(value.kind)) {
      body = `if (typeof __value !== ${JSON.stringify(value.kind)}${value.kind === "number" ? " || !Number.isFinite(__value)" : ""}) { ${fail(value.kind)} } return __value;`;
    } else if (["null", "undefined"].includes(value.kind)) {
      body = `if (__value !== ${value.kind === "undefined" ? "void 0" : "null"}) { ${fail(value.kind)} } return __value;`;
    } else if (value.kind === "literal") {
      if (typeof value.value === "number" && !Number.isFinite(value.value)) throw new TypeError("Runtime contract numeric literals must be finite");
      body = `if (__value !== ${JSON.stringify(value.value)}) { ${fail(JSON.stringify(value.value))} } return __value;`;
    } else if (value.kind === "array") {
      const child = generate(value.element, depth + 1);
      body = `if (!Array.isArray(__value)) { ${fail("array")} } if (__value.length > 10000) { ${fail("at most 10000 array elements")} } const __result = []; for (let __index = 0; __index < __value.length; __index++) { const __entry = Object.getOwnPropertyDescriptor(__value, String(__index)); const __itemPath = __path + "[" + __index + "]"; if (__entry && !("value" in __entry)) throw new __ContractError(__itemPath, "data property"); __result.push(${child}(__entry?.value, __itemPath)); } return __result;`;
    } else if (value.kind === "object") {
      const entries = Object.entries(value.properties);
      const fields = entries.map(([key, field]) => {
        const child = generate(field, depth + 1);
        const quoted = JSON.stringify(key);
        return `{ const __entry = Object.getOwnPropertyDescriptor(__value, ${quoted}); const __fieldPath = __path + ${JSON.stringify("." + key)}; if (__entry && !("value" in __entry)) throw new __ContractError(__fieldPath, "data property"); const __field = ${child}(__entry?.value, __fieldPath); if (__entry) Object.defineProperty(__result, ${quoted}, { value: __field, enumerable: true, writable: true, configurable: true }); }`;
      }).join(" ");
      body = `if (__value === null || typeof __value !== "object" || Array.isArray(__value) || ![Object.prototype, null].includes(Object.getPrototypeOf(__value))) { ${fail("plain record")} } const __result = {}; ${fields} for (const __key of Reflect.ownKeys(__value)) { if (!${JSON.stringify(entries.map(([key]) => key))}.includes(__key)) throw new __ContractError(__path + "." + String(__key), "no extra field"); } return __result;`;
    } else if (value.kind === "union") {
      const branches = value.members.map(member => {
        const child = generate(member, depth + 1);
        return `try { return ${child}(__value, __path); } catch (__error) { if (!(__error instanceof __ContractError)) throw __error; if (!__best || __error.path.length > __best.path.length) __best = __error; }`;
      }).join(" ");
      body = `let __best; ${branches} throw __best;`;
    } else {
      throw new TypeError(`Unsupported runtime contract type '${value.kind}'`);
    }
    functions[index] = `function ${name}(__value, __path) { if (++__visited > 10000) throw new __ContractError(__path, "at most 10000 values"); ${body} }`;
    return name;
  }
  const root = generate(type);
  return `((__candidate) => { const { Object, Array, Number, Reflect, String, TypeError } = globalThis; class __ContractError extends TypeError { constructor(path, expected) { super("Contract failed at " + path + ": expected " + expected); this.name = "NiralContractError"; this.code = "NRS081"; this.path = path; this.expected = expected; } } let __visited = 0; ${functions.join("\n")} return ${root}(__candidate, "$"); })`;
}