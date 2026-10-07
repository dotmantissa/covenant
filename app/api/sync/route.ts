import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { syncAllFacilities } from "@/lib/sync";

export async function POST(request: Request) {
  try {
    await requireActor(request);
    const syncedIds = await syncAllFacilities();
    return jsonResponse({
      success: true,
      syncedFacilityCount: syncedIds.length,
      facilityIds: syncedIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
