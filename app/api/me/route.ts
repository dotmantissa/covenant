import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { alerts, db, facilities } from "@/lib/db";
import { eq, or, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const addr = actor.address.toLowerCase();

    // Query user's facilities from database
    const userFacilities = await db()
      .select()
      .from(facilities)
      .where(
        or(
          eq(sql`lower(${facilities.lenderAddress})`, addr),
          eq(sql`lower(${facilities.borrowerAddress})`, addr),
        ),
      );

    const asLender = userFacilities.filter(
      (f) => f.lenderAddress.toLowerCase() === addr,
    );
    const asBorrower = userFacilities.filter(
      (f) => f.borrowerAddress.toLowerCase() === addr,
    );

    // Unread alerts count
    const [unread] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(alerts)
      .where(sql`${alerts.readAt} is null and ${alerts.facilityId} in (${
        userFacilities.length > 0
          ? sql.join(
              userFacilities.map((f) => sql`${f.facilityId}`),
              sql`, `,
            )
          : sql`''`
      })`);

    return jsonResponse({
      actor: {
        email: actor.email,
        privyDid: actor.privyDid,
        address: actor.address,
      },
      counts: {
        total: userFacilities.length,
        asLender: asLender.length,
        asBorrower: asBorrower.length,
        unreadAlerts: unread?.count ?? 0,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
