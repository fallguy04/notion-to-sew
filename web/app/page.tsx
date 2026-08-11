import KioskClient from "./kiosk-client";
import StaffAccess from "./staff-access";
import { getCatalogue, getTopSellers } from "@/lib/queries";

// The kiosk is the front door, exactly as it is today. Revalidating rather than
// rendering per request means a wifi hiccup serves the last good catalogue
// instead of an error page.
export const revalidate = 60;

export default async function Page() {
  const [catalogue, popular] = await Promise.all([getCatalogue(), getTopSellers(6)]);

  return (
    <main>
      <KioskClient catalogue={catalogue} popular={popular} />
      <StaffAccess />
    </main>
  );
}
