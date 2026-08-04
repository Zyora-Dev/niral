export const dynamic = "force-dynamic";

const DELAY = Number(process.env.BENCH_DELAY ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BLOCKING baseline: the page awaits the slow work before returning anything.
export default async function Page() {
  await sleep(DELAY);
  return (
    <>
      <h1>SHELL READY</h1>
      <p>STREAMED-OK total={1000}</p>
    </>
  );
}
