import { submitIntent } from "@/lib/transactions";
import { integerInput } from "@/lib/amounts";
import { attoInput } from "@/lib/amounts";
import { handleRouteError, jsonResponse } from "@/lib/api";
import { actorsByAddress, optionalActor, requireActor, userByEmail } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { covenants, db, facilities, positions } from "@/lib/db";
import { currentFacilityIds } from "@/lib/sync";
import { desc, eq, or, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const actor = await optionalActor(request);
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const showAll = url.searchParams.get("all") === "true" || !actor;
    const addr = actor ? actor.address.toLowerCase() : "";

    const conditions = [];

    if (!showAll && addr) {
      if (role === "lender") {
        conditions.push(eq(sql`lower(${facilities.lenderAddress})`, addr));
      } else if (role === "borrower") {
        conditions.push(eq(sql`lower(${facilities.borrowerAddress})`, addr));
      } else {
        conditions.push(
          or(
            eq(sql`lower(${facilities.lenderAddress})`, addr),
            eq(sql`lower(${facilities.borrowerAddress})`, addr),
          ),
        );
      }
    }

    const activeIds = await currentFacilityIds();
    const rows = (await db()
      .select()
      .from(facilities)
      .where(conditions.length > 0 ? or(...conditions) : undefined)
      .orderBy(desc(facilities.syncedAt))).filter((row) => activeIds.has(row.facilityId));

    // Get positions for all these facilities
    const posRows = await db().select().from(positions);
    const posMap = new Map(posRows.map((p) => [p.facilityId, p]));

    // Get covenant counts and offside counts
    const covRows = await db().select().from(covenants);
    const covCounts = new Map<string, { total: number; offside: number }>();
    for (const c of covRows) {
      const current = covCounts.get(c.facilityId) ?? { total: 0, offside: 0 };
      current.total += 1;
      if (c.status === "breach_pending_cure" || c.status === "breached") {
        current.offside += 1;
      }
      covCounts.set(c.facilityId, current);
    }

    // Resolve counterparties
    const addressesToLookup = rows.flatMap((f) => [
      f.lenderAddress,
      f.borrowerAddress,
    ]);
    const usersMap = await actorsByAddress(addressesToLookup);

    const result = rows.map((f) => {
      const pos = posMap.get(f.facilityId);
      const counts = covCounts.get(f.facilityId) ?? { total: 0, offside: 0 };
      const lenderUser = usersMap.get(f.lenderAddress.toLowerCase());
      const borrowerUser = usersMap.get(f.borrowerAddress.toLowerCase());

      return {
        ...f,
        position: pos ?? null,
        covenantCount: counts.total,
        offsideCount: counts.offside,
        lenderEmail: lenderUser?.email ?? null,
        borrowerEmail: borrowerUser?.email ?? null,
      };
    });

    return jsonResponse({ facilities: result });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const body = await request.json();

    const {
      facilityId,
      borrowerAddress,
      borrowerEmail: targetBorrowerEmail,
      borrowerName,
      purpose = "",
      principalAtto,
      rateBp,
      stepUpBp = 200,
      treasuryRpcUrl = "",
      treasuryAddress = "",
      governanceUrl = "",
    } = body;

    if (!facilityId || !borrowerName || !principalAtto || rateBp === undefined) {
      return jsonResponse(
        {
          error:
            "facilityId, borrowerName, principalAtto, and rateBp are required",
        },
        400,
      );
    }

    // Resolve borrower address if email is given
    let finalBorrowerAddress = borrowerAddress;
    if (targetBorrowerEmail && !finalBorrowerAddress) {
      const existing = await userByEmail(targetBorrowerEmail);
      if (existing) {
        finalBorrowerAddress = existing.genlayerAddress;
      }
    }

    if (!finalBorrowerAddress) {
      return jsonResponse(
        { error: "a valid borrower address or registered borrower email is required" },
        400,
      );
    }

    return jsonResponse(await submitIntent({request,actor,facilityId:String(facilityId).trim(),
      address:addresses().facilityRegistry,method:"create_facility",args:[
        String(facilityId).trim(),String(finalBorrowerAddress).trim(),String(borrowerName).trim(),String(purpose).trim(),
        attoInput(principalAtto),integerInput(rateBp,"Rate",1,100000),integerInput(stepUpBp,"Step up",0,100000),
        String(treasuryRpcUrl).trim(),String(treasuryAddress).trim(),String(governanceUrl).trim()]}),202);
  } catch (error) {
    return handleRouteError(error);
  }
}
