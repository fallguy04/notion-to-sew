"use server";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

/**
 * PIN check on the server.
 *
 * The PIN never reaches the browser bundle, and the comparison is
 * constant-time so a wrong answer takes as long as a right one. On success a
 * signed, httpOnly cookie marks the session as staff — there is no value in it
 * a client could forge.
 */
const SECRET = process.env.KIOSK_SESSION_SECRET || process.env.KIOSK_ADMIN_PIN || "";

function sign(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

export async function checkPin(pin: string): Promise<boolean> {
  const expected = process.env.KIOSK_ADMIN_PIN ?? "";
  if (!expected) return false;

  const a = Buffer.from(pin.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));
  if (!timingSafeEqual(a, b)) return false;

  const issued = `${Date.now()}.${randomBytes(8).toString("hex")}`;
  const jar = await cookies();
  jar.set("staff", `${issued}.${sign(issued)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // a shop day
  });
  return true;
}

export async function isStaff(): Promise<boolean> {
  const raw = (await cookies()).get("staff")?.value;
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return false;
  const [value, mac] = [raw.slice(0, idx), raw.slice(idx + 1)];
  const expected = sign(value);
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
