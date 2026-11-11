"use client";
import * as counter from "./counter.nrs";
import { useNrs } from "@niral/react";

export default function Counter({ initial = 0 }) {
  const c = useNrs(counter, { initial });
  return (
    <section>
      <h1 data-testid="count">{c.count}</h1>
      <p data-testid="doubled">doubled: {c.doubled}</p>
      <p data-testid="parity">parity: {c.parity}</p>
      <button data-testid="inc" onClick={c.increment}>increment</button>
      <button data-testid="reset" onClick={c.reset}>reset</button>
    </section>
  );
}
