/**
 * The derivation is pinned, not just checked for self consistency.
 *
 * Every user's GenLayer address comes out of this function, and the registry
 * stores those addresses as a facility's lender and borrower. If a refactor
 * changes the derivation, every existing facility stops recognising its own
 * parties and there is no migration back. The fixtures below are the contract:
 * if they fail, the change is wrong, not the test.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const TEST_SECRET =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** Addresses this derivation has always produced for TEST_SECRET. */
const FIXTURES: Record<string, string> = {
  "did:privy:clv0abc123": "0x42ef22674B51707072e33e17C0d49110430a7D05",
  "did:privy:clv0xyz789": "0x6899065D517B18E4a56bDe4a343490D7747f7342",
  "did:privy:aaaaaaaaaaaaaaaaaaaaaaaa": "0x7f72b7724a5Ff17975B50abFe6e6C33378FBC55E",
};

type Signer = typeof import("../../lib/signer");
let signer: Signer;

before(async () => {
  process.env.SIGNER_MASTER_SECRET = TEST_SECRET;
  signer = await import("../../lib/signer");
});

describe("deriveAccount", () => {
  it("produces the pinned address for each known DID", () => {
    for (const [did, expected] of Object.entries(FIXTURES)) {
      assert.equal(signer.deriveAccount(did).address, expected, `DID ${did}`);
    }
  });

  it("is deterministic across calls", () => {
    const first = signer.deriveAccount("did:privy:repeat");
    const second = signer.deriveAccount("did:privy:repeat");
    assert.equal(first.address, second.address);
    assert.equal(first.privateKey, second.privateKey);
  });

  it("gives different users different addresses", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(signer.deriveAccount(`did:privy:user${i}`).address);
    }
    assert.equal(seen.size, 50, "derived addresses collided");
  });

  it("produces a well formed key and address", () => {
    const { address, privateKey } = signer.deriveAccount("did:privy:shape");
    assert.match(address, /^0x[0-9a-fA-F]{40}$/);
    assert.match(privateKey, /^0x[0-9a-f]{64}$/);
    // In range for secp256k1.
    const scalar = BigInt(privateKey);
    assert.ok(scalar > 0n);
    assert.ok(
      scalar <
        BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
    );
  });

  it("refuses an empty DID rather than deriving a shared address", () => {
    assert.throws(() => signer.deriveAccount(""), /without a Privy DID/);
  });

  it("depends on the master secret", async () => {
    const before = signer.deriveAccount("did:privy:rotate").address;
    process.env.SIGNER_MASTER_SECRET = TEST_SECRET.replace(/ff$/, "fe");
    // The module caches nothing, so the next call reads the new secret.
    const after = signer.deriveAccount("did:privy:rotate").address;
    process.env.SIGNER_MASTER_SECRET = TEST_SECRET;
    assert.notEqual(before, after);
  });

  it("rejects a master secret that is too short", () => {
    process.env.SIGNER_MASTER_SECRET = "tooshort";
    assert.throws(() => signer.deriveAccount("did:privy:x"), /too short/);
    process.env.SIGNER_MASTER_SECRET = TEST_SECRET;
  });

  it("explains itself when the master secret is missing", () => {
    delete process.env.SIGNER_MASTER_SECRET;
    assert.throws(() => signer.deriveAccount("did:privy:x"), /SIGNER_MASTER_SECRET is not set/);
    process.env.SIGNER_MASTER_SECRET = TEST_SECRET;
  });
});
