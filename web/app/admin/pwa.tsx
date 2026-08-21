"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useOnline } from "@/components/hydrated";
import { dateTime } from "@/lib/format";

const SEEN = "nts.lastSync";

/**
 * Installing the back office, and telling the truth when it is offline.
 *
 * Every screen in here is rendered on the server against the shop's database,
 * so there is nothing to recompute on the phone. What the service worker keeps
 * is the last copy of each page that was actually opened, which is enough to
 * look up a price, a phone number or what someone owes while standing in a
 * queue with no signal.
 *
 * The banner is the point. Stale figures shown as though they were current is
 * how someone quotes a balance that was settled an hour ago, so the moment the
 * network is gone the page says so, and says when what you are reading was
 * fetched.
 */
export default function Pwa() {
  const online = useOnline();
  const pathname = usePathname();
  /** Set when the worker had to answer this page out of the cache. */
  const [stale, setStale] = useState<string | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* http, private mode, or an unsupported browser — the app still works */
    });
  }, []);

  useEffect(() => {
    // Ask the worker whether the page now on screen came from the network or
    // out of its cache. A device can be perfectly online and still not reach
    // the shop's server, and stale takings shown as current is the failure
    // worth guarding against.
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const said = e.data as { url: string; at: string | null } | null;
      setStale(said && said.url === window.location.href ? said.at : null);
    };
    sw.postMessage("nts:stale?", [ch.port2]);
    return () => ch.port1.close();
  }, [pathname]);

  useEffect(() => {
    if (!online) return;
    // Stamped per page view while the network is there, so the banner can say
    // how old the thing you are looking at actually is.
    try {
      localStorage.setItem(SEEN, new Date().toISOString());
    } catch {
      /* private mode */
    }
  }, [online, pathname]);

  if (online && !stale) return null;

  // Read at render rather than kept in state: there is nothing to keep in step
  // with, and useOnline reports true on the server, so this branch only ever
  // runs on a client that already knows something is wrong.
  const seen = stale ?? readSeen();

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-50 border-t border-amber/40 bg-amber/15 px-4 py-2.5 backdrop-blur">
      <p className="mx-auto max-w-3xl text-center text-[13px] leading-snug text-ink-soft">
        <strong className="font-semibold text-ink">
          {online ? "Can't reach the shop." : "No connection."}
        </strong>{" "}
        You&apos;re reading the last copy this phone loaded
        {seen ? `, from ${dateTime(seen)}` : ""}. Nothing can be saved or sent until it&apos;s
        back.
      </p>
    </div>
  );
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
}

/** Wipes the cached pages when someone signs out — they hold the shop's book. */
export async function forgetCachedPages() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage("nts:forget");
  } catch {
    /* nothing registered */
  }
}
