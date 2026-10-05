# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Facility registry: the credit agreement itself.

A facility records who lent, who borrowed, how much, at what rate, and the
schedule of covenants attached to the debt. Each covenant carries the promise
in plain English alongside the machine readable parameters the monitor needs to
test it.

Only the covenant monitor may write test outcomes, and only the vault may move
a facility into an enforcement state. Everything else is the lender drafting
the agreement or either party reading it.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from genlayer import *

ERROR_EXPECTED = "[EXPECTED]"

KIND_RATIO = "ratio"
KIND_FILING = "filing"
KIND_PROSE = "prose"
KIND_TREASURY = "treasury"
VALID_KINDS = (KIND_RATIO, KIND_FILING, KIND_PROSE, KIND_TREASURY)

COMPARATOR_GTE = "gte"
COMPARATOR_LTE = "lte"
VALID_COMPARATORS = (COMPARATOR_GTE, COMPARATOR_LTE)

CONSEQUENCE_DRAW_STOP = "draw_stop"
CONSEQUENCE_RATE_STEP_UP = "rate_step_up"
CONSEQUENCE_ACCELERATION = "acceleration"
VALID_CONSEQUENCES = (
    CONSEQUENCE_DRAW_STOP,
    CONSEQUENCE_RATE_STEP_UP,
    CONSEQUENCE_ACCELERATION,
)

COVENANT_UNTESTED = "untested"
COVENANT_COMPLIANT = "compliant"
COVENANT_PENDING_CURE = "breach_pending_cure"
COVENANT_BREACHED = "breached"
COVENANT_CURED = "cured"
VALID_COVENANT_STATUSES = (
    COVENANT_UNTESTED,
    COVENANT_COMPLIANT,
    COVENANT_PENDING_CURE,
    COVENANT_BREACHED,
    COVENANT_CURED,
)

FACILITY_ACTIVE = "active"
FACILITY_DRAW_STOPPED = "draw_stopped"
FACILITY_ACCELERATING = "accelerating"
FACILITY_CLOSED = "closed"
VALID_FACILITY_STATUSES = (
    FACILITY_ACTIVE,
    FACILITY_DRAW_STOPPED,
    FACILITY_ACCELERATING,
    FACILITY_CLOSED,
)

APPEAL_NONE = "none"
APPEAL_OPEN = "open"
APPEAL_UPHELD = "upheld"
APPEAL_OVERTURNED = "overturned"

ZERO_ADDRESS = Address("0x" + "00" * 20)


def parse_iso(value: str) -> datetime:
    """Parse an ISO 8601 timestamp into an aware UTC datetime."""
    text = str(value).strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_iso(value: datetime) -> str:
    """Render a datetime as a second precision UTC stamp."""
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def block_now() -> str:
    """The transaction clock. Never read the wall clock inside a contract."""
    return format_iso(parse_iso(str(gl.message_raw["datetime"])))


def shift_hours(stamp: str, hours: int) -> str:
    return format_iso(parse_iso(stamp) + timedelta(hours=int(hours)))


def addr_key(value: Address) -> str:
    """Lowercase hex key, stable for use as a map index."""
    return "0x" + value.as_bytes.hex()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")


@allow_storage
@dataclass
class Covenant:
    """One promise attached to the debt.

    ``text`` is the covenant as the lender wrote it. The remaining fields are
    the parameters that let the monitor test that sentence without having to
    reinterpret it on every run.

    Field meaning depends on ``kind``:

    - ``ratio``    uses ``numerator_label`` and ``denominator_label`` to tell
                   the extractor which two figures to pull, and compares the
                   result against ``threshold_bp`` where 10000 equals 1.0x.
    - ``treasury`` compares an on-chain balance against ``threshold_atto``.
    - ``filing``   checks the latest published report against
                   ``filing_deadline_days``.
    - ``prose``    has no numeric threshold. The outcome lives in ``status``
                   and the cited artifact in ``evidence_ref``.
    """

    text: str
    kind: str
    metric: str
    numerator_label: str
    denominator_label: str
    threshold_bp: u256
    threshold_atto: u256
    comparator: str
    test_frequency_hours: u256
    cure_period_hours: u256
    filing_deadline_days: u256
    breach_consequence: str
    source_urls: DynArray[str]
    status: str
    observed_bp: u256
    observed_atto: u256
    evidence_ref: str
    last_tested_at: str
    next_due_at: str
    cure_deadline: str
    test_count: u256
    breach_count: u256
    appeal_status: str
    appeal_bond_atto: u256


@allow_storage
@dataclass
class Facility:
    facility_id: str
    lender: Address
    borrower: Address
    borrower_name: str
    purpose: str
    principal_atto: u256
    rate_bp: u256
    step_up_bp: u256
    created_at: str
    status: str
    treasury_rpc_url: str
    treasury_address: str
    governance_url: str
    covenants: DynArray[Covenant]


class FacilityRegistry(gl.Contract):
    owner: Address
    monitor: Address
    vault: Address
    facilities: TreeMap[str, Facility]
    facility_ids: DynArray[str]
    facility_count: u256
    lender_index: TreeMap[str, DynArray[str]]
    borrower_index: TreeMap[str, DynArray[str]]

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.monitor = ZERO_ADDRESS
        self.vault = ZERO_ADDRESS
        self.facility_count = u256(0)

    # ---------------------------------------------------------------- wiring

    @gl.public.write
    def set_monitor(self, monitor_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the monitor")
        self.monitor = Address(monitor_address)

    @gl.public.write
    def set_vault(self, vault_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the vault")
        self.vault = Address(vault_address)

    @gl.public.view
    def get_wiring(self) -> dict:
        return {
            "owner": self.owner.as_hex,
            "monitor": self.monitor.as_hex,
            "vault": self.vault.as_hex,
            "facility_count": int(self.facility_count),
        }

    # ------------------------------------------------------------ agreement

    @gl.public.write
    def create_facility(
        self,
        facility_id: str,
        borrower_address: str,
        borrower_name: str,
        purpose: str,
        principal_atto: int,
        rate_bp: int,
        step_up_bp: int,
        treasury_rpc_url: str,
        treasury_address: str,
        governance_url: str,
    ) -> str:
        key = facility_id.strip()
        require(len(key) > 0, "facility id cannot be empty")
        require(key not in self.facilities, f"facility {key} already exists")
        require(len(borrower_name.strip()) > 0, "borrower name cannot be empty")
        require(int(principal_atto) > 0, "principal must be greater than zero")
        require(int(rate_bp) > 0, "rate must be greater than zero")
        require(int(step_up_bp) >= 0, "step up cannot be negative")

        lender = gl.message.sender_address
        borrower = Address(borrower_address)
        require(borrower != ZERO_ADDRESS, "borrower address cannot be empty")
        require(borrower != lender, "a facility needs two different parties")

        self.facilities[key] = Facility(
            facility_id=key,
            lender=lender,
            borrower=borrower,
            borrower_name=borrower_name.strip(),
            purpose=purpose.strip(),
            principal_atto=u256(int(principal_atto)),
            rate_bp=u256(int(rate_bp)),
            step_up_bp=u256(int(step_up_bp)),
            created_at=block_now(),
            status=FACILITY_ACTIVE,
            treasury_rpc_url=treasury_rpc_url.strip(),
            treasury_address=treasury_address.strip(),
            governance_url=governance_url.strip(),
            covenants=[],
        )

        self.facility_ids.append(key)
        self.facility_count = u256(int(self.facility_count) + 1)

        self.lender_index.get_or_insert_default(addr_key(lender)).append(key)
        self.borrower_index.get_or_insert_default(addr_key(borrower)).append(key)

        return key

    @gl.public.write
    def add_covenant(
        self,
        facility_id: str,
        text: str,
        kind: str,
        metric: str,
        numerator_label: str,
        denominator_label: str,
        threshold_bp: int,
        threshold_atto: int,
        comparator: str,
        test_frequency_hours: int,
        cure_period_hours: int,
        filing_deadline_days: int,
        breach_consequence: str,
        source_urls: list[str],
    ) -> int:
        facility = self._facility(facility_id)
        require(
            gl.message.sender_address == facility.lender,
            "only the lender can draft covenants",
        )
        require(facility.status != FACILITY_CLOSED, "this facility is closed")
        require(len(text.strip()) >= 12, "write the covenant out in full")
        require(kind in VALID_KINDS, f"unknown covenant kind {kind}")
        require(comparator in VALID_COMPARATORS, f"unknown comparator {comparator}")
        require(
            breach_consequence in VALID_CONSEQUENCES,
            f"unknown consequence {breach_consequence}",
        )
        require(int(test_frequency_hours) > 0, "test frequency must be positive")
        require(int(cure_period_hours) >= 0, "cure period cannot be negative")

        urls = [u.strip() for u in source_urls if len(u.strip()) > 0]
        if kind in (KIND_RATIO, KIND_FILING, KIND_PROSE):
            require(len(urls) > 0, "this covenant needs at least one source to read")
        if kind == KIND_RATIO:
            require(
                len(numerator_label.strip()) > 0 and len(denominator_label.strip()) > 0,
                "a ratio covenant needs both figures named",
            )
            require(int(threshold_bp) > 0, "a ratio covenant needs a threshold")
        if kind == KIND_TREASURY:
            require(int(threshold_atto) > 0, "a treasury covenant needs a floor")
            require(
                len(facility.treasury_address) > 0 and len(facility.treasury_rpc_url) > 0,
                "record the treasury address and RPC before adding a treasury covenant",
            )
        if kind == KIND_FILING:
            require(int(filing_deadline_days) > 0, "a filing covenant needs a deadline")

        now = block_now()
        facility.covenants.append(
            Covenant(
                text=text.strip(),
                kind=kind,
                metric=metric.strip(),
                numerator_label=numerator_label.strip(),
                denominator_label=denominator_label.strip(),
                threshold_bp=u256(int(threshold_bp)),
                threshold_atto=u256(int(threshold_atto)),
                comparator=comparator,
                test_frequency_hours=u256(int(test_frequency_hours)),
                cure_period_hours=u256(int(cure_period_hours)),
                filing_deadline_days=u256(int(filing_deadline_days)),
                breach_consequence=breach_consequence,
                source_urls=urls,
                status=COVENANT_UNTESTED,
                observed_bp=u256(0),
                observed_atto=u256(0),
                evidence_ref="",
                last_tested_at="",
                next_due_at=now,
                cure_deadline="",
                test_count=u256(0),
                breach_count=u256(0),
                appeal_status=APPEAL_NONE,
                appeal_bond_atto=u256(0),
            )
        )
        return len(facility.covenants) - 1

    # ----------------------------------------------------------- monitor API

    @gl.public.write
    def record_test_result(
        self,
        facility_id: str,
        covenant_index: int,
        status: str,
        observed_bp: int,
        observed_atto: int,
        evidence_ref: str,
    ) -> None:
        require(
            self.monitor != ZERO_ADDRESS and gl.message.sender_address == self.monitor,
            "only the covenant monitor can record a test result",
        )
        require(status in VALID_COVENANT_STATUSES, f"unknown covenant status {status}")

        facility = self._facility(facility_id)
        covenant = self._covenant(facility, covenant_index)

        now = block_now()
        covenant.status = status
        covenant.observed_bp = u256(int(observed_bp))
        covenant.observed_atto = u256(int(observed_atto))
        covenant.evidence_ref = evidence_ref
        covenant.last_tested_at = now
        covenant.next_due_at = shift_hours(now, int(covenant.test_frequency_hours))
        covenant.test_count = u256(int(covenant.test_count) + 1)

        if status == COVENANT_PENDING_CURE:
            # Opening a fresh cure window. An already running window is left
            # alone so a borrower cannot reset the clock by triggering a retest.
            if len(covenant.cure_deadline) == 0:
                covenant.cure_deadline = shift_hours(now, int(covenant.cure_period_hours))
                covenant.breach_count = u256(int(covenant.breach_count) + 1)
        elif status == COVENANT_BREACHED:
            if len(covenant.cure_deadline) == 0:
                covenant.breach_count = u256(int(covenant.breach_count) + 1)
        else:
            covenant.cure_deadline = ""

    @gl.public.write
    def record_appeal(
        self,
        facility_id: str,
        covenant_index: int,
        appeal_status: str,
        bond_atto: int,
    ) -> None:
        require(
            self.monitor != ZERO_ADDRESS and gl.message.sender_address == self.monitor,
            "only the covenant monitor can record an appeal",
        )
        facility = self._facility(facility_id)
        covenant = self._covenant(facility, covenant_index)
        covenant.appeal_status = appeal_status
        covenant.appeal_bond_atto = u256(int(bond_atto))

    @gl.public.write
    def set_facility_status(self, facility_id: str, status: str) -> None:
        sender = gl.message.sender_address
        allowed = sender == self.monitor or sender == self.vault
        require(allowed, "only the monitor or the vault can move a facility")
        require(status in VALID_FACILITY_STATUSES, f"unknown facility status {status}")
        self._facility(facility_id).status = status

    # ----------------------------------------------------------------- reads

    @gl.public.view
    def get_facility(self, facility_id: str) -> dict:
        facility = self._facility(facility_id)
        return {
            "facility_id": facility.facility_id,
            "lender": facility.lender.as_hex,
            "borrower": facility.borrower.as_hex,
            "borrower_name": facility.borrower_name,
            "purpose": facility.purpose,
            "principal_atto": str(int(facility.principal_atto)),
            "rate_bp": int(facility.rate_bp),
            "step_up_bp": int(facility.step_up_bp),
            "created_at": facility.created_at,
            "status": facility.status,
            "treasury_rpc_url": facility.treasury_rpc_url,
            "treasury_address": facility.treasury_address,
            "governance_url": facility.governance_url,
            "covenant_count": len(facility.covenants),
        }

    @gl.public.view
    def get_covenant(self, facility_id: str, covenant_index: int) -> dict:
        facility = self._facility(facility_id)
        covenant = self._covenant(facility, covenant_index)
        return self._covenant_dict(covenant, int(covenant_index))

    @gl.public.view
    def get_covenants(self, facility_id: str) -> list:
        facility = self._facility(facility_id)
        return [
            self._covenant_dict(facility.covenants[i], i)
            for i in range(len(facility.covenants))
        ]

    @gl.public.view
    def get_test_parameters(self, facility_id: str, covenant_index: int) -> dict:
        """Everything the monitor needs to run one test, in a single read."""
        facility = self._facility(facility_id)
        covenant = self._covenant(facility, covenant_index)
        return {
            "facility_id": facility.facility_id,
            "facility_status": facility.status,
            "treasury_rpc_url": facility.treasury_rpc_url,
            "treasury_address": facility.treasury_address,
            "governance_url": facility.governance_url,
            "covenant_index": int(covenant_index),
            "text": covenant.text,
            "kind": covenant.kind,
            "metric": covenant.metric,
            "numerator_label": covenant.numerator_label,
            "denominator_label": covenant.denominator_label,
            "threshold_bp": int(covenant.threshold_bp),
            "threshold_atto": str(int(covenant.threshold_atto)),
            "comparator": covenant.comparator,
            "cure_period_hours": int(covenant.cure_period_hours),
            "filing_deadline_days": int(covenant.filing_deadline_days),
            "breach_consequence": covenant.breach_consequence,
            "source_urls": [covenant.source_urls[i] for i in range(len(covenant.source_urls))],
            "status": covenant.status,
            "cure_deadline": covenant.cure_deadline,
        }

    @gl.public.view
    def list_facility_ids(self) -> list:
        return [self.facility_ids[i] for i in range(len(self.facility_ids))]

    @gl.public.view
    def facilities_of(self, party_address: str) -> dict:
        slot = addr_key(Address(party_address))
        as_lender = []
        as_borrower = []
        if slot in self.lender_index:
            bucket = self.lender_index[slot]
            as_lender = [bucket[i] for i in range(len(bucket))]
        if slot in self.borrower_index:
            bucket = self.borrower_index[slot]
            as_borrower = [bucket[i] for i in range(len(bucket))]
        return {"as_lender": as_lender, "as_borrower": as_borrower}

    @gl.public.view
    def due_covenants(self) -> list:
        """Covenants whose next test is already due at the current block time.

        The off-chain scheduler reads this instead of walking every facility.
        """
        now = block_now()
        due = []
        for i in range(len(self.facility_ids)):
            facility_id = self.facility_ids[i]
            facility = self.facilities[facility_id]
            if facility.status == FACILITY_CLOSED:
                continue
            for index in range(len(facility.covenants)):
                covenant = facility.covenants[index]
                if covenant.status == COVENANT_BREACHED:
                    continue
                if len(covenant.next_due_at) == 0 or covenant.next_due_at <= now:
                    due.append(
                        {
                            "facility_id": facility_id,
                            "covenant_index": index,
                            "kind": covenant.kind,
                            "metric": covenant.metric,
                            "next_due_at": covenant.next_due_at,
                            "status": covenant.status,
                        }
                    )
        return due

    @gl.public.view
    def portfolio_summary(self) -> dict:
        """Counts across every facility, for the console header."""
        totals = {
            "facilities": len(self.facility_ids),
            "covenants": 0,
            "compliant": 0,
            "pending_cure": 0,
            "breached": 0,
            "untested": 0,
            "cured": 0,
            "principal_atto": 0,
        }
        for i in range(len(self.facility_ids)):
            facility = self.facilities[self.facility_ids[i]]
            totals["principal_atto"] = totals["principal_atto"] + int(facility.principal_atto)
            for index in range(len(facility.covenants)):
                covenant = facility.covenants[index]
                totals["covenants"] = totals["covenants"] + 1
                if covenant.status == COVENANT_COMPLIANT:
                    totals["compliant"] = totals["compliant"] + 1
                elif covenant.status == COVENANT_PENDING_CURE:
                    totals["pending_cure"] = totals["pending_cure"] + 1
                elif covenant.status == COVENANT_BREACHED:
                    totals["breached"] = totals["breached"] + 1
                elif covenant.status == COVENANT_CURED:
                    totals["cured"] = totals["cured"] + 1
                else:
                    totals["untested"] = totals["untested"] + 1
        totals["principal_atto"] = str(totals["principal_atto"])
        return totals

    # ------------------------------------------------------------- internals

    def _facility(self, facility_id: str) -> Facility:
        key = facility_id.strip()
        require(key in self.facilities, f"no facility called {key}")
        return self.facilities[key]

    def _covenant(self, facility: Facility, covenant_index: int) -> Covenant:
        index = int(covenant_index)
        require(
            0 <= index < len(facility.covenants),
            f"covenant {index} is not on this facility",
        )
        return facility.covenants[index]

    def _covenant_dict(self, covenant: Covenant, index: int) -> dict:
        return {
            "covenant_index": index,
            "text": covenant.text,
            "kind": covenant.kind,
            "metric": covenant.metric,
            "numerator_label": covenant.numerator_label,
            "denominator_label": covenant.denominator_label,
            "threshold_bp": int(covenant.threshold_bp),
            "threshold_atto": str(int(covenant.threshold_atto)),
            "comparator": covenant.comparator,
            "test_frequency_hours": int(covenant.test_frequency_hours),
            "cure_period_hours": int(covenant.cure_period_hours),
            "filing_deadline_days": int(covenant.filing_deadline_days),
            "breach_consequence": covenant.breach_consequence,
            "source_urls": [covenant.source_urls[i] for i in range(len(covenant.source_urls))],
            "status": covenant.status,
            "observed_bp": int(covenant.observed_bp),
            "observed_atto": str(int(covenant.observed_atto)),
            "evidence_ref": covenant.evidence_ref,
            "last_tested_at": covenant.last_tested_at,
            "next_due_at": covenant.next_due_at,
            "cure_deadline": covenant.cure_deadline,
            "test_count": int(covenant.test_count),
            "breach_count": int(covenant.breach_count),
            "appeal_status": covenant.appeal_status,
            "appeal_bond_atto": str(int(covenant.appeal_bond_atto)),
        }
