import { getCustomerIndex } from "@/lib/queries";
import { PageHead } from "@/components/ui";
import CustomersClient from "./customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rows = await getCustomerIndex();

  return (
    <>
      <PageHead
        title="Customers"
        hint="Profiles, purchase history and store credit."
      />
      <CustomersClient rows={rows} openNew={params.new === "1"} />
    </>
  );
}
