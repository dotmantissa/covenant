# Covenant

On-chain credit facilities with natural language covenants evaluated by GenLayer validators on Studionet.

## Overview

In traditional finance, credit agreements contain negative and affirmative covenants: minimum liquidity ratios, leverage caps, filing deadlines, and restrictions on new senior debt. When a covenant is breached, the consequence is spelled out in the credit agreement: an immediate freeze on further draws, a penalty step-up on the interest rate, or full loan acceleration.

Enforcing those agreements in off-chain lending requires trust, auditors, and lawyers.

Covenant moves the agreement and its enforcement on-chain:
1. Loan terms and covenants are registered in an intelligent contract (`FacilityRegistry`).
2. Covenants are written in plain English alongside structured testing parameters.
3. Validators read external financial disclosures or on-chain balances, extract reported figures, run sandboxed arithmetic, and reach consensus on compliance (`CovenantMonitor`).
4. When a breach is confirmed, the monitor emits consequences directly to the vault contract (`CreditVault`), which freezes draws, steps up the borrowing rate, or initiates acceleration under the approved covenant terms. Contract permissions are enforced on chain; the email application uses server custody.

## Contracts Architecture

The protocol separates agreement state, consensus monitoring, and capital custody into three specialized contracts:

### 1. FacilityRegistry (`contracts/facility_registry.py`)
- Stores credit facility terms: lender, borrower, principal, base interest rate, step-up rate, purpose, and governance parameters.
- Maintains the covenant schedule for each facility across four supported kinds:
  - Ratio covenants: debt to equity, current ratio, interest coverage.
  - Filing covenants: 10-Q/10-K filing timeliness relative to quarter end.
  - Treasury covenants: native ETH reserve floors authenticated against fixed PublicNode and dRPC providers on Ethereum mainnet at their current finalized block hash.
  - Prose covenants: qualitative operational promises evaluated by validator consensus.
- Enforces cure windows and tracks appeal bond status.
- Holds indices by party for quick retrieval of facilities where an address is lender or borrower.
- Every covenant is drafted inactive. Only its borrower can call `approve_covenant(facility_id, index)` to accept the immutable text, thresholds, remedies, and sources before testing or enforcement.

### 2. CovenantMonitor (`contracts/covenant_monitor.py`)
- Independent evaluator callable by any party or automated worker on schedule.
- Separates text extraction from numeric verification:
  - An LLM extracts named figures from public web endpoints.
  - Exact ratio math and comparison against threshold basis points run in a deterministic sandbox (`gl.vm.spawn_sandbox`).
  - Validators judge whether extraction accurately reflects the source and whether arithmetic matches.
- Treasury validators independently verify chain identity, current finalized block number/hash, and EIP-1898 balance through both approved operators. Caller-selected endpoints, disagreements, malformed quantities, and stale evidence fail closed.
- Records a complete evidence audit trail for every test: source URL, extracted figures, sandbox calculation, consensus verdict, and timestamp.
- Handles borrower appeals backed by a dispute bond.

### 3. CreditVault (`contracts/credit_vault.py`)
- Holds lender deposits and manages borrower drawdowns, repayments, and accrued interest.
- Authority to enforce consequences belongs exclusively to the wired monitor.
- Covenant-specific restrictions are aggregated from complete versioned snapshots. Reordered or replayed delivery cannot overwrite newer settlement, and a compliant covenant cannot remove another covenant’s restriction.
- Repayments pay interest then principal; excess returns to the original payer. Lenders can call `withdraw_interest` for collected interest separately from undrawn capital.
- Successful appeals remove only the disputed covenant’s restriction, reversing acceleration while preserving other restrictions and outstanding debt.
- Enforces three distinct breach consequences:
  - `draw_stop`: locks the facility against further borrowing while allowing repayment.
  - `rate_step_up`: increases the borrowing rate by the facility step-up basis points.
  - `acceleration`: declares default and demands immediate return of drawn capital.

## Deployed Addresses (Studionet)

The [live application](https://covenant-ten-sable.vercel.app) uses the corrected contracts. See the [reviewer remediation and transaction evidence](evidence/REVIEW.md) for verified economic, appeal and hosted checks.

All three contracts are deployed and wired together on GenLayer Studionet (Chain ID 61999):

- FacilityRegistry: `0x4f3CE228C0f497d87c9704a7bC0e19dcBA83752A`
- CovenantMonitor: `0xF2e101942009Da72eAC90b3a2a89B147ecC3E8E0`
- CreditVault: `0x75d6f6E7B62fb0DE0A635bBd8bcd5EcC89C7a1da`

Wiring verification is confirmed on-chain by reading `get_wiring()` across all three contracts.

## User Experience and Key Derivation

Covenant provides a consumer-grade experience without requiring browser wallet extensions:
- Authentication is email-only, handled via Privy.
- Each user account deterministically maps to a dedicated GenLayer address via HKDF-SHA256 over a server master secret and the unique user identifier.
- Server-side transactions are signed on demand using `genlayer-js`.
- Studionet transaction submission is gasless; commitments, repayments, and appeal bonds still require funded native balances.
- Strict smart contract access control is maintained: facilities distinguish between lender and borrower accounts.

## Local Setup

### Prerequisites
- Node.js 20 or later
- Python 3.12 with `venv`
- PostgreSQL database (e.g. Neon serverless Postgres)

### Installation

1. Clone the repository and install Node.js dependencies:
```bash
npm install
```

2. Set up the Python virtual environment and install GenLayer testing tools:
```bash
python3 -m venv .venv
.venv/bin/pip install genlayer-test==0.29.2 genvm-linter
```

3. Configure environment variables in `.env.local`:
```bash
cp .env.example .env.local
```

Required variables:
- `DATABASE_URL`: Connection string for Neon Postgres
- `NEXT_PUBLIC_PRIVY_APP_ID`: Privy application identifier
- `PRIVY_APP_SECRET`: Privy application secret
- `SIGNER_MASTER_SECRET`: 64-character hex secret for HKDF key derivation
- `NEXT_PUBLIC_STUDIONET_RPC_URL`: `https://studio.genlayer.com/api`
- `NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS`: `0x4f3CE228C0f497d87c9704a7bC0e19dcBA83752A`
- `NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS`: `0xF2e101942009Da72eAC90b3a2a89B147ecC3E8E0`
- `NEXT_PUBLIC_CREDIT_VAULT_ADDRESS`: `0x75d6f6E7B62fb0DE0A635bBd8bcd5EcC89C7a1da`

4. Push the schema to Postgres:
```bash
npm run db:push
npm run db:verify
```

### Running the Application

Start the Next.js development server:
```bash
npm run dev
```

The web interface will be available at `http://localhost:3000`.

To run the covenant evaluation scheduler worker:
```bash
npm run sweep
```

The worker queries due covenants across all registered facilities, triggers on-chain tests through validator consensus, and records evidence rows in the database.

## Test Suites

The codebase includes comprehensive test suites across contracts, direct execution, integration testing, and backend routes:

### 1. Direct Mode Contract Tests
Tests business logic, math sandboxing, edge cases, and cross-contract interactions:
```bash
pytest tests/direct -v
```

### 2. Live Studionet Integration Tests
Tests contract reads and state transactions via consensus on Studionet:
```bash
npm run test:integration
```

### 3. Node and API Unit Tests
Tests key derivation, chain transport, and API error handling:
```bash
npm run test:node
```

### 4. Contract Static Analysis and Lint
Validates SDK compliance and deterministic execution rules:
```bash
for f in contracts/*.py; do .venv/bin/genvm-lint check "$f"; done
ruff check contracts/ tests/
```

### 5. Production Application Build
Verifies TypeScript compilation, ESLint rules, and static page generation:
```bash
npm run lint
npm run typecheck
npm run build
```

## Reviewer remediation and reproducible evidence

The corrected contracts use finalized messages for enforcement, registry updates,
bond payouts, drawdowns, surplus refunds and withdrawals. Account payouts use
the external native transfer interface; IC emit_transfer cannot deliver to EOAs. Each receiving contract
rejects stale revisions. Agreement terms and exact borrower consent arrive through authenticated registry messages emitted on finalization; no decision relies on an unfinalized registry read. Draws also require acknowledgement of the monitor’s latest revision, so an accepted clean appeal cannot grant rights before its finalized settlement. The monitor owns the cure clock and restrictions, avoiding
a dependency on asynchronously updated registry records. The application waits for
the emitted transaction tree to finalize before reporting settlement. IC receipts must report VM SUCCESS and agreeing consensus; native SEND receipts must confirm credited funds and their finalized parent linkage.
If a child write fails, anyone can call `CovenantMonitor.sync_enforcement(facility_id)`;
it retries the latest snapshot without paying a bond twice. Registry `sync_agreement(facility_id)` similarly retries immutable agreement and authorized covenant delivery without resetting cure clocks or admitting drafts.

The root `TASKS.md` is a local, Git-ignored recovery checklist. Validation commands:

```bash
python3 -m pytest tests/direct -q
for contract in contracts/*.py; do genvm-lint check "$contract"; done
ruff check contracts tests
npm run typecheck
npm run test:node
npm run lint
npm run build
```

The live lifecycle runner records each submitted transaction before waiting and
resumes it by hash after interruption. It checks full consensus execution, child
transactions, native balance deltas, interest withdrawal, surplus recovery,
acceleration with outstanding principal, borrower consent, appeal bond refund,
restored draw rights, and final lender recovery. It uses Studionet's test faucet
for native value; gasless transaction submission alone does not fund repayments.

```bash
# REVIEW_KEY_FILE names a secure ignored file containing
# GENLAYER_DEPLOYER_PRIVATE_KEY and REVIEW_BORROWER_PRIVATE_KEY.
python3 tests/integration/review_lifecycle.py deploy
python3 tests/integration/review_lifecycle.py economics
python3 tests/integration/review_lifecycle.py breach
# Publish the correcting disclosure, then independently retest under appeal:
python3 tests/integration/review_lifecycle.py resolve
python3 tests/integration/review_lifecycle.py verify
python3 -m pytest tests/integration -v -s
```

See [review evidence](evidence/REVIEW.md) and
[public transaction receipts](evidence/studionet-review.json). The disclosed debt
and correction are explicitly controlled test evidence, with Git history showing
the source used for each consensus decision.

`npm run deploy:contracts -- --fresh` deploys a fresh stack. Otherwise the deployer
requires stored source hashes to match and refuses to silently reuse outdated
code. Update hosting environment addresses from `deploy/addresses.json` after
redeployment. Older immutable deployments retain their original code and addresses.


## Deployment and operating boundaries

Borrowers approve the SHA256 digest of the full immutable covenant and facility terms. Displayed terms are refreshed from the deployment-scoped cache, including approved sources, 120-day ratio evidence freshness and the calendar-quarter filing schedule. Filing tests require the latest quarter whose inclusive deadline has expired; an older report cannot satisfy a newer obligation. Consensus binds exact figures, dates, approved-source identity and the SHA256 of the fetched text used by the panel (up to 24,000 characters), rather than claiming a hash of an entire original PDF. Prose findings store deterministic narratives rather than unbound leader explanations.

Rates accrue by effective test timestamps using the complete finalized enforcement event history. Reordered delivery cannot erase a stepped-rate interval. Completed repayment checkpoints are not reopened by rulings that arrive later; new rate history recalculates unsettled accrual on the remaining principal. A successful appeal clears the incorrectly imposed acceleration and restores draws while preserving debt; past interest is accounted for under the approved historical rates, not refunded retrospectively. A rate-only remedy preserves borrowing rights. Wiring is explicitly sealed before production facilities are created; the initial deployer cannot later replace enforcement authorities.

Every write is journaled before broadcast. A reconnect polls its saved transaction and all descendants, then refreshes finalized facility state. An ambiguous transport error does not permit automatic replacement signing. A root revert permits a fresh request; failed descendant settlement retains its original receipt and can repair enforcement delivery by replaying the current snapshot. Historical findings are immutable, with separately stored receipts whose decoded output must exactly match the original finding, including an appeal's bond recipient. Receipt/vote enrichment can lag indexing and is labelled pending.

Sign in with email, open **Account**, and request 100 test GEN on Studionet before committing funds, repaying or posting a bond. Submission is gasless; native transfers require balances. Borrowers sign in once to register an account, then lenders can select that borrower by email. Each account has its own DID-derived address. These keys remain controlled by the application server. Preserve `SIGNER_MASTER_SECRET` securely: an accidental change fails closed instead of overwriting registered addresses; restore the original secret to recover access. This is a test-token demonstration, not user-held production custody.

Production monitoring uses `.github/workflows/covenant-scheduler.yml` every five minutes, plus a daily Vercel Hobby fallback. Configure the same private random secret as production `CRON_SECRET` and repository Actions secret `COVENANT_CRON_SECRET`, then set repository variable `COVENANT_MONITORING_ENABLED=true`. GitHub scheduled jobs can be delayed; cadence is best effort. The endpoint rejects unauthenticated invocation, locks concurrent runs, and processes one saved settlement or due covenant per run. Open appeals and expired cure windows remain scheduled, and due-selection rotates to prevent a permanently unavailable source starving other facilities. `/api/sweep` publishes pass timestamps, pending/confirmed/failure details. Facility pages label cached refresh time; failed chain refresh is explicitly shown.

`npm run test:browser` renders the actual facility/account components in Chromium, stubbing only the Privy and API transport boundaries. It proves saved-transaction appeal polling, authoritative ruling refresh, restored draw controls, visible settlement failures, exact 0.29 GEN signing and account funding refresh. It does not claim live Privy OTP delivery. Direct tests exercise adversarial validators and reordered messages; Studionet explorer receipts separately prove real consensus and native settlement.

Runtime websocket8.x dependencies are pinned to patched8.22.0 without forcing the7.x consumers to a new major version. The final runtime dependency audit has no high or critical advisories;27 moderate transitive advisories remain. Five high development-only audit entries trace to the unpatched braces3.x glob parser in the lint toolchain, which receives repository-controlled patterns. This does not assert that dependencies are free of vulnerabilities.
