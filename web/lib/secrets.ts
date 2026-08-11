import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql } from "./db";

/**
 * Credentials the shop sets from inside the app.
 *
 * Stored encrypted with a key derived from KIOSK_SESSION_SECRET, so a copy of
 * the database on its own is not a copy of the mail password. AES-256-GCM
 * because it authenticates as well as encrypts: a tampered ciphertext fails to
 * decrypt rather than quietly producing garbage that gets sent to Gmail as a
 * password.
 *
 * The trade this makes is honest: the key lives in the environment and the
 * ciphertext lives in the database, so anyone holding both can read the secret.
 * That is the same bargain as putting it in the environment directly, minus the
 * part where it also sits in a database backup in plain text.
 */

const KEY = createHash("sha256")
  .update(`nts-secret-v1:${process.env.KIOSK_SESSION_SECRET ?? ""}`)
  .digest(); // 32 bytes

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function decrypt(packed: string): string | null {
  try {
    const [iv, tag, body] = packed.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, or someone edited the row. Either way there is no secret here.
    return null;
  }
}

/** A safe-to-display fingerprint: how long it is and how it ends. */
const hintFor = (value: string) =>
  value.length <= 4 ? `${value.length} characters` : `${value.length} characters ending ${value.slice(-4)}`;

export async function putSecret(key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return removeSecret(key);
  await sql`
    INSERT INTO app_secrets (key, ciphertext, hint, updated_at)
    VALUES (${key}, ${encrypt(trimmed)}, ${hintFor(trimmed)}, now())
    ON CONFLICT (key) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext,
           hint = EXCLUDED.hint,
           updated_at = now()`;
}

export async function removeSecret(key: string) {
  await sql`DELETE FROM app_secrets WHERE key = ${key}`;
}

export async function getSecret(key: string): Promise<string | null> {
  const rows = (await sql`SELECT ciphertext FROM app_secrets WHERE key = ${key}`) as {
    ciphertext: string;
  }[];
  if (rows.length === 0) return null;
  return decrypt(rows[0].ciphertext);
}

/** What the settings screen may show about a stored secret — never the value. */
export async function describeSecret(key: string) {
  const rows = (await sql`
    SELECT hint, updated_at FROM app_secrets WHERE key = ${key}`) as {
    hint: string | null;
    updated_at: string;
  }[];
  return rows[0] ?? null;
}
