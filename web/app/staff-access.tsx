"use client";

import { useCallback, useRef, useState } from "react";
import PinDialog from "./pin-dialog";

/**
 * The staff way into the back office from the kiosk itself.
 *
 * Two handles, both hidden in plain sight, because one was not enough:
 *
 *  - **Three taps on the shop's name.** Unambiguous — a tap either happened or
 *    it didn't — and nobody triple-taps a heading by accident. This is the one
 *    to remember, because the name is always on screen.
 *  - **A press held on the dot in the corner**, kept as a fallback.
 *
 * The old kiosk used a 42px lock icon at 22% opacity, which customers could hit
 * by accident and staff could not find on purpose. Neither of these is visible
 * as a control, and neither responds to a stray touch.
 */
const TAPS_NEEDED = 3;
// Two seconds, not one: this has to be comfortable for someone who isn't
// trying to beat a stopwatch, and nobody taps a heading three times in two
// seconds by accident either.
const TAP_WINDOW_MS = 2000;

export function useStaffUnlock(holdMs = 700) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taps = useRef<number[]>([]);

  const cancelHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const startHold = useCallback(() => {
    cancelHold();
    timer.current = setTimeout(() => setOpen(true), holdMs);
  }, [cancelHold, holdMs]);

  /** Three taps inside the window. Older taps fall out as time passes. */
  const onTap = useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current, now].filter((t) => now - t < TAP_WINDOW_MS);
    if (taps.current.length >= TAPS_NEEDED) {
      taps.current = [];
      setOpen(true);
    }
  }, []);

  const noCallout = (e: React.MouseEvent) => e.preventDefault();

  return {
    /** For the shop name: three taps, and no long-press text selection. */
    tapHandlers: { onClick: onTap, onContextMenu: noCallout },
    /** For the corner dot: press and hold. */
    holdHandlers: {
      onPointerDown: startHold,
      onPointerUp: cancelHold,
      onPointerLeave: cancelHold,
      onPointerCancel: cancelHold,
      onContextMenu: noCallout,
    },
    dialog: open ? <PinDialog onClose={() => setOpen(false)} /> : null,
  };
}

/** The fallback handle: a hairline dot in the corner, held for a moment. */
export default function StaffAccess() {
  const { holdHandlers, dialog } = useStaffUnlock();
  return (
    <>
      <button
        {...holdHandlers}
        aria-label="Staff access (press and hold)"
        title="Press and hold for staff access"
        className="fixed bottom-2 right-2 z-50 h-11 w-11 rounded-full opacity-25 transition-opacity active:opacity-60"
      >
        <span className="mx-auto block h-2 w-2 rounded-full bg-ink-faint" />
      </button>
      {dialog}
    </>
  );
}
