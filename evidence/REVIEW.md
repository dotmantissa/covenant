# Reviewer remediation evidence

Verified 2026-10-11 on Studionet, chain ID 61999, facility `review-1791688995`.
The corrected facility completed the economic and bonded appeal lifecycles. The lender recovered all capital and collected interest; the vault and monitor hold no remaining funds or liabilities for this facility.

## Reviewer requests and fixes

| Request | Implemented behavior and proof |
| --- | --- |
| Covenant isolation | Each covenant owns its restriction. Full revisioned snapshots aggregate all remaining restrictions. A compliant treasury test left a separate prose acceleration active: [treasury/authenticated-test](https://explorer-studio.genlayer.com/tx/0xd3318bfa15bc8baec4917a35c4cd8602b3aa886dae6648209883727be33e1c34). |
| Borrower authorization | Every covenant starts as an inactive immutable draft. Only the borrower can approve its exact index and terms. Finalized registry messages deliver consent; missing consent fails closed. [appeal/unauthorized-test](https://explorer-studio.genlayer.com/tx/0x0b1474028f414eeb65182ac7f4f3d0649caf80c70609afe10df2916c863631eb) reverted before [appeal/borrower-approve](https://explorer-studio.genlayer.com/tx/0x1c01ceffa51a63001e8a2d219420c38fbb00e6076da64c7d9a6ce7a7700c2951). |
| Interest and excess repayments | Collected interest is a separate per-facility lender claim. Repayments pay interest, then principal, then refund surplus to the actual payer, including third parties. [economic/repay](https://explorer-studio.genlayer.com/tx/0xbf6a34fe9f0f4cdc571bc6ab0408a3f1125e9a73def32239eb2710ac674ef296) and [economic/withdraw-interest](https://explorer-studio.genlayer.com/tx/0x26d647a23fe28a30db027d6088a60eb1d5d5a0d3d067e1eed2c53d599e95d0d6) verified exact native credits; unauthorized and repeated withdrawals reverted. |
| Appeal remedies | Successful appeals remove only the disputed restriction. Acceleration, draw freeze and rates recompute from remaining covenants, preserving principal and accrued interest. [appeal/resolve](https://explorer-studio.genlayer.com/tx/0x4dc74d3b28e85eca8abd3269d7cb8c1d8cbf2ad9969fff7869f2b87060e50a6c) refunded the bond and restored rights; [appeal/restored-draw](https://explorer-studio.genlayer.com/tx/0x7e07a775d154ca5c3d2313090cf60c5a89afcc2dfd2aa26ecd4eb09848cb4cb6) exercised those rights. |
| Treasury authentication | Fixed PublicNode and dRPC operators independently agree on chain 1, the current finalized block number/hash and an EIP-1898 canonical balance. Validators independently refetch both. Arbitrary RPC endpoints, malformed envelopes, stale/forged blocks and disagreements fail closed. Live treasury evidence and citation are recorded in the JSON. |
| Asynchronous settlement | Agreement, consent, findings, appeals and restriction messages emit on finalization. Positive monotonic revisions reject stale/replayed writes; monitor-owned cure clocks survive registry delay. Draws require vault acknowledgement of the latest monitor revision, including accepted clean appeals. Permissionless retries never duplicate bonds. External native transfers replace invalid IC transfers to EOAs. App responses wait for the full message tree and never automatically re-sign ambiguous writes. |
| Adversarial tests and live evidence | 115 Direct Mode tests, including independent validator rejection, reversed/replayed delivery, pooled capital, lost messages, unfinalized consent and accepted-appeal races. 10 live integration tests rechecked all 54 recorded transactions, deployed sources and terminal liabilities. Full receipts and explorer links are in [studionet-review.json](studionet-review.json). |

Contract implementation: [registry](../contracts/facility_registry.py), [monitor](../contracts/covenant_monitor.py), [vault](../contracts/credit_vault.py).
Adversarial cases: [Direct Mode tests](../tests/direct/test_adversarial_remedies.py). App consent and interest withdrawal routes/buttons are implemented, with pending authorization displayed explicitly.

## Actual fund and appeal results

All amounts below are native test GEN except the independently authenticated Ethereum treasury. Interest accrued using real transaction timestamps; the live run used full consensus, without mocks, leader-only mode or time manipulation.

| Check | Observed result |
| --- | --- |
| Initial lender commitment and borrower draw | 100 GEN committed; borrower credited exactly 100 GEN. |
| First repayment | 110 GEN paid: 100 GEN principal, 0.000586631151699644 GEN interest, 9.999413368848300356 GEN returned to payer. |
| First interest withdrawal | Lender credited exactly 0.000586631151699644 GEN; 100 GEN capital preserved. |
| Breach and separate compliance | Prose acceleration retained with 10 GEN principal outstanding after compliant authenticated treasury test. Draw attempt rejected. |
| Successful appeal | Bond refund exactly 1 GEN; registry active; acceleration/freeze cleared; 10 GEN principal and accrued interest preserved. |
| Restored borrowing | Further 1 GEN draw credited; outstanding principal became 11 GEN. |
| Final repayment | 12 GEN paid: 11 GEN principal, 0.000337519025875188 GEN interest, 0.999662480974124812 GEN refunded. |
| Complete lender recovery | Final interest credited exactly; lender credited 100 GEN capital. Vault/monitor balances, drawn principal, commitments and accrued interest all zero. |

The initial prose source intentionally misreported a simulated senior loan. The correction states that it was never executed, while preserving the existing vault debt. This controlled public fixture tests real source retrieval and consensus; it makes no claims about real borrowers.

- [Initial disclosure](https://github.com/dotmantissa/covenant/blob/1a48c3bb32067b8ecf56ab5240e5f7a985a6f3fe/evidence/appeal-source.md), SHA256 `fdabc441cd6d7448019f51365774a18dd5970d03a0df7b06041cf8fd5cc56805`.
- [Correcting disclosure](https://github.com/dotmantissa/covenant/blob/736573aa650c91b45a7aa399cba7c5f8fca2ac5e/evidence/appeal-source.md), SHA256 `9de6a94958d88ccde210400de8e866ed7fe2f469b6e45ad85c7d5e20d6158f02`.
- The correction was published only after breach, compliant treasury isolation, blocked draw and bond settlement completed. Its public contents were verified before resolution.

## Corrected deployment

| Contract | Address |
| --- | --- |
| facilityRegistry | [0x4A9ef4c962c9e8e6c60c9e562f4795B27719e184](https://explorer-studio.genlayer.com/address/0x4A9ef4c962c9e8e6c60c9e562f4795B27719e184) |
| covenantMonitor | [0xCf43f89ea873e856Be28ad373e62022Bf756a91F](https://explorer-studio.genlayer.com/address/0xCf43f89ea873e856Be28ad373e62022Bf756a91F) |
| creditVault | [0xA8b087ff6229ADD096fc72BDFF297480C9ECc984](https://explorer-studio.genlayer.com/address/0xA8b087ff6229ADD096fc72BDFF297480C9ECc984) |

All six wiring pointers were checked. Code fetched directly with `gen_getContractCode` matches repository SHA256 hashes in [deployment manifest](../deploy/addresses.json). Contracts retain the concrete pinned GenVM runner; older immutable deployments retain their old code. The original project vault had zero balance and zero positions before replacement.

## Explorer-linked root transactions

All emitted children and grandchildren are individually linked and verified in the JSON. Contract transactions require both agreeing consensus and VM execution matching the expected outcome. Native SEND children require `FINALIZED`, `value_credited=true`, correct parent/trigger and exact recipient balance deltas; they do not have a VM consensus receipt. Studio leaves their unused consensus result at `NO_MAJORITY`.

| Action | Expected outcome | Transaction |
| --- | --- | --- |
| deploy/facilityRegistry | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x479265c5a3c8a1eee070933e3021e39ae32dae7b6277b9147ce82181ece8b2ef) |
| deploy/covenantMonitor | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x7d05bbfa31d8543720be8a869185dc0989ed5e750f3ee5f1d884661395e0871e) |
| wire/facilityRegistry/set_monitor | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x498c931f17c1b2f9f1dd771df05f228091d4567805e9bd13bb34e89bc714fe48) |
| deploy/creditVault | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xfa1a99706b6c5090b1ca82ba35cee8c8bfe6a53ff86d5377db110add494923dc) |
| wire/facilityRegistry/set_vault | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xd5ae3b6f0d0768e2259032c5187aec9f94ae1290aaeb56d9292c1aca79eaaeff) |
| wire/covenantMonitor/set_vault | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x553f6bb50444f57df03221bafb9011a9d94e9787f07c2ad315b0b3a0d0871322) |
| wire/creditVault/set_monitor | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xbab5424afec3b58c45df7d99f9d5ebc4338b2494ce3f8c97a6473697599c5c24) |
| economic/create | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x463200878786a21b5d7db116419c298709f1f65de98b5f8f37c9b5260d45d43c) |
| economic/commit | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x553b0c366c369160960c0f7d81fa8775950b935ca9f4ed417176ea4efe81d410) |
| economic/draw | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x3db1cef47182fb96834b327434390317339c4598963246a22ce79dac5fb7fef8) |
| economic/repay | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xbf6a34fe9f0f4cdc571bc6ab0408a3f1125e9a73def32239eb2710ac674ef296) |
| economic/unauthorized-interest | Expected revert | [Explorer](https://explorer-studio.genlayer.com/tx/0x0d02c7e04f018cff8f78a9cb764601a8430b970c3968d401b9d7c749d6dd9b51) |
| economic/withdraw-interest | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x26d647a23fe28a30db027d6088a60eb1d5d5a0d3d067e1eed2c53d599e95d0d6) |
| economic/repeat-interest | Expected revert | [Explorer](https://explorer-studio.genlayer.com/tx/0x42bacb31b02c67e0961d50d0f8cab4d42d09aa5ad388cba540c96d92e717e126) |
| appeal/initial-draw | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x871fd5f6a95b4260559f25f60d609d14cfc5a3bd8a05d4b618cd76ea73caad82) |
| appeal/draft | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xa5ed5f646f9e7c84a8aefa70a37e16b999b3039bdb08e79c8a14d69e3208d640) |
| appeal/unauthorized-test | Expected revert | [Explorer](https://explorer-studio.genlayer.com/tx/0x0b1474028f414eeb65182ac7f4f3d0649caf80c70609afe10df2916c863631eb) |
| appeal/borrower-approve | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x1c01ceffa51a63001e8a2d219420c38fbb00e6076da64c7d9a6ce7a7700c2951) |
| appeal/breach-test | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xc30eb71b885cca8abbef544881aaa2228bf840e91577e5c5312be0364ee40d8f) |
| treasury/draft | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x147318156026062ce436a65b92c95824fa2b3d788a1466f31b347c89076abe68) |
| treasury/borrower-approve | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xdcfc79dc072867a3d759099f7f0029ff1e62e41a21cf5c3242eb51cdc7b6e2a9) |
| treasury/authenticated-test | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xd3318bfa15bc8baec4917a35c4cd8602b3aa886dae6648209883727be33e1c34) |
| appeal/blocked-draw | Expected revert | [Explorer](https://explorer-studio.genlayer.com/tx/0x7b8fa3063962c53b18eedf0a9f7c377b89b477c987d084a1e6e6ffc85a6aefa9) |
| appeal/post-bond | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x67c6fc1cb7ad9f47636876c92010b2259edb0dff2daa0a7ba50335b2104b1326) |
| appeal/resolve | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x4dc74d3b28e85eca8abd3269d7cb8c1d8cbf2ad9969fff7869f2b87060e50a6c) |
| appeal/repeat-resolution | Expected revert | [Explorer](https://explorer-studio.genlayer.com/tx/0xe31d9fdf6ef4984714980d7cabf8b971fb5219123a0738d2358e04f9a5359fba) |
| appeal/restored-draw | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x7e07a775d154ca5c3d2313090cf60c5a89afcc2dfd2aa26ecd4eb09848cb4cb6) |
| cleanup/repay | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xf01d409988aebebb780ee0e178a6dfd7e2ad3164e4eeea1cae85cf5f630ab0b2) |
| cleanup/interest | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0xcec0ff46977a90631f17ee858dc40d12cfafd30f226e0c565e4897be72378956) |
| cleanup/capital | Success | [Explorer](https://explorer-studio.genlayer.com/tx/0x8b35bccc1d7305835ece39c693ad5eb4bda4e08c317ae313a76354392255c784) |

## Validation

- `python3 -m pytest tests/direct -q`: **115 passed**.
- `python3 tests/integration/review_lifecycle.py verify`: **45 contract transactions and 9 native transfers independently rechecked**.
- `python3 -m pytest tests/integration -v -s`: **10 passed**.
- `npm run test:node`: **29 passed**; includes failed children, ambiguous submissions, native receipt formats and missing validator agreement.
- `genvm-lint check` on all three contracts; Ruff, TypeScript, ESLint and production build: **passed**.
- App settlement helpers also verified actual Studionet draw and repayment receipts.

The [resumable lifecycle runner](../tests/integration/review_lifecycle.py) persists hashes before waiting. Credentials and the recovery checklist are Git-ignored; the deployed upload excludes them.

## Authentication and runtime boundaries

Treasury verification trusts the two fixed HTTPS operators and GenLayer consensus; it is not an Ethereum light client proof. Coordinated compromise of both operators remains a trust assumption. Caller-supplied responses alone cannot authenticate evidence.

Studio's [storage handler](https://github.com/genlayerlabs/genlayer-studio/blob/c94072951e483510329670aa427fba3fa6944f45/backend/node/genvm/base.py#L635) rejects `LATEST_FINAL` peer reads. Registry-authenticated messages emitted from finalized decisions replace that unsupported operation. Studio's [native transfer handler](https://github.com/genlayerlabs/genlayer-studio/blob/c94072951e483510329670aa427fba3fa6944f45/backend/consensus/base.py#L678) marks credited SENDs separately from IC execution. Live balance checks caught and resolved both runtime assumptions before this final proof.

Explorer browser protection prevented automated page scraping; the links use the official explorer's `/tx/` route and the accompanying RPC receipts were independently rechecked.

## Hosted application verification

The [production app](https://covenant-ten-sable.vercel.app) is running source commit `39a7ec9` on [deployment dpl_EAWQeaD4FR2D7XUGtPT5f6iGySAX](https://covenant-hnsl7gje7-mantissas-projects.vercel.app), verified Ready through Vercel. Production and preview public configuration use the three corrected addresses above; existing private authentication and database configuration is preserved.

Public HTTP checks confirmed the homepage displays every corrected address and links this report. The reviewer facility page/API returns the active facility, two compliant covenants, overturned appeal, zero commitments/principal/accrued interest, and cleared acceleration/draw freeze. Live listings exclude historical deployments while retaining their database records; a legacy facility detail returns 404. Unauthenticated borrower approval and interest withdrawal requests both return 401 without submitting contract writes. Structured results are recorded under `hosting` in the JSON evidence.
