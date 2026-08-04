import { Suspense } from "react";

export const dynamic = "force-dynamic";

const DELAY = Number(process.env.BENCH_DELAY ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STREAMING: the shell + <Suspense> fallback flush immediately; the async
// child streams in once its promise settles (React Server Components streaming).
async function Slow() {
  await sleep(DELAY);
  return <p>STREAMED-OK total={1000}</p>;
}

export default function Page() {
  return (
    <>
      <h1>SHELL READY</h1>
      <Suspense fallback={<p>PENDING</p>}>
        <Slow />
      </Suspense>
    </>
  );
}
