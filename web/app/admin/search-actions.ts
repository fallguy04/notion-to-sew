"use server";

import { requireStaff } from "@/lib/auth";
import { sql } from "@/lib/db";

/**
 * One search across the whole shop, for the command palette.
 *
 * Three small queries rather than one union: they rank differently, they cap
 * separately so a customer with forty invoices cannot crowd out the product
 * you were looking for, and each is a plain index-friendly predicate.
 *
 * Names and product names match a word at a time, the same rule the customer
 * picker uses — the book is filed "Bauman, Cindy" and people type "Cindy
 * Bauman". An empty pattern list makes ILIKE ALL vacuously true, so the
 * callers below always pass at least one term.
 */

export type Hit = {
  kind: "product" | "customer" | "invoice";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export async function paletteSearch(query: string): Promise<Hit[]> {
  await requireStaff();

  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length === 0) return [];
  const patterns = terms.map((t) => `%${t}%`);
  const digits = q.replace(/\D/g, "");

  const [products, customers, invoices] = await Promise.all([
    sql`
      SELECT sku, name, price::float8 AS price, stock_qty, active
        FROM products
       WHERE (sku || ' ' || name) ILIKE ALL(${patterns}::text[])
       ORDER BY (lower(sku) LIKE ${terms[0] + "%"}) DESC, active DESC, name
       LIMIT 6`,
    sql`
      SELECT id, name, email, phone, credit::float8 AS credit
        FROM customers
       WHERE name ILIKE ALL(${patterns}::text[])
          OR (${digits} <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ${"%" + digits + "%"})
          OR COALESCE(email, '') ILIKE ${"%" + q + "%"}
       ORDER BY (lower(name) LIKE ${terms[0] + "%"}) DESC, name
       LIMIT 6`,
    // Only when the search looks like an invoice number. Matching digits
    // inside every id would bury the real answers under coincidences.
    digits.length >= 2 && /^#?\d+$/.test(q)
      ? sql`
          SELECT i.id, i.total::float8 AS total, i.status::text AS status, i.sold_at,
                 COALESCE(c.name, 'Guest') AS customer_name
            FROM invoices i
            LEFT JOIN customers c ON c.id = i.customer_id
           WHERE i.id::text LIKE ${digits + "%"}
           ORDER BY i.id DESC
           LIMIT 5`
      : Promise.resolve([]),
  ]);

  const hits: Hit[] = [];

  for (const r of invoices as {
    id: number;
    total: number;
    status: string;
    sold_at: string;
    customer_name: string;
  }[]) {
    hits.push({
      kind: "invoice",
      id: String(r.id),
      title: `Invoice #${r.id}`,
      subtitle: `${r.customer_name} · ${fmt(r.total)} · ${r.status}`,
      href: `/admin/invoices/${r.id}`,
    });
  }

  for (const r of customers as {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    credit: number;
  }[]) {
    const bits = [r.phone, r.email].filter(Boolean) as string[];
    if (r.credit > 0) bits.unshift(`${fmt(r.credit)} credit`);
    hits.push({
      kind: "customer",
      id: r.id,
      title: r.name,
      subtitle: bits.join(" · ") || "No contact details",
      href: `/admin/customers/${r.id}`,
    });
  }

  for (const r of products as {
    sku: string;
    name: string;
    price: number;
    stock_qty: number;
    active: boolean;
  }[]) {
    hits.push({
      kind: "product",
      id: r.sku,
      title: r.sku,
      subtitle: `${r.name} · ${fmt(r.price)} · ${r.stock_qty} on hand${r.active ? "" : " · retired"}`,
      href: `/admin/inventory?q=${encodeURIComponent(r.sku)}`,
    });
  }

  return hits;
}

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
