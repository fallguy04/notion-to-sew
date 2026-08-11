import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * Neon's HTTP driver rather than a TCP pool.
 *
 * Vercel functions are short-lived and can scale to many concurrent instances;
 * a per-instance TCP pool would exhaust connections fast. HTTP has no handshake
 * to keep warm and no socket to drop — which also matters here because the
 * kiosk runs on shop wifi that comes and goes.
 */
export const sql = neon(process.env.DATABASE_URL);

export type Product = {
  sku: string;
  name: string;
  price: number;
  stock_qty: number;
  wholesale_price: number | null;
};

export type CartLine = {
  sku: string | null;
  description: string;
  qty: number;
  unit_price: number;
};
