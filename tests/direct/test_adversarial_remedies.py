"""Adversarial enforcement/accounting tests with actual contracts and queued messages."""
import copy

import pytest

from conftest import (
    COVENANT_PROSE, COVENANT_RATIO, COVENANT_TREASURY, FACILITY_ID, GEN,
    PRINCIPAL, REVENUE_URL, SECONDARY_RPC, TREASURY_ACCOUNT,
    TREASURY_RPC, commit_capital, mock_rpc_balance, open_facility, repay_amount,
)
from test_covenant_monitor import healthy_ratio, lean_ratio, prose


def draft(registry, facility_id=FACILITY_ID, consequence="draw_stop", kind="ratio"):
    return registry.add_covenant(
        facility_id, "Maintain the agreed minimum liquidity coverage at all times.", kind,
        "Liquidity", "assets", "liabilities", 12000, GEN, "gte", 24, 0, 0,
        consequence, [REVENUE_URL] if kind != "treasury" else [],
    )


def bond(stack, vm, index, amount=GEN):
    vm.sender = stack["borrower"]
    vm.value = amount
    stack["wiring"].credit(stack["monitor"].address_bytes, amount)
    try:
        return stack["monitor"].appeal_breach(FACILITY_ID, index)
    finally:
        vm.value = 0


def test_exact_borrower_consent_and_no_blanket_authorization(funded, direct_vm):
    registry, monitor = funded["registry"], funded["monitor"]
    direct_vm.sender = funded["lender"]
    index = draft(registry, consequence="acceleration")
    assert not registry.get_covenant(FACILITY_ID, index)["borrower_authorized"]
    with direct_vm.expect_revert("not authorized by borrower"):
        monitor.test_covenant(FACILITY_ID, index)
    with direct_vm.expect_revert("only the borrower"):
        registry.approve_covenant(FACILITY_ID, index)
    direct_vm.sender = funded["borrower"]
    registry.approve_covenant(FACILITY_ID, index)
    assert registry.get_covenant(FACILITY_ID, index)["borrower_authorized"]
    healthy_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, index)
    direct_vm.sender = funded["lender"]
    next_index = draft(registry, consequence="acceleration")
    assert not registry.get_covenant(FACILITY_ID, next_index)["borrower_authorized"]
    with direct_vm.expect_revert("not authorized by borrower"):
        monitor.test_covenant(FACILITY_ID, next_index)


def test_first_covenant_after_funding_requires_consent(stack, direct_vm, direct_alice, direct_bob):
    open_facility(stack["registry"], direct_vm, direct_alice, direct_bob)
    commit_capital(stack, direct_vm, direct_alice, PRINCIPAL)
    index = draft(stack["registry"])
    with direct_vm.expect_revert("not authorized by borrower"):
        stack["monitor"].test_covenant(FACILITY_ID, index)
    assert stack["registry"].due_covenants() == []


def test_clean_covenant_cannot_release_another_breach(funded, direct_vm):
    mock_rpc_balance(direct_vm, TREASURY_RPC, 400_000 * GEN)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    healthy_ratio(direct_vm)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["draw_frozen"]
    assert funded["registry"].get_facility(FACILITY_ID)["status"] == "draw_stopped"
    direct_vm.clear_mocks()
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    funded["wiring"].drain()
    assert not funded["vault"].get_position(FACILITY_ID)["draw_frozen"]


def test_queued_breach_blocks_draw_before_delivery(funded, direct_vm):
    prose(direct_vm, holds=False)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    direct_vm.sender = funded["borrower"]
    with direct_vm.expect_revert("enforcement is pending"):
        funded["vault"].draw(FACILITY_ID, GEN)


def test_reverse_delivery_and_replay_do_not_restore_stale_breach(funded, direct_vm):
    monitor, wiring = funded["monitor"], funded["wiring"]
    mock_rpc_balance(direct_vm, TREASURY_RPC, 400_000 * GEN)
    monitor.test_covenant(FACILITY_ID, COVENANT_TREASURY)
    direct_vm.clear_mocks()
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    monitor.test_covenant(FACILITY_ID, COVENANT_TREASURY)
    replay = copy.deepcopy(wiring.deferred)
    wiring.deferred.reverse()
    wiring.drain()
    wiring.deferred.extend(replay)
    wiring.drain()
    assert funded["registry"].get_covenant(FACILITY_ID, COVENANT_TREASURY)["status"] == "cured"
    assert funded["registry"].get_facility(FACILITY_ID)["status"] == "active"
    assert not funded["vault"].get_position(FACILITY_ID)["draw_frozen"]
    assert all(m.get("on") == "finalized" for m in wiring.messages)


def test_no_capital_yet_preserves_restrictions_and_replays(facility, direct_vm):
    prose(direct_vm, holds=False)
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    healthy_ratio(direct_vm)
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)
    facility["wiring"].deferred.reverse()
    facility["wiring"].drain()
    commit_capital(facility, direct_vm, facility["lender"], PRINCIPAL)
    assert facility["vault"].get_position(FACILITY_ID)["accelerated"]
    assert facility["registry"].get_facility(FACILITY_ID)["status"] == "accelerating"


def test_cure_clock_cannot_reset_when_registry_is_delayed(funded, direct_vm):
    lean_ratio(direct_vm)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)
    # No delivery of registry.record_test_result.
    direct_vm.warp("2026-11-05T12:00:00Z")
    result = funded["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)
    assert result["status"] == "breached"
    funded["wiring"].deferred.reverse()
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["current_rate_bp"] == 1250


def test_successful_appeal_restores_draws_and_returns_bond_once(funded, direct_vm):
    prose(direct_vm, holds=False)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    # Open appeal even before registry receives finding.
    bond(funded, direct_vm, COVENANT_PROSE)
    direct_vm.clear_mocks()
    prose(direct_vm, holds=True)
    result = funded["monitor"].resolve_appeal(FACILITY_ID, COVENANT_PROSE)
    assert result["appeal_status"] == "overturned"
    replay = copy.deepcopy(funded["wiring"].deferred)
    funded["wiring"].deferred.reverse()
    funded["wiring"].drain()
    funded["wiring"].deferred.extend(replay)
    funded["wiring"].drain()
    position = funded["vault"].get_position(FACILITY_ID)
    assert not position["accelerated"] and not position["draw_frozen"]
    assert funded["registry"].get_covenant(FACILITY_ID, COVENANT_PROSE)["appeal_status"] == "overturned"
    transfers = [t for t in funded["wiring"].transfers if t["from"] == funded["monitor"].address.lower()]
    assert len(transfers) == 1 and transfers[0]["value"] == GEN
    with direct_vm.expect_revert("no appeal is open"):
        funded["monitor"].resolve_appeal(FACILITY_ID, COVENANT_PROSE)
    funded["vault"].draw(FACILITY_ID, GEN)


@pytest.mark.parametrize("other", ["draw_stop", "rate_step_up", "acceleration"])
def test_appeal_removes_only_disputed_restriction(funded, direct_vm, other):
    registry, monitor = funded["registry"], funded["monitor"]
    direct_vm.sender = funded["lender"]
    index = draft(registry, consequence=other)
    direct_vm.sender = funded["borrower"]
    registry.approve_covenant(FACILITY_ID, index)
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, index)
    prose(direct_vm, holds=False)
    monitor.test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    bond(funded, direct_vm, COVENANT_PROSE)
    direct_vm.clear_mocks()
    prose(direct_vm, holds=True)
    monitor.resolve_appeal(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    position = funded["vault"].get_position(FACILITY_ID)
    assert position["draw_frozen"]
    assert position["accelerated"] == (other == "acceleration")
    assert position["current_rate_bp"] == (1250 if other == "rate_step_up" else 850)
    expected = "accelerating" if other == "acceleration" else "draw_stopped"
    assert registry.get_facility(FACILITY_ID)["status"] == expected


def test_lost_child_messages_can_be_retried_without_duplicate_bond(funded, direct_vm):
    prose(direct_vm, holds=False)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].deferred.clear()  # lost/failed child messages
    funded["monitor"].sync_enforcement(FACILITY_ID)
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["accelerated"]
    funded["monitor"].sync_enforcement(FACILITY_ID)
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["enforcement_count"] == 1


def test_repayment_cannot_clear_other_acceleration(funded, direct_vm):
    direct_vm.sender = funded["borrower"]
    funded["vault"].draw(FACILITY_ID, GEN)
    prose(direct_vm, holds=False)
    funded["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    repay_amount(funded, direct_vm, funded["borrower"], 2 * GEN)
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["accelerated"]
    assert funded["registry"].get_facility(FACILITY_ID)["status"] == "accelerating"


def test_collected_interest_isolated_partial_withdraw_and_replay(funded, direct_vm):
    vault, wiring = funded["vault"], funded["wiring"]
    direct_vm.warp("2026-11-05T12:00:00Z")
    direct_vm.sender = funded["borrower"]
    vault.draw(FACILITY_ID, 1_000_000 * GEN)
    wiring.drain()
    direct_vm.warp("2027-11-05T12:00:00Z")
    repay_amount(funded, direct_vm, funded["borrower"], 100_000 * GEN)
    collected = int(vault.get_interest_collected(FACILITY_ID)["interest_collected_atto"])
    assert collected == 85_000 * GEN
    with direct_vm.expect_revert("only the lender"):
        vault.withdraw_interest(FACILITY_ID)
    direct_vm.sender = funded["lender"]
    for amount in (-1, collected + 1):
        with direct_vm.expect_revert():
            vault.withdraw_interest(FACILITY_ID, amount)
    before = wiring.balance_of(funded["lender"])
    vault.withdraw_interest(FACILITY_ID, GEN)
    vault.withdraw_interest(FACILITY_ID)
    with direct_vm.expect_revert("no earned interest"):
        vault.withdraw_interest(FACILITY_ID)
    assert wiring.balance_of(funded["lender"]) == before  # native value is reserved, not yet credited
    wiring.drain()
    assert wiring.balance_of(funded["lender"]) - before == collected
    position = vault.get_position(FACILITY_ID)
    undrawn = int(position["committed_atto"]) - int(position["drawn_atto"])
    assert wiring.balance_of(vault.address_bytes) == undrawn
    vault.withdraw_free_capital(FACILITY_ID, undrawn)
    assert wiring.balance_of(vault.address_bytes) == 0
    assert all(m.get("on") == "finalized" for m in wiring.messages)
    assert all(t["kind"] == "external" for t in wiring.transfers)


@pytest.mark.parametrize("third_party", [False, True])
def test_surplus_returns_to_payer_and_principal_remains_available(funded, direct_vm, direct_charlie, third_party):
    vault, wiring = funded["vault"], funded["wiring"]
    direct_vm.sender = funded["borrower"]
    vault.draw(FACILITY_ID, 500_000 * GEN)
    wiring.drain()
    payer = direct_charlie if third_party else funded["borrower"]
    before = wiring.balance_of(payer)
    result = repay_amount(funded, direct_vm, payer, 600_000 * GEN)
    assert result["principal_paid_atto"] == str(500_000 * GEN)
    assert result["excess_refunded_atto"] == str(100_000 * GEN)
    assert wiring.balance_of(payer) == before
    wiring.drain()
    assert wiring.balance_of(payer) - before == 100_000 * GEN
    assert wiring.balance_of(vault.address_bytes) == PRINCIPAL
    assert int(vault.get_position(FACILITY_ID)["repaid_atto"]) == 500_000 * GEN


@pytest.mark.parametrize("url", ["http://evil.example", "https://localhost:8545", "https://10.1.1.1", "https://eth.llamarpc.com.evil.example", "https://user@eth.llamarpc.com", "https://evil.example/rpc"])
def test_caller_rpc_cannot_supply_treasury_facts(stack, direct_vm, direct_alice, direct_bob, url):
    registry = stack["registry"]
    direct_vm.sender = direct_alice
    registry.create_facility("bad-rpc", direct_bob.as_hex, "Test", "Test", GEN, 700, 200,
                             url, TREASURY_ACCOUNT, "")
    index = draft(registry, "bad-rpc", kind="treasury")
    direct_vm.sender = direct_bob
    registry.approve_covenant("bad-rpc", index)
    with direct_vm.expect_revert("approved Ethereum mainnet provider"):
        stack["monitor"].test_covenant("bad-rpc", index)


def envelope(result):
    return {"jsonrpc": "2.0", "id": 1, "result": result}


@pytest.mark.parametrize("method,result,message", [
    ("eth_chainId", "0x2", "chain identity mismatch"),
    ("eth_getBalance", "0x00", "invalid RPC quantity"),
    ("eth_getBalance", "0x" + "f" * 65, "out of bounds"),
    ("eth_getBalance", "0x10", "providers disagree"),
    ("eth_getBlockByNumber", None, "invalid treasury block header"),
    ("eth_getBlockByNumber", {"number": "0x100", "hash": "bad", "timestamp": "0x1"}, "block hash"),
    ("eth_getBlockByNumber", {"number": "0x100", "hash": "0x" + "ab" * 32, "timestamp": "0x1"}, "stale or future"),
])
def test_treasury_disagreement_and_malformed_results_fail_closed(facility, direct_vm, method, result, message):
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    direct_vm._rpc_overrides = {(SECONDARY_RPC, method): envelope(result)}
    with direct_vm.expect_revert(message):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    assert facility["monitor"].get_wiring()["test_total"] == 0
    assert facility["wiring"].deferred == []


@pytest.mark.parametrize("document", [[], {}, {"jsonrpc": "2.0", "id": True, "result": "0x1"}, {"jsonrpc": "2.0", "id": 9, "result": "0x1"}, {"jsonrpc": "2.0", "id": 1, "result": "0x1", "error": {}}])
def test_treasury_envelope_rejects_forged_and_error_results(facility, direct_vm, document):
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    direct_vm._rpc_overrides = {(SECONDARY_RPC, "eth_getBalance"): document}
    with direct_vm.expect_revert("invalid RPC envelope"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)


def test_validator_independently_rejects_forged_balance(facility, direct_vm, helpers, monkeypatch):
    import genlayer.gl as gl
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    seen = []

    def run(leader, validator):
        result = leader()
        assert validator(gl.vm.Return(calldata=result))
        forged = dict(result, balance="999999999999999999999999999999")
        assert not validator(gl.vm.Return(calldata=forged))
        seen.append(result)
        return result

    monkeypatch.setattr(gl.vm, "run_nondet_unsafe", run)
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    assert len(seen) == 1


def test_validator_rejects_authenticated_old_finalized_block(facility, direct_vm, monkeypatch):
    import genlayer.gl as gl
    mock_rpc_balance(direct_vm, TREASURY_RPC, 800_000 * GEN)
    seen = []

    def run(leader, validator):
        result = leader()
        old = dict(result, number="0xff")
        assert not validator(gl.vm.Return(calldata=old))
        seen.append(result)
        return result

    monkeypatch.setattr(gl.vm, "run_nondet_unsafe", run)
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    assert seen


def test_registry_rejects_unversioned_settlement(facility, direct_vm, as_address):
    registry = facility["registry"]
    direct_vm.sender = as_address(facility["monitor"].address)
    with direct_vm.expect_revert("settlement requires a revision"):
        registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "compliant", 13000, 0, "proof", 0)
    with direct_vm.expect_revert("only the vault"):
        registry.set_facility_status(FACILITY_ID, "active", 1)


def test_curing_rate_covenant_preserves_other_draw_stop(funded, direct_vm):
    monitor, wiring, vault = funded["monitor"], funded["wiring"], funded["vault"]
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    direct_vm.warp("2026-11-05T12:00:00Z")
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    mock_rpc_balance(direct_vm, TREASURY_RPC, 400_000 * GEN)
    monitor.test_covenant(FACILITY_ID, COVENANT_TREASURY)
    wiring.drain()
    assert vault.get_position(FACILITY_ID)["current_rate_bp"] == 1250
    direct_vm.clear_mocks()
    healthy_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()
    assert vault.get_position(FACILITY_ID)["current_rate_bp"] == 850
    assert vault.get_position(FACILITY_ID)["draw_frozen"]


def test_clean_ordinary_retest_does_not_make_acceleration_unappealable(funded, direct_vm):
    monitor = funded["monitor"]
    prose(direct_vm, holds=False)
    monitor.test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    direct_vm.clear_mocks()
    prose(direct_vm, holds=True)
    monitor.test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    assert funded["vault"].get_position(FACILITY_ID)["accelerated"]
    bond(funded, direct_vm, COVENANT_PROSE)
    monitor.resolve_appeal(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()
    assert not funded["vault"].get_position(FACILITY_ID)["accelerated"]


def test_pooled_vault_preserves_other_facility_capital(funded, direct_vm, direct_charlie):
    registry, vault, wiring = funded["registry"], funded["vault"], funded["wiring"]
    open_facility(registry, direct_vm, direct_charlie, funded["borrower"], "other-facility")
    commit_capital(funded, direct_vm, direct_charlie, 100 * GEN, "other-facility")
    direct_vm.warp("2026-11-05T12:00:00Z")
    direct_vm.sender = funded["borrower"]
    vault.draw(FACILITY_ID, 100 * GEN)
    direct_vm.warp("2027-11-05T12:00:00Z")
    repay_amount(funded, direct_vm, funded["borrower"], 200 * GEN)
    earned = int(vault.get_interest_collected(FACILITY_ID)["interest_collected_atto"])
    assert earned == 85 * GEN // 10
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only the lender"):
        vault.withdraw_interest(FACILITY_ID)
    direct_vm.sender = funded["lender"]
    vault.withdraw_interest(FACILITY_ID)
    vault.withdraw_free_capital(FACILITY_ID, PRINCIPAL)
    assert wiring.balance_of(vault.address_bytes) == 100 * GEN
    direct_vm.sender = funded["borrower"]
    vault.draw("other-facility", 100 * GEN)
    assert wiring.balance_of(vault.address_bytes) == 0
    assert int(vault.get_position("other-facility")["drawn_atto"]) == 100 * GEN
