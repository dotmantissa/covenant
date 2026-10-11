"""Crash-resumable, full-consensus Studionet reviewer evidence runner.

Run: python3 tests/integration/review_lifecycle.py deploy|economics|breach|resolve
Credentials come from REVIEW_KEY_FILE (default ignored .env.review); evidence
contains only public addresses, transaction hashes, receipt outcomes and states.
No mocks, leader-only execution, or network time manipulation is used.
"""
import argparse
import base64
import hashlib
import json
import os
import time
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.assertions import tx_execution_succeeded
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionHashVariant, TransactionStatus

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "evidence/studionet-review.json"
GEN = 10**18
EXPLORER = "https://explorer-studio.genlayer.com/tx/"
SOURCE_URL = "https://raw.githubusercontent.com/dotmantissa/covenant/main/evidence/appeal-source.md"


def execution_succeeded(receipt):
    if receipt.get("type") == 0:
        return (receipt.get("status_name") == "FINALIZED" and receipt.get("value_credited") is True
                and bool(receipt.get("triggered_by")) and receipt.get("triggered_on") == "finalized")
    return tx_execution_succeeded(receipt)


def save(data):
    EVIDENCE.parent.mkdir(exist_ok=True)
    temp = EVIDENCE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2, default=str) + "\n")
    temp.replace(EVIDENCE)


class ReviewRun:
    def __init__(self):
        keys = {}
        for line in (ROOT / os.environ.get("REVIEW_KEY_FILE", ".env.review")).read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                keys[k] = v
        self.lender = Account.from_key(keys["GENLAYER_DEPLOYER_PRIVATE_KEY"])
        self.borrower = Account.from_key(keys["REVIEW_BORROWER_PRIVATE_KEY"])
        self.client = create_client(chain=studionet, account=self.lender)
        original_request = self.client.provider.make_request

        def request(method, params):
            for attempt in range(6):
                try:
                    return original_request(method, params)
                except Exception as err:
                    transient = any(word in str(err).lower() for word in
                        ("connection", "timeout", "429", "-32429", "invalid json", "502", "503"))
                    # Retrying identical signed bytes preserves its hash and nonce.
                    # Never re-sign an ambiguous submission with a fresh nonce.
                    retryable = method.startswith(("eth_get", "gen_get", "gen_call")) or method == "eth_sendRawTransaction"
                    if not transient or not retryable or attempt == 5:
                        raise
                    print("retrying", method, "after transient transport failure", flush=True)
                    time.sleep(5 * (attempt + 1))
        self.client.provider.make_request = request
        self.data = json.loads(EVIDENCE.read_text()) if EVIDENCE.exists() else {
            "network": "studionet", "chainId": 61999, "lender": self.lender.address,
            "borrower": self.borrower.address, "contracts": {}, "steps": {}, "checks": {},
            "facilityId": "review-" + str(int(time.time())),
        }
        for record in self.data["steps"].values():
            record["explorer"] = EXPLORER + record["hash"]
        assert self.data["lender"] == self.lender.address
        assert self.data["borrower"] == self.borrower.address
        save(self.data)

    def balance(self, address):
        return int(self.client.get_balance(address))

    def read(self, contract, method, args=None):
        return self.client.read_contract(self.data["contracts"][contract], method, args=args or [],
            transaction_hash_variant=TransactionHashVariant.LATEST_FINAL)

    def receipt(self, tx_hash):
        return self.client.wait_for_transaction_receipt(tx_hash,
            status=TransactionStatus.FINALIZED, interval=7000, retries=180, full_transaction=True)

    def step(self, label, submit, expect_success=True):
        record = self.data["steps"].get(label)
        if record and "receipt" in record:
            self.children(label, record["receipt"])
            return record["receipt"]
        if not record:
            tx_hash = submit()
            tx_hash = tx_hash.hex() if hasattr(tx_hash, "hex") else str(tx_hash)
            if not tx_hash.startswith("0x"):
                tx_hash = "0x" + tx_hash
            record = {"hash": tx_hash, "explorer": EXPLORER + tx_hash,
                      "expectedSuccess": expect_success}
            self.data["steps"][label] = record
            save(self.data)  # submission recorded before waiting
        print(label, record["explorer"], flush=True)
        receipt = self.receipt(record["hash"])
        assert execution_succeeded(receipt) == expect_success, (label, receipt)
        assert receipt.get("status_name") == "FINALIZED" or receipt["status"] == 7, (label, receipt["status"])
        leaders = (receipt.get("consensus_data") or {}).get("leader_receipt", [])
        record["receipt"] = {k: receipt[k] for k in
            ("hash", "status", "status_name", "to_address", "data", "triggered_transactions", "leader_only", "execution_mode", "type", "value", "value_credited", "from_address", "triggered_by", "triggered_on") if k in receipt}
        record["receipt"]["consensus_data"] = {"leader_receipt": [
            {k: leader[k] for k in ("execution_result", "error", "result", "pending_transactions", "pending_eth_transactions", "vote", "mode") if k in leader}
            for leader in leaders]}
        record["receipt"]["consensus_data"]["validators"] = [
            {k: validator[k] for k in ("execution_result", "vote", "mode") if k in validator}
            for validator in (receipt.get("consensus_data") or {}).get("validators", [])]
        record["receipt"]["consensus_data"]["votes"] = (receipt.get("consensus_data") or {}).get("votes", {})
        receipt = record["receipt"]
        save(self.data)
        self.children(label, receipt)
        return receipt

    def children(self, label, receipt):
        # A finalized parent alone is insufficient: each emitted child reaches
        # consensus independently. Record and verify the entire message tree.
        for child in receipt.get("triggered_transactions", []):
            tx_hash = child.get("hash") if isinstance(child, dict) else child
            if not tx_hash:
                raise AssertionError((label, "missing child transaction hash", child))
            child_label = f"{label}/child/{tx_hash}"
            self.step(child_label, lambda: tx_hash)

    def write(self, label, contract, method, args, value=0, borrower=False, expect_success=True):
        return self.step(label, lambda: self.client.write_contract(
            self.data["contracts"][contract], method, args=args, value=value,
            account=self.borrower if borrower else self.lender), expect_success)

    def check(self, label, facts):
        self.data["checks"][label] = facts
        save(self.data)
        print("verified", label, json.dumps(facts, default=str), flush=True)

    def deploy(self):
        for key, filename, args in [
            ("facilityRegistry", "facility_registry.py", []),
            ("covenantMonitor", "covenant_monitor.py", None),
            ("creditVault", "credit_vault.py", None),
        ]:
            code = (ROOT / "contracts" / filename).read_bytes()
            digest = hashlib.sha256(code).hexdigest()
            if key in self.data["contracts"]:
                assert self.data["sourceHashes"][key] == digest, "source changed after deployment"
                continue
            if args is None:
                args = [self.data["contracts"]["facilityRegistry"]]
            receipt = self.step("deploy/" + key, lambda code=code, args=args:
                                self.client.deploy_contract(code=code, args=args))
            address = (receipt.get("data") or {}).get("contract_address") or receipt.get("to_address")
            assert address, receipt
            self.data["contracts"][key] = address
            self.data.setdefault("sourceHashes", {})[key] = digest
            save(self.data)
        contracts = self.data["contracts"]
        for key, method, peer in [("facilityRegistry", "set_monitor", "covenantMonitor"),
                                  ("facilityRegistry", "set_vault", "creditVault"),
                                  ("covenantMonitor", "set_vault", "creditVault"),
                                  ("creditVault", "set_monitor", "covenantMonitor")]:
            self.write(f"wire/{key}/{method}", key, method, [contracts[peer]])
        for key, peer1, peer2 in [("facilityRegistry", "monitor", "vault"),
                                 ("covenantMonitor", "registry", "vault"),
                                 ("creditVault", "registry", "monitor")]:
            wiring = self.read(key, "get_wiring")
            peers = {"monitor": "covenantMonitor", "registry": "facilityRegistry", "vault": "creditVault"}
            for name in [peer1, peer2]:
                assert wiring[name].lower() == contracts[peers[name]].lower()
        (ROOT / "deploy/addresses.json").write_text(json.dumps({
            "network": "studionet", "chainId": 61999, "deployer": self.lender.address,
            "contracts": contracts, "sourceHashes": self.data["sourceHashes"],
        }, indent=2) + "\n")
        hashes = {}
        for key, address in contracts.items():
            code = self.client.provider.make_request("gen_getContractCode", [address])["result"]
            hashes[key] = hashlib.sha256(base64.b64decode(code)).hexdigest()
            assert hashes[key] == self.data["sourceHashes"][key], "chain source differs from repository"
        self.check("deployed_source_hashes", hashes)
        self.check("wiring", contracts)

    def economics(self):
        fid = self.data["facilityId"]
        # Studio test faucet is required for value movement, despite gasless writes.
        for party in [self.lender, self.borrower]:
            if self.balance(party.address) < 200 * GEN:
                response = self.client.provider.make_request("sim_fundAccount", [party.address, 1000 * GEN])
                assert "result" in response, response
        self.write("economic/create", "facilityRegistry", "create_facility", [fid,
            self.borrower.address, "Reviewer lifecycle borrower", "Fund accounting and covenant review",
            100 * GEN, 10000, 400, "https://ethereum-rpc.publicnode.com",
            "0x0000000000000000000000000000000000000001", SOURCE_URL])
        self.write("economic/commit", "creditVault", "commit", [fid], 100 * GEN)
        vault_address = self.data["contracts"]["creditVault"]
        if "economic/draw" not in self.data["steps"]:
            self.data["drawBefore"] = {"borrower": str(self.balance(self.borrower.address)),
                                       "vault": str(self.balance(vault_address))}
            save(self.data)
        self.write("economic/draw", "creditVault", "draw", [fid, 100 * GEN], borrower=True)
        if "draw_settlement" not in self.data["checks"]:
            after_b = self.balance(self.borrower.address)
            after_v = self.balance(vault_address)
            assert after_b - int(self.data["drawBefore"]["borrower"]) == 100 * GEN
            assert int(self.data["drawBefore"]["vault"]) - after_v == 100 * GEN
            self.check("draw_settlement", {"borrowerDeltaAtto": str(100 * GEN), "vaultDeltaAtto": str(-100 * GEN)})
        # Wall time while transactions finalize accrues actual integer interest.
        if "economic/repay" not in self.data["steps"]:
            quote = self.read("creditVault", "quote_outstanding", [fid])
            assert int(quote["interest_atto"]) > 0, quote
        if "economic/repay" not in self.data["steps"]:
            self.data["repayBefore"] = {"borrower": str(self.balance(self.borrower.address)),
                                       "vault": str(self.balance(vault_address))}
            save(self.data)
        self.write("economic/repay", "creditVault", "repay", [fid], 110 * GEN, borrower=True)
        if "repayment_and_surplus" not in self.data["checks"]:
            position = self.read("creditVault", "get_position", [fid])
            earned = int(self.read("creditVault", "get_interest_collected", [fid])["interest_collected_atto"])
            assert int(position["drawn_atto"]) == 0 and int(position["interest_accrued_atto"]) == 0
            assert earned > 0
            surplus = 110 * GEN - 100 * GEN - earned
            assert surplus > 0
            assert self.balance(self.borrower.address) - int(self.data["repayBefore"]["borrower"]) == -110 * GEN + surplus
            assert self.balance(vault_address) == 100 * GEN + earned
            self.check("repayment_and_surplus", {"principalAtto": str(100 * GEN),
                       "earnedInterestAtto": str(earned), "payerSurplusAtto": str(surplus),
                       "vaultBalanceAtto": str(self.balance(vault_address))})
        earned = int(self.data["checks"]["repayment_and_surplus"]["earnedInterestAtto"])
        self.write("economic/unauthorized-interest", "creditVault", "withdraw_interest", [fid, 0], borrower=True, expect_success=False)
        if "economic/withdraw-interest" not in self.data["steps"]:
            self.data["interestBefore"] = str(self.balance(self.lender.address))
            save(self.data)
        self.write("economic/withdraw-interest", "creditVault", "withdraw_interest", [fid, 0])
        if "interest_settlement" not in self.data["checks"]:
            assert self.balance(self.lender.address) - int(self.data["interestBefore"]) == earned
            assert self.read("creditVault", "get_interest_collected", [fid])["interest_collected_atto"] == "0"
            assert self.balance(vault_address) == 100 * GEN
            self.check("interest_settlement", {"lenderDeltaAtto": str(earned), "capitalPreservedAtto": str(100 * GEN)})
        self.write("economic/repeat-interest", "creditVault", "withdraw_interest", [fid, 0], expect_success=False)

    def breach(self):
        fid = self.data["facilityId"]
        self.write("appeal/initial-draw", "creditVault", "draw", [fid, 10 * GEN], borrower=True)
        self.write("appeal/draft", "facilityRegistry", "add_covenant", [fid,
            "Incur no new senior debt without the lender's written consent.", "prose", "No senior debt",
            "", "", 0, 0, "gte", 24, 0, 0, "acceleration", [SOURCE_URL]])
        self.write("appeal/unauthorized-test", "covenantMonitor", "test_covenant", [fid, 0], expect_success=False)
        self.write("appeal/borrower-approve", "facilityRegistry", "approve_covenant", [fid, 0], borrower=True)
        self.write("appeal/breach-test", "covenantMonitor", "test_covenant", [fid, 0])
        finding = self.read("covenantMonitor", "get_finding", [fid, 0])
        position = self.read("creditVault", "get_position", [fid])
        assert finding["breached"] and position["accelerated"] and position["draw_frozen"]
        assert int(position["drawn_atto"]) == 10 * GEN
        assert self.read("facilityRegistry", "get_facility", [fid])["status"] == "accelerating"
        self.write("treasury/draft", "facilityRegistry", "add_covenant", [fid,
            "Maintain at least one wei of native ETH in the agreed Ethereum mainnet treasury.",
            "treasury", "Authenticated ETH floor", "", "", 0, 1, "gte", 24, 0, 0,
            "draw_stop", []])
        self.write("treasury/borrower-approve", "facilityRegistry", "approve_covenant", [fid, 1], borrower=True)
        self.write("treasury/authenticated-test", "covenantMonitor", "test_covenant", [fid, 1])
        treasury = self.read("covenantMonitor", "get_finding", [fid, 1])
        assert not treasury["breached"] and int(treasury["observed_atto"]) > 0
        assert "chain:1" in treasury["citation"] and "eth.drpc.org" in treasury["citation"]
        assert self.read("creditVault", "get_position", [fid])["accelerated"]
        self.check("authenticated_treasury_and_release_isolation", treasury)
        self.write("appeal/blocked-draw", "creditVault", "draw", [fid, GEN], borrower=True, expect_success=False)
        self.write("appeal/post-bond", "covenantMonitor", "appeal_breach", [fid, 0], GEN, borrower=True)
        assert self.read("covenantMonitor", "get_appeal_bond", [fid, 0]) == str(GEN)
        self.check("acceleration_and_bond", {"finding": finding, "position": position, "bondAtto": str(GEN)})

    def resolve(self):
        fid = self.data["facilityId"]
        if "appeal/resolve" not in self.data["steps"]:
            self.data["bondBefore"] = str(self.balance(self.borrower.address))
            save(self.data)
        self.write("appeal/resolve", "covenantMonitor", "resolve_appeal", [fid, 0], borrower=True)
        if "appeal_reversal_and_refund" not in self.data["checks"]:
            position = self.read("creditVault", "get_position", [fid])
            covenant = self.read("facilityRegistry", "get_covenant", [fid, 0])
            assert not position["accelerated"] and not position["draw_frozen"]
            assert int(position["drawn_atto"]) == 10 * GEN, "appeal must preserve the debt"
            assert covenant["appeal_status"] == "overturned"
            assert self.read("facilityRegistry", "get_facility", [fid])["status"] == "active"
            assert self.read("covenantMonitor", "get_appeal_bond", [fid, 0]) == "0"
            assert self.balance(self.borrower.address) - int(self.data["bondBefore"]) == GEN
            assert self.balance(self.data["contracts"]["covenantMonitor"]) == 0
            self.check("appeal_reversal_and_refund", {"position": position, "covenant": covenant, "borrowerBondDeltaAtto": str(GEN)})
        self.write("appeal/repeat-resolution", "covenantMonitor", "resolve_appeal", [fid, 0], expect_success=False)
        self.write("appeal/restored-draw", "creditVault", "draw", [fid, GEN], borrower=True)
        if "restored_rights" not in self.data["checks"]:
            restored = self.read("creditVault", "get_position", [fid])
            assert int(restored["drawn_atto"]) == 11 * GEN
            self.check("restored_rights", restored)
        vault_address = self.data["contracts"]["creditVault"]
        if "cleanup/repay" not in self.data["steps"]:
            self.data["cleanupBefore"] = {"borrower": str(self.balance(self.borrower.address))}
            save(self.data)
        self.write("cleanup/repay", "creditVault", "repay", [fid], 12 * GEN, borrower=True)
        if "cleanup_repayment" not in self.data["checks"]:
            earned = int(self.read("creditVault", "get_interest_collected", [fid])["interest_collected_atto"])
            assert earned > 0
            assert self.balance(self.borrower.address) - int(self.data["cleanupBefore"]["borrower"]) == -11 * GEN - earned
            assert self.balance(vault_address) == 100 * GEN + earned
            self.check("cleanup_repayment", {"principalAtto": str(11 * GEN), "earnedInterestAtto": str(earned),
                "payerSurplusAtto": str(GEN - earned)})
        earned = int(self.data["checks"]["cleanup_repayment"]["earnedInterestAtto"])
        if "cleanup/interest" not in self.data["steps"]:
            self.data["cleanupInterestBefore"] = str(self.balance(self.lender.address))
            save(self.data)
        self.write("cleanup/interest", "creditVault", "withdraw_interest", [fid, 0])
        if "cleanup_interest" not in self.data["checks"]:
            assert self.balance(self.lender.address) - int(self.data["cleanupInterestBefore"]) == earned
            assert self.balance(vault_address) == 100 * GEN
            self.check("cleanup_interest", {"lenderDeltaAtto": str(earned)})
        if "cleanup/capital" not in self.data["steps"]:
            self.data["capitalBefore"] = str(self.balance(self.lender.address))
            save(self.data)
        self.write("cleanup/capital", "creditVault", "withdraw_free_capital", [fid, 100 * GEN])
        assert self.balance(self.lender.address) - int(self.data["capitalBefore"]) == 100 * GEN
        assert self.balance(vault_address) == 0
        assert self.balance(self.data["contracts"]["covenantMonitor"]) == 0
        self.check("final_settlement", {"vaultBalanceAtto": "0", "monitorBalanceAtto": "0",
            "lenderCapitalDeltaAtto": str(100 * GEN), "position": self.read("creditVault", "get_position", [fid])})



if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["deploy", "economics", "breach", "resolve"])
    args = parser.parse_args()
    run = ReviewRun()
    getattr(run, args.phase)()
