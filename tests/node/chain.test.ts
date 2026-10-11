/**
 * Unit tests for chain transport helpers.
 *
 * Verifies transaction receipt validation, revert message parsing,
 * and retry logic for transient errors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertExecuted, ContractRevert, sendWrite, withRetry, isAbsentVaultPosition } from "../../lib/chain";
import type { GenLayerTransaction } from "genlayer-js/types";

describe("unfunded vault positions", () => {
  const facilityId = "automation-review-1791714315";
  const raw = "AVtFWFBFQ1RFRF0gbm8gcG9zaXRpb24gb3BlbiBvbiBhdXRvbWF0aW9uLXJldmlldy0xNzkxNzE0MzE1";
  it("recognizes the actual nested Studio view-error envelope", () => {
    const error = Object.assign(new Error("Missing or invalid parameters."), {
      cause: { code: -32000, message: "execution failed", data: {
        receipt: { execution_result: "ERROR", result: raw },
      } },
    });
    assert.equal(isAbsentVaultPosition(error, facilityId), true);
    assert.equal(isAbsentVaultPosition(error, "other-facility"), false);
  });
  it("does not swallow transport failures or unrelated reverts", () => {
    for (const error of [new Error("timeout: no position open on " + facilityId),
      { cause: { data: { receipt: { execution_result: "ERROR", result: Buffer.from("\u0001[EXPECTED] only lender may commit").toString("base64") } } } },
      { data: { receipt: { execution_result: "SUCCESS", result: raw } } },
      { data: { receipt: { execution_result: "ERROR", result: "invalid" } } },
    ]) assert.equal(isAbsentVaultPosition(error, facilityId), false);
  });
  it("supports the explicit UserError form without substring matching", () => {
    assert.equal(isAbsentVaultPosition(new Error("UserError: [EXPECTED] no position open on " + facilityId), facilityId), true);
    assert.equal(isAbsentVaultPosition(new Error("unrelated: [EXPECTED] no position open on " + facilityId), facilityId), false);
  });
});

describe("assertExecuted", () => {
  it("passes when transaction is FINALIZED with SUCCESS execution result", () => {
    const receipt = {
      status: 7,
      statusName: "FINALIZED",
      result: 6,
      txExecutionResult: 0,
      txExecutionResultName: "SUCCESS",
      consensus_data: {
        leader_receipt: [
          {
            execution_result: "SUCCESS",
          },
        ],
      },
    } as unknown as GenLayerTransaction;

    assert.doesNotThrow(() => assertExecuted("testMethod", receipt));
  });

  it("throws ContractRevert when leader receipt reports error", () => {
    const receipt = {
      status: 7,
      statusName: "FINALIZED",
      consensus_data: {
        leader_receipt: [
          {
            execution_result: "ERROR",
            error: "UserError: only lender may commit funds",
          },
        ],
      },
    } as unknown as GenLayerTransaction;

    assert.throws(
      () => assertExecuted("commit", receipt),
      (err: unknown) => {
        assert.ok(err instanceof ContractRevert);
        assert.equal(err.label, "commit");
        assert.equal(err.message, "only lender may commit funds");
        return true;
      },
    );
  });

  it("throws when transaction status is not settled", () => {
    const receipt = {
      status: 1,
      statusName: "PENDING",
      consensus_data: {
        leader_receipt: [],
      },
    } as unknown as GenLayerTransaction;

    assert.throws(
      () => assertExecuted("testMethod", receipt),
      /did not settle, status PENDING/,
    );
  });

  it("throws when execution result is absent", () => {
    const receipt = {
      status: 7,
      statusName: "FINALIZED",
      consensus_data: {
        leader_receipt: [],
      },
    } as unknown as GenLayerTransaction;

    assert.throws(
      () => assertExecuted("testMethod", receipt),
      /reported no execution result/,
    );
  });
});

describe("withRetry", () => {
  it("resolves immediately on first success", async () => {
    let calls = 0;
    const res = await withRetry("quick", async () => {
      calls += 1;
      return "ok";
    });
    assert.equal(res, "ok");
    assert.equal(calls, 1);
  });

  it("does not retry permanent non-transient errors", async () => {
    let calls = 0;
    await assert.rejects(
      async () => {
        await withRetry("perm", async () => {
          calls += 1;
          throw new Error("unauthorized caller");
        });
      },
      /unauthorized caller/,
    );
    assert.equal(calls, 1);
  });

  it("retries transient fetch failed errors until success", async () => {
    let calls = 0;
    const res = await withRetry(
      "network",
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("fetch failed");
        return "success";
      },
      3,
    );
    assert.equal(res, "success");
    assert.equal(calls, 2);
  });
});

describe("emitted settlement", () => {
  it("waits for every child and grandchild before completing", async () => {
    const { waitForEmittedTransactions } = await import("../../lib/chain");
    const root = `0x${"1".repeat(64)}` as const;
    const child = `0x${"2".repeat(64)}` as const;
    const grandchild = `0x${"3".repeat(64)}` as const;
    const waited: string[] = [];
    const client = {
      getTriggeredTransactionIds: async ({ hash }: { hash: string }) =>
        hash === root ? [child] : hash === child ? [grandchild] : [],
      waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
        waited.push(hash);
        return { statusName: "FINALIZED", result: 6, consensus_data: {
          leader_receipt: [{ execution_result: "SUCCESS" }],
        } };
      },
    } as unknown as import("../../lib/chain").Client;
    await waitForEmittedTransactions(client, root as import("genlayer-js/types").TransactionHash, "test");
    assert.deepEqual(waited, [child, grandchild]);
  });

  it("rejects a failed settlement child even when its parent succeeded", async () => {
    const { waitForEmittedTransactions } = await import("../../lib/chain");
    const client = {
      getTriggeredTransactionIds: async () => [`0x${"2".repeat(64)}`],
      waitForTransactionReceipt: async () => ({ statusName: "FINALIZED", consensus_data: {
        leader_receipt: [{ execution_result: "ERROR", error: "UserError: transfer failed" }],
      } }),
    } as unknown as import("../../lib/chain").Client;
    await assert.rejects(
      waitForEmittedTransactions(client, `0x${"1".repeat(64)}` as import("genlayer-js/types").TransactionHash, "test"), ContractRevert,
    );
  });
});


describe("write submission integrity", () => {
  it("never re-signs an ambiguous value submission", async () => {
    let submissions = 0;
    const client = {
      writeContract: async () => { submissions++; throw new Error("fetch failed"); },
    } as unknown as import("../../lib/chain").Client;
    await assert.rejects(sendWrite(client, "repay", `0x${"1".repeat(40)}`, "repay", ["facility"], 1n), /fetch failed/);
    assert.equal(submissions, 1);
  });

  it("rejects an unknown execution result despite finalization", () => {
    const receipt = { statusName: "FINALIZED", consensus_data: {
      leader_receipt: [{ execution_result: "UNKNOWN" }],
    } } as unknown as GenLayerTransaction;
    assert.throws(() => assertExecuted("repay", receipt), /unrecognized execution result/);
  });
});


describe("native settlement receipts", () => {
  const parent = `0x${"1".repeat(64)}`;
  const native = () => ({ type: 0, statusName: "FINALIZED", value: 100,
    from_address: `0x${"2".repeat(40)}`, to_address: `0x${"3".repeat(40)}`,
    value_credited: true, triggered_by: parent, triggered_on: "finalized",
    consensus_data: null,
  } as unknown as GenLayerTransaction);

  it("accepts a credited finalized native child without a VM receipt", async () => {
    const { assertSettlementChild } = await import("../../lib/chain");
    assert.doesNotThrow(() => assertSettlementChild("draw", native(), parent));
  });
  it("rejects finalized native children whose recipient was not credited", async () => {
    const { assertSettlementChild } = await import("../../lib/chain");
    assert.throws(() => assertSettlementChild("draw", { ...native(), value_credited: false } as GenLayerTransaction, parent), /cannot be confirmed/);
  });
  it("rejects native children emitted by a different parent", async () => {
    const { assertSettlementChild } = await import("../../lib/chain");
    assert.throws(() => assertSettlementChild("draw", native(), "different"), /cannot be confirmed/);
  });
  it("rejects accepted native children before finalization", async () => {
    const { assertSettlementChild } = await import("../../lib/chain");
    assert.throws(() => assertSettlementChild("draw", { ...native(), statusName: "ACCEPTED" } as GenLayerTransaction, parent), /cannot be confirmed/);
  });
});


it("verifies raw SEND ledger when the SDK omits native type and linkage", async () => {
  const { waitForEmittedTransactions } = await import("../../lib/chain");
  const parent = `0x${"1".repeat(64)}` as import("genlayer-js/types").TransactionHash;
  const child = `0x${"2".repeat(64)}`;
  let rawReads = 0;
  const client = {
    getTriggeredTransactionIds: async ({ hash }: { hash: string }) => hash === parent ? [child] : [],
    waitForTransactionReceipt: async () => ({ status: 7, consensus_data: null }),
    request: async () => {
      rawReads++;
      return { type: 0, status: "FINALIZED", value_credited: true, triggered_by: parent,
        triggered_on: "finalized", value: 100, from_address: "0xsource", to_address: "0xtarget" };
    },
  } as unknown as import("../../lib/chain").Client;
  await waitForEmittedTransactions(client, parent, "draw");
  assert.equal(rawReads, 1);
});


it("rejects a successful leader when validators did not reach agreement", () => {
  const receipt = { statusName: "FINALIZED", result: 5, consensus_data: {
    leader_receipt: [{ execution_result: "SUCCESS" }],
  } } as unknown as GenLayerTransaction;
  assert.throws(() => assertExecuted("repay", receipt), /did not reach agreeing consensus/);
});
