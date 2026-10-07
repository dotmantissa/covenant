import { handleRouteError, jsonResponse } from "@/lib/api";
import { actorsByAddress, requireActor, userByEmail } from "@/lib/auth";
import { clientFor, addresses, sendWrite } from "@/lib/chain";
import { covenants, db, facilities, positions } from "@/lib/db";
import { syncFacility } from "@/lib/sync";
import { desc, eq, or, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const showAll = url.searchParams.get("all") === "true";
    const addr = actor.address.toLowerCase();

    const conditions = [];

    if (!showAll) {
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

    const rows = await db()
      .select()
      .from(facilities)
      .where(conditions.length > 0 ? or(...conditions) : undefined)
      .orderBy(desc(facilities.syncedAt));

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

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    const writeResult = await sendWrite(
      client,
      "create_facility",
      addrs.facilityRegistry,
      "create_facility",
      [
        String(facilityId).trim(),
        String(finalBorrowerAddress).trim(),
        String(borrowerName).trim(),
        String(purpose).trim(),
        BigInt(principalAtto),
        Number(rateBp),
        Number(stepUpBp),
        String(treasuryRpcUrl).trim(),
        String(treasuryAddress).trim(),
        String(governanceUrl).trim(),
      ],
    );

    // Sync from chain to Neon read model
    const synced = await syncFacility(String(facilityId).trim(), writeResult.hash);

    return jsonResponse(
      {
        facility: synced.facility,
        position: synced.position,
        covenants: synced.covenants,
        txHash: writeResult.hash,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
