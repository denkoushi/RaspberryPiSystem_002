# Hermes knowledge: Markdown, photographs, PDFs and reports

## Purpose / Big Picture

Workers freely send notes, photographs and PDFs through Hermes. The system asks natural-language choices only when purpose/topic is ambiguous, preserves originals, organizes knowledge in the background, and answers questions with source text and images. A fixed report template provides readable headings, descriptions, photographs and provenance.

The initial topic is 金属塗装の実技準備. The user authorized implementation on 2026-09-15, subsequently selected Git + Markdown instead of Wiki.js, approved a fixed HTML report template, and added PDF intake. These later decisions supersede the initial Wiki design. The user subsequently authorized proceeding through production deployment. Scope is the standard Pi5 API/Web rolling release; kiosk agents and the DGX Control Plane are unchanged.

## Progress

- [x] Audited existing resources and created the task worktree at main SHA `ee42f462f124c374a1d1e618a05970664007359b`.
- [x] Verified Wiki.js API in disposable containers before the user changed storage direction; removed the unused Wiki implementation and credentials. No Wiki service is required.
- [x] Implemented source validation, organization boundary and deterministic Markdown/report projection.
- [x] Implemented dedicated bare Git publication with compare-and-swap, replay and historical reads.
- [x] Implemented immutable original/display image intake using the existing durable-file-store port.
- [x] Implemented bounded PDF page extraction, OCR fallback, original retention and per-page citations.
- [x] Implemented a fixed React report view/dialog using ProtectedImage and existing Dialog.
- [x] Focused Git, PDF, source validation and UI tests, plus actual Poppler conversion of a synthetic PDF.
- [x] Persist intake/choice/job state and asset ownership in PostgreSQL; authenticate all intake/read/media routes.
- [x] Connect free input and attachment controls to Hermes, infer intent/topic, validate choice ID/version and resume after disconnect.
- [x] Compose a durable worker with existing DGX admission and cancellation, and publish only fully prepared source sets.
- [x] Connect authorized search/question answering to original-source adapters without certifying AI-generated summaries as originals.
- [x] Connect report responses and authenticated media resolution to the Hermes UI.
- [ ] Complete hosted CI on the exact release SHA, then deploy Pi5 through the standard runner and confirm health. Real OCR/DGX response quality remains a pilot acceptance check.

## Current Deliverable Boundary

The pilot now includes authenticated API intake, durable PostgreSQL job/choice state, the lease-fenced worker, existing DGX inference adapters, Hermes attachment/choice controls, and authenticated image/PDF responses. The fixed React report is connected to persisted results. Capability probing keeps the existing Hermes path available when disabled. Pi5 enables the feature through inventory, the existing environment templates and the rollback-backed consultation candidate environment update.

Synthetic checks demonstrate the local loop with real PostgreSQL and Git and injected inference. Hosted CI, deployed runtime health and real-source OCR/inference quality are separate evidence; do not report them as complete until verified.

## Existing Responsibilities

`apps/web/src/components/hermes/HermesFloatingChat.tsx` and `apps/api/src/services/assembly/business-hermes-consultation.service.ts` approach 1,000 lines and already own consultation state. Their display-string choice identity and speculative prefetch must not become the registration path. Add a focused knowledge intake module and only small composition changes there.

`services/hermes-answer-cache` already uses GPTCache, FAISS and SQLite FTS for source candidates. Exact-source facts certify existing source kinds, not generated knowledge. QMD remains an independent trial. Do not install another retrieval framework or replace those paths as part of this pilot.

`services/file-storage` owns durable bytes and integrity. The new `KnowledgeAssetStore` delegates to it under `knowledge-assets`. `services/ocr/ports/image-ocr.port.ts` supplies reusable OCR. Existing production API images already install Poppler. Kiosk PDF adapters swallow extraction failures and discard page-level provenance, so the new bounded adapter invokes the same tools without importing kiosk business rules.

## Architecture and Decisions

Source validation and rendering are pure. Organizer/photo-describer ports isolate inference; image/PDF adapters isolate byte conversion; the Git adapter alone runs Git; the report component receives trusted structured fields and resolves image IDs through an injected authenticated URL resolver. Dependency direction is from application operations toward ports, with concrete adapters implementing the ports.

The knowledge Git repository is a **separate bare data repository**, never the application's source checkout. It has no working tree, shared index or remote operations. Publication stores `knowledge.md` and `report.json` together in one commit, then atomically updates `refs/heads/knowledge` against an expected parent. A stale writer cannot overwrite a newer revision. A retry of identical content returns the existing revision. Historical reads verify ancestry. Initialization refuses a nonempty unrelated directory.

The repository uses format marker `hermesKnowledge.formatVersion=1`, SHA-1 Git object format, local service identity and disabled hooks/signing/global Git configuration. Test commits occur only in disposable data repositories. Source-code commits and release operations follow the separately authorized standard Git workflow.

Markdown uses `knowledge-image:<SHA256>` image references. An ordinary Markdown viewer will not resolve them automatically; the application must resolve authorized assets. Photographs/PDF bytes never enter Git. Originals are immutable; derived JPEGs are separate content-addressed files. Report JSON is a versioned projection for a fixed HTML layout, not arbitrary model-generated HTML.

PDF intake keeps the original, extracts embedded text per page, renders each page to JPEG, and invokes existing image OCR when a page has no embedded text. Empty OCR results are explicitly `unreadable` and retain the page image. OCR errors and malformed PDFs propagate as failures rather than empty successful imports. PDF provenance retains document hash, filename, page number and extraction method. PDF image regions are initially represented by whole-page images; separate figure extraction is not included.

Pilot limits are 20 sources per report, four photos per note, 10 MB per image, 20 MB and 20 pages per PDF. Each PDF page becomes a source, so a single 20-page PDF fills the current report limit. Limits reject oversized input rather than silently truncate. Attachment controls display the limits before upload; expanding topic/source batching is outside this pilot. Encrypted PDFs are rejected.

The organizer validates JSON, exact quotation substrings and photo IDs. This prevents fabricated citations, but does not establish the correctness of an AI summary. Reports label AI organization and expose raw source text/page images. A failed publication must leave the last accepted report usable.

## Integrated Workflow and Operations

PostgreSQL stores the original submission and content hashes before bytes are accepted. Actor/conversation-scoped choices use stable action IDs and expected versions; an increasing database sequence invalidates old choices even when timestamps tie. HTTP retries reuse the intake UUID. Published knowledge is shared with authenticated application users/devices; pending inputs are owner-scoped. User JWT authentication takes precedence over shared device keys.

The worker leases the pilot topic, checkpoints extracted sources and organized pages, retries deferred inference without exhausting attempts, and recovers expired work. The scheduler leader alone starts it; candidate validation does not mutate knowledge. Git publication is atomic and the fenced database revision is updated only after a complete document exists. Original files and historical Git objects are not garbage-collected by this feature.

Foreground intent/answer requests use existing runtime preparation. Background text and image organization use the existing `dgx-background-preparation` alias and defer on admission refusal. No new DGX profile, principal, token or orchestrator is introduced. Attachment-only input asks for purpose without starting inference.

For the 20-source pilot, question answering selects from bounded original excerpts and summaries and validates returned source IDs. It does not add generated knowledge to GPTCache/FAISS or certify it as an existing business source. Unrelated input delegates to the existing Hermes consultation and its existing search. Larger indexed retrieval is a later, separately scoped extension.

The additive migration creates KnowledgeIntake and KnowledgeTopic; rollback to the previous API image leaves these unused tables and durable assets intact. Two persistent storage-contract entries mount `knowledge-assets` and `knowledge-git` for both active/candidate slots. The runtime image retains Git and existing Poppler. No host checkout is used for knowledge writes.

Disaster recovery must retain PostgreSQL plus both new storage directories and the existing file-integrity catalog. Existing photo-only backups do not cover these directories automatically. The backup recommendation catalog exposes both new directories through the existing operator workflow; verify their enabled backup targets before relying on production records as the sole copy. For a consistent recovery point, stop knowledge intake/worker before the existing database/directory backups, restore that set together, then resume. Ordinary release rollback preserves data and does not require restoring these backups.

## Validation and Evidence

Run from this task worktree. Dependencies were installed offline with the lockfile unchanged. The risk budget is 45 minutes for local validation; focused commands are normally seconds. Do not rerun successful suites without a relevant change.

- `pnpm --filter @raspi-system/shared-types build`: passed.
- API focused suites: Git (6), source projection (6), organization (4), image/PDF intake (5), Poppler command boundary (5): passed after local fixes. Additional tests were run individually instead of repeating already-passing suites. Existing file-storage configuration tests (5) passed.
- Real Poppler test: `KNOWLEDGE_REAL_PDF_TEST=1 pnpm exec vitest run src/services/knowledge/__tests__/poppler-pdf-pages.local.test.ts` from `apps/api`: passed (1). Requires `pdfinfo`, `pdftotext`, `pdftoppm` on PATH.
- The real test ran against disposable Alpine 3.22 / Poppler 25.04.0, with synthetic embedded text and a page without text. It verified text, JPEG decoding, page count and 1600-pixel bounds. It did not test real OCR accuracy or DGX inference. Host wrappers and container were test-only.
- Web report test: `pnpm exec vitest run src/features/hermes-knowledge/KnowledgeReportView.test.tsx` from `apps/web`: passed (2), covering citations, images, unreadable-page notice and HTML escaping.
- API new-module TypeScript check and ESLint: passed. Web selected-component TypeScript check includes `src/vite-env.d.ts`; ESLint passed after import-order fixes.

Initial Git tests exposed macOS `/var` → `/private/var` canonicalization: initialization now rejects a symlink at the repository itself and canonicalizes its parent path. A test-double issue around Node's `execFile` promisify contract was corrected; real Poppler validation independently passed. No failed assertion was weakened.

## Release Status

Local implementation is complete; production deployment evidence is pending. Required release evidence: PR/head checks, main merge SHA and required CI/security/artifact success, standard Pi5 run ID, terminal raw status, Ansible recap, health and rollback outcome. Real-source recognition and usability must be checked using the pilot's actual notes/photos/PDFs after release.

Latest integration checks: real disposable PostgreSQL repository/worker tests (5), vision adapter contract (8), upload authentication routes (5), existing Hermes/report UI tests (40), intake hook tests (4), storage materializer tests (8), API build typecheck and Web typecheck. Real PostgreSQL tests are opt-in with KNOWLEDGE_DATABASE_TEST=1 and target a fixed disposable loopback database, never the production DATABASE_URL. Local test resources are removed after validation.

Hosted CI identified missing per-route rate limits, a storage-count assertion, owned-sequence bootstrap ordering and an unsolicited capability request while Hermes was closed. Corrections retain existing gates: explicit rate limits, 16 storage entries with both knowledge paths asserted, tables before owned sequences, and capabilities only on opening Hermes. The canonical isolated PostgreSQL role-boundary test passed with application-role knowledge insertion; its disposable resources were verified removed.
