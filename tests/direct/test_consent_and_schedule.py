"""Exact borrower consent, sealed authority and due-time enforcement."""
from conftest import FACILITY_ID,COVENANT_RATIO,COVENANT_TREASURY,GEN,mock_rpc_balance,TREASURY_RPC
from test_covenant_monitor import healthy_ratio


def test_wrong_displayed_terms_digest_is_refused(facility,direct_vm):
    direct_vm.sender=facility['borrower']
    with direct_vm.expect_revert('terms digest does not match'):
        facility['registry'].approve_covenant(FACILITY_ID,0,'0'*64)
    before=facility['registry'].get_covenant(FACILITY_ID,0)['terms_digest']
    healthy_ratio(direct_vm);facility['monitor'].test_covenant(FACILITY_ID,0);facility['wiring'].drain()
    assert facility['registry'].get_covenant(FACILITY_ID,0)['terms_digest']==before


def test_active_agreements_seal_owner_rewiring(facility,direct_vm,direct_owner,direct_charlie):
    direct_vm.sender=direct_owner
    for contract,method in [(facility['registry'],'set_monitor'),(facility['monitor'],'set_vault'),(facility['vault'],'set_registry')]:
        assert contract.get_wiring()['wiring_sealed']
        with direct_vm.expect_revert('wiring is sealed'):
            getattr(contract,method)(direct_charlie.as_hex)


def test_early_tests_require_explicit_party_override(facility,direct_vm,direct_charlie):
    healthy_ratio(direct_vm);m=facility['monitor'];m.test_covenant(FACILITY_ID,0);facility['wiring'].drain()
    direct_vm.sender=direct_charlie
    for manual in [False,True]:
        with direct_vm.expect_revert('test is not due'):m.test_covenant(FACILITY_ID,0,manual)
    direct_vm.sender=facility['borrower']
    with direct_vm.expect_revert('test is not due'):m.test_covenant(FACILITY_ID,0)
    m.test_covenant(FACILITY_ID,0,True)


def test_cure_expiry_precedes_cadence_and_breached_recovery_stays_due(facility,direct_vm):
    # Treasury has24h cadence and72h cure, so draft a slow720h cadence with72h cure.
    r,m,w=facility['registry'],facility['monitor'],facility['wiring'];direct_vm.sender=facility['lender']
    index=r.add_covenant(FACILITY_ID,'Keep the agreed treasury floor at all times.','treasury','Floor','','',0,600000*GEN,'gte',720,72,0,'draw_stop',[])
    direct_vm.sender=facility['borrower'];r.approve_covenant(FACILITY_ID,index,r.get_covenant(FACILITY_ID,index)['terms_digest']);w.drain()
    direct_vm.warp('2026-10-20T00:00:00Z');mock_rpc_balance(direct_vm,TREASURY_RPC,400000*GEN)
    m.test_covenant(FACILITY_ID,index);w.drain()
    assert r.get_covenant(FACILITY_ID,index)['next_due_at']=='2026-10-23T00:00:00Z'
    direct_vm.warp('2026-10-23T00:00:00Z');m.test_covenant(FACILITY_ID,index);w.drain()
    assert r.get_covenant(FACILITY_ID,index)['status']=='breached'
    direct_vm.warp('2026-11-23T00:00:00Z')
    assert any(c['covenant_index']==index for c in r.due_covenants())
    direct_vm.clear_mocks();mock_rpc_balance(direct_vm,TREASURY_RPC,800000*GEN)
    m.test_covenant(FACILITY_ID,index);w.drain()
    assert not m.get_enforcement_state(FACILITY_ID)['restrictions']
