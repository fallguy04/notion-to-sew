"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "./hydrated";

/**
 * Renders into document.body rather than in place.
 *
 * A `position: fixed` overlay is positioned against the nearest ancestor that
 * has a transform, filter or perspective — not the viewport. The entrance
 * animation on the page wrapper leaves an identity transform behind
 * (matrix(1,0,0,1,0,0)), which was enough to make the backdrop cover only the
 * card it happened to sit inside, producing a small grey rectangle in the
 * middle of the screen instead of a full-window overlay.
 *
 * Portalling to body makes the overlay immune to whatever styling wraps the
 * component that opened it, so this cannot silently come back the next time
 * something animates.
 */
export default function Modal({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  const hydrated = useHydrated();

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!hydrated) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}
