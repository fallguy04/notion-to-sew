"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useHydrated } from "@/components/hydrated";

/**
 * The offer to put the shop on the home screen.
 *
 * Browsers never surface this on their own where anyone finds it — Chrome
 * hides it behind a menu, iOS Safari behind the share sheet — so an installable
 * app with no prompt is an app nobody installs. This shows one card, on a
 * phone, signed in, until it's either installed or waved away. Waved away is
 * remembered; a nag that returns every morning teaches people to stop reading
 * banners at all.
 *
 * Chromium hands us a real install prompt to fire from our own button. iOS
 * has no such API — never has — so there the card can only say the two taps.
 */

const KEY = "nts.install.dismissed";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallNudge() {
  const hydrated = useHydrated();
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const grab = (e: Event) => {
      // Chrome would otherwise show its own mini-bar at a moment of its choosing.
      e.preventDefault();
      setOffer(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", grab);
    return () => window.removeEventListener("beforeinstallprompt", grab);
  }, []);

  if (!hydrated || gone) return null;
  if (isStandalone()) return null; // already on the home screen
  if (remembered()) return null;
  if (!window.matchMedia("(pointer: coarse)").matches) return null; // phones, not laptops
  const ios = isIos();
  if (!offer && !ios) return null; // a browser with neither path gets no dead-end card

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      /* private mode — the state still hides it for this visit */
    }
    setGone(true);
  };

  const install = async () => {
    if (!offer) return;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    if (outcome === "accepted") dismiss();
  };

  return (
    <div className="no-print mb-5 flex items-center gap-3.5 rounded-2xl border border-spruce/25 bg-spruce-light/60 py-3 pl-3.5 pr-2 lg:hidden">
      <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-[11px]" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-snug">Put the shop on your home screen</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">
          {ios
            ? "Tap the Share button, then “Add to Home Screen”."
            : "Its own icon, full screen, and readable without a signal."}
        </p>
      </div>
      {offer && (
        <button type="button" onClick={install} className="btn btn-primary btn-sm shrink-0">
          Add
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="tap shrink-0 rounded-lg p-2 text-ink-faint"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

function remembered() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

function isIos() {
  const ua = navigator.userAgent;
  // Modern iPads say "Macintosh"; the touch points give them away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
