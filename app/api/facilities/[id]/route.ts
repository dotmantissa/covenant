import { handleRouteError, jsonResponse } from "@/lib/api";
import { actorsByAddress, optionalActor } from "@/lib/auth";
import { alerts, covenants, covenantTests, db, facilities, positions } from "@/lib/db";
import { syncFacility } from "@/lib/sync";
import { desc, eq } from "drizzle-orm";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await optionalActor(request);
    const { id: facilityId } = await params;
    const url = new URL(request.url);
    const shouldRefresh = url.searchParams.get("refresh") === "true";

    if (shouldRefresh) {
      try {
        await syncFacility(facilityId);
      } catch (e) {
        console.warn(`Could not refresh facility ${facilityId} from chain:`, e);
      }
    }

    const [facility] = await db()
      .select()
      .from(facilities)
      .where(eq(facilities.facilityId, facilityId))
      .limit(1);

    if (!facility) {
      // Try to sync directly in case it exists on chain but wasn't in DB yet
      try {
        const synced = await syncFacility(facilityId);
        return jsonResponse({
          facility: synced.facility,
          position: synced.position ?? null,
          covenants: synced.covenants,
          tests: [],
          alerts: [],
        });
      } catch {
        return jsonResponse({ error: "facility not found" }, 404);
      }
    }

    const [position] = await db()
      .select()
      .from(positions)
      .where(eq(positions.facilityId, facilityId))
      .limit(1);

    const covRows = await db()
      .select()
      .from(covenants)
      .where(eq(covenants.facilityId, facilityId))
      .orderBy(covenants.covenantIndex);

    const tests = await db()
      .select()
      .from(covenantTests)
      .where(eq(covenantTests.facilityId, facilityId))
      .orderBy(desc(covenantTests.createdAt))
      .limit(20);

    const facilityAlerts = await db()
      .select()
      .from(alerts)
      .where(eq(alerts.facilityId, facilityId))
      .orderBy(desc(alerts.createdAt))
      .limit(15);

    const usersMap = await actorsByAddress([
      facility.lenderAddress,
      facility.borrowerAddress,
    ]);

    return jsonResponse({
      facility: {
        ...facility,
        lenderEmail: usersMap.get(facility.lenderAddress.toLowerCase())?.email ?? null,
        borrowerEmail:
          usersMap.get(facility.borrowerAddress.toLowerCase())?.email ?? null,
      },
      position: position ?? null,
      covenants: covRows,
      tests,
      alerts: facilityAlerts,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
