import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { covenants, covenantTests, db, facilities } from "@/lib/db";
import { and, eq } from "drizzle-orm";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireActor(request);
    const { id: idStr } = await params;
    const testId = parseInt(idStr, 10);

    if (isNaN(testId)) {
      return jsonResponse({ error: "invalid test id" }, 400);
    }

    const [test] = await db()
      .select()
      .from(covenantTests)
      .where(eq(covenantTests.id, testId))
      .limit(1);

    if (!test) {
      return jsonResponse({ error: "evidence record not found" }, 404);
    }

    const [facility] = await db()
      .select()
      .from(facilities)
      .where(eq(facilities.facilityId, test.facilityId))
      .limit(1);

    const [covenant] = await db()
      .select()
      .from(covenants)
      .where(
        and(
          eq(covenants.facilityId, test.facilityId),
          eq(covenants.covenantIndex, test.covenantIndex),
        ),
      )
      .limit(1);

    return jsonResponse({
      test,
      facility: facility ?? null,
      covenant: covenant ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
