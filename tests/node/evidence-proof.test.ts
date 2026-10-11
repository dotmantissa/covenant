import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesSnapshot } from '../../lib/evidence-proof';
const original={sequence:12,facility_id:'a',covenant_index:0,breached:true,status:'breached',observed_bp:14999,content_hash:'authentic',citation:'approved',under_appeal:false};
test('receipt correlation binds original sequence and every economic and source field',()=>{
 const {under_appeal:_,...normal}=original;void _;
 assert(matchesSnapshot(normal,original));
 for(const edit of [{sequence:13},{facility_id:'b'},{observed_bp:15000},{content_hash:'forged'},{citation:'unapproved'},{breached:false}])assert(!matchesSnapshot({...normal,...edit},original));
 assert(!matchesSnapshot({...normal,narrative:'unbound added narrative'},original));
});
test('appeal history is distinct and binds outcome plus bond payout recipient',()=>{
 const appeal={...original,sequence:13,under_appeal:true,appeal_status:'overturned',bond_atto:'100',bond_paid_to:'borrower'};
 assert(matchesSnapshot({finding:appeal,appeal_status:'overturned'},appeal));
 assert(!matchesSnapshot({finding:{...appeal,bond_paid_to:'lender'}},appeal));
 assert(!matchesSnapshot({finding:appeal},original));
});
