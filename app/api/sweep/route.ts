import { handleRouteError, jsonResponse } from "@/lib/api";
import { db, sweeps } from "@/lib/db";
import { runSweep } from "@/lib/sweep";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db()
      .select()
      .from(sweeps)
      .orderBy(desc(sweeps.startedAt))
      .limit(20);

    return jsonResponse({ sweeps: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const triggerParam = url.searchParams.get("trigger");
    const trigger = triggerParam === "manual" ? "manual" : "cron";

    const result = await runSweep({ trigger });
    return jsonResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
