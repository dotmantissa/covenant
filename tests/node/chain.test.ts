/**
 * Unit tests for chain transport helpers.
 *
 * Verifies transaction receipt validation, revert message parsing,
 * and retry logic for transient errors.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertExecuted, ContractRevert, sendWrite, withRetry } from "../../lib/chain";
import type { GenLayerTransaction } from "genlayer-js/types";

describe("assertExecuted", () => {
  it("passes when transaction is FINALIZED with SUCCESS execution result", () => {
    const receipt = {
      status: 7,
      statusName: "FINALIZED",
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
        return { statusName: "FINALIZED", consensus_data: {
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
