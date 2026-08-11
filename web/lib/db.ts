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

export type ProductFull = Product & {
  cost: number | null;
  vendor: string | null;
  category: string | null;
  active: boolean;
};

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  credit: number;
  is_wholesale: boolean;
  tax_rate: number | null;
  joined_on: string | null;
};

/** What a picker needs — deliberately smaller than the full row. */
export type CustomerLite = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  credit: number;
  is_wholesale: boolean;
  tax_rate: number | null;
};

export type CartLine = {
  sku: string | null;
  description: string;
  qty: number;
  unit_price: number;
};

export type InvoiceStatus = "paid" | "pending" | "void";
export type PaymentMethod = "cash" | "check" | "card" | "venmo" | "invoice" | "credit";

export type Invoice = {
  id: number;
  customer_id: string | null;
  customer_name: string | null;
  status: InvoiceStatus;
  payment: PaymentMethod | null;
  subtotal: number;
  discount: number;
  freight: number;
  tax: number;
  credit_applied: number;
  total: number;
  is_wholesale: boolean;
  due_date: string | null;
  sold_at: string;
  paid_at: string | null;
  note: string | null;
};

export type InvoiceLine = {
  id: number;
  sku: string | null;
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type Expense = {
  id: number;
  spent_on: string;
  category: string;
  amount: number;
  description: string | null;
};
