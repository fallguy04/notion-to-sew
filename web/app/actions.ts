"use server";

import { redirect } from "next/navigation";
import { verifyPin, startSession, endSession } from "@/lib/auth";

export async function checkPin(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false;
  await startSession();
  return true;
}

export async function signOut() {
  await endSession();
  redirect("/kiosk");
}
