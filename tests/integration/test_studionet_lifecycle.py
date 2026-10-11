"""Verify persisted reviewer transactions and terminal state against live Studionet.

Generate the evidence with review_lifecycle.py first. These tests read the actual
network, recheck execution outcomes, and verify the complete recorded message tree.
"""
import hashlib
import json
import time
from pathlib import Path

import pytest
from gltest import get_contract_factory
from genlayer_py import create_client
from genlayer_py.chains import studionet
from genlayer_py.assertions import tx_execution_succeeded

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def evidence():
    path = ROOT / "evidence/studionet-review.json"
    assert path.exists(), "run the live reviewer lifecycle before checking its evidence"
    data = json.loads(path.read_text())
    assert "final_settlement" in data["checks"], "live lifecycle is incomplete"
    return data


def test_review_receipts_include_consensus_children_and_reverts(evidence):
    client = create_client(chain=studionet)
    for name, step in evidence["steps"].items():
        live = client.get_transaction(step["hash"])
        assert live["status_name"] == "FINALIZED", name
        assert live.get("leader_only") is False, name
        assert live.get("execution_mode") == "NORMAL", name
        if live.get("type") == 0:
            assert live.get("value_credited") is True, name
            assert live.get("triggered_on") == "finalized", name
            parent_name = name.rsplit("/child/", 1)[0]
            assert live.get("triggered_by") == evidence["steps"][parent_name]["hash"], name
            assert step["expectedSuccess"], name
        else:
            assert tx_execution_succeeded(live) == step["expectedSuccess"], name
        assert live.get("triggered_transactions", []) == step["receipt"].get("triggered_transactions", []), name
        time.sleep(2)  # respect hosted request limits while rechecking every receipt
        receipt = step["receipt"]
        assert receipt["status_name"] == "FINALIZED", name
        if receipt.get("type") == 0:
            assert receipt["value_credited"] is True, name
            assert receipt["triggered_on"] == "finalized", name
        else:
            assert tx_execution_succeeded(receipt) == step["expectedSuccess"], name
        assert step["explorer"].endswith(step["hash"]), name
        for tx_hash in receipt.get("triggered_transactions", []):
            assert f"{name}/child/{tx_hash}" in evidence["steps"], (name, tx_hash)
    for required in ["economic/repay", "economic/withdraw-interest", "appeal/breach-test",
                     "appeal/borrower-approve", "appeal/post-bond", "appeal/resolve",
                     "appeal/restored-draw", "cleanup/capital"]:
        assert required in evidence["steps"]


def test_deployed_sources_match_repository(evidence):
    for key, source in [("facilityRegistry", "facility_registry.py"),
                        ("covenantMonitor", "covenant_monitor.py"),
                        ("creditVault", "credit_vault.py")]:
        assert hashlib.sha256((ROOT / "contracts" / source).read_bytes()).hexdigest() == evidence["sourceHashes"][key]
    assert evidence["checks"]["deployed_source_hashes"] == evidence["sourceHashes"]
    assert json.loads((ROOT / "deploy/addresses.json").read_text())["contracts"] == evidence["contracts"]


def test_live_appeal_state_and_final_liabilities(evidence):
    fid = evidence["facilityId"]
    registry = get_contract_factory("FacilityRegistry").build_contract(
        contract_address=evidence["contracts"]["facilityRegistry"])
    monitor = get_contract_factory("CovenantMonitor").build_contract(
        contract_address=evidence["contracts"]["covenantMonitor"])
    vault = get_contract_factory("CreditVault").build_contract(
        contract_address=evidence["contracts"]["creditVault"])
    covenant = registry.get_covenant(args=[fid, 0]).call()
    assert covenant["borrower_authorized"]
    assert covenant["appeal_status"] == "overturned"
    assert monitor.get_appeal_bond(args=[fid, 0]).call() == "0"
    position = vault.get_position(args=[fid]).call()
    assert not position["accelerated"] and not position["draw_frozen"]
    assert position["committed_atto"] == "0" and position["drawn_atto"] == "0"
    assert vault.get_interest_collected(args=[fid]).call()["interest_collected_atto"] == "0"
    assert vault.get_wiring().call()["balance_atto"] == "0"


def test_recorded_economic_deltas_and_appeal_preserve_debt(evidence):
    checks = evidence["checks"]
    repayment = checks["repayment_and_surplus"]
    assert int(repayment["principalAtto"]) == 100 * 10**18
    assert int(repayment["earnedInterestAtto"]) > 0
    assert int(repayment["payerSurplusAtto"]) > 0
    assert (int(repayment["principalAtto"]) + int(repayment["earnedInterestAtto"]) +
            int(repayment["payerSurplusAtto"])) == 110 * 10**18
    assert checks["interest_settlement"]["lenderDeltaAtto"] == repayment["earnedInterestAtto"]
    reversal = checks["appeal_reversal_and_refund"]
    assert int(reversal["position"]["drawn_atto"]) == 10 * 10**18
    assert int(reversal["borrowerBondDeltaAtto"]) == 10**18
    assert int(checks["restored_rights"]["drawn_atto"]) == 11 * 10**18


def test_complete_lender_recovery(evidence):
    checks = evidence["checks"]
    assert checks["cleanup_interest"]["lenderDeltaAtto"] == checks["cleanup_repayment"]["earnedInterestAtto"]
    assert int(checks["final_settlement"]["lenderCapitalDeltaAtto"]) == 100 * 10**18
