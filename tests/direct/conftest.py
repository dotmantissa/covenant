"""Shared fixtures for Covenant direct mode tests.

Two shims are installed here because the direct runner does not provide them:

* ``gl.vm.spawn_sandbox`` normally serialises the callable and hands it to a
  fresh VM. There is no VM in direct mode, so it is replaced with a version
  that calls the function and wraps the outcome in the same result types. The
  contract code is untouched and still uses the real sandbox in production.
* Cross contract calls are routed between the locally deployed instances, so
  the registry, monitor and vault can be exercised wired together rather than
  one at a time.
"""

import json
from pathlib import Path

import pytest

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"

REGISTRY = str(CONTRACTS / "facility_registry.py")
MONITOR = str(CONTRACTS / "covenant_monitor.py")
VAULT = str(CONTRACTS / "credit_vault.py")

GEN = 10**18


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
        except Exception as err:  # surfaces as a VM error, same as production
            return gl_vm.VMError(message=f"{type(err).__name__}: {err}")

    from genlayer.py.types import Lazy

    spawn_sandbox.lazy = lambda fn, **kw: Lazy(lambda: spawn_sandbox(fn, **kw))
    gl_vm.spawn_sandbox = spawn_sandbox
    gl_vm._covenant_sandbox_shim = True


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
        self.by_address = {}
        self.transfers = []
        self.deferred = []

    def register(self, address, contract):
        self.by_address[bytes(address.as_bytes)] = contract

    def _resolve(self, address):
        return self.by_address.get(bytes(address.as_bytes))

    def _invoke(self, target, payload, sender):
        method = payload.get("method")
        args = list(payload.get("args", []) or [])
        kwargs = dict(payload.get("kwargs", {}) or {})
        previous = self.vm.sender
        self.vm.sender = sender
        try:
            return getattr(target, method)(*args, **kwargs)
        finally:
            self.vm.sender = previous

    def hook(self, vm, request):
        import genlayer.gl as gl

        here = gl.message.contract_address

        if "CallContract" in request:
            spec = request["CallContract"]
            target = self._resolve(spec["address"])
            if target is None:
                return _encode_user_error(f"no contract at {spec['address']}")
            try:
                return _encode_ok(self._invoke(target, spec["calldata"], here))
            except Exception as err:
                return _encode_user_error(getattr(err, "message", None) or str(err))

        if "PostMessage" in request:
            spec = request["PostMessage"]
            target = self._resolve(spec["address"])
            value = int(spec.get("value", 0) or 0)
            payload = spec.get("calldata") or {}

            if target is None or not payload.get("method"):
                # A plain transfer, or a message to an account we do not model.
                self.transfers.append(
                    {
                        "to": "0x" + bytes(spec["address"].as_bytes).hex(),
                        "value": value,
                        "from": "0x" + bytes(here.as_bytes).hex(),
                    }
                )
                return {"ok": None}

            # Emitted calls settle after the current call in production, so they
            # are queued and drained explicitly by the test.
            self.deferred.append((target, payload, here, value))
            return {"ok": None}

        return None

    def drain(self):
        """Run every queued emitted message, in order."""
        ran = 0
        while self.deferred:
            target, payload, sender, _value = self.deferred.pop(0)
            self._invoke(target, payload, sender)
            ran += 1
        return ran


@pytest.fixture
def gen():
    return GEN


@pytest.fixture
def wiring(direct_vm):
    return Wiring(direct_vm)


@pytest.fixture
def registry(direct_vm, direct_deploy, direct_owner, wiring):
    direct_vm.sender = direct_owner
    contract = direct_deploy(REGISTRY)
    _install_sandbox_shim()
    wiring.register(contract.address, contract)
    direct_vm._gl_call_hook = wiring.hook
    return contract


@pytest.fixture
def stack(direct_vm, direct_deploy, direct_owner, registry, wiring):
    """Registry, monitor and vault deployed and wired to each other."""
    direct_vm.sender = direct_owner

    monitor = direct_deploy(MONITOR, registry.address.as_hex)
    vault = direct_deploy(VAULT, registry.address.as_hex)

    wiring.register(monitor.address, monitor)
    wiring.register(vault.address, vault)

    registry.set_monitor(monitor.address.as_hex)
    registry.set_vault(vault.address.as_hex)
    monitor.set_vault(vault.address.as_hex)
    vault.set_monitor(monitor.address.as_hex)

    return {
        "registry": registry,
        "monitor": monitor,
        "vault": vault,
        "wiring": wiring,
    }


# ------------------------------------------------------------- mock helpers


def mock_page(direct_vm, url_pattern: str, text: str):
    """Mock a rendered page, which is what web.render(mode='text') returns."""
    direct_vm.mock_web(url_pattern, {"status": 200, "body": text})


def mock_json(direct_vm, url_pattern: str, payload):
    direct_vm.mock_web(url_pattern, {"status": 200, "body": json.dumps(payload)})


def mock_rpc_balance(direct_vm, rpc_pattern: str, balance_atto: int):
    direct_vm.mock_web(
        rpc_pattern,
        {
            "status": 200,
            "body": json.dumps({"jsonrpc": "2.0", "id": 1, "result": hex(balance_atto)}),
        },
    )


def mock_extraction(direct_vm, payload: dict, prompt_pattern: str = r"(?s).*"):
    direct_vm.mock_llm(prompt_pattern, json.dumps(payload))
