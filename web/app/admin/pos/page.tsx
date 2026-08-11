import {
  getAllProducts,
  getCustomers,
  getTaxRate,
  getSettings,
  requiresCustomer,
} from "@/lib/queries";
import { venmoQr } from "@/lib/qr";
import { PageHead } from "@/components/ui";
import PosClient from "./pos-client";

export const dynamic = "force-dynamic";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const wanted = Array.isArray(params.customer) ? params.customer[0] : params.customer;

  const [products, customers, shopRate, settings] = await Promise.all([
    getAllProducts(),
    getCustomers(),
    getTaxRate(),
    getSettings(),
  ]);

  // Inactive items stay out of the till but remain in reports and history.
  const sellable = products.filter((p) => p.active);
  const preselect = wanted ? (customers.find((c) => c.id === wanted) ?? null) : null;
  const qr = await venmoQr(settings.VenmoUser ?? "");

  return (
    <>
      <PageHead title="Point of sale" hint="Ring up a sale at the counter." />
      <PosClient
        products={sellable}
        customers={customers}
        shopRate={shopRate}
        venmoUser={settings.VenmoUser ?? ""}
        venmoQr={qr}
        requireCustomer={requiresCustomer(settings)}
        preselect={preselect}
      />
    </>
  );
}
