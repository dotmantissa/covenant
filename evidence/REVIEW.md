# Audited deployment and lifecycle evidence

The revised registry, monitor and vault were deployed on Studionet on 2026-10-11. All three contract sources were fetched independently from the chain and SHA256-matched to the repository. All six wiring pointers were checked and every authority is sealed.

Current addresses, source digests and finalized deployment receipts are in [studionet-review.json](studionet-review.json). The new economic and appeal lifecycle is being completed against this stack; its final verified outcomes will replace this progress note.

The earlier deployment's complete financial proof remains preserved separately as [previous review](REVIEW-v1.md) and [previous receipts](studionet-review-v1.json). It is not evidence for the new source.

Local validation: 138 adversarial Direct Mode tests, 48 Node checks and six Chromium component lifecycle tests passed. The browser tests use the actual application components with mocked Privy/API transport boundaries; live native settlement is proved separately by the new Studionet receipts.
