import { handlers, authConfigured } from "@/auth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!authConfigured()) return new Response("Sign-in is being configured.", { status: 503 });
  return handlers.GET(request);
}
export async function POST(request: NextRequest) {
  if (!authConfigured()) return new Response("Sign-in is being configured.", { status: 503 });
  return handlers.POST(request);
}
