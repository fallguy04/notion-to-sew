"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "./hydrated";

/**
 * Transient confirmation for actions that don't own a form — marking an invoice
 * paid, deleting a line, copying a link.
 *
 * Portalled to the body for the same reason modals are: an ancestor with a
 * transform would otherwise capture the fixed positioning and park the toast in
 * the middle of whatever card raised it.
 */

type Toast = { id: number; message: string; tone: "good" | "bad" };
type Ctx = (message: string, tone?: "good" | "bad") => void;

const ToastContext = createContext<Ctx>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const hydrated = useHydrated();

  const push = useCallback<Ctx>((message, tone = "good") => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, message, tone }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {hydrated &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4"
          >
            {items.map((t) => (
              <div
                key={t.id}
                className={`pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-2.5 text-[14px] font-medium shadow-[var(--shadow-float)] ${
                  t.tone === "bad" ? "bg-clay text-white" : "bg-ink text-white"
                }`}
              >
                <span aria-hidden className="mt-[2px]">
                  {t.tone === "bad" ? "!" : "✓"}
                </span>
                <span>{t.message}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
