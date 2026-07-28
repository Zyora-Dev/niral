// React contender — same UI, plain createElement (no JSX = no transform games).
// Hydration signal: useEffect on the root fires after React commits hydration.
import { createElement as h, useState, useEffect } from "react";

export function App({ items }) {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    window.__hydrated = performance.now();
  }, []);
  return h(
    "div",
    null,
    h("h1", { onClick: () => setClicks((c) => c + 1) }, `Rows ${items.length} · clicks ${clicks}`),
    h(
      "ul",
      null,
      items.map((t) => h("li", { key: t.id, className: t.done ? "done" : "" }, `${t.id}: ${t.text}`))
    )
  );
}
