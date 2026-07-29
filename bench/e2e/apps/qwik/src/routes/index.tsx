import { component$, useSignal } from "@builder.io/qwik";

// dynamic SSR on every request — same 1000-row page
export default component$(() => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: "row item number " + i, done: i % 3 === 0 }));
  const clicks = useSignal(0);
  return (
    <>
      <h1 onClick$={() => clicks.value++}>
        Rows {items.length} · clicks {clicks.value}
      </h1>
      <ul>
        {items.map((t) => (
          <li key={t.id} class={t.done ? "done" : ""}>
            {t.id}: {t.text}
          </li>
        ))}
      </ul>
    </>
  );
});
