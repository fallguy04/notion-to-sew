import Link from "next/link";
import AdminCard from "./admin-card";

export const dynamic = "force-static";

/**
 * Runs during HTML parse, before the chooser paints, so an iPad never sees a
 * flash of this screen on its way to the kiosk.
 *
 * iPadOS Safari reports a "Macintosh" user-agent, so the server can't tell it
 * from a laptop. maxTouchPoints can: no Mac has a touchscreen. `?choose=1`
 * escapes the redirect, which is how you reach this screen from an iPad on
 * purpose.
 */
const DETECT = `
(function () {
  try {
    if (location.search.indexOf('choose') !== -1) return;
    var touch = navigator.maxTouchPoints > 1;
    var mac = /Macintosh|Mac OS X/.test(navigator.userAgent);
    var ipad = /iPad/.test(navigator.userAgent);
    if (ipad || (mac && touch)) location.replace('/kiosk');
  } catch (e) {}
})();
`;

export default function Chooser() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: DETECT }} />
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="rise w-full max-w-3xl">
          <header className="mb-10 text-center">
            <div className="font-display text-[34px] font-semibold tracking-tight">
              Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
            </div>
            <p className="mt-2 text-[13px] font-medium uppercase tracking-[0.14em] text-ink-faint">
              Where would you like to go?
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/kiosk"
              className="tap group flex flex-col justify-between rounded-2xl border border-line bg-surface p-7 min-h-[220px] hover:border-spruce hover:shadow-[0_8px_28px_-14px_rgba(34,32,29,0.25)]"
            >
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-spruce-light text-spruce">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="font-display mt-5 text-[24px] font-semibold">Shop</h2>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
                  The customer kiosk — search the catalogue and build a basket.
                </p>
              </div>
              <span className="mt-6 text-[15px] font-medium text-spruce">
                Open kiosk <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>

            <AdminCard />
          </div>

          <p className="mt-8 text-center text-[13px] text-ink-faint">
            On the iPad this screen is skipped and the kiosk opens straight away.
          </p>
        </div>
      </main>
    </>
  );
}
