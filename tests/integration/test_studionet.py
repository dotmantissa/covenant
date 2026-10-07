import json
import uuid
from pathlib import Path
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

def load_addresses():
    addresses_file = Path("deploy/addresses.json")
    with open(addresses_file, "r") as f:
        data = json.load(f)
    return data["contracts"]

def test_studionet_wiring_verification():
    addresses = load_addresses()
    registry_addr = addresses["facilityRegistry"]
    monitor_addr = addresses["covenantMonitor"]
    vault_addr = addresses["creditVault"]

    registry_factory = get_contract_factory("FacilityRegistry")
    registry = registry_factory.build_contract(contract_address=registry_addr)
    reg_wiring = registry.get_wiring().call()
    assert reg_wiring["monitor"].lower() == monitor_addr.lower()
    assert reg_wiring["vault"].lower() == vault_addr.lower()

    monitor_factory = get_contract_factory("CovenantMonitor")
    monitor = monitor_factory.build_contract(contract_address=monitor_addr)
    mon_wiring = monitor.get_wiring().call()
    assert mon_wiring["registry"].lower() == registry_addr.lower()
    assert mon_wiring["vault"].lower() == vault_addr.lower()

    vault_factory = get_contract_factory("CreditVault")
    vault = vault_factory.build_contract(contract_address=vault_addr)
    vlt_wiring = vault.get_wiring().call()
    assert vlt_wiring["registry"].lower() == registry_addr.lower()
    assert vlt_wiring["monitor"].lower() == monitor_addr.lower()

def test_studionet_registry_portfolio_read():
    addresses = load_addresses()
    registry_addr = addresses["facilityRegistry"]
    registry_factory = get_contract_factory("FacilityRegistry")
    registry = registry_factory.build_contract(contract_address=registry_addr)

    summary = registry.portfolio_summary().call()
    assert "facilities" in summary
    assert "covenants" in summary
    assert "principal_atto" in summary
    assert isinstance(summary["facilities"], int)

    facility_ids = registry.list_facility_ids().call()
    assert isinstance(facility_ids, list)

def test_studionet_monitor_findings_read():
    addresses = load_addresses()
    monitor_addr = addresses["covenantMonitor"]
    monitor_factory = get_contract_factory("CovenantMonitor")
    monitor = monitor_factory.build_contract(contract_address=monitor_addr)

    findings = monitor.get_findings().call()
    assert isinstance(findings, list)

def test_studionet_vault_stats_read():
    addresses = load_addresses()
    vault_addr = addresses["creditVault"]
    vault_factory = get_contract_factory("CreditVault")
    vault = vault_factory.build_contract(contract_address=vault_addr)

    wiring = vault.get_wiring().call()
    assert "total_committed_atto" in wiring
    assert "total_drawn_atto" in wiring
    assert "position_count" in wiring

    positions = vault.get_positions().call()
    assert isinstance(positions, list)

def test_studionet_create_facility_and_covenant():
    addresses = load_addresses()
    registry_addr = addresses["facilityRegistry"]
    registry_factory = get_contract_factory("FacilityRegistry")
    registry = registry_factory.build_contract(contract_address=registry_addr)

    unique_id = f"fac-gltest-{uuid.uuid4().hex[:8]}"
    borrower_dummy = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

    # 1. Create facility on chain via consensus
    tx_create = registry.create_facility(args=[
        unique_id,
        borrower_dummy,
        "Test Borrower Co",
        "Working capital for inventory expansion",
        1_000_000_000_000_000_000_000,  # 1000 tokens
        750,                            # 7.5% base
        200,                            # 2.0% step-up
        "https://eth.llamarpc.com",
        "0x0000000000000000000000000000000000000001",
        "https://governance.example.com",
    ]).transact()

    assert tx_execution_succeeded(tx_create), f"create_facility transaction failed: {tx_create}"

    # Verify facility was stored
    fac = registry.get_facility(args=[unique_id]).call()
    assert fac["facility_id"] == unique_id
    assert fac["borrower_name"] == "Test Borrower Co"
    assert fac["rate_bp"] == 750
    assert fac["step_up_bp"] == 200
    assert fac["covenant_count"] == 0

    # 2. Add covenant on chain via consensus
    tx_covenant = registry.add_covenant(args=[
        unique_id,
        "Total debt to tangible net worth shall not exceed 3.0x at any quarter end.",
        "ratio",
        "Leverage Ratio",
        "total_debt",
        "tangible_net_worth",
        30000,                          # 3.0x in bp
        0,
        "lte",
        24,                             # test frequency: 24h
        72,                             # cure period: 72h
        0,
        "rate_step_up",
        ["https://reports.example.com/q3.json"],
    ]).transact()

    assert tx_execution_succeeded(tx_covenant), f"add_covenant transaction failed: {tx_covenant}"

    # Verify covenant was stored
    updated_fac = registry.get_facility(args=[unique_id]).call()
    assert updated_fac["covenant_count"] == 1

    covenants = registry.get_covenants(args=[unique_id]).call()
    assert len(covenants) == 1
    cov = covenants[0]
    assert cov["kind"] == "ratio"
    assert cov["threshold_bp"] == 30000
    assert cov["comparator"] == "lte"
    assert cov["breach_consequence"] == "rate_step_up"
