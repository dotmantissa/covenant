import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { covenantTests, db } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    await requireActor(request);
    const url = new URL(request.url);
    const facilityId = url.searchParams.get("facilityId");
    const covenantIndexStr = url.searchParams.get("covenantIndex");
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "25", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

    let whereClause = undefined;

    if (facilityId && covenantIndexStr !== null) {
      const covenantIndex = parseInt(covenantIndexStr, 10);
      whereClause = and(
        eq(covenantTests.facilityId, facilityId),
        eq(covenantTests.covenantIndex, covenantIndex),
      );
    } else if (facilityId) {
      whereClause = eq(covenantTests.facilityId, facilityId);
    }

    const rows = await db()
      .select()
      .from(covenantTests)
      .where(whereClause)
      .orderBy(desc(covenantTests.createdAt))
      .limit(limit)
      .offset(offset);

    return jsonResponse({ evidence: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}
