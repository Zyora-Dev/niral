"use client";
import { useState } from "react";

export default function Rows({ items }) {
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <h1 onClick={() => setClicks(clicks + 1)}>
        Rows {items.length} · clicks {clicks}
      </h1>
      <ul>
        {items.map((t) => (
          <li key={t.id} className={t.done ? "done" : ""}>
            {t.id}: {t.text}
          </li>
        ))}
      </ul>
    </>
  );
}
