import KioskClient from "./kiosk-client";
import StaffAccess from "../staff-access";
import { getCatalogue, getTopSellers } from "@/lib/queries";

// Prerendered and revalidated rather than rendered per request: a wifi hiccup
// serves the last good catalogue instead of an error page.
export const revalidate = 60;

export default async function KioskPage() {
  const [catalogue, popular] = await Promise.all([getCatalogue(), getTopSellers(6)]);
  return (
    <main>
      <KioskClient catalogue={catalogue} popular={popular} />
      <StaffAccess />
    </main>
  );
}
