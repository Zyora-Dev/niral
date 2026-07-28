// Shared benchmark data — identical rows for every framework.
export const rows = (n = 1000) =>
  Array.from({ length: n }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 }));

/** The measurement shell every page uses: __t0 at parse start. */
export const shell = (head, body) => `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<script>window.__t0 = performance.now()</script>
${head}
</head><body>
${body}
</body></html>`;
