import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies a Svix-signed webhook, which is what Resend uses.
 *
 * Done by hand rather than with the `svix` package: it is twenty lines, and a
 * dependency that can post to your database on a stranger's say-so is one
 * worth being able to read.
 *
 * The signature covers `id.timestamp.body` over the *raw* body — so the route
 * must pass the exact bytes it received, not a re-serialised object. A single
 * reordered key would fail.
 */
export function verifySvix(opts: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  /** How far out of date a timestamp may be, in seconds. */
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, id, timestamp, signature, body } = opts;
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing signature headers" };

  // A replayed request is a real attack: an old "delivered" could be resent
  // forever. Five minutes matches Svix's own window.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (opts.toleranceSeconds ?? 300)) {
    return { ok: false, reason: "timestamp too far from now" };
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  // The header carries space-separated `v1,<signature>` pairs; any one matching
  // is enough, and each comparison is constant-time.
  const candidates = signature
    .split(" ")
    .map((part) => part.split(",", 2)[1])
    .filter((s): s is string => Boolean(s));

  const a = Buffer.from(expected);
  const matched = candidates.some((c) => {
    const b = Buffer.from(c);
    return b.length === a.length && timingSafeEqual(a, b);
  });

  return matched ? { ok: true } : { ok: false, reason: "signature did not match" };
}
