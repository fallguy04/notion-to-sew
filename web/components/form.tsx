"use client";

import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action-result";

/**
 * A submit button that knows whether its own form is in flight.
 *
 * The point is that a slow connection can no longer look like a dead one. The
 * complaint about the old kiosk — "it just doesn't respond" — was partly wifi
 * and partly that nothing on screen ever acknowledged the tap.
 */
export function Submit({
  children,
  pendingLabel,
  className = "btn btn-primary",
  disabled,
  formAction,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      {pending && <Spinner />}
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The one place a form reports how it went. */
export function Result({ result }: { result: ActionResult }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={`pop mt-3 flex items-start gap-1.5 text-[13.5px] leading-snug ${
        result.ok ? "text-spruce" : "text-clay"
      }`}
    >
      <span aria-hidden className="mt-[1px] shrink-0">
        {result.ok ? "✓" : "!"}
      </span>
      <span>{result.message}</span>
    </p>
  );
}
