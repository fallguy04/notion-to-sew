export const metadata = { title: "Offline — Notion to Sew" };

/**
 * The fallback for a page that was never opened on this device, so there is no
 * copy of it to show. Deliberately plain: it is served from the cache with no
 * data behind it, and it should not pretend otherwise.
 */
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="font-display text-[26px] font-semibold tracking-tight">
        Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
      </div>
      <h1 className="mt-6 font-display text-[22px] font-semibold">No connection</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
        This page hasn&apos;t been opened on this phone before, so there&apos;s no copy of it to
        show. Pages you have already visited will still open.
      </p>
      <p className="mt-4 text-[14px] leading-relaxed text-ink-faint">
        Nothing can be saved while you&apos;re offline. A sale rung up now would have to guess at
        prices and stock that may have moved, so it&apos;s better written on paper and entered
        after.
      </p>
    </main>
  );
}
