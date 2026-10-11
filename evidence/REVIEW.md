# Audit remediation and verified deployment

Verified on 2026-10-11 against Studionet, chain ID 61999. Main facility: `review-1791714315`. Production: [covenant-facilities.vercel.app](https://covenant-facilities.vercel.app/).

The corrected stack completed native capital, interest, surplus repayment and bonded appeal settlement in NORMAL consensus mode, without mocks, leader-only execution or manipulated network clocks. The lender recovered all committed capital and earned interest. Vault and monitor native balances, outstanding principal, commitments, accrued and collected interest are zero for the financial lifecycle. The prior stack was independently verified empty before migration; [previous evidence](REVIEW-v1.md) remains archived and is not presented as proof of the new source.

## All audit findings and implemented changes

| Audit finding | Implemented correction | Regression evidence |
| --- | --- | --- |
| Consensus output and evidence | Validators independently bind canonical figures, unit, dates, approved citation, artifact identity and fetched-text SHA256. Exact normalized values replace tolerances. Stored prose narratives are derived deterministically; no unbound leader text becomes precedent or drives money. | [Source/tests](../tests/direct/test_consensus_bound_evidence.py) |
| Filing boundaries and stale reports | Filing dates are normalized to UTC calendar dates. Every panel binds the same latest calendar quarter whose inclusive filing deadline has expired. A stale quarter cannot satisfy a newer obligation. | [Source/tests](../tests/direct/test_consensus_bound_evidence.py) |
| Temporal accounting and asynchronous delivery | Complete revisioned event histories preserve effective stepped-rate intervals through reordered delivery; fractional carry prevents repeated truncation. Capital operations fail closed pending monitor revision acknowledgement. Retry of the current snapshot repairs a dropped vault-to-registry child. | [Source/tests](../tests/direct/test_async_accounting.py) |
| Remedy isolation and successful appeals | Each covenant owns its restriction. Aggregation retains all other restrictions. Rate-only remedies preserve borrowing; acceleration remains appealable after an ordinary clean retest. Successful appeals clear the disputed acceleration and restore rights while preserving debt. | [Source/tests](../tests/direct/test_adversarial_remedies.py) |
| Borrower consent and enforcement authority | Only the borrower approves the SHA256 digest of exact immutable facility/covenant/deployment terms. An inactive lender draft cannot enforce. All three authorities are sealed before facilities; the deployer cannot rewire active agreements. | [Source/tests](../tests/direct/test_consent_and_schedule.py) |
| Scheduling and recovery | The monitor enforces cadence. Due selection includes recovery from breach, earlier cure expiry and open appeals. Production jobs authenticate, lock overlap, resume saved work, rotate due selection and perform one bounded operation per pass. | [Source/tests](../.github/workflows/covenant-scheduler.yml) |
| Exact money and signed inputs | UI decimal strings convert directly to 18-decimal integers; no floating-point conversion changes capital, treasury floors, repayments or bonds. Backend input rejects invalid/overflowing amounts. Display retains exact 18 places. | [Source/tests](../tests/node/amounts.test.ts) |
| Deployment-scoped terms and cache | A namespace derived from network and all three addresses isolates financial tables between deployments. Fresh authoritative terms, policy and digest populate approval; database bootstrap is atomic. | [Source/tests](../lib/deployment.ts) |
| Durable submission and settlement | Actor-owned idempotent intents save signed bytes before broadcast. Recovery replays identical bytes and polls the original transaction. Confirmation requires agreeing successful IC receipts, credited native transfers and the entire finalized descendant tree, then authoritative refresh. Large trees checkpoint across invocations. | [Source/tests](../tests/node/transactions.test.ts) |
| Complete browser appeal lifecycle | Reload finds the stored appeal, polls it, refreshes the ruling from chain and leaves the appealed state only after confirmed settlement. Restored Draw controls and visible failed-settlement/repair controls are tested using actual rendered components. | [Source/tests](../tests/browser/facility.spec.ts) |
| Alert isolation | Alert visibility and dismissal bind the authenticated party and facility; read receipts belong to recipients. Cross-user dismissal fails and mark-all affects only that user. Test notifications are idempotent. | [Source/tests](../tests/node/backend-authorization.test.ts) |
| Immutable evidence, explorer receipts and votes | The full paged on-chain history is append-only. Receipt enrichment separately fetches the full SDK receipt, proves agreeing finalized execution and exactly matches its return against the immutable finding, including appeal bond recipient/outcome. Actual Studio bare summary bytes are never mistaken for consensus status. | [Source/tests](../tests/node/evidence-proof.test.ts) |
| Financial metric domains and treasury authentication | Invalid signs, zero denominators, future or stale financial evidence fail closed. Two fixed Ethereum HTTPS operators independently agree on mainnet finalized block identity and canonical EIP-1898 balance; validators refetch independently. Caller responses alone never authenticate funds. | [Source/tests](../tests/direct/test_adversarial_remedies.py) |
| Usable accounts and honest custody | Email accounts display the owned address and exact balance, request recipient-bound test funds and select registered borrower emails. Ambiguous faucet attempts retain their lease. Master-secret changes fail closed without replacing addresses. UI/docs disclose server custody and periodic monitoring. | [Source/tests](../tests/browser/facility.spec.ts) |

## Actual economic and appeal results

| Check | Observed finalized result |
| --- | --- |
| Initial commitment and draw | 100 GEN committed; borrower credited exactly 100 GEN. |
| Initial 110 GEN repayment | 100 GEN principal, 0.000193429731100963 GEN interest, 9.999806570268899037 GEN refunded to the actual payer. |
| Lender interest withdrawal | Credited exactly 0.000193429731100963 GEN; 100 GEN capital retained. Unauthorized/repeated withdrawals reverted. |
| Covenant isolation | Prose breach accelerated 10 GEN debt. A separate independently authenticated compliant treasury test left acceleration and the draw freeze active; draw attempt reverted. |
| Successful appeal | Correction overturned the breach; borrower credited exactly 1 GEN bond; registry active, acceleration and draw freeze cleared, 10 GEN debt preserved. Repeated resolution reverted. |
| Restored borrowing | A further 1 GEN draw settled, leaving 11 GEN outstanding. |
| Final 12 GEN repayment | 11 GEN principal, 0.000383339675291731 GEN interest, 0.999616660324708269 GEN refunded to the actual payer. |
| Complete lender recovery | Final interest credited exactly 0.000383339675291731 GEN, then 100 GEN capital credited. Final liabilities and contract balances zero. |

The main appeal transaction [appeal/resolve](https://explorer-studio.genlayer.com/tx/0x7142c7dfb001728084faad3af385ede79e34ffb603733a7ae06e45a90d9143bd) includes all five verified descendants, including the exact native bond credit. [appeal/restored-draw](https://explorer-studio.genlayer.com/tx/0x5782cb5606d238519ecbdb0b4422ecfa0ddeb445f18c2a60957fdfe47421130e) proves restored rights through an actual transfer. [economic/repay](https://explorer-studio.genlayer.com/tx/0x79a7687da472ed05ba756dcf91066b98f9eb06eea90dfe22718b64e1e6c4c3bd) and [cleanup/repay](https://explorer-studio.genlayer.com/tx/0xe64d904112f35b9801d7fab9086b791547d5e91cf33097fc8c65d2729f3fae47) prove interest-first accounting and exact refunds.

## Public correction used for the appeal

The controlled source initially alleged an additional simulated senior loan. Its later correction states that it was never executed, preserving the real vault debt. This fixture does not make claims about real borrowers.

- [Initial disclosure](https://github.com/dotmantissa/covenant/blob/a5e2a23517150bddd1ea19e3d4e65e99ea3e518e/evidence/audit-appeal-source.md), file SHA256 `9d78eed96a63b399bf8010adc69bca4fa72d693df7124595c2422d4f74943def`.
- [Correction disclosure](https://github.com/dotmantissa/covenant/blob/8fe1afeba4dc505aacca8bee9b2390c22afda390/evidence/audit-appeal-source.md), file SHA256 `618b6a6facf53b6e4240187f6229d6b52d0dd7c9aef149c5c46ccdb5a05df03c`.

The correction was published only after the breach, separate compliant treasury, rejected draw and appeal bond credit were independently verified. The exact approved public URL was fetched and byte-matched before resolution. In general, contract `content_hash` binds the fetched rendered text used by validators, up to 24,000 characters; it does not claim a digest of every byte of an original PDF.

## Matching deployed source and sealed authorities

| Contract | Address | Verified source SHA256 |
| --- | --- | --- |
| facilityRegistry | [0x4f3CE228C0f497d87c9704a7bC0e19dcBA83752A](https://explorer-studio.genlayer.com/address/0x4f3CE228C0f497d87c9704a7bC0e19dcBA83752A) | `b6a72f0d37651c1d3dfa08a349412f259913c53596be710cc6de8d7a711dc95d` |
| covenantMonitor | [0xF2e101942009Da72eAC90b3a2a89B147ecC3E8E0](https://explorer-studio.genlayer.com/address/0xF2e101942009Da72eAC90b3a2a89B147ecC3E8E0) | `ed7fda06fb8ecfabbb247fa6bc09e37cfcfff2426dd48733bff08c046dfec3d4` |
| creditVault | [0x75d6f6E7B62fb0DE0A635bBd8bcd5EcC89C7a1da](https://explorer-studio.genlayer.com/address/0x75d6f6E7B62fb0DE0A635bBd8bcd5EcC89C7a1da) | `72bb1d835dfc0283172735ca5262c5b3019e6d372ccaf94bedab72f516ced58f` |

The additional production check also verifies unfunded facilities refresh successfully from the exact nested Studio absence envelope, without swallowing unrelated failures.

The actual `gen_getContractCode` responses were independently SHA256-matched to the exact repository sources. All six peer pointers match and every authority is sealed. The GenVM runner is pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

## Explorer-linked roots

All child hashes, native credit flags, finalized parent links, execution outcomes and actual vote maps are retained in [studionet-review.json](studionet-review.json). The links below use the official explorer `/tx/` route; proof verification used RPC receipts rather than assuming a rendered explorer page means success.

| Operation | Verified outcome | Explorer |
| --- | --- | --- |
| deploy/facilityRegistry | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x6df6619a37bb5d41ca3bb9e43e42fa38680a70bb40874e52a29fbdeffae5387b) |
| deploy/covenantMonitor | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xea7621a8a6e3419c76a5f82a3413338642fef2e088ac14a484625b6813c45f32) |
| deploy/creditVault | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x774b6d4d52ea4dc9502961dd86d8f07c9f85b018c5d115bb7e7c8b1dec33ffd3) |
| wire/facilityRegistry/set_monitor | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x1712e71029a71bd37bb7954e06ab2862839d452202eb67933a8f2c1e0702d67b) |
| wire/facilityRegistry/set_vault | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xd2a8cfd1cf469a56180487b183e0ee5a4bfd9064d6eed9dda007259f66f93d21) |
| wire/covenantMonitor/set_vault | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xb04624ad2ea45e4af174df2b29982610d0d4e8cdfed0f1da1c41a85b06fad7bc) |
| wire/creditVault/set_monitor | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xd8abba456f7c6b05a98db236d76ac33cbaf73222e34767e388be3a424db5fabc) |
| seal/facilityRegistry | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x5024fd9c688f6301066bea84dd132c4412f796d495946fbbb57caab039e99cf1) |
| seal/covenantMonitor | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xeca4b94e70a65dd7f22a9768e5c994182daf11770ad6a505c8a447caa5efeb1b) |
| seal/creditVault | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x6144928c73196b552ea00c3877a0e502dfc8988b594fc4e330cfc07f46702f22) |
| economic/create | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xf910f4e6ab1be7b1194d0833c20fd1bb3ca2208b8015fb98ffa3116bed9f0a8f) |
| economic/commit | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x9450e3ff5967dcc4f0e8f06667ec2ebb5074ab6c8d5760ed3ba385b44e47c448) |
| economic/draw | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xd6965edf29095c4499628104e6d7d58893ed068dd95cb1ef320e35611e04a6ed) |
| economic/repay | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x79a7687da472ed05ba756dcf91066b98f9eb06eea90dfe22718b64e1e6c4c3bd) |
| economic/unauthorized-interest | Expected revert | [Receipt](https://explorer-studio.genlayer.com/tx/0x59b89b1aab7b5f9ec7f736dbab680fbe41b416e1bd380ed0e83459754923453d) |
| economic/withdraw-interest | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x783ee666b56d47bd2dac079cfa42086b73dd0018136d6b7bb02fa677479be4f3) |
| economic/repeat-interest | Expected revert | [Receipt](https://explorer-studio.genlayer.com/tx/0x69c4aa4daa9cd42250ebc4b65d46c8d11794b0434f6b5b2fb3c1269eadf45fcf) |
| appeal/initial-draw | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x46840cd7bbb909734c0de0663893543d3cd5a762116c699ddcfcbf08711f8f28) |
| appeal/draft | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x9217b151e4ee7bb87ce903533f5ea4ab019aa7eea8bfd149379959da0704822a) |
| appeal/unauthorized-test | Expected revert | [Receipt](https://explorer-studio.genlayer.com/tx/0x650f05922be677dd98f388bf53c56b3b9cd38688a185ba0ae07db803113ebad0) |
| appeal/borrower-approve | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xc99b595c3dd2d1c3e37f802e5aeccf3968680dd1aacf1a50773079808e0edf1b) |
| appeal/breach-test | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x8839777a181e90467d74fac743e74643f49e4a5cc67a697f95713d6a1818638d) |
| treasury/draft | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xe7f5ef0812f35f5682e03d99dfe77b035a1039fd35d0a2aa72c84389cf081775) |
| treasury/borrower-approve | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x3056ee2b4f51cb7fc2a1a94cc6aa217b063233fb5b4620e989c46158830ab0d6) |
| treasury/authenticated-test | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x7bfa1c1b36178cf20ed70bd05d2075542cc54824cb6916832d48c6d6ae9f692d) |
| appeal/blocked-draw | Expected revert | [Receipt](https://explorer-studio.genlayer.com/tx/0xbde694d4efe12910f37569c5439e5080890307791f9db1c968972e7a00c87a43) |
| appeal/post-bond | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x94adbbc78317da102aa7cbdb43bef4f14fe56beffa202f1c74a3f0916029f549) |
| appeal/resolve | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x7142c7dfb001728084faad3af385ede79e34ffb603733a7ae06e45a90d9143bd) |
| appeal/repeat-resolution | Expected revert | [Receipt](https://explorer-studio.genlayer.com/tx/0x71acbdd7ac7e6857895c7af5fa048aac9743e2c3a430ba0a0a55036884cb1eea) |
| appeal/restored-draw | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x5782cb5606d238519ecbdb0b4422ecfa0ddeb445f18c2a60957fdfe47421130e) |
| cleanup/repay | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xe64d904112f35b9801d7fab9086b791547d5e91cf33097fc8c65d2729f3fae47) |
| cleanup/interest | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xda67c95300163668373565b49959a6df80554b1e09e0697d9db8e7c20e71c66a) |
| cleanup/capital | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x90f8ec6090711bf787c089f0dd7179b12fd3350b48e0e437884be9b4cb9a4e31) |
| automation/create | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xf9deb26daf1f6247420c9f8232ee0e44cfacc3ed3fa99d7758ec0b11d60e53a6) |
| automation/draft | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0xc1db9f87dcd57fcc84d8d7d5192842a04e3050d606c07bd0f9901ba64015c20e) |
| automation/borrower-approve | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x49f1bbd5300a9db3d1e4d5d514faa6526afa1379a3a419107b0a04f2fbc3e088) |
| automation/scheduled-test | Success | [Receipt](https://explorer-studio.genlayer.com/tx/0x63c34bb2c026595fe1146aaec545ec9c5f07fcab8403e8198b27c014d8de9a34) |

## Validation

- Adversarial Direct Mode: **139 passed**. Independent validator callbacks reject conflicting decision/evidence metadata and monetary inputs; delivery tests cover replay, reordering, loss, pooled capital, consent and accepted-appeal races.
- Backend/Node: **52 passed**, including exact decimal inputs, per-recipient authorization, immutable receipt matching, saved signed-byte recovery, native settlement and durable large-graph checkpoints.
- Actual Chromium components: **6 passed**, covering stored-appeal polling, authoritative ruling refresh, restored rights, failure/repair messaging, exact signing, funding UI and email borrower selection.
- Live integration: **12 checks passed**: the original ten plus immutable appeal-history/sealed-authority and actual hosted scheduler signer/settlement checks.
- Independent receipt refresh: **67 finalized transactions** (58 contract executions and 9 native credits), recorded separately as `checks.receipts_rechecked` and `checks.automation_receipts_rechecked`.
- All three GenVM lints, Ruff on contracts and tests, TypeScript, ESLint, optimized production build and tracked-secret scan passed.

The browser suite stubs Privy/API transport only; it does not claim live email OTP delivery. The financial proof uses real native Studionet credits. Credentials, signed-envelope recovery journals, local reproductions and `TASKS.md` are Git-ignored and excluded from Vercel uploads.

## Production configuration and automation

The requested alias serves the current immutable stack. Both production and preview have matching public addresses and all required authentication, database, signing and cron settings. Existing protected identity/database/master-signing secrets were preserved. Actual Privy verification-key and app-settings requests authenticated those credentials successfully. `/api/deployment` independently verifies chain sources and sealed wiring; `/api/evidence` returns exact matched explorer receipts with actual validator vote maps, and facility refresh reports an overturned appeal and zero terminal financial liabilities.

Production monitoring uses an enabled five-minute GitHub Actions workflow plus the verified Vercel Hobby daily fallback (`17 3 * * *`). Authentication uses the same securely configured secret. The [verified dispatched run](https://github.com/dotmantissa/covenant/actions/runs/38134743233) completed successfully. Public sweep history records pass timestamps; anonymous mutation, transaction listing and account requests return 401. Runs are bounded and locked; scheduled job timing remains best effort.

A separate unfunded facility `automation-review-1791714315` exercised the actual hosted scheduler signer, durable submission and polling. Its [scheduled treasury transaction](https://explorer-studio.genlayer.com/tx/0x63c34bb2c026595fe1146aaec545ec9c5f07fcab8403e8198b27c014d8de9a34) and descendants finalized successfully; both providers independently authenticated the balance, chain test count became one, and no capital moved. The persisted public sweep passes show submission followed by confirmed settlement.

## Explicit operating assumptions

- Treasury authentication trusts two fixed HTTPS operators plus GenLayer consensus; it is not an Ethereum light-client proof. Coordinated compromise of both operators remains an assumption.
- Studio does not support peer `LATEST_FINAL` reads inside GenVM. Authenticated messages emitted from finalized registry/monitor decisions deliver agreement, consent and enforcement; application reads explicitly use latest-final.
- Rates use complete effective-time histories and fractional carry on unsettled accrual. Completed repayment checkpoints are not reopened by later rulings. Appeals restore rights while preserving debt and historical interest; retrospective interest refunds are not claimed.
- Email-derived keys are held by the application server, explicitly disclosed in the UI. Wiring is sealed, but signing custody is not decentralized or user-held.
- Patched runtime WebSocket dependencies remove the identified high-severity runtime issue. The final runtime audit reports zero high/critical advisories and 27 moderate advisories. Five development-only high entries trace to an unpatched glob parser in the lint toolchain; the repository does not claim vulnerability-free dependencies.
- Testnet deployments and these covered adversarial/financial lifecycles are demonstrated. This report does not guarantee Portal acceptance or universal production security.
