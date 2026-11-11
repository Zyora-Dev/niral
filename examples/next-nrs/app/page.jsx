// Server Component rendering a NiralScript-backed Client Component island.
import Counter from "./counter.jsx";

export default function Page() {
  return (
    <main>
      <p>NiralScript + Next.js App Router</p>
      <Counter initial={5} />
    </main>
  );
}
