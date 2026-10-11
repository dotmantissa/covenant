import { handleRouteError,jsonResponse } from "@/lib/api";
import { db,ensureDatabase,sweeps } from "@/lib/db";
import { runSweep } from "@/lib/sweep";
import { isCronAuthorized } from "@/lib/cron-auth";
import { desc } from "drizzle-orm";
export const maxDuration=60;
export async function POST(request:Request) {
  if(!isCronAuthorized(request))return jsonResponse({error:'Scheduler authorization required.'},401);
  try{return jsonResponse(await runSweep({trigger:'cron'}));}catch(error){return handleRouteError(error);}
}
export async function GET(request:Request) {
  if(new URL(request.url).searchParams.get('scheduled')==='true')return POST(request);
  try{await ensureDatabase();return jsonResponse({sweeps:await db().select().from(sweeps).orderBy(desc(sweeps.startedAt)).limit(20)});}
  catch(error){return handleRouteError(error);}
}
