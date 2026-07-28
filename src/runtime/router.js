/**
 * Niral runtime — client-side navigation.
 *
 * Internal <a> clicks don't reload the page: the router fetches the target
 * with an `x-niral-nav` header, the server answers with JSON (props, module
 * paths, styles), and the current page component is swapped in place.
 * History (back/forward) works; anything unusual falls back to a real
 * browser navigation.
 */

import * as __n from "./index.js";

let current = null; // mounted instance for the active page
let installed = false;

function styleTag() {
  let el = document.querySelector("style[data-niral-style]");
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-niral-style", "");
    document.head.appendChild(el);
  }
  return el;
}

/* prefetch cache: url → { promise, t } (10s TTL) */
const navCache = new Map();
const NAV_TTL = 10_000;

function fetchNav(url) {
  const hit = navCache.get(url);
  if (hit && Date.now() - hit.t < NAV_TTL) return hit.promise;
  const promise = fetch(url, { headers: { "x-niral-nav": "1" } }).then((res) => res.json());
  navCache.set(url, { promise, t: Date.now() });
  promise.catch(() => navCache.delete(url));
  return promise;
}

// entries are module paths (client navigation) or already-resolved component
// functions (the boot script static-imports them — no runtime import() hop)
const resolveMod = (p) => (typeof p === "string" ? import(p).then((m) => m.default) : p);

async function mountPage(root, component, layoutRefs, props) {
  const refs = [...layoutRefs, component];
  const loaded = refs.some((r) => typeof r === "string") ? await Promise.all(refs.map(resolveMod)) : refs;
  const Page = loaded[loaded.length - 1];
  const layouts = loaded.slice(0, -1);
  if (!layouts.length) return Page(root, props);
  return __n.mount(root, () => {
    const chain = (i) =>
      i === layouts.length
        ? (Page.__build ?? Page)(props)
        : __n.child(layouts[i], () => ({ ...props }), () => [chain(i + 1)]);
    return [chain(0)];
  });
}

/** Swap the current page for a nav payload's component/props/styles. */
async function applyPage(data) {
  const root = document.getElementById("niral-root");
  current?.destroy?.();
  root.replaceChildren();
  styleTag().textContent = data.style ?? "";
  if (data.head) {
    const t = data.head.match(/<title>([^<]*)<\/title>/);
    if (t) document.title = t[1];
  }
  current = await mountPage(root, data.component, data.layouts ?? [], data.props ?? {});
}

/** Navigate without a page load. Falls back to location.href when needed. */
export async function navigate(url, { push = true } = {}) {
  let data = null;
  try {
    data = await fetchNav(url);
  } catch {
    /* non-JSON response → hard navigation below */
  }
  if (!data?.ok || data.mode !== "client") {
    location.href = url;
    return;
  }
  await applyPage(data);
  if (push) history.pushState({}, "", url);
  scrollTo(0, 0);
}

/** Progressive form enhancement: POST ?/action without a reload. */
async function submitForm(form, action) {
  const url = new URL(action, location.href);
  const body = new URLSearchParams(new FormData(form)).toString();
  let data = null;
  try {
    const res = await fetch(url.pathname + url.search, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-niral-form": "1" },
      body,
    });
    data = await res.json();
  } catch {
    /* transport failed — fall back to a native submit */
  }
  if (!data?.ok) {
    form.submit();
    return;
  }
  if (data.redirect) return navigate(data.redirect);
  navCache.clear(); // the action changed server state — stale prefetches lie
  await applyPage(data); // fresh load() data + props.form, no reload
}

function install() {
  if (installed) return;
  installed = true;
  // prefetch on hover — by the time the click lands, the payload is usually here
  addEventListener("mouseover", (e) => {
    const a = e.target.closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    try {
      const url = new URL(a.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      void fetchNav(url.pathname + url.search).catch(() => {});
    } catch {
      /* invalid href */
    }
  });
  addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a");
    if (!a || a.target || a.hasAttribute("download") || a.getAttribute("rel") === "external") return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  addEventListener("popstate", () => navigate(location.pathname + location.search, { push: false }));
  // form actions: <form method="post" action="?/save"> enhance in place
  addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    const form = e.target;
    const action = form?.getAttribute?.("action") ?? "";
    if (!action.includes("?/")) return;
    if ((form.getAttribute("method") ?? "get").toLowerCase() !== "post") return;
    e.preventDefault();
    submitForm(form, action);
  });
}

/** Entry point emitted by the server's hydration script. */
export async function boot({ component, layouts = [], props = {}, i18n = null }) {
  if (i18n) __n._setI18n(i18n.messages, i18n.locale); // catalog BEFORE any t() runs
  const root = document.getElementById("niral-root");
  __n._hydrateNext(root); // attach to the SSR DOM — no rebuild, no flash
  current = await mountPage(root, component, layouts, props);
  install();
  window.__NIRAL_NAV__ = navigate; // programmatic navigation escape hatch
}
