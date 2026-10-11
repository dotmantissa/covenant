/** Exact equality of immutable adjudications, independent of JSON property order. */
export function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function returnedFinding(value:unknown):Record<string,unknown>|null {
  if(!value || typeof value!=='object')return null;
  const result=value as Record<string,unknown>;
  const finding=result.finding && typeof result.finding==='object'?result.finding as Record<string,unknown>:result;
  if(!Number.isSafeInteger(finding.sequence)||typeof finding.facility_id!=='string'||!Number.isSafeInteger(finding.covenant_index))return null;
  return {...finding,under_appeal:finding.under_appeal??Boolean(result.finding)};
}
export function matchesSnapshot(returned:unknown,snapshot:Record<string,unknown>):boolean {
  const finding=returnedFinding(returned);return finding!==null&&canonical(finding)===canonical(snapshot);
}
