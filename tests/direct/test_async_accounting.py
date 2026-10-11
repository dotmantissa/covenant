"""Temporal money accounting and multi-hop retry regressions."""
import copy
from conftest import FACILITY_ID, COVENANT_RATIO, COVENANT_PROSE, GEN, repay_amount
from test_covenant_monitor import healthy_ratio, lean_ratio, prose
from test_adversarial_remedies import bond


def test_reordered_rate_history_charges_the_complete_breach_interval(funded,direct_vm,helpers):
    m,w,v=funded['monitor'],funded['wiring'],funded['vault']
    direct_vm.warp('2026-10-20T00:00:00Z');direct_vm.sender=funded['borrower']
    v.draw(FACILITY_ID,100*GEN);w.drain();lean_ratio(direct_vm)
    m.test_covenant(FACILITY_ID,COVENANT_RATIO, True);w.drain()
    direct_vm.warp('2026-11-10T00:00:00Z');m.test_covenant(FACILITY_ID,COVENANT_RATIO, True)
    before=v.get_position(FACILITY_ID)
    # Repaying while rate history is undelivered must not undercharge interest.
    direct_vm.value=GEN;w.credit(v.address_bytes,GEN)
    with direct_vm.expect_revert('settlement is pending'):v.repay(FACILITY_ID)
    direct_vm.value=0
    direct_vm.warp('2026-11-20T00:00:00Z');direct_vm.clear_mocks();healthy_ratio(direct_vm)
    m.test_covenant(FACILITY_ID,COVENANT_RATIO, True)
    replay=copy.deepcopy(w.deferred);w.deferred.reverse();w.drain()
    after=v.get_position(FACILITY_ID);mod=helpers('credit_vault')
    elapsed=mod.seconds_between(before['last_accrual_at'],after['last_accrual_at'])
    expected=100*GEN*(850*elapsed+400*10*86400)//(10000*31536000)
    assert int(after['interest_accrued_atto'])-int(before['interest_accrued_atto'])==expected
    assert after['current_rate_bp']==850
    w.deferred.extend(replay);w.drain()
    assert v.get_position(FACILITY_ID)['interest_accrued_atto']==after['interest_accrued_atto']


def test_same_revision_retry_repairs_dropped_registry_status(funded,direct_vm):
    m,w,v,r=funded['monitor'],funded['wiring'],funded['vault'],funded['registry']
    prose(direct_vm,False);m.test_covenant(FACILITY_ID,COVENANT_PROSE, True);w.drain()
    bond(funded,direct_vm,COVENANT_PROSE);w.drain();direct_vm.clear_mocks();prose(direct_vm,True)
    m.resolve_appeal(FACILITY_ID,COVENANT_PROSE)
    while w.deferred:
        target,payload,sender,value=w.deferred.pop(0)
        if payload.get('method')=='set_facility_status':continue
        if '_transfer_index' in payload:
            t=w.transfers[payload['_transfer_index']]
            if not t['settled']:w.credit(target,value);t['settled']=True
        else:w._invoke(target,payload,sender,value)
    assert not v.get_position(FACILITY_ID)['accelerated']
    assert r.get_facility(FACILITY_ID)['status']=='accelerating'
    m.sync_enforcement(FACILITY_ID);w.drain()
    assert r.get_facility(FACILITY_ID)['status']=='active'
    assert r.get_covenant(FACILITY_ID,COVENANT_PROSE)['appeal_status']=='overturned'


def test_rate_only_remedy_preserves_borrowing(funded,direct_vm):
    direct_vm.warp('2026-10-20T00:00:00Z');lean_ratio(direct_vm)
    funded['monitor'].test_covenant(FACILITY_ID,COVENANT_RATIO, True);funded['wiring'].drain()
    direct_vm.warp('2026-11-10T00:00:00Z');funded['monitor'].test_covenant(FACILITY_ID,COVENANT_RATIO, True);funded['wiring'].drain()
    p=funded['vault'].get_position(FACILITY_ID)
    assert p['current_rate_bp']==1250 and not p['draw_frozen']
    direct_vm.sender=funded['borrower'];funded['vault'].draw(FACILITY_ID,GEN)
    assert funded['registry'].get_facility(FACILITY_ID)['status']=='active'


def test_history_preserves_every_adjudication_and_appeal_settlement(funded,direct_vm):
    m,w=funded['monitor'],funded['wiring']
    prose(direct_vm,False);first=m.test_covenant(FACILITY_ID,COVENANT_PROSE, True);w.drain()
    original=m.get_test(first['sequence']);bond(funded,direct_vm,COVENANT_PROSE);w.drain()
    direct_vm.clear_mocks();prose(direct_vm,True);result=m.resolve_appeal(FACILITY_ID,COVENANT_PROSE);w.drain()
    assert m.get_test(first['sequence'])==original
    page=m.list_tests(0,1);assert page['tests']==[original] and page['total']==2
    final=m.list_tests(page['next_sequence'],1)['tests'][0]
    assert final['under_appeal'] and final['appeal_status']=='overturned'
    assert final['bond_paid_to']==funded['borrower'].as_hex and final['bond_atto']==str(GEN)
    assert result['finding']==final
