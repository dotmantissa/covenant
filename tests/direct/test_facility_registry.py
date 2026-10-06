"""The credit agreement: who can write it, and what it refuses to accept."""

import pytest

from conftest import (
    COVENANT_RATIO,
    COVENANT_TREASURY,
    FACILITY_ID,
    FORUM_URL,
    GEN,
    REVENUE_URL,
    TREASURY_ACCOUNT,
    TREASURY_RPC,
    draft_covenants,
    open_facility,
)


def test_a_new_facility_records_both_parties_and_the_terms(
    registry, direct_vm, direct_alice, direct_bob
):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    facility = registry.get_facility(FACILITY_ID)

    assert facility["lender"] == direct_alice.as_hex
    assert facility["borrower"] == direct_bob.as_hex
    assert facility["borrower_name"] == "Harbour DAO"
    assert facility["principal_atto"] == str(2_500_000 * GEN)
    assert facility["rate_bp"] == 850
    assert facility["step_up_bp"] == 400
    assert facility["status"] == "active"
    assert facility["treasury_address"] == TREASURY_ACCOUNT
    assert facility["created_at"].endswith("Z")


def test_both_parties_can_find_the_facility_from_their_own_side(
    registry, direct_vm, direct_alice, direct_bob
):
    open_facility(registry, direct_vm, direct_alice, direct_bob)

    alice_view = registry.facilities_of(direct_alice.as_hex)
    assert alice_view["as_lender"] == [FACILITY_ID]
    assert alice_view["as_borrower"] == []

    bob_view = registry.facilities_of(direct_bob.as_hex)
    assert bob_view["as_borrower"] == [FACILITY_ID]
    assert bob_view["as_lender"] == []


def test_a_duplicate_facility_id_is_refused(registry, direct_vm, direct_alice, direct_bob):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    with direct_vm.expect_revert("already exists"):
        open_facility(registry, direct_vm, direct_alice, direct_bob)


@pytest.mark.parametrize(
    "field,value,message",
    [
        ("principal_atto", 0, "principal must be greater than zero"),
        ("rate_bp", 0, "rate must be greater than zero"),
        ("borrower_name", "   ", "borrower name cannot be empty"),
        ("facility_id", "  ", "facility id cannot be empty"),
    ],
)
def test_nonsense_terms_are_refused(
    registry, direct_vm, direct_alice, direct_bob, field, value, message
):
    direct_vm.sender = direct_alice
    args = {
        "facility_id": "check-1",
        "borrower_address": direct_bob.as_hex,
        "borrower_name": "Harbour DAO",
        "purpose": "Working capital",
        "principal_atto": 1000 * GEN,
        "rate_bp": 700,
        "step_up_bp": 200,
        "treasury_rpc_url": TREASURY_RPC,
        "treasury_address": TREASURY_ACCOUNT,
        "governance_url": FORUM_URL,
    }
    args[field] = value
    with direct_vm.expect_revert(message):
        registry.create_facility(**args)


def test_a_facility_needs_two_different_parties(registry, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("two different parties"):
        registry.create_facility(
            "self-deal",
            direct_alice.as_hex,
            "Harbour DAO",
            "Working capital",
            1000 * GEN,
            700,
            200,
            TREASURY_RPC,
            TREASURY_ACCOUNT,
            FORUM_URL,
        )


def test_the_lender_drafts_four_covenants(registry, direct_vm, direct_alice, direct_bob):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    draft_covenants(registry, direct_vm, direct_alice)

    assert registry.get_facility(FACILITY_ID)["covenant_count"] == 4
    covenants = registry.get_covenants(FACILITY_ID)
    assert [c["kind"] for c in covenants] == ["ratio", "filing", "prose", "treasury"]

    ratio = covenants[COVENANT_RATIO]
    assert ratio["threshold_bp"] == 12000
    assert ratio["comparator"] == "gte"
    assert ratio["breach_consequence"] == "rate_step_up"
    assert ratio["status"] == "untested"
    assert ratio["source_urls"] == [REVENUE_URL]
    assert ratio["test_count"] == 0
    assert "1.2x" in ratio["text"]


def test_only_the_lender_can_draft_a_covenant(
    registry, direct_vm, direct_alice, direct_bob
):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the lender can draft covenants"):
        registry.add_covenant(
            FACILITY_ID,
            "Borrower writes their own homework, which is not how this works.",
            "prose",
            "Self serving",
            "",
            "",
            0,
            0,
            "gte",
            168,
            0,
            0,
            "draw_stop",
            [FORUM_URL],
        )


@pytest.mark.parametrize(
    "overrides,message",
    [
        ({"kind": "vibes"}, "unknown covenant kind"),
        ({"comparator": "roughly"}, "unknown comparator"),
        ({"breach_consequence": "a stern word"}, "unknown consequence"),
        ({"text": "too short"}, "write the covenant out in full"),
        ({"test_frequency_hours": 0}, "test frequency must be positive"),
        ({"source_urls": []}, "needs at least one source"),
        ({"threshold_bp": 0}, "needs a threshold"),
        (
            {"numerator_label": "", "denominator_label": ""},
            "needs both figures named",
        ),
    ],
)
def test_an_untestable_covenant_is_refused(
    registry, direct_vm, direct_alice, direct_bob, overrides, message
):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    args = {
        "facility_id": FACILITY_ID,
        "text": "Maintain a minimum 1.2x coverage ratio, tested monthly.",
        "kind": "ratio",
        "metric": "Coverage",
        "numerator_label": "revenue",
        "denominator_label": "debt service",
        "threshold_bp": 12000,
        "threshold_atto": 0,
        "comparator": "gte",
        "test_frequency_hours": 720,
        "cure_period_hours": 336,
        "filing_deadline_days": 0,
        "breach_consequence": "rate_step_up",
        "source_urls": [REVENUE_URL],
    }
    args.update(overrides)
    with direct_vm.expect_revert(message):
        registry.add_covenant(**args)


def test_a_filing_covenant_needs_a_deadline(
    registry, direct_vm, direct_alice, direct_bob
):
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("needs a deadline"):
        registry.add_covenant(
            FACILITY_ID,
            "Publish a quarterly transparency report on a schedule nobody wrote down.",
            "filing",
            "Reporting",
            "",
            "",
            0,
            0,
            "lte",
            168,
            168,
            0,
            "draw_stop",
            ["https://harbour.example.org/transparency"],
        )


def test_a_treasury_covenant_needs_the_treasury_recorded(
    registry, direct_vm, direct_alice, direct_bob
):
    direct_vm.sender = direct_alice
    registry.create_facility(
        "no-treasury",
        direct_bob.as_hex,
        "Harbour DAO",
        "Working capital",
        1000 * GEN,
        700,
        200,
        "",
        "",
        FORUM_URL,
    )
    with direct_vm.expect_revert("record the treasury address"):
        registry.add_covenant(
            "no-treasury",
            "Keep at least 600,000 in a treasury we never told you about.",
            "treasury",
            "Treasury floor",
            "",
            "",
            0,
            600_000 * GEN,
            "gte",
            24,
            72,
            0,
            "draw_stop",
            [],
        )


def test_only_the_monitor_can_record_a_test_result(facility, direct_vm, direct_alice, as_address):
    registry = facility["registry"]
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only the covenant monitor"):
        registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "compliant", 13000, 0, "x")


def test_recording_a_result_advances_the_schedule(facility, direct_vm, as_address):
    registry = facility["registry"]
    monitor_address = registry.get_wiring()["monitor"]
    direct_vm.sender = as_address(monitor_address)

    registry.record_test_result(
        FACILITY_ID, COVENANT_RATIO, "compliant", 13120, 0, "dashboards.example.org/harbour/revenue"
    )
    covenant = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)

    assert covenant["status"] == "compliant"
    assert covenant["observed_bp"] == 13120
    assert covenant["test_count"] == 1
    assert covenant["cure_deadline"] == ""
    assert covenant["last_tested_at"] < covenant["next_due_at"]


def test_a_cure_window_opens_once_and_is_not_reset_by_a_retest(facility, direct_vm, as_address):
    registry = facility["registry"]
    monitor_address = registry.get_wiring()["monitor"]
    direct_vm.sender = as_address(monitor_address)

    registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "breach_pending_cure", 11000, 0, "a")
    first = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)
    assert first["cure_deadline"] != ""
    assert first["breach_count"] == 1

    direct_vm.warp("2026-10-07T00:00:00Z")
    registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "breach_pending_cure", 10900, 0, "b")
    second = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)

    # A borrower must not be able to buy themselves a fresh window by asking
    # for another test.
    assert second["cure_deadline"] == first["cure_deadline"]
    assert second["breach_count"] == 1


def test_a_clean_test_clears_the_cure_window(facility, direct_vm, as_address):
    registry = facility["registry"]
    monitor_address = registry.get_wiring()["monitor"]
    direct_vm.sender = as_address(monitor_address)

    registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "breach_pending_cure", 11000, 0, "a")
    registry.record_test_result(FACILITY_ID, COVENANT_RATIO, "cured", 12400, 0, "b")

    covenant = registry.get_covenant(FACILITY_ID, COVENANT_RATIO)
    assert covenant["status"] == "cured"
    assert covenant["cure_deadline"] == ""


def test_the_scheduler_sees_every_untested_covenant_as_due(facility):
    due = facility["registry"].due_covenants()
    assert len(due) == 4
    assert {item["covenant_index"] for item in due} == {0, 1, 2, 3}


def test_a_tested_covenant_drops_out_of_the_due_list(facility, direct_vm, as_address):
    registry = facility["registry"]
    monitor_address = registry.get_wiring()["monitor"]
    direct_vm.sender = as_address(monitor_address)
    registry.record_test_result(FACILITY_ID, COVENANT_TREASURY, "compliant", 0, 700_000 * GEN, "rpc")

    due = registry.due_covenants()
    assert COVENANT_TREASURY not in {item["covenant_index"] for item in due}
    assert len(due) == 3


def test_the_portfolio_summary_counts_every_covenant_state(facility, direct_vm, as_address):
    registry = facility["registry"]
    monitor_address = registry.get_wiring()["monitor"]
    direct_vm.sender = as_address(monitor_address)
    registry.record_test_result(FACILITY_ID, 0, "compliant", 13000, 0, "a")
    registry.record_test_result(FACILITY_ID, 1, "breach_pending_cure", 60, 0, "b")
    registry.record_test_result(FACILITY_ID, 2, "breached", 0, 0, "c")

    summary = registry.portfolio_summary()
    assert summary["facilities"] == 1
    assert summary["covenants"] == 4
    assert summary["compliant"] == 1
    assert summary["pending_cure"] == 1
    assert summary["breached"] == 1
    assert summary["untested"] == 1
    assert summary["principal_atto"] == str(2_500_000 * GEN)


def test_reading_a_covenant_that_is_not_there_is_an_error(facility, direct_vm):
    with direct_vm.expect_revert("covenant 9 is not on this facility"):
        facility["registry"].get_covenant(FACILITY_ID, 9)


def test_reading_a_facility_that_is_not_there_is_an_error(registry, direct_vm):
    with direct_vm.expect_revert("no facility called ghost"):
        registry.get_facility("ghost")
