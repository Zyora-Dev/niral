import { signal, onDestroy } from "./signals.js";

const submitting = new WeakSet();
let changed = () => {};
let redirect = (url) => { location.href = url; };

export function configureForms(handlers) {
  changed = handlers.changed;
  redirect = handlers.redirect;
}

export function formRequest(form, submitter) {
  const action = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
  const method = submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
  const target = submitter?.getAttribute("formtarget") ?? form.getAttribute("target");
  const url = new URL(action, location.href);
  if (method.toLowerCase() !== "post" || (target && target !== "_self") || url.origin !== location.origin || !/^\?\/[A-Za-z_]\w*$/.test(url.search)) return null;
  const fields = new FormData(form, submitter);
  const enctype = submitter?.getAttribute("formenctype") ?? form.getAttribute("enctype");
  const multipart = enctype === "multipart/form-data" || [...fields.values()].some((value) => typeof value !== "string");
  return {
    url: url.pathname + url.search,
    name: url.search.slice(2),
    body: multipart ? fields : new URLSearchParams(fields).toString(),
    headers: multipart ? {} : { "content-type": "application/x-www-form-urlencoded" },
  };
}

export async function postForm(form, request, { signal: abortSignal, resultOnly = false } = {}) {
  if (submitting.has(form)) return null;
  submitting.add(form);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { ...request.headers, "x-niral-form": "1", ...(resultOnly ? { "x-niral-result": "1" } : {}) },
      body: request.body,
      signal: abortSignal,
    });
    const data = await response.json();
    if (!data || typeof data.ok !== "boolean") throw new Error("Invalid form response");
    changed();
    return { data, status: response.status };
  } finally {
    submitting.delete(form);
  }
}

export function formAction(name) {
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error("Invalid form action name");
  const empty = () => ({ status: "idle", result: undefined, errors: {}, error: null, statusCode: 0 });
  const state = signal(empty());
  let controller = null;
  let disposed = false;
  onDestroy(() => { disposed = true; controller?.abort(); });
  return {
    get pending() { return state.get().status === "pending"; },
    get status() { return state.get().status; },
    get result() { return state.get().result; },
    get errors() { return state.get().errors; },
    get error() { return state.get().error; },
    get statusCode() { return state.get().statusCode; },
    reset() {
      controller?.abort();
      controller = null;
      state.set(empty());
    },
    async submit(event) {
      if (event.defaultPrevented || disposed) return;
      const form = event.currentTarget ?? event.target;
      const request = formRequest(form, event.submitter);
      if (!request || request.name !== name) return;
      event.preventDefault();
      if (controller || submitting.has(form)) return;
      const active = new AbortController();
      controller = active;
      state.set({ ...empty(), status: "pending" });
      try {
        const response = await postForm(form, request, { signal: active.signal, resultOnly: true });
        if (!response || disposed || controller !== active) return;
        const { data, status } = response;
        const success = data.ok && status >= 200 && status < 300;
        state.set({ status: success ? "success" : "error", result: success ? data.result : undefined, errors: data.errors ?? {}, error: success ? null : data.error ?? "Submission failed", statusCode: status });
        if (success && data.redirect) await redirect(data.redirect);
      } catch {
        if (!disposed && controller === active) state.set({ ...empty(), status: "error", error: "The response could not be received. Check whether the change was saved before retrying." });
      } finally {
        if (controller === active) controller = null;
      }
    },
  };
}