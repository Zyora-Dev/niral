import { createSignal, For } from "solid-js";

// dynamic SSR on every request — same 1000-row page as the other frameworks
export default function Home() {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 }));
  const [clicks, setClicks] = createSignal(0);
  return (
    <>
      <h1 onClick={() => setClicks(clicks() + 1)}>
        Rows {items.length} · clicks {clicks()}
      </h1>
      <ul>
        <For each={items}>{(t) => <li class={t.done ? "done" : ""}>{t.id}: {t.text}</li>}</For>
      </ul>
    </>
  );
}
