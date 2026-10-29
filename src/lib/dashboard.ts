import { cache } from "react";
import { redirect } from "next/navigation";
import { auth, authConfigured } from "../auth";
import { isAllowedEmail } from "./access";
import { database } from "./db";
import { reportError } from "./log";

export const requireDashboard = cache(async function requireDashboard() {
  if (!authConfigured()) redirect("/signin");
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email, process.env.ALLOWED_EMAILS)) redirect("/signin");
  return { session };
});

export async function dashboardClinic() {
  await requireDashboard();
  try {
    return await database().clinic.findUnique({
      where: { slug: process.env.CLINIC_SLUG ?? "dr-sands" },
      select: { id: true, name: true },
    });
  } catch {
    reportError("DATABASE_UNAVAILABLE");
    return null;
  }
}
