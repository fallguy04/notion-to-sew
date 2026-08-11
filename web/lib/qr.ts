import "server-only";
import QRCode from "qrcode";

/**
 * The Venmo QR code, drawn on the server and embedded in the page.
 *
 * The old app pulled this from api.qrserver.com, which meant the shop's payment
 * handle went to a third party on every sale and the code simply failed to
 * appear whenever the wifi was having one of its moments. Rendering it here
 * costs a few kilobytes of data URI and always works.
 */
export async function venmoQr(handle: string): Promise<string | null> {
  const user = handle.trim().replace(/^@/, "");
  if (!user) return null;
  try {
    return await QRCode.toDataURL(`https://venmo.com/u/${encodeURIComponent(user)}`, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#22201Dff", light: "#FFFFFFff" },
    });
  } catch {
    return null;
  }
}
