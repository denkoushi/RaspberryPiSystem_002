---
id: KB-402
title: Assembly approved UI/UX was overwritten after feature-branch deployment
status: remediation-in-progress
scope: kiosk assembly work screen, template editor, release lineage
date: 2026-07-27
source_of_truth: true
related_code:
  - apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
  - apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx
  - apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx
  - apps/api/src/routes/assembly/index.ts
related_docs:
  - ../decisions/ADR-20260725-kiosk-assembly-work-uiux-and-machine-name-picker.md
  - ../plans/kiosk-assembly-work-uiux-improvements.md
  - ../plans/assembly-approved-uiux-regression-recovery-execplan.md
validation: immutable Git ancestry, approved release records, current-main source comparison, regression tests, and standard main-only release acceptance
---

# KB-402: Assembly approved UI/UX was overwritten after feature-branch deployment

## Summary

The Assembly V3 work-screen layout and machine-name picker were approved and deployed
from `feat/kiosk-assembly-work-uiux`, but the approved branch was not merged into
`main`. A later correct deployment of `main` therefore replaced that UI with the older
right pane, restored the free-entry model field, and exposed an empty status band.

The regression was a release-lineage error, not a database migration or production-data
loss. The approved implementation remained intact at immutable branch head
`8b4fc78dc76808855da9d6682a3c57e444e47e78`.

## Evidence

- Approved implementation: `6d566dc326e7a30fd8aa54f9dd516361b4b88c7a`.
- Approved test follow-up: `5dbb98eb488009a6e9351bc0b898b3d39e4869e5`.
- Approved branch head: `8b4fc78dc76808855da9d6682a3c57e444e47e78`.
- Approved production run: `20260725-150046-020a76`.
- Regression boundary: approved head was not an ancestor of the later deployed
  `main` head `8338957ed3cee1f40bd123b0b2ea3afd0164acf1`.

## Root cause

Production deployment from a feature branch made the running system newer than the
canonical integration branch. Subsequent work correctly started from and deployed
`main`, but Git had no record that the approved UI was part of `main`, so the later
release legitimately omitted it.

## Impact

- The Assembly work screen showed the pre-V3 right pane and smaller history.
- A separate empty 56px status row reduced the document area.
- New template creation again exposed the old free-entry `型番/FHINCD` field.
- Current crop steps, shared markers, NFC access, and stored work data were not lost.

## Remediation

The recovery branch performs a real merge of approved head `8b4fc78d` into current
`main`, resolves conflicts at component boundaries, and preserves the later crop,
storyboard, shared-marker, LRU-image, NFC, and sequence-viewer-only behavior.

The repaired release is accepted only when:

1. both the approved head and the pre-recovery `main` head are ancestors of the PR head;
2. the PR is merged to `main` and required CI, CodeQL, and gitleaks pass;
3. production is updated from merged `main` through the standard rolling updater;
4. the post-release plan is a no-op and `raspi4-assembly-01` passes read-only acceptance.

## Prevention

- Never treat a feature-branch production deployment as integration completion.
- Approved production code must be merged to `main` before the release is considered
  durable.
- Release evidence must record both the deployed SHA and proof that the SHA is an
  ancestor of `origin/main`.
- Follow-up branches start from `main`; missing approved ancestry is a blocking
  preflight failure, not a UI-level fix to rediscover later.
