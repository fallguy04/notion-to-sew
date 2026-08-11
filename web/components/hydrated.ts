"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False while rendering on the server and during the first client render, true
 * afterwards.
 *
 * Portals need this: `document` does not exist on the server, and creating one
 * during hydration produces markup the server never sent. The obvious version
 * is `useState(false)` plus an effect that sets it true, but that schedules a
 * second render pass for every dialog on the page. `useSyncExternalStore` with
 * a server snapshot of `false` says the same thing in one pass, and React
 * treats it as the intended way to read something outside itself.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** Whether the device currently has a network. Used to explain, never to block. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    // Assume connected until the browser says otherwise, so the server-rendered
    // page never flashes an "offline" warning at someone who is online.
    () => true,
  );
}
