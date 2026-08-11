import { notFound } from "next/navigation";
import {
  getCustomer,
  getCustomerInvoices,
  getNamesakes,
  getCustomers,
  getTaxRate,
} from "@/lib/queries";
import { mailConfigured } from "@/lib/mail";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

/**
 * A customer profile addressed by primary key.
 *
 * This is the screen that started all of this: "I clicked manage customer for
 * Calico Point and it opened Bob's Bangles". That was possible because two rows
 * shared the id C-5 and the lookup returned whichever came first. The id is now
 * a primary key and the URL *is* the id, so this page can only ever show one
 * person — and if someone else shares their name, it says so rather than
 * quietly merging them.
 */
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const [invoices, namesakes, everyone, shopRate] = await Promise.all([
    getCustomerInvoices(id),
    getNamesakes(customer.name, id),
    getCustomers(),
    getTaxRate(),
  ]);

  return (
    <ProfileClient
      customer={customer}
      invoices={invoices}
      namesakes={namesakes}
      everyone={everyone}
      shopRate={shopRate}
      mailReady={await mailConfigured()}
    />
  );
}
