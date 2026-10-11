import { attoInput, integerInput } from "@/lib/amounts";
import { handleRouteError, jsonResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { addresses } from "@/lib/chain";
import { submitIntent } from "@/lib/transactions";
export const maxDuration=60;

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

    return jsonResponse(await submitIntent({request,actor,facilityId,address:addresses().facilityRegistry,method:"add_covenant",args:[
      facilityId,String(text).trim(),String(kind).trim(),String(metric).trim(),String(numeratorLabel).trim(),String(denominatorLabel).trim(),
      integerInput(thresholdBp,"Threshold"),attoInput(thresholdAtto,true),String(comparator),
      integerInput(testFrequencyHours,"Frequency",1,8760),integerInput(curePeriodHours,"Cure period",0,8760),integerInput(filingDeadlineDays,"Filing deadline",0,366),
      String(breachConsequence),Array.isArray(sourceUrls)?sourceUrls:[]]}),202);
  } catch (error) {
    return handleRouteError(error);
  }
}
