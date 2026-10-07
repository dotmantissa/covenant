# Covenant

On-chain credit facilities with natural language covenants evaluated by GenLayer validators on Studionet.

## Overview

In traditional finance, credit agreements contain negative and affirmative covenants: minimum liquidity ratios, leverage caps, filing deadlines, and restrictions on new senior debt. When a covenant is breached, the consequence is spelled out in the credit agreement: an immediate freeze on further draws, a penalty step-up on the interest rate, or full loan acceleration.

Enforcing those agreements in off-chain lending requires trust, auditors, and lawyers.

Covenant moves the agreement and its enforcement on-chain:
1. Loan terms and covenants are registered in an intelligent contract (`FacilityRegistry`).
2. Covenants are written in plain English alongside structured testing parameters.
3. Validators read external financial disclosures or on-chain balances, extract reported figures, run sandboxed arithmetic, and reach consensus on compliance (`CovenantMonitor`).
4. When a breach is confirmed, the monitor emits consequences directly to the vault contract (`CreditVault`), which freezes draws, steps up the borrowing rate, or initiates acceleration trustlessly.

## Contracts Architecture

The protocol separates agreement state, consensus monitoring, and capital custody into three specialized contracts:

### 1. FacilityRegistry (`contracts/facility_registry.py`)
- Stores credit facility terms: lender, borrower, principal, base interest rate, step-up rate, purpose, and governance parameters.
- Maintains the covenant schedule for each facility across four supported kinds:
  - Ratio covenants: debt to equity, current ratio, interest coverage.
  - Filing covenants: 10-Q/10-K filing timeliness relative to quarter end.
  - Treasury covenants: on-chain reserve floors checked via RPC.
  - Prose covenants: qualitative operational promises evaluated by validator consensus.
- Enforces cure windows and tracks appeal bond status.
- Holds indices by party for quick retrieval of facilities where an address is lender or borrower.

### 2. CovenantMonitor (`contracts/covenant_monitor.py`)
- Independent evaluator callable by any party or automated worker on schedule.
- Separates text extraction from numeric verification:
  - An LLM extracts named figures from public web endpoints.
  - Exact ratio math and comparison against threshold basis points run in a deterministic sandbox (`gl.vm.spawn_sandbox`).
  - Validators judge whether extraction accurately reflects the source and whether arithmetic matches.
- Treasury covenants execute on-chain balance checks with strict equality.
- Records a complete evidence audit trail for every test: source URL, extracted figures, sandbox calculation, consensus verdict, and timestamp.
- Handles borrower appeals backed by a dispute bond.

### 3. CreditVault (`contracts/credit_vault.py`)
- Holds lender deposits and manages borrower drawdowns, repayments, and accrued interest.
- Authority to enforce consequences belongs exclusively to the wired monitor.
- Enforces three distinct breach consequences:
  - `draw_stop`: locks the facility against further borrowing while allowing repayment.
  - `rate_step_up`: increases the borrowing rate by the facility step-up basis points.
  - `acceleration`: declares default and demands immediate return of drawn capital.

## Deployed Addresses (Studionet)

All three contracts are deployed and wired together on GenLayer Studionet (Chain ID 61999):

- FacilityRegistry: `0x535b9510E7946D1106D27766359a136847eB6eFc`
- CovenantMonitor: `0x4273F7e4CFF3B1cd6069F7ED5f4cb7493889E9aE`
- CreditVault: `0x80Aa7EfAec29239d38a318293339473FbD2B0855`

Wiring verification is confirmed on-chain by reading `get_wiring()` across all three contracts.

## User Experience and Key Derivation

Covenant provides a consumer-grade experience without requiring browser wallet extensions:
- Authentication is email-only, handled via Privy.
- Each user account deterministically maps to a dedicated GenLayer address via HKDF-SHA256 over a server master secret and the unique user identifier.
- Server-side transactions are signed on demand using `genlayer-js`.
- Studionet transactions are gasless, so user accounts require no faucet funding.
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
- `NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS`: `0x535b9510E7946D1106D27766359a136847eB6eFc`
- `NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS`: `0x4273F7e4CFF3B1cd6069F7ED5f4cb7493889E9aE`
- `NEXT_PUBLIC_CREDIT_VAULT_ADDRESS`: `0x80Aa7EfAec29239d38a318293339473FbD2B0855`

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
.venv/bin/pytest tests/direct -v
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
