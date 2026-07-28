import Rows from "./rows";

// dynamic SSR on every request — same behavior as niral load() and SvelteKit
export const dynamic = "force-dynamic";

async function getItems() {
  return Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 }));
}

export default async function Page() {
  const items = await getItems();
  return <Rows items={items} />;
}
