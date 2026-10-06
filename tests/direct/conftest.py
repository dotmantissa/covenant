"""Shared fixtures for Covenant direct mode tests.

The direct runner is built to exercise one contract at a time. Covenant is
three contracts that only mean anything wired together, so this module fills in
the gaps rather than letting the tests stub out the interesting part:

* ``gl.vm.spawn_sandbox`` is not patched by the runner and fails on a missing
  cloudpickle. It is replaced with a version that calls the function and wraps
  the outcome in the same result types. Contract code is untouched.
* The runner installs no cross contract hook. ``Wiring`` provides one that
  routes calls between the locally deployed instances, tracks which contract is
  executing so ``sender`` is correct across a boundary, and moves native value.
* ``gl.message.contract_address`` is cached at SDK import, so every contract
  otherwise reports the address of whichever deployed first. ``Wiring`` sets the
  executing contract explicitly instead.
* ``direct_vm.warp`` moves the runner's own clock but never reaches
  ``gl.message_raw['datetime']``, which is injected once at load time and is the
  clock the contracts actually read. ``Wiring`` re-points it on every entry into
  contract code, so warping a cure window forward works.
"""

import json
from contextlib import contextmanager
from pathlib import Path

import pytest

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"

REGISTRY = str(CONTRACTS / "facility_registry.py")
MONITOR = str(CONTRACTS / "covenant_monitor.py")
VAULT = str(CONTRACTS / "credit_vault.py")

GEN = 10**18


def _reset_contract_guard():
    """Allow a second contract class to load in the same process.

    The SDK permits one ``gl.Contract`` subclass per module and enforces it with
    a process wide flag. That is right in production, where a deployment is one
    module, but it would stop the registry, monitor and vault reaching one test.
    """
    try:
        import genlayer.gl.genvm_contracts as genvm_contracts
    except Exception:
        return  # first deploy, the SDK is not on the path yet
    genvm_contracts.__known_contract__ = None


def _install_sandbox_shim():
    """Make gl.vm.spawn_sandbox run the callable instead of pickling it."""
    import genlayer.gl.vm as gl_vm

    if getattr(gl_vm, "_covenant_sandbox_shim", False):
        return

    def spawn_sandbox(fn, *, allow_write_ops=False):
        try:
            return gl_vm.Return(calldata=fn())
        except gl_vm.UserError as err:
            return err
        except Exception as err:
            return gl_vm.VMError(message=f"{type(err).__name__}: {err}")

    from genlayer.py.types import Lazy

    spawn_sandbox.lazy = lambda fn, **kw: Lazy(lambda: spawn_sandbox(fn, **kw))
    gl_vm.spawn_sandbox = spawn_sandbox
    gl_vm._covenant_sandbox_shim = True


def _as_bytes(address) -> bytes:
    if isinstance(address, bytes):
        return address
    if hasattr(address, "as_bytes"):
        return bytes(address.as_bytes)
    return bytes(address)


def _encode_ok(value) -> bytes:
    from genlayer.py import calldata
    from genlayer.py.public_abi import ResultCode

    return bytes([ResultCode.RETURN]) + calldata.encode(value)


def _encode_user_error(message: str) -> bytes:
    from genlayer.py.public_abi import ResultCode

    return bytes([ResultCode.USER_ERROR]) + str(message).encode("utf-8")


class Wiring:
    """Routes cross contract traffic between locally deployed instances."""

    def __init__(self, vm):
        self.vm = vm
        self.contracts = {}
        self.stack = []
        self.transfers = []
        self.deferred = []

    # ------------------------------------------------------------ bookkeeping

    def register(self, address, contract) -> None:
        self.contracts[_as_bytes(address)] = contract

    def balance_of(self, address) -> int:
        return self.vm._balances.get(_as_bytes(address), 0)

    def credit(self, address, amount: int) -> None:
        key = _as_bytes(address)
        self.vm._balances[key] = self.vm._balances.get(key, 0) + int(amount)

    def debit(self, address, amount: int) -> None:
        key = _as_bytes(address)
        self.vm._balances[key] = max(0, self.vm._balances.get(key, 0) - int(amount))

    @contextmanager
    def executing(self, address, sender=None, value=None):
        """Run a block as though `address` were the contract under execution."""
        from genlayer.py.types import Address

        previous_contract = self.vm._contract_address
        previous_sender = self.vm._sender
        previous_value = self.vm._value

        self.vm._contract_address = _as_bytes(address)
        if sender is not None:
            self.vm._sender = sender
        if value is not None:
            self.vm._value = int(value)
        self.vm._refresh_gl_message()
        self._point_message_at(Address(_as_bytes(address)))
        self._sync_clock()

        self.stack.append(_as_bytes(address))
        try:
            yield
        finally:
            self.stack.pop()
            self.vm._contract_address = previous_contract
            self.vm._sender = previous_sender
            self.vm._value = previous_value
            self.vm._refresh_gl_message()
            if previous_contract is not None:
                self._point_message_at(Address(_as_bytes(previous_contract)))

    def _sync_clock(self) -> None:
        """Carry ``direct_vm.warp`` through to the clock the contracts read.

        ``gl.message_raw['datetime']`` is injected once when the contract loads
        and ``_refresh_gl_message`` leaves it alone, so without this a warped
        test still sees the wall clock from deploy time.
        """
        import sys

        gl = sys.modules.get("genlayer.gl")
        if gl is None or getattr(gl, "message_raw", None) is None:
            return
        gl.message_raw["datetime"] = self.vm._datetime

    def _point_message_at(self, address) -> None:
        """gl.message caches contract_address at import, so set it directly."""
        import sys

        gl = sys.modules.get("genlayer.gl")
        if gl is None or getattr(gl, "message", None) is None:
            return
        gl.message = gl.MessageType(
            contract_address=address,
            sender_address=gl.message.sender_address,
            origin_address=gl.message.origin_address,
            value=gl.message.value,
            chain_id=gl.message.chain_id,
        )
        if getattr(gl, "message_raw", None) is not None:
            gl.message_raw["contract_address"] = address

    # ----------------------------------------------------------------- caller

    def _caller(self):
        from genlayer.py.types import Address

        if not self.stack:
            return None
        return Address(self.stack[-1])

    def _invoke(self, target_address, payload, sender, value=0):
        contract = self.contracts[_as_bytes(target_address)]
        method = payload.get("method")
        args = list(payload.get("args", []) or [])
        kwargs = dict(payload.get("kwargs", {}) or {})
        with self.executing(target_address, sender=sender, value=value):
            return getattr(contract, method)(*args, **kwargs)

    # ------------------------------------------------------------------- hook

    def hook(self, vm, request):
        caller = self._caller()

        if "CallContract" in request:
            spec = request["CallContract"]
            target = _as_bytes(spec["address"])
            if target not in self.contracts:
                return _encode_user_error(f"no contract at {spec['address']}")
            try:
                return _encode_ok(self._invoke(target, spec["calldata"], caller))
            except Exception as err:
                return _encode_user_error(getattr(err, "message", None) or str(err))

        if "PostMessage" in request:
            spec = request["PostMessage"]
            target = _as_bytes(spec["address"])
            value = int(spec.get("value", 0) or 0)
            payload = spec.get("calldata") or {}

            if value > 0 and caller is not None:
                self.debit(caller, value)
                self.credit(target, value)

            if target not in self.contracts or not payload.get("method"):
                self.transfers.append(
                    {
                        "to": "0x" + target.hex(),
                        "from": "0x" + _as_bytes(caller).hex() if caller else None,
                        "value": value,
                    }
                )
                return {"ok": None}

            # Emitted calls settle after the current call in production, so they
            # are queued here and drained explicitly by the test.
            self.deferred.append((target, payload, caller, value))
            return {"ok": None}

        return None

    def drain(self) -> int:
        """Run every queued emitted message, in order."""
        ran = 0
        while self.deferred:
            target, payload, sender, value = self.deferred.pop(0)
            self._invoke(target, payload, sender, value)
            ran += 1
        return ran


class Deployed:
    """A deployed contract bound to the address it actually lives at.

    Attribute access passes through, but a public method call is wrapped so the
    wiring knows which contract is executing. Without that, a cross contract
    call cannot work out who the sender is.
    """

    __slots__ = ("contract", "address", "address_bytes", "_wiring")

    def __init__(self, contract, address, wiring):
        self.contract = contract
        self.address = address.as_hex
        self.address_bytes = _as_bytes(address)
        self._wiring = wiring

    def __getattr__(self, name):
        attr = getattr(self.contract, name)
        if name.startswith("_") or not callable(attr):
            return attr

        def call(*args, **kwargs):
            with self._wiring.executing(self.address_bytes):
                return attr(*args, **kwargs)

        return call


@pytest.fixture
def gen():
    return GEN


@pytest.fixture
def wiring(direct_vm):
    return Wiring(direct_vm)


@pytest.fixture
def deploy(direct_vm, direct_deploy, wiring):
    """Deploy a contract at its own address and wire it for cross calls."""

    def _deploy(path: str, *args):
        # The SDK only reaches sys.path on the first deploy, so nothing from
        # genlayer may be imported above this call.
        _reset_contract_guard()

        # Every contract is allocated from ROOT_SLOT_ID of whatever storage
        # manager the VM is holding, so three contracts deployed into one VM
        # would otherwise overlay each other slot for slot and the last write
        # would win. A fresh manager per deploy gives each one its own space.
        # The instance binds to this manager through its root Slot and keeps
        # using it afterwards, whatever the VM is pointed at later.
        from gltest.direct.vm import InmemManager

        direct_vm._storage = InmemManager()

        contract = direct_deploy(path, *args)
        _install_sandbox_shim()

        from genlayer.py.types import Address

        address = Address(bytes(direct_vm._contract_address))
        wiring.register(address, contract)
        direct_vm._gl_call_hook = wiring.hook
        return Deployed(contract, address, wiring)

    return _deploy


@pytest.fixture
def registry(direct_vm, direct_owner, deploy):
    direct_vm.sender = direct_owner
    return deploy(REGISTRY)


@pytest.fixture
def stack(direct_vm, direct_owner, registry, deploy, wiring):
    """Registry, monitor and vault deployed and wired to each other."""
    direct_vm.sender = direct_owner

    monitor = deploy(MONITOR, registry.address)
    vault = deploy(VAULT, registry.address)

    registry.set_monitor(monitor.address)
    registry.set_vault(vault.address)
    monitor.set_vault(vault.address)
    vault.set_monitor(monitor.address)

    return {
        "registry": registry,
        "monitor": monitor,
        "vault": vault,
        "wiring": wiring,
    }


@pytest.fixture
def helpers():
    """Module level helpers of each contract, once the SDK is on the path.

    ``gltest`` keeps every loaded contract in ``sys.modules`` under
    ``_contract_<stem>``, so the pure functions can be exercised directly
    instead of only through contract calls.
    """
    import sys

    def module(stem: str):
        name = f"_contract_{stem}"
        assert name in sys.modules, f"{stem} has not been deployed in this test yet"
        return sys.modules[name]

    return module


@pytest.fixture
def as_address():
    def _as_address(value: str):
        from genlayer.py.types import Address

        return Address(value)

    return _as_address


# ------------------------------------------------------------- mock helpers


def mock_page(direct_vm, url_pattern: str, text: str):
    """Mock a rendered page, which is what web.render(mode='text') returns."""
    direct_vm.mock_web(url_pattern, {"status": 200, "body": text})


def mock_json(direct_vm, url_pattern: str, payload):
    direct_vm.mock_web(url_pattern, {"status": 200, "body": json.dumps(payload)})


def mock_rpc(direct_vm, rpc_pattern: str, payload):
    """Mock a JSON-RPC endpoint.

    The treasury read is a ``web.post``, and the runner matches a mock on method
    as well as URL, so a mock left at the default GET is never found.
    """
    direct_vm.mock_web(
        rpc_pattern,
        {"method": "POST", "status": 200, "body": json.dumps(payload)},
    )


def mock_rpc_balance(direct_vm, rpc_pattern: str, balance_atto: int):
    mock_rpc(direct_vm, rpc_pattern, {"jsonrpc": "2.0", "id": 1, "result": hex(balance_atto)})


def mock_rpc_error(direct_vm, rpc_pattern: str, code: int = -32000, message: str = "nope"):
    mock_rpc(
        direct_vm,
        rpc_pattern,
        {"jsonrpc": "2.0", "id": 1, "error": {"code": code, "message": message}},
    )


# ----------------------------------------------------------- sample facility

FACILITY_ID = "harbour-revolver-01"
TREASURY_RPC = "https://rpc.example.org/mainnet"
TREASURY_ACCOUNT = "0x" + "a7" * 20
REVENUE_URL = "https://dashboards.example.org/harbour/revenue"
REPORTS_URL = "https://harbour.example.org/transparency"
FORUM_URL = "https://forum.example.org/harbour/governance"

COVENANT_RATIO = 0
COVENANT_FILING = 1
COVENANT_PROSE = 2
COVENANT_TREASURY = 3

PRINCIPAL = 2_500_000 * GEN
RATE_BP = 850
STEP_UP_BP = 400


def open_facility(registry, direct_vm, lender, borrower, facility_id=FACILITY_ID):
    direct_vm.sender = lender
    registry.create_facility(
        facility_id,
        borrower.as_hex,
        "Harbour DAO",
        "Revolving working capital against protocol revenue",
        PRINCIPAL,
        RATE_BP,
        STEP_UP_BP,
        TREASURY_RPC,
        TREASURY_ACCOUNT,
        FORUM_URL,
    )
    return facility_id


def draft_covenants(registry, direct_vm, lender, facility_id=FACILITY_ID):
    """The four covenants the demo facility carries, one of each kind."""
    direct_vm.sender = lender

    registry.add_covenant(
        facility_id,
        "Maintain a minimum 1.2x ratio of annualised protocol revenue to annual "
        "debt service, tested monthly.",
        "ratio",
        "Revenue to debt service",
        "annualised protocol revenue",
        "annual debt service",
        12000,
        0,
        "gte",
        720,
        336,
        0,
        "rate_step_up",
        [REVENUE_URL],
    )

    registry.add_covenant(
        facility_id,
        "Publish a quarterly transparency report within 45 days of each quarter end.",
        "filing",
        "Quarterly report timeliness",
        "",
        "",
        0,
        0,
        "lte",
        168,
        168,
        45,
        "draw_stop",
        [REPORTS_URL],
    )

    registry.add_covenant(
        facility_id,
        "Incur no new senior debt without the lender's written consent.",
        "prose",
        "No new senior debt",
        "",
        "",
        0,
        0,
        "gte",
        168,
        0,
        0,
        "acceleration",
        [FORUM_URL],
    )

    registry.add_covenant(
        facility_id,
        "Keep at least 600,000 in the operating treasury at all times.",
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


def commit_capital(stack_, direct_vm, lender, amount, facility_id=FACILITY_ID):
    """Lender funds the vault.

    ``commit`` is payable. The direct runner sets ``gl.message.value`` but does
    not move any balance, so the arriving capital is credited here to keep the
    vault's own accounting honest.
    """
    vault = stack_["vault"]
    direct_vm.sender = lender
    direct_vm.value = int(amount)
    stack_["wiring"].credit(vault.address_bytes, int(amount))
    try:
        return vault.commit(facility_id)
    finally:
        direct_vm.value = 0


def repay_amount(stack_, direct_vm, borrower, amount, facility_id=FACILITY_ID):
    vault = stack_["vault"]
    direct_vm.sender = borrower
    direct_vm.value = int(amount)
    stack_["wiring"].credit(vault.address_bytes, int(amount))
    try:
        return vault.repay(facility_id)
    finally:
        direct_vm.value = 0


@pytest.fixture
def facility(stack, direct_vm, direct_alice, direct_bob):
    """A four covenant facility. Alice lends, Bob borrows."""
    registry = stack["registry"]
    open_facility(registry, direct_vm, direct_alice, direct_bob)
    draft_covenants(registry, direct_vm, direct_alice)
    return {
        **stack,
        "facility_id": FACILITY_ID,
        "lender": direct_alice,
        "borrower": direct_bob,
    }


@pytest.fixture
def funded(facility, direct_vm):
    """The same facility with the lender's capital committed to the vault."""
    commit_capital(facility, direct_vm, facility["lender"], PRINCIPAL)
    return facility
