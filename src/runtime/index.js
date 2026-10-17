/** Niral runtime — public surface. Generated code imports this as `__n`. */
export { signal, derived, effect, root, batch, untrack, prop, setContext, getContext, onMount, onDestroy, _setSink } from "./signals.js";
export {
  el, text, append, setAttr, bindAttr, bindClass, bindStyle, rawHtml, on, bindValue, bindPath, bindText,
  ifBlock, forBlock, awaitBlock, child, mount, transition, animateFlip, _setRestore, _hydrateNext, _routeChild,
} from "./dom.js";
export { rpc } from "./rpc.js";
export { formAction } from "./forms.js";
export { pageRefresh } from "./refresh.js";
export { pageNavigation } from "./navigation.js";
export { live } from "./live.js";
export { t, _setI18n, currentLocale } from "./i18n.js";
