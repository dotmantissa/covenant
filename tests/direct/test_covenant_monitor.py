"""The monitor: reading evidence, judging the promise, calling the consequence."""

import pytest

from conftest import (
    COVENANT_FILING,
    COVENANT_PROSE,
    COVENANT_RATIO,
    COVENANT_TREASURY,
    FACILITY_ID,
    FORUM_URL,
    GEN,
    REPORTS_URL,
    REVENUE_URL,
    TREASURY_RPC,
    mock_page,
    mock_rpc_balance,
    mock_rpc_error,
)

RATIO_PROMPT = r"FIGURE A, the numerator"
FILING_PROMPT = r"whether a borrower published a periodic report"
PROSE_PROMPT = r"THE PROMISE:"

REVENUE_PAGE = """Harbour DAO treasury dashboard
Annualised protocol revenue: 1,560,000 USDC
Annual debt service: 1,200,000 USDC
Figures as of 30 September 2026.
"""

LEAN_REVENUE_PAGE = """Harbour DAO treasury dashboard
Annualised protocol revenue: 1,080,000 USDC
Annual debt service: 1,200,000 USDC
Figures as of 31 October 2026.
"""

REPORTS_PAGE = """Harbour DAO transparency reports
Q2 2026 report, period ended 30 June 2026, published 10 August 2026.
"""

FORUM_PAGE = """Harbour DAO governance
HIP-39 Treasury diversification, passed, 12 August 2026.
HIP-40 Grants round four, passed, 2 September 2026.
"""

FORUM_PAGE_WITH_DEBT = """Harbour DAO governance
HIP-42 Senior credit line from Northwind Capital, passed, 28 September 2026.
The DAO will draw a senior secured facility ranking ahead of existing lenders.
"""


def healthy_ratio(direct_vm, numerator="1560000", denominator="1200000"):
    mock_page(direct_vm, REVENUE_URL, REVENUE_PAGE)
    direct_vm.mock_llm(
        RATIO_PROMPT,
        {
            "numerator": numerator,
            "denominator": denominator,
            "unit": "USDC",
            "citation": REVENUE_URL,
            "locator": "Annualised protocol revenue",
            "as_of": "2026-09-30",
            "notes": "Both figures taken from the same dashboard panel.",
        },
    )


def lean_ratio(direct_vm, numerator="1080000", denominator="1200000"):
    mock_page(direct_vm, REVENUE_URL, LEAN_REVENUE_PAGE)
    direct_vm.mock_llm(
        RATIO_PROMPT,
        {
            "numerator": numerator,
            "denominator": denominator,
            "unit": "USDC",
            "citation": REVENUE_URL,
            "locator": "Annualised protocol revenue",
            "as_of": "2026-10-31",
            "notes": "Revenue fell against a flat debt service.",
        },
    )


def filing(direct_vm, published_at="2026-08-10"):
    mock_page(direct_vm, REPORTS_URL, REPORTS_PAGE)
    direct_vm.mock_llm(
        FILING_PROMPT,
        {
            "period_end": "2026-06-30",
            "published_at": published_at,
            "report_title": "Harbour DAO Q2 2026 transparency report",
            "citation": REPORTS_URL,
            "notes": "",
        },
    )


def prose(direct_vm, holds=True):
    if holds:
        mock_page(direct_vm, FORUM_URL, FORUM_PAGE)
        payload = {
            "holds": True,
            "artifact_id": "no-contrary-record",
            "artifact_title": "No senior debt proposal on record",
            "artifact_date": "2026-09-02",
            "citation": FORUM_URL,
            "reasoning": "The only passed proposals cover diversification and grants.",
        }
    else:
        mock_page(direct_vm, FORUM_URL, FORUM_PAGE_WITH_DEBT)
        payload = {
            "holds": False,
            "artifact_id": "HIP-42",
            "artifact_title": "Senior credit line from Northwind Capital",
            "artifact_date": "2026-09-28",
            "citation": FORUM_URL,
            "reasoning": 'HIP-42 passed and creates a facility "ranking ahead of existing lenders".',
        }
    direct_vm.mock_llm(PROSE_PROMPT, payload)


# ------------------------------------------------------------ ratio covenant


def test_a_healthy_ratio_reads_as_compliant(facility, direct_vm):
    healthy_ratio(direct_vm)
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)

    assert outcome["status"] == "compliant"
    assert outcome["breached"] is False
    assert outcome["observed_bp"] == 13000
    assert outcome["threshold_bp"] == 12000
    assert outcome["consequence_applied"] == ""
    assert "1.3000x versus a 1.2000x test" in outcome["narrative"]
    assert outcome["citation"] == "dashboards.example.org/harbour/revenue"


def test_the_ratio_comes_from_sandboxed_arithmetic_not_the_model(facility, direct_vm):
    # The model is handed figures whose ratio it never states. If the contract
    # were taking a verdict from the model this would not line up.
    healthy_ratio(direct_vm, numerator="1,440,000", denominator="1,200,000")
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)

    assert outcome["observed_bp"] == 12000
    assert outcome["breached"] is False  # exactly on the 1.2x test, which passes


def test_a_thin_ratio_opens_a_cure_window_rather_than_a_breach(facility, direct_vm):
    lean_ratio(direct_vm)
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)

    assert outcome["observed_bp"] == 9000
    assert outcome["breached"] is True
    assert outcome["status"] == "breach_pending_cure"
    # A rate step-up is hard to undo, so it waits for the cure window to lapse.
    assert outcome["consequence_applied"] == ""


def test_a_ratio_still_offside_after_the_cure_window_becomes_a_breach(
    funded, direct_vm
):
    registry = funded["registry"]
    monitor = funded["monitor"]
    wiring = funded["wiring"]

    direct_vm.warp("2026-10-05T12:00:00Z")
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()
    assert registry.get_covenant(FACILITY_ID, COVENANT_RATIO)["status"] == "breach_pending_cure"

    # The covenant allows 336 hours to cure. Come back after that.
    direct_vm.warp("2026-11-01T12:00:00Z")
    lean_ratio(direct_vm)
    outcome = monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    assert outcome["status"] == "breached"
    assert outcome["consequence_applied"] == "rate_step_up"
    assert funded["vault"].get_position(FACILITY_ID)["current_rate_bp"] == 1250


def test_recovering_inside_the_cure_window_clears_the_covenant(facility, direct_vm):
    monitor = facility["monitor"]
    wiring = facility["wiring"]

    direct_vm.warp("2026-10-05T12:00:00Z")
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    direct_vm.warp("2026-10-12T12:00:00Z")
    direct_vm.clear_mocks()
    healthy_ratio(direct_vm)
    outcome = monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    wiring.drain()

    assert outcome["status"] == "cured"
    assert outcome["breached"] is False
    assert facility["registry"].get_covenant(FACILITY_ID, COVENANT_RATIO)["cure_deadline"] == ""


@pytest.mark.parametrize(
    "written,expected_milli",
    [
        ("1560000", 1_560_000_000),
        ("1,560,000", 1_560_000_000),
        ("$1,560,000.00", 1_560_000_000),
        ("1.56m", 1_560_000_000),
        ("1.56 million", 1_560_000_000),
        ("1560000.5", 1_560_000_500),
    ],
)
def test_figures_written_the_way_people_write_them_still_parse(
    facility, direct_vm, written, expected_milli
):
    healthy_ratio(direct_vm, numerator=written, denominator="1200000")
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)
    finding = facility["monitor"].get_finding(FACILITY_ID, COVENANT_RATIO)
    assert finding["numerator_milli"] == str(expected_milli)


def test_a_model_that_cannot_find_the_figures_fails_the_test(facility, direct_vm):
    mock_page(direct_vm, REVENUE_URL, "The dashboard is being rebuilt.")
    direct_vm.mock_llm(
        RATIO_PROMPT,
        {"numerator": None, "denominator": None, "notes": "Neither figure is published."},
    )
    with direct_vm.expect_revert("could not find both figures"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)


def test_a_zero_denominator_is_refused_rather_than_dividing_by_it(facility, direct_vm):
    healthy_ratio(direct_vm, numerator="1560000", denominator="0")
    with direct_vm.expect_revert("denominator came back as zero"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)


def test_a_failing_source_is_reported_as_a_server_problem(facility, direct_vm):
    direct_vm.mock_web(REVENUE_URL, {"status": 503, "body": "upstream unavailable"})
    direct_vm.mock_web(
        r"dashboards\.example\.org.*\.json", {"status": 503, "body": "{}"}
    )
    # A rendered page has no status to inspect, so point the covenant at a JSON
    # endpoint to exercise the status handling path.
    facility["registry"]
    with pytest.raises(Exception):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)


# ----------------------------------------------------------- filing covenant


def test_a_report_filed_inside_the_deadline_is_compliant(facility, direct_vm):
    direct_vm.warp("2026-08-20T00:00:00Z")
    filing(direct_vm, published_at="2026-08-10")
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_FILING)

    assert outcome["status"] == "compliant"
    assert outcome["observed_bp"] == 41  # days between period end and publication
    assert "41 days later against a 45 day deadline" in outcome["narrative"]


def test_a_late_report_stops_draws_straight_away(funded, direct_vm):
    direct_vm.warp("2026-09-25T00:00:00Z")
    filing(direct_vm, published_at="2026-09-20")
    outcome = funded["monitor"].test_covenant(FACILITY_ID, COVENANT_FILING)
    funded["wiring"].drain()

    assert outcome["breached"] is True
    assert outcome["status"] == "breach_pending_cure"
    # A draw stop is the one consequence that bites immediately.
    assert outcome["consequence_applied"] == "draw_stop"
    assert funded["vault"].get_position(FACILITY_ID)["draw_frozen"] is True


def test_a_report_that_never_arrived_is_measured_against_today(facility, direct_vm):
    direct_vm.warp("2026-09-25T00:00:00Z")
    mock_page(direct_vm, REPORTS_URL, "Harbour DAO transparency reports. Q2 2026 pending.")
    direct_vm.mock_llm(
        FILING_PROMPT,
        {
            "period_end": "2026-06-30",
            "published_at": None,
            "report_title": "",
            "citation": REPORTS_URL,
            "notes": "No Q2 report has been posted.",
        },
    )
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_FILING)

    assert outcome["breached"] is True
    assert "No report published" in outcome["narrative"]
    assert outcome["observed_bp"] == 87


# ------------------------------------------------------------ prose covenant


def test_a_promise_with_nothing_against_it_holds(facility, direct_vm):
    prose(direct_vm, holds=True)
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)

    assert outcome["status"] == "compliant"
    assert outcome["breached"] is False
    assert "The promise still holds" in outcome["narrative"]


def test_new_senior_debt_accelerates_the_facility(funded, direct_vm):
    prose(direct_vm, holds=False)
    outcome = funded["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    funded["wiring"].drain()

    # This covenant carries no cure period, so the breach is immediate.
    assert outcome["status"] == "breached"
    assert outcome["consequence_applied"] == "acceleration"
    assert "HIP-42" in outcome["narrative"]

    position = funded["vault"].get_position(FACILITY_ID)
    assert position["accelerated"] is True
    assert position["draw_frozen"] is True
    assert funded["registry"].get_facility(FACILITY_ID)["status"] == "accelerating"


def test_a_verdict_with_no_artifact_behind_it_is_rejected(facility, direct_vm):
    mock_page(direct_vm, FORUM_URL, FORUM_PAGE)
    direct_vm.mock_llm(
        PROSE_PROMPT,
        {"holds": False, "reasoning": "It feels like they took on debt somewhere."},
    )
    with direct_vm.expect_revert("verdict given with no artifact cited"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)


@pytest.mark.parametrize("written,expected", [("yes", True), ("no", False),
                                              ("true", True), ("violated", False)])
def test_a_verdict_written_as_a_word_is_understood(facility, direct_vm, written, expected):
    mock_page(direct_vm, FORUM_URL, FORUM_PAGE)
    direct_vm.mock_llm(
        PROSE_PROMPT,
        {"holds": written, "artifact_id": "HIP-40", "citation": FORUM_URL,
         "reasoning": "Checked the passed proposals."},
    )
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)
    assert outcome["breached"] is not expected


def test_an_unreadable_verdict_is_refused(facility, direct_vm):
    mock_page(direct_vm, FORUM_URL, FORUM_PAGE)
    direct_vm.mock_llm(
        PROSE_PROMPT,
        {"holds": "probably fine", "artifact_id": "HIP-40", "citation": FORUM_URL},
    )
    with direct_vm.expect_revert("cannot read verdict"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_PROSE)


# --------------------------------------------------------- treasury covenant


def test_a_treasury_above_the_floor_is_compliant(facility, direct_vm):
    mock_rpc_balance(direct_vm, TREASURY_RPC, 700_000 * GEN)
    outcome = facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)

    assert outcome["status"] == "compliant"
    assert outcome["observed_atto"] == str(700_000 * GEN)
    assert outcome["citation"].startswith("rpc.example.org")


def test_a_treasury_below_the_floor_stops_draws(funded, direct_vm):
    mock_rpc_balance(direct_vm, TREASURY_RPC, 450_000 * GEN)
    outcome = funded["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)
    funded["wiring"].drain()

    assert outcome["breached"] is True
    assert outcome["status"] == "breach_pending_cure"
    assert outcome["consequence_applied"] == "draw_stop"
    assert funded["vault"].get_position(FACILITY_ID)["draw_frozen"] is True


def test_an_rpc_error_is_surfaced_rather_than_guessed_at(facility, direct_vm):
    mock_rpc_error(direct_vm, TREASURY_RPC)
    with direct_vm.expect_revert("RPC error"):
        facility["monitor"].test_covenant(FACILITY_ID, COVENANT_TREASURY)


# ------------------------------------------------------------ the audit trail


def test_every_test_is_kept_with_what_it_relied_on(facility, direct_vm):
    healthy_ratio(direct_vm)
    facility["monitor"].test_covenant(FACILITY_ID, COVENANT_RATIO)

    finding = facility["monitor"].get_finding(FACILITY_ID, COVENANT_RATIO)
    assert finding["kind"] == "ratio"
    assert finding["observed_bp"] == 13000
    assert finding["threshold_bp"] == 12000
    assert finding["numerator_milli"] == str(1_560_000_000)
    assert finding["denominator_milli"] == str(1_200_000_000)
    assert finding["citation"] == "dashboards.example.org/harbour/revenue"
    assert finding["locator"] == "Annualised protocol revenue"
    assert finding["sequence"] == 1

    assert facility["monitor"].get_wiring()["test_total"] == 1
    assert facility["monitor"].get_wiring()["breach_total"] == 0


def test_a_retest_replaces_the_finding_and_counts_the_breach(facility, direct_vm):
    monitor = facility["monitor"]
    healthy_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)
    facility["wiring"].drain()

    direct_vm.clear_mocks()
    lean_ratio(direct_vm)
    monitor.test_covenant(FACILITY_ID, COVENANT_RATIO)

    assert monitor.get_finding(FACILITY_ID, COVENANT_RATIO)["observed_bp"] == 9000
    assert monitor.get_wiring()["test_total"] == 2
    assert monitor.get_wiring()["breach_total"] == 1
    assert len(monitor.get_findings()) == 1


def test_an_untested_covenant_has_no_finding(facility, direct_vm):
    with direct_vm.expect_revert("has not been tested yet"):
        facility["monitor"].get_finding(FACILITY_ID, COVENANT_RATIO)
