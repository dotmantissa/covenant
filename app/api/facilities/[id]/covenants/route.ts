import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { clientFor, addresses, sendWrite } from "@/lib/chain";
import { syncFacility } from "@/lib/sync";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor(request);
    const { id: facilityId } = await params;
    const body = await request.json();

    const {
      text,
      kind,
      metric = "",
      numeratorLabel = "",
      denominatorLabel = "",
      thresholdBp = 0,
      thresholdAtto = "0",
      comparator,
      testFrequencyHours = 24,
      curePeriodHours = 0,
      filingDeadlineDays = 0,
      breachConsequence,
      sourceUrls = [],
    } = body;

    if (!text || !kind || !comparator || !breachConsequence) {
      return jsonResponse(
        {
          error:
            "text, kind, comparator, and breachConsequence are required",
        },
        400,
      );
    }

    const client = clientFor(actor.privyDid);
    const addrs = addresses();

    const writeResult = await sendWrite(
      client,
      "add_covenant",
      addrs.facilityRegistry,
      "add_covenant",
      [
        facilityId,
        String(text).trim(),
        String(kind).trim(),
        String(metric).trim(),
        String(numeratorLabel).trim(),
        String(denominatorLabel).trim(),
        Number(thresholdBp),
        BigInt(thresholdAtto),
        String(comparator).trim(),
        Number(testFrequencyHours),
        Number(curePeriodHours),
        Number(filingDeadlineDays),
        String(breachConsequence).trim(),
        Array.isArray(sourceUrls) ? sourceUrls : [String(sourceUrls)],
      ],
    );

    // Sync from chain to Neon read cache
    const synced = await syncFacility(facilityId);

    return jsonResponse(
      {
        covenants: synced.covenants,
        txHash: writeResult.hash,
        covenantIndex: writeResult.returned,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
