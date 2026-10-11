# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Credit vault: the capital, and the part that actually bites.

The vault holds the lender's commitment and the borrower's drawn balance. It is
the only contract that moves money, and it takes instructions about covenant
outcomes from exactly one place, the monitor.

That separation is the point. A borrower who trips a covenant cannot talk the
vault out of it, and a lender cannot freeze a facility without a finding behind
it. The consequence follows from the test, not from either party's opinion of
the test.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from genlayer import *

ERROR_EXPECTED = "[EXPECTED]"

CONSEQUENCE_DRAW_STOP = "draw_stop"
CONSEQUENCE_RATE_STEP_UP = "rate_step_up"
CONSEQUENCE_ACCELERATION = "acceleration"
VALID_CONSEQUENCES = (
    CONSEQUENCE_DRAW_STOP,
    CONSEQUENCE_RATE_STEP_UP,
    CONSEQUENCE_ACCELERATION,
)

FACILITY_ACTIVE = "active"
FACILITY_DRAW_STOPPED = "draw_stopped"
FACILITY_ACCELERATING = "accelerating"
FACILITY_CLOSED = "closed"

BP_DENOMINATOR = 10000
SECONDS_PER_YEAR = 31_536_000

ZERO_ADDRESS = Address("0x" + "00" * 20)


def parse_iso(value: str) -> datetime:
    text = str(value).strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def block_now() -> str:
    return format_iso(parse_iso(str(gl.message_raw["datetime"])))


def seconds_between(earlier: str, later: str) -> int:
    if len(earlier) == 0 or len(later) == 0:
        return 0
    return max(0, int((parse_iso(later) - parse_iso(earlier)).total_seconds()))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")


def facility_status_for(consequence: str) -> str:
    """Where a consequence leaves the agreement, money aside."""
    if consequence == CONSEQUENCE_ACCELERATION:
        return FACILITY_ACCELERATING
    return FACILITY_DRAW_STOPPED


def interest_for(drawn_atto: int, rate_bp: int, seconds: int) -> int:
    """Simple interest on the drawn balance, in integer arithmetic throughout."""
    if drawn_atto <= 0 or rate_bp <= 0 or seconds <= 0:
        return 0
    return (drawn_atto * rate_bp * seconds) // (BP_DENOMINATOR * SECONDS_PER_YEAR)


@allow_storage
@dataclass
class Enforcement:
    facility_id: str
    consequence: str
    at: str
    rate_before_bp: u256
    rate_after_bp: u256
    note: str


@allow_storage
@dataclass
class Position:
    facility_id: str
    lender: Address
    borrower: Address
    principal_atto: u256
    committed_atto: u256
    drawn_atto: u256
    repaid_atto: u256
    base_rate_bp: u256
    current_rate_bp: u256
    step_up_bp: u256
    interest_accrued_atto: u256
    draw_frozen: bool
    accelerated: bool
    opened_at: str
    last_accrual_at: str
    last_event_at: str
    acceleration_started_at: str
    enforcement_count: u256


@gl.evm.contract_interface
class NativeRecipient:
    """EOA/chain-layer payout; external messages execute only at finalization."""
    class View:
        pass

    class Write:
        pass


class CreditVault(gl.Contract):
    owner: Address
    registry: Address
    monitor: Address
    positions: TreeMap[str, Position]
    position_ids: DynArray[str]
    enforcements: DynArray[Enforcement]
    total_committed_atto: u256
    total_drawn_atto: u256
    interest_collected_atto: TreeMap[str, u256]
    enforcement_revisions: TreeMap[str, u256]
    facility_restrictions: TreeMap[str, str]

    def __init__(self, registry_address: str) -> None:
        self.owner = gl.message.sender_address
        self.registry = Address(registry_address)
        self.monitor = ZERO_ADDRESS
        self.total_committed_atto = u256(0)
        self.total_drawn_atto = u256(0)

    # ---------------------------------------------------------------- wiring

    @gl.public.write
    def set_monitor(self, monitor_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the monitor")
        self.monitor = Address(monitor_address)

    @gl.public.write
    def set_registry(self, registry_address: str) -> None:
        require(gl.message.sender_address == self.owner, "only the owner can set the registry")
        self.registry = Address(registry_address)

    @gl.public.view
    def get_wiring(self) -> dict:
        return {
            "owner": self.owner.as_hex,
            "registry": self.registry.as_hex,
            "monitor": self.monitor.as_hex,
            "balance_atto": str(int(self.balance)),
            "total_committed_atto": str(int(self.total_committed_atto)),
            "total_drawn_atto": str(int(self.total_drawn_atto)),
            "position_count": len(self.position_ids),
        }

    # ------------------------------------------------------------- capital

    @gl.public.write.payable
    def commit(self, facility_id: str) -> dict:
        """Lender funds the facility. Can be topped up to the principal."""
        amount = int(gl.message.value)
        require(amount > 0, "send the capital you want to commit")

        facility = self._read_facility(facility_id)
        lender = Address(str(facility["lender"]))
        require(gl.message.sender_address == lender, "only the lender can commit capital")
        require(str(facility["status"]) != FACILITY_CLOSED, "this facility is closed")

        principal = int(facility["principal_atto"])
        now = block_now()
        key = facility_id.strip()

        if key not in self.positions:
            offside = str(facility["status"]) != FACILITY_ACTIVE
            self.positions[key] = Position(
                facility_id=key,
                lender=lender,
                borrower=Address(str(facility["borrower"])),
                principal_atto=u256(principal),
                committed_atto=u256(0),
                drawn_atto=u256(0),
                repaid_atto=u256(0),
                base_rate_bp=u256(int(facility["rate_bp"])),
                current_rate_bp=u256(int(facility["rate_bp"])),
                step_up_bp=u256(int(facility["step_up_bp"])),
                interest_accrued_atto=u256(0),
                draw_frozen=offside,
                accelerated=str(facility["status"]) == FACILITY_ACCELERATING,
                opened_at=now,
                last_accrual_at=now,
                last_event_at=now,
                acceleration_started_at="",
                enforcement_count=u256(0),
            )
            self.position_ids.append(key)

        position = self.positions[key]
        self._apply_position_restrictions(position, block_now())
        committed = int(position.committed_atto) + amount
        require(
            committed <= principal,
            "that would commit more than the agreed principal",
        )

        self._accrue(position, now)
        position.committed_atto = u256(committed)
        position.last_event_at = now
        self.total_committed_atto = u256(int(self.total_committed_atto) + amount)

        return {
            "facility_id": key,
            "committed_atto": str(committed),
            "available_atto": str(committed - int(position.drawn_atto)),
        }

    @gl.public.write
    def draw(self, facility_id: str, amount_atto: int) -> dict:
        """Borrower takes down capital, if the covenants still allow it."""
        position = self._position(facility_id)
        require(
            gl.message.sender_address == position.borrower,
            "only the borrower can draw on this facility",
        )

        amount = int(amount_atto)
        require(amount > 0, "a draw needs an amount")
        if self.monitor != ZERO_ADDRESS:
            state = gl.get_contract_at(self.monitor).view().get_enforcement_state(position.facility_id)
            require(not state["restrictions"],
                    "draws are stopped while covenant enforcement is pending")
        require(not position.accelerated, "this facility has been accelerated")
        require(
            not position.draw_frozen,
            "draws are stopped while a covenant is offside",
        )

        available = int(position.committed_atto) - int(position.drawn_atto)
        require(amount <= available, f"only {available} is available to draw")
        require(amount <= int(self.balance), "the vault does not hold that much")

        now = block_now()
        self._accrue(position, now)
        position.drawn_atto = u256(int(position.drawn_atto) + amount)
        position.last_event_at = now
        self.total_drawn_atto = u256(int(self.total_drawn_atto) + amount)

        NativeRecipient(position.borrower).emit_transfer(value=u256(amount))

        return {
            "facility_id": position.facility_id,
            "drawn_atto": str(int(position.drawn_atto)),
            "available_atto": str(int(position.committed_atto) - int(position.drawn_atto)),
        }

    @gl.public.write.payable
    def repay(self, facility_id: str) -> dict:
        """Borrower pays down interest first, then principal.

        Any excess beyond what is owed is refunded to the borrower.
        Interest paid is tracked for lender withdrawal.
        """
        position = self._position(facility_id)
        amount = int(gl.message.value)
        require(amount > 0, "send the amount you want to repay")

        now = block_now()
        self._accrue(position, now)

        remaining = amount
        interest_due = int(position.interest_accrued_atto)
        interest_paid = min(remaining, interest_due)
        position.interest_accrued_atto = u256(interest_due - interest_paid)
        remaining = remaining - interest_paid

        # Track earned interest for lender withdrawal.
        if interest_paid > 0:
            key = position.facility_id
            prior = int(self.interest_collected_atto.get(key, u256(0)))
            self.interest_collected_atto[key] = u256(prior + interest_paid)

        drawn = int(position.drawn_atto)
        principal_paid = min(remaining, drawn)
        position.drawn_atto = u256(drawn - principal_paid)
        remaining = remaining - principal_paid
        position.repaid_atto = u256(int(position.repaid_atto) + (amount - remaining))
        position.last_event_at = now
        self.total_drawn_atto = u256(max(0, int(self.total_drawn_atto) - principal_paid))

        # An unrestricted third party may repay; surplus belongs to the payer.
        excess = remaining
        if excess > 0:
            require(excess <= int(self.balance), "the vault cannot refund the surplus")
            NativeRecipient(gl.message.sender_address).emit_transfer(value=u256(excess))

        return {
            "facility_id": position.facility_id,
            "interest_paid_atto": str(interest_paid),
            "principal_paid_atto": str(principal_paid),
            "excess_refunded_atto": str(excess),
            "drawn_atto": str(int(position.drawn_atto)),
            "interest_outstanding_atto": str(int(position.interest_accrued_atto)),
        }

    @gl.public.write
    def withdraw_free_capital(self, facility_id: str, amount_atto: int) -> dict:
        """Lender pulls back capital that has not been drawn."""
        position = self._position(facility_id)
        require(
            gl.message.sender_address == position.lender,
            "only the lender can withdraw capital",
        )
        amount = int(amount_atto)
        require(amount > 0, "a withdrawal needs an amount")

        undrawn = int(position.committed_atto) - int(position.drawn_atto)
        require(amount <= undrawn, f"only {undrawn} is undrawn")
        require(amount <= int(self.balance), "the vault does not hold that much")

        now = block_now()
        self._accrue(position, now)
        position.committed_atto = u256(int(position.committed_atto) - amount)
        position.last_event_at = now
        self.total_committed_atto = u256(max(0, int(self.total_committed_atto) - amount))

        NativeRecipient(position.lender).emit_transfer(value=u256(amount))
        return {
            "facility_id": position.facility_id,
            "committed_atto": str(int(position.committed_atto)),
        }

    @gl.public.write
    def withdraw_interest(self, facility_id: str, amount_atto: int = 0) -> dict:
        """Lender withdraws earned interest covered by borrower repayments."""
        position = self._position(facility_id)
        require(
            gl.message.sender_address == position.lender,
            "only the lender can withdraw interest",
        )
        key = position.facility_id
        available = int(self.interest_collected_atto.get(key, u256(0)))
        require(available > 0, "no earned interest to withdraw")
        require(int(amount_atto) >= 0, "interest withdrawal cannot be negative")
        withdraw_amount = available if int(amount_atto) == 0 else int(amount_atto)
        require(withdraw_amount <= available, "withdrawal exceeds earned interest")
        require(withdraw_amount <= int(self.balance), "the vault does not hold that much")

        self.interest_collected_atto[key] = u256(available - withdraw_amount)
        NativeRecipient(position.lender).emit_transfer(value=u256(withdraw_amount))
        return {
            "facility_id": key,
            "interest_withdrawn_atto": str(withdraw_amount),
            "interest_remaining_atto": str(available - withdraw_amount),
        }

    # --------------------------------------------------------- enforcement

    @gl.public.write
    def apply_enforcement(self, facility_id: str, revision: int, restrictions: list) -> dict:
        """Apply a finalized full snapshot once, regardless of message ordering.

        Each covenant owns its restriction. A clean covenant or successful
        appeal removes only that covenant's restriction. The aggregate preserves
        every remaining acceleration, draw stop and interest step-up.
        """
        require(self.monitor != ZERO_ADDRESS and gl.message.sender_address == self.monitor,
                "only the covenant monitor can enforce a consequence")
        key = facility_id.strip()
        self._read_facility(key)
        require(revision > 0, "enforcement requires a revision")
        if revision <= int(self.enforcement_revisions.get(key, u256(0))):
            return {"facility_id": key, "applied": False, "reason": "stale revision"}
        for item in restrictions:
            require(item["consequence"] in VALID_CONSEQUENCES, "unknown consequence")
            require(int(item["covenant_index"]) >= 0, "invalid covenant index")
        self.enforcement_revisions[key] = u256(revision)
        self.facility_restrictions[key] = json.dumps(restrictions, sort_keys=True)
        if key in self.positions:
            self._apply_position_restrictions(self.positions[key], block_now())
        status = self._status_for_restrictions(restrictions)
        self._set_facility_status(key, status, revision)
        return {"facility_id": key, "applied": True, "revision": revision, "status": status}

    def _status_for_restrictions(self, restrictions: list) -> str:
        if any(item["consequence"] == CONSEQUENCE_ACCELERATION for item in restrictions):
            return FACILITY_ACCELERATING
        return FACILITY_DRAW_STOPPED if restrictions else FACILITY_ACTIVE

    def _apply_position_restrictions(self, position: Position, now: str) -> None:
        restrictions = json.loads(self.facility_restrictions.get(position.facility_id, "[]"))
        self._accrue(position, now)
        rate_before = int(position.current_rate_bp)
        accelerated_before = position.accelerated
        frozen_before = position.draw_frozen
        position.draw_frozen = bool(restrictions)
        position.accelerated = any(item["consequence"] == CONSEQUENCE_ACCELERATION
                                   for item in restrictions)
        stepped = any(item["consequence"] == CONSEQUENCE_RATE_STEP_UP for item in restrictions)
        position.current_rate_bp = u256(int(position.base_rate_bp) +
                                        (int(position.step_up_bp) if stepped else 0))
        if position.accelerated and not accelerated_before:
            position.acceleration_started_at = now
        elif not position.accelerated:
            position.acceleration_started_at = ""
        if (rate_before != int(position.current_rate_bp) or
                accelerated_before != position.accelerated or frozen_before != position.draw_frozen):
            position.last_event_at = now
            position.enforcement_count = u256(int(position.enforcement_count) + 1)
            self.enforcements.append(Enforcement(
                facility_id=position.facility_id,
                consequence="acceleration" if position.accelerated else
                            "rate_step_up" if stepped else "draw_stop" if restrictions else "release",
                at=now, rate_before_bp=u256(rate_before), rate_after_bp=position.current_rate_bp,
                note="Applied covenant-specific finalized enforcement snapshot.",
            ))

    # ----------------------------------------------------------------- reads

    @gl.public.view
    def get_position(self, facility_id: str) -> dict:
        return self._position_dict(self._position(facility_id))

    @gl.public.view
    def get_positions(self) -> list:
        return [
            self._position_dict(self.positions[self.position_ids[i]])
            for i in range(len(self.position_ids))
        ]

    @gl.public.view
    def get_enforcements(self, facility_id: str) -> list:
        wanted = facility_id.strip()
        out = []
        for i in range(len(self.enforcements)):
            event = self.enforcements[i]
            if len(wanted) == 0 or event.facility_id == wanted:
                out.append(
                    {
                        "facility_id": event.facility_id,
                        "consequence": event.consequence,
                        "at": event.at,
                        "rate_before_bp": int(event.rate_before_bp),
                        "rate_after_bp": int(event.rate_after_bp),
                        "note": event.note,
                    }
                )
        return out

    @gl.public.view
    def quote_outstanding(self, facility_id: str) -> dict:
        """What the borrower owes if they settled at the current block time."""
        position = self._position(facility_id)
        now = block_now()
        pending = interest_for(
            int(position.drawn_atto),
            int(position.current_rate_bp),
            seconds_between(position.last_accrual_at, now),
        )
        interest = int(position.interest_accrued_atto) + pending
        return {
            "facility_id": position.facility_id,
            "as_of": now,
            "drawn_atto": str(int(position.drawn_atto)),
            "interest_atto": str(interest),
            "total_atto": str(int(position.drawn_atto) + interest),
            "rate_bp": int(position.current_rate_bp),
            "accelerated": bool(position.accelerated),
        }

    @gl.public.view
    def get_interest_collected(self, facility_id: str) -> dict:
        key = facility_id.strip()
        available = int(self.interest_collected_atto.get(key, u256(0)))
        return {
            "facility_id": key,
            "interest_collected_atto": str(available),
        }

    # ------------------------------------------------------------- internals

    def _accrue(self, position: Position, now: str) -> None:
        elapsed = seconds_between(position.last_accrual_at, now)
        if elapsed <= 0:
            return
        earned = interest_for(
            int(position.drawn_atto), int(position.current_rate_bp), elapsed
        )
        if earned > 0:
            position.interest_accrued_atto = u256(
                int(position.interest_accrued_atto) + earned
            )
        position.last_accrual_at = now

    def _position(self, facility_id: str) -> Position:
        key = facility_id.strip()
        require(key in self.positions, f"no position open on {key}")
        return self.positions[key]

    def _read_facility(self, facility_id: str) -> dict:
        facility = gl.get_contract_at(self.registry).view().get_facility(facility_id)
        require(isinstance(facility, dict), "registry returned no facility")
        return facility

    def _set_facility_status(self, facility_id: str, status: str, revision: int) -> None:
        if self.registry == ZERO_ADDRESS:
            return
        gl.get_contract_at(self.registry).emit(on="finalized").set_facility_status(
            facility_id, status, revision
        )

    def _position_dict(self, position: Position) -> dict:
        return {
            "facility_id": position.facility_id,
            "lender": position.lender.as_hex,
            "borrower": position.borrower.as_hex,
            "principal_atto": str(int(position.principal_atto)),
            "committed_atto": str(int(position.committed_atto)),
            "drawn_atto": str(int(position.drawn_atto)),
            "repaid_atto": str(int(position.repaid_atto)),
            "available_atto": str(
                int(position.committed_atto) - int(position.drawn_atto)
            ),
            "base_rate_bp": int(position.base_rate_bp),
            "current_rate_bp": int(position.current_rate_bp),
            "step_up_bp": int(position.step_up_bp),
            "interest_accrued_atto": str(int(position.interest_accrued_atto)),
            "draw_frozen": bool(position.draw_frozen),
            "accelerated": bool(position.accelerated),
            "opened_at": position.opened_at,
            "last_accrual_at": position.last_accrual_at,
            "last_event_at": position.last_event_at,
            "acceleration_started_at": position.acceleration_started_at,
            "enforcement_count": int(position.enforcement_count),
        }
