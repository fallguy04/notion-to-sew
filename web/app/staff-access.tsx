"use client";

import { useRef, useState } from "react";
import PinDialog from "./pin-dialog";

/**
 * Staff way into the admin area from the kiosk itself.
 *
 * A hairline dot needing a 700ms long press. The old kiosk used a 42px lock
 * icon at 22% opacity, which customers could hit by accident and staff could
 * not find on purpose; a long press is the opposite of both.
 */
export default function StaffAccess() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    timer.current = setTimeout(() => setOpen(true), 700);
  };
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  return (
    <>
      <button
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Staff access (press and hold)"
        title="Press and hold for staff access"
        className="fixed bottom-2 right-2 z-50 h-11 w-11 rounded-full opacity-25 transition-opacity active:opacity-60"
      >
        <span className="mx-auto block h-2 w-2 rounded-full bg-ink-faint" />
      </button>
      {open && <PinDialog onClose={() => setOpen(false)} />}
    </>
  );
}
