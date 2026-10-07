"""Focused tests for the covenant breach appeal lifecycle.

Exercises posting dispute bonds, access control restrictions, polling stored
appeal state from contract state, re-testing under appeal, resolving appeals
(upheld vs overturned), transferring bonds, and moving cases out of the
appealed state.
"""

import pytest
from conftest import (
    COVENANT_RATIO,
    COVENANT_TREASURY,
    FACILITY_ID,
    GEN,
    REVENUE_URL,
    TREASURY_RPC,
    mock_page,
    mock_rpc_balance,
)
from test_covenant_monitor import healthy_ratio, lean_ratio


def test_only_borrower_can_appeal(facility, direct_vm):
    monitor = facility["monitor"]
    wiring = facility["wiring"]
    lender = facility["lender"]
    borrower = facility["borrower"]

    # 1. Trip covenant into breach_pending_cure
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    # 2. Lender cannot appeal
    direct_vm.sender = lender
    direct_vm.value = 1 * GEN
    wiring.credit(monitor.address_bytes, 1 * GEN)
    with pytest.raises(Exception, match="only the borrower can appeal"):
        monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)

    # 3. Third party cannot appeal
    from genlayer.py.types import Address
    direct_vm.sender = Address("0x" + "99" * 20)
    with pytest.raises(Exception, match="only the borrower can appeal"):
        monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)


def test_cannot_appeal_compliant_covenant(facility, direct_vm):
    monitor = facility["monitor"]
    wiring = facility["wiring"]
    borrower = facility["borrower"]

    healthy_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    direct_vm.sender = borrower
    direct_vm.value = 1 * GEN
    wiring.credit(monitor.address_bytes, 1 * GEN)
    with pytest.raises(Exception, match="there is no finding to appeal"):
        monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)


def test_cannot_appeal_with_zero_bond(facility, direct_vm):
    monitor = facility["monitor"]
    wiring = facility["wiring"]
    borrower = facility["borrower"]

    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    direct_vm.sender = borrower
    direct_vm.value = 0
    with pytest.raises(Exception, match="an appeal needs a bond"):
        monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)


def test_appeal_open_state_and_polling(facility, direct_vm):
    monitor = facility["monitor"]
    registry = facility["registry"]
    wiring = facility["wiring"]
    borrower = facility["borrower"]

    # Trip covenant
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    # Borrower posts 1 GEN bond
    direct_vm.sender = borrower
    bond_1 = 1 * GEN
    direct_vm.value = bond_1
    wiring.credit(monitor.address_bytes, bond_1)
    res = monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)

    assert res["appeal_status"] == "open"
    assert res["bond_atto"] == str(bond_1)

    # Poll stored appeal bond directly from monitor view
    assert monitor.get_appeal_bond(FACILITY_ID, COVENANT_RATIO) == str(bond_1)

    # Drain emitted record_appeal to registry
    wiring.drain()

    # Poll registry state: covenant reflects open appeal and bond
    cov = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)
    assert cov["appeal_status"] == "open"
    assert cov["appeal_bond_atto"] == str(bond_1)

    # Stacking bond: borrower adds another 0.5 GEN
    bond_2 = 5 * 10**17
    direct_vm.value = bond_2
    wiring.credit(monitor.address_bytes, bond_2)
    res2 = monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)

    total_bond = bond_1 + bond_2
    assert res2["bond_atto"] == str(total_bond)
    assert monitor.get_appeal_bond(FACILITY_ID, COVENANT_RATIO) == str(total_bond)

    wiring.drain()
    cov2 = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)
    assert cov2["appeal_bond_atto"] == str(total_bond)


def test_resolve_appeal_upheld_awards_bond_to_lender(facility, direct_vm):
    monitor = facility["monitor"]
    registry = facility["registry"]
    wiring = facility["wiring"]
    lender = facility["lender"]
    borrower = facility["borrower"]

    # Trip covenant
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    # Borrower appeals with 2 GEN bond
    bond = 2 * GEN
    direct_vm.sender = borrower
    direct_vm.value = bond
    wiring.credit(monitor.address_bytes, bond)
    monitor.appeal_breach(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    # Off-chain evidence still reflects breach
    lean_ratio(direct_vm)

    # Resolve appeal: retest on-chain confirms breach
    transfers_before = len(wiring.transfers)
    outcome = monitor.resolve_appeal(FACILITY_ID, COVENANT_RATIO)

    assert outcome["appeal_status"] == "upheld"
    assert outcome["bond_paid_to"] == lender.as_hex
    assert outcome["bond_atto"] == str(bond)

    # Stored appeal bond is zeroed out
    assert monitor.get_appeal_bond(FACILITY_ID, COVENANT_RATIO) == "0"

    # Verify emitted transfer paid bond to lender
    assert len(wiring.transfers) == transfers_before + 1
    transfer = wiring.transfers[-1]
    assert transfer["to"].lower() == lender.as_hex.lower()
    assert transfer["value"] == bond

    # Drain emitted record_appeal to registry
    wiring.drain()

    # Poll registry: covenant moved out of open appeal to upheld with 0 bond
    cov = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)
    assert cov["appeal_status"] == "upheld"
    assert cov["appeal_bond_atto"] == "0"


def test_resolve_appeal_overturned_refunds_borrower_and_cures(funded, direct_vm):
    monitor = funded["monitor"]
    registry = funded["registry"]
    vault = funded["vault"]
    wiring = funded["wiring"]
    borrower = funded["borrower"]

    # 1. Trip covenant: treasury drops below 600,000 GEN threshold
    mock_rpc_balance(direct_vm, TREASURY_RPC, 400_000 * GEN)
    monitor.test_covenant(FACILITY_ID, COVENANT_TREASURY)
    wiring.drain()

    # Vault enforces draw stop
    pos_before = vault.get_position(FACILITY_ID)
    assert pos_before["draw_frozen"] is True

    # 2. Borrower appeals with 1.5 GEN bond
    bond = 15 * 10**17
    direct_vm.sender = borrower
    direct_vm.value = bond
    wiring.credit(monitor.address_bytes, bond)
    res = monitor.appeal_breach(FACILITY_ID, COVENANT_TREASURY)
    assert res["appeal_status"] == "open"
    wiring.drain()

    # 3. Off-chain treasury balance recovers above threshold
    direct_vm.clear_mocks()
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)

    # 4. Resolve appeal: retest on-chain overturns breach finding
    transfers_before = len(wiring.transfers)
    outcome = monitor.resolve_appeal(FACILITY_ID, COVENANT_TREASURY)

    assert outcome["appeal_status"] == "overturned"
    assert outcome["bond_paid_to"] == borrower.as_hex
    assert outcome["bond_atto"] == str(bond)

    # Stored appeal bond in monitor is cleared
    assert monitor.get_appeal_bond(FACILITY_ID, COVENANT_TREASURY) == "0"

    # Verify emitted transfer refunded bond to borrower
    assert len(wiring.transfers) == transfers_before + 1
    transfer = wiring.transfers[-1]
    assert transfer["to"].lower() == borrower.as_hex.lower()
    assert transfer["value"] == bond

    # Drain emitted updates to registry and vault
    wiring.drain()

    # Poll registry: status moved to cured, appeal status overturned, 0 bond
    cov = registry.get_covenant(FACILITY_ID, COVENANT_TREASURY)
    assert cov["status"] == "cured"
    assert cov["appeal_status"] == "overturned"
    assert cov["appeal_bond_atto"] == "0"

    # Poll vault: draw freeze released
    pos_after = vault.get_position(FACILITY_ID)
    assert pos_after["draw_frozen"] is False
