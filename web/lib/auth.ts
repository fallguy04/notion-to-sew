import "server-only";
import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

/**
 * Staff sessions.
 *
 * The PIN never reaches the browser bundle, the comparison is constant-time so
 * a wrong answer takes as long as a right one, and the cookie is an httpOnly
 * HMAC over an issue time — there is nothing in it worth forging and nothing a
 * client can edit into a longer session.
 */

const COOKIE = "staff";
const MAX_AGE = 60 * 60 * 8; // a shop day

/**
 * A dedicated secret is preferred. Falling back to the PIN means changing the
 * PIN also invalidates every open session, which is the correct behaviour when
 * the PIN is changed because it leaked.
 */
const SECRET = process.env.KIOSK_SESSION_SECRET || process.env.KIOSK_ADMIN_PIN || "";

// Fail loudly at import rather than rejecting every correct PIN in silence.
if (!process.env.KIOSK_ADMIN_PIN) {
  console.error(
    "[auth] KIOSK_ADMIN_PIN is not set — every PIN will be rejected. " +
      "Note that `next start` does not load .env.local into the runtime; " +
      "export the vars, or set them in the Vercel dashboard.",
  );
}

function sign(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

export async function verifyPin(pin: string): Promise<boolean> {
  const expected = process.env.KIOSK_ADMIN_PIN ?? "";
  if (!expected) return false;
  const a = Buffer.from(pin.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));
  return timingSafeEqual(a, b);
}

export async function startSession() {
  const issued = `${Date.now()}.${randomBytes(8).toString("hex")}`;
  // Keyed to the actual request protocol rather than NODE_ENV. A production
  // build served over plain http — which is what `next start` does locally —
  // sets a Secure cookie the browser then refuses to store, so sign-in appears
  // to succeed and every page after it bounces back to the kiosk.
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";
  const jar = await cookies();
  jar.set(COOKIE, `${issued}.${sign(issued)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function isStaff(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return false;
  const value = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(value);
  if (mac.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;

  // The cookie's own maxAge already expires it, but a cookie is client-side
  // state; the signed timestamp is the copy the server can trust.
  const issuedAt = Number(value.split(".")[0]);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < MAX_AGE * 1000;
}

/**
 * Guard for every admin server action. Pages are protected by the admin layout;
 * actions are separate HTTP endpoints and have to check for themselves.
 */
export async function requireStaff() {
  if (!(await isStaff())) {
    throw new Error("Not signed in. Enter your PIN again to continue.");
  }
}
