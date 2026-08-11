import KioskClient from "./kiosk-client";
import StaffAccess from "../staff-access";
import { getCatalogue, getTopSellers, getTaxRate, getSettings } from "@/lib/queries";
import { venmoQr } from "@/lib/qr";
import { mailConfigured } from "@/lib/mail";

/**
 * Prerendered and revalidated rather than rendered per request.
 *
 * A wifi hiccup then serves the last good catalogue instead of an error page,
 * which is the single biggest thing behind "it just doesn't respond". Whole
 * minutes of staleness cost nothing here: a price that changed 40 seconds ago
 * is still the right price.
 */
export const revalidate = 60;

export default async function KioskPage() {
  const [catalogue, popular, shopRate, settings] = await Promise.all([
    getCatalogue(),
    getTopSellers(6),
    getTaxRate(),
    getSettings(),
  ]);

  const qr = await venmoQr(settings.VenmoUser ?? "");

  return (
    <main>
      <KioskClient
        catalogue={catalogue}
        popular={popular}
        shopRate={shopRate}
        venmoUser={settings.VenmoUser ?? ""}
        venmoQr={qr}
        mailReady={await mailConfigured()}
      />
      <StaffAccess />
    </main>
  );
}
