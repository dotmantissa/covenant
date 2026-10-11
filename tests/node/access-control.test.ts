import assert from "node:assert/strict";
import { test } from "node:test";
import { isCronAuthorized } from "../../lib/cron-auth";
import { receivesAlert } from "../../lib/alert-access";

test("anonymous, missing-secret and incorrect-token requests cannot trigger signing sweeps",()=>{
  const secret='a'.repeat(64);const request=(token?:string)=>new Request('https://app/api/sweep',{headers:token?{authorization:token}:{}});
  assert(!isCronAuthorized(request(),secret));assert(!isCronAuthorized(request(`Bearer ${'b'.repeat(64)}`),secret));
  assert(!isCronAuthorized(request(`Bearer ${secret}`),''));assert(isCronAuthorized(request(`Bearer ${secret}`),secret));
});
test("alert audience is limited to actual counterparties and role",()=>{
  const facility={lenderAddress:'0xLender',borrowerAddress:'0xBorrower'};
  assert(receivesAlert('0xlender',facility,'both'));assert(receivesAlert('0xborrower',facility,'both'));
  assert(!receivesAlert('0xoutsider',facility,'both'));assert(!receivesAlert('0xborrower',facility,'lender'));
  assert(!receivesAlert('0xlender',facility,'borrower'));
});
