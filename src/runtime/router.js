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
import { configureForms, formRequest, postForm } from "./forms.js";
import { configureRefresh } from "./refresh.js";
import { _setNavigation } from "./navigation.js";

let current = null; // mounted instance for the active page
let installed = false;
let pageProps = null;
let navigationVersion = 0;
let refreshVersion = 0;
let routeTree = [];
let renderedUrl = null;
let historySequence = 0;
let activeHistoryId = null;
const scrollPositions = new Map();

function historyEntry() {
  return { id: `${Date.now()}:${++historySequence}`, scroll: [0, 0] };
}

function saveScroll() {
  if (!activeHistoryId) return;
  const position = [scrollX, scrollY];
  scrollPositions.set(activeHistoryId, position);
  if (history.state?.__niral?.id === activeHistoryId) {
    history.replaceState({ ...history.state, __niral: { id: activeHistoryId, scroll: position } }, "");
  }
}

function finishNavigation(target, push, restore) {
  if (push) history.pushState({ __niral: historyEntry() }, "", target.href);
  const entry = history.state?.__niral ?? historyEntry();
  if (!history.state?.__niral) history.replaceState({ ...history.state, __niral: entry }, "");
  activeHistoryId = entry.id;
  renderedUrl = target.href;
  let anchor = null;
  if (target.hash) {
    let name = target.hash.slice(1);
    try { name = decodeURIComponent(name); } catch {}
    anchor = document.getElementById(name) ?? document.getElementsByName(name)[0];
  }
  const root = document.getElementById("niral-root");
  const focusTarget = anchor ?? root.querySelector("main h1") ?? root.querySelector("h1") ?? root;
  if (!focusTarget.hasAttribute("tabindex")) {
    focusTarget.setAttribute("tabindex", "-1");
    focusTarget.addEventListener("blur", () => focusTarget.removeAttribute("tabindex"), { once: true });
  }
  focusTarget.focus({ preventScroll: true });
  if (restore) {
    const position = scrollPositions.get(entry.id) ?? entry.scroll;
    scrollTo(...position);
  } else if (anchor) anchor.scrollIntoView();
  else scrollTo(0, 0);
  saveScroll();
}

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
  pageProps = __n.signal(props);
  const propsSignal = pageProps;
  routeTree = loaded.map((component) => ({ component, view: __n.signal({ component }) }));
  return __n.mount(root, () => {
    const chain = (depth) => {
      const entry = routeTree[depth];
      return __n._routeChild(
        () => entry.view.get().component,
        () => propsSignal.get(),
        () => depth + 1 < routeTree.length ? () => chain(depth + 1) : undefined,
      );
    };
    return [chain(0)];
  });
}

async function refreshPage(abortSignal) {
  const propsSignal = pageProps;
  const version = navigationVersion;
  const request = ++refreshVersion;
  const url = location.href;
  navCache.clear();
  const response = await fetch(url, { headers: { "x-niral-nav": "1" }, cache: "no-store", signal: abortSignal });
  const data = await response.json();
  if (abortSignal.aborted || version !== navigationVersion || request !== refreshVersion || propsSignal !== pageProps || url !== location.href) return false;
  if (!response.ok || response.redirected || !data?.ok || data.mode !== "client" || !data.props || !propsSignal) throw new Error("Invalid refresh response");
  propsSignal.set(data.props);
  return true;
}

/** Swap the current page for a nav payload's component/props/styles. */
async function applyPage(data, version = ++navigationVersion) {
  const loaded = await Promise.all([...(data.layouts ?? []), data.component].map(resolveMod));
  if (version !== navigationVersion) return false;
  const root = document.getElementById("niral-root");
  styleTag().textContent = data.style ?? "";
  if (data.head) {
    const t = data.head.match(/<title>([^<]*)<\/title>/);
    if (t) document.title = t[1];
  }
  if (!current || !routeTree.length) {
    root.replaceChildren();
    current = await mountPage(root, loaded[loaded.length - 1], loaded.slice(0, -1), data.props ?? {});
  } else {
    let shared = 0;
    while (shared < Math.min(routeTree.length, loaded.length) - 1 && routeTree[shared].component === loaded[shared]) shared++;
    const changed = routeTree[shared];
    routeTree = loaded.map((component, depth) => depth < shared ? routeTree[depth] : depth === shared ? changed : { component, view: __n.signal({ component }) });
    changed.component = loaded[shared];
    __n.batch(() => {
      pageProps.set(data.props ?? {});
      changed.view.set({ component: loaded[shared] });
    });
  }
  return true;
}

/** Navigate without a page load. Falls back to location.href when needed. */
export async function navigate(url, { push = true, restore = false } = {}) {
  const version = ++navigationVersion;
  const target = new URL(url, location.href);
  const previous = new URL(renderedUrl ?? location.href);
  saveScroll();
  _setNavigation({ from: previous.href, to: target.href });
  try {
    if (target.origin !== location.origin) {
      location.href = target.href;
      return false;
    }
    if (target.pathname === previous.pathname && target.search === previous.search && (target.hash || previous.hash)) {
      finishNavigation(target, push, restore);
      return true;
    }
    const data = await fetchNav(target.pathname + target.search);
    if (version !== navigationVersion) return false;
    if (!data?.ok || data.mode !== "client") {
      location.href = target.href;
      return false;
    }
    if (!await applyPage(data, version) || version !== navigationVersion) return false;
    finishNavigation(target, push, restore);
    return true;
  } catch {
    if (version === navigationVersion) location.href = target.href;
    return false;
  } finally {
    if (version === navigationVersion) _setNavigation(null);
  }
}

/** Progressive form enhancement: POST ?/action without a reload. */
async function submitForm(form, request) {
  try {
    const response = await postForm(form, request);
    if (!response) return;
    const { data } = response;
    if (!data.ok) throw new Error(data.error ?? "Submission failed");
    if (data.redirect) return navigate(data.redirect);
    await applyPage(data);
  } catch {
    form.dispatchEvent(new CustomEvent("niral:form-error", { bubbles: true, detail: { error: "The response could not be received. Check whether the change was saved before retrying." } }));
  }
}

function install() {
  if (installed) return;
  installed = true;
  renderedUrl = location.href;
  const entry = history.state?.__niral ?? historyEntry();
  activeHistoryId = entry.id;
  history.replaceState({ ...history.state, __niral: entry }, "");
  history.scrollRestoration = "manual";
  addEventListener("scroll", () => {
    if (activeHistoryId) scrollPositions.set(activeHistoryId, [scrollX, scrollY]);
  }, { passive: true });
  addEventListener("pagehide", saveScroll);
  configureRefresh(refreshPage);
  configureForms({ changed: () => navCache.clear(), redirect: (url) => navigate(url) });
  // prefetch on hover — by the time the click lands, the payload is usually here
  addEventListener("mouseover", (e) => {
    const a = e.target.closest?.("a");
    if (!a || a.target || a.hasAttribute("download") || a.relList.contains("external")) return;
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
    if (!a || a.target || a.hasAttribute("download") || a.relList.contains("external")) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("mailto:")) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  addEventListener("popstate", () => navigate(location.href, { push: false, restore: true }));
  // form actions: <form method="post" action="?/save"> enhance in place
  addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    const form = e.target;
    if (!form?.getAttribute) return;
    const request = formRequest(form, e.submitter);
    if (!request) return;
    e.preventDefault();
    submitForm(form, request);
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
