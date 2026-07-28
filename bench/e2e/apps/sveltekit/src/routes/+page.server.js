// dynamic SSR on every request (SvelteKit default — no prerender)
export function load() {
  return { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 })) };
}
