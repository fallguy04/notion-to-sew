import Link from "next/link";
import { redirect } from "next/navigation";
import { isStaff } from "../actions";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Admin() {
  if (!(await isStaff())) redirect("/");

  const [stats] = (await sql`
    SELECT (SELECT count(*) FROM customers)                          AS customers,
           (SELECT count(*) FROM products WHERE active)              AS products,
           (SELECT count(*) FROM invoices)                           AS invoices,
           (SELECT count(*) FROM invoices WHERE status='pending')    AS open_invoices,
           (SELECT sum(total) FROM invoices WHERE status='paid')     AS paid`) as any[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between border-b border-line pb-5">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Admin</h1>
        <Link href="/" className="text-[15px] text-spruce underline-offset-4 hover:underline">
          Back to kiosk
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Customers", stats.customers],
          ["Products", stats.products],
          ["Invoices", stats.invoices],
          ["Open", stats.open_invoices],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {label}
            </div>
            <div className="tabular font-display mt-1 text-[30px] font-semibold">{String(value)}</div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[15px] text-ink-soft">
        Lifetime paid revenue{" "}
        <span className="tabular font-semibold">
          ${Number(stats.paid).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
        . The full admin portal is still on Streamlit while this is built out.
      </p>
    </main>
  );
}
