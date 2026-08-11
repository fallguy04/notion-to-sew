import { getAllProducts } from "@/lib/queries";
import { PageHead } from "@/components/ui";
import InventoryClient from "./inventory-client";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "out", "low", "nocost", "inactive"] as const;
type Filter = (typeof FILTERS)[number];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : "all";

  const products = await getAllProducts();

  return (
    <>
      <PageHead
        title="Inventory"
        hint="What you have, what it costs and what it sells for."
      />
      <InventoryClient
        products={products}
        openRestock={params.restock === "1"}
        initialFilter={filter}
      />
    </>
  );
}
