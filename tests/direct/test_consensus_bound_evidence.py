"""Independent validator callbacks and canonical economic decisions."""
import copy
import pytest
from conftest import FACILITY_ID, COVENANT_FILING, COVENANT_RATIO, COVENANT_PROSE
from test_covenant_monitor import filing, healthy_ratio, prose


def exercise(direct_vm, monkeypatch, mutate, expected):
    from genlayer import gl
    def run(leader, validator):
        result = leader()
        assert validator(gl.vm.Return(calldata=result))
        different = copy.deepcopy(result)
        mutate(different)
        assert validator(gl.vm.Return(calldata=different)) is expected
        return result
    monkeypatch.setattr(gl.vm, 'run_nondet_unsafe', run)


def test_full_timestamp_cannot_bypass_bound_canonical_date(facility, direct_vm, monkeypatch):
    direct_vm.warp('2026-08-20T00:00:00Z'); filing(direct_vm, '2026-08-15')
    exercise(direct_vm, monkeypatch, lambda d: d.update(period_end='2026-06-30T23:59:59Z'), False)
    result = facility['monitor'].test_covenant(FACILITY_ID, COVENANT_FILING, True)
    assert result['observed_bp'] == 46 and result['breached']


def test_filing_date_times_are_canonical_before_arithmetic(facility, direct_vm):
    direct_vm.warp('2026-08-20T00:00:00Z'); filing(direct_vm, '2026-08-15T23:59:59Z')
    result = facility['monitor'].test_covenant(FACILITY_ID, COVENANT_FILING, True)
    assert result['observed_bp'] == 46


def test_obsolete_report_cannot_clear_missing_due_quarter(facility, direct_vm):
    direct_vm.warp('2027-01-01T00:00:00Z'); filing(direct_vm)
    result = facility['monitor'].test_covenant(FACILITY_ID, COVENANT_FILING, True)
    assert result['breached'] and '2026-09-30' in result['narrative']


@pytest.mark.parametrize('field,value', [('citation','attacker.example/forged'),('content_hash','0'*64),('artifact_date','1900-01-01'),('holds',False)])
def test_prose_consumed_fields_are_independently_bound(facility, direct_vm, monkeypatch, field, value):
    prose(direct_vm)
    exercise(direct_vm, monkeypatch, lambda d: d.update({field:value}), False)
    facility['monitor'].test_covenant(FACILITY_ID, COVENANT_PROSE, True)


def test_unbound_free_text_is_not_stored_as_verified(facility, direct_vm, monkeypatch):
    prose(direct_vm)
    from genlayer import gl
    def run(leader, validator):
        result=leader(); result.update(reasoning='FORGED REASON', artifact_title='FORGED TITLE')
        assert validator(gl.vm.Return(calldata=result))
        return result
    monkeypatch.setattr(gl.vm,'run_nondet_unsafe',run)
    facility['monitor'].test_covenant(FACILITY_ID,COVENANT_PROSE, True)
    f=facility['monitor'].get_finding(FACILITY_ID,COVENANT_PROSE)
    assert 'FORGED' not in f['narrative'] and len(f['content_hash']) == 64


@pytest.mark.parametrize('field,value', [('numerator_milli',1560000001),('as_of','2026-09-29'),('unit','ETH'),('locator','forged')])
def test_ratio_evidence_has_no_raw_figure_or_metadata_tolerance(facility,direct_vm,monkeypatch,field,value):
    direct_vm.warp('2026-10-11T00:00:00Z'); healthy_ratio(direct_vm)
    exercise(direct_vm,monkeypatch,lambda d:d.update({field:value}),False)
    facility['monitor'].test_covenant(FACILITY_ID,COVENANT_RATIO, True)


@pytest.mark.parametrize('num,den',[('100','-10'),('-100','10')])
def test_invalid_metric_signs_revert_without_clamping(facility,direct_vm,num,den):
    healthy_ratio(direct_vm,num,den)
    with direct_vm.expect_revert('ratio figures must be nonnegative'):
        facility['monitor'].test_covenant(FACILITY_ID,COVENANT_RATIO, True)


def test_stale_ratio_evidence_cannot_enforce_or_clear(facility,direct_vm):
    direct_vm.warp('2027-03-01T00:00:00Z');healthy_ratio(direct_vm)
    with direct_vm.expect_revert('ratio evidence must be dated'):
        facility['monitor'].test_covenant(FACILITY_ID,COVENANT_RATIO, True)
