import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { alerts, db, facilities } from "@/lib/db";
import { desc, eq, or, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const addr = actor.address.toLowerCase();
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "true";

    // Find facilities belonging to this actor
    const userFacilities = await db()
      .select({ facilityId: facilities.facilityId })
      .from(facilities)
      .where(
        or(
          eq(sql`lower(${facilities.lenderAddress})`, addr),
          eq(sql`lower(${facilities.borrowerAddress})`, addr),
        ),
      );

    if (userFacilities.length === 0) {
      return jsonResponse({ alerts: [] });
    }

    const facilityIds = userFacilities.map((f) => f.facilityId);

    let query = db()
      .select()
      .from(alerts)
      .where(sql`${alerts.facilityId} in (${sql.join(
        facilityIds.map((id) => sql`${id}`),
        sql`, `,
      )})`);

    if (unreadOnly) {
      query = db()
        .select()
        .from(alerts)
        .where(
          sql`${alerts.readAt} is null and ${alerts.facilityId} in (${sql.join(
            facilityIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
    }

    const rows = await query.orderBy(desc(alerts.createdAt)).limit(50);

    return jsonResponse({ alerts: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireActor(request);
    const body = await request.json();
    const { alertId, markAll = false, facilityId } = body;

    if (markAll) {
      if (facilityId) {
        await db()
          .update(alerts)
          .set({ readAt: new Date() })
          .where(sql`${alerts.facilityId} = ${facilityId} and ${alerts.readAt} is null`);
      } else {
        await db()
          .update(alerts)
          .set({ readAt: new Date() })
          .where(sql`${alerts.readAt} is null`);
      }
      return jsonResponse({ success: true, all: true });
    }

    if (!alertId) {
      return jsonResponse({ error: "alertId is required" }, 400);
    }

    const [updated] = await db()
      .update(alerts)
      .set({ readAt: new Date() })
      .where(eq(alerts.id, Number(alertId)))
      .returning();

    return jsonResponse({ alert: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
