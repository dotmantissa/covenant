import { timingSafeEqual } from "node:crypto";
/** A missing secret never turns a production signing endpoint into public access. */
export function isCronAuthorized(request:Request, secret=process.env.CRON_SECRET):boolean {
  if(!secret || secret.length<32)return false;
  const expected=Buffer.from(`Bearer ${secret}`);const actual=Buffer.from(request.headers.get('authorization')??'');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
