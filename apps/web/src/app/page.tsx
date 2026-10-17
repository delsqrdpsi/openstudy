import Link from "next/link";

export default function Home() {
  return (
    <main className="wb-paper flex min-h-full flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-xl text-center">
        <h1 style={{ fontFamily: "var(--wb-font-family)" }} className="text-6xl font-bold">
          OpenStudy
        </h1>
        <p className="mt-3 text-lg text-neutral-600">A whiteboard tutor you run yourself. Talks, writes, draws, listens.</p>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
        <div className="text-sm font-medium text-neutral-500">Fixture lessons (no model, no network)</div>
        <Link href="/lesson/rl101" className="rounded-full bg-sky-500 px-6 py-3 text-center text-lg font-semibold text-white hover:bg-sky-600">
          Reinforcement Learning 101
        </Link>
      </div>
    </main>
  );
}
