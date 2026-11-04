---
id: meta-document-migration-ledger
status: active
scope: high-risk documentation entrypoints and legacy large documents
date: 2026-06-24
source_of_truth: false
related_docs:
  - ./document-inventory-summary.md
  - ./document-inventory.json
  - ../plans/docs-canonicalization-roadmap.md
validation:
  - node scripts/docs/audit-docs.mjs --check
  - git diff --check
open_items:
  - Continue thinning remaining `docs/INDEX.md` latest-update blocks by domain.
  - Create or identify standard deployment and validation runbooks before shortening guides.
---

# Document Migration Ledger

This ledger maps high-risk legacy entrypoints and large documents to their
next canonical destination. It is a migration control file, not a content
source of truth.

## Action Vocabulary

- `keep`: keep the file in place and edit only the stale guidance.
- `redirect`: keep the old URL, but make it a short pointer to the new source.
- `split`: move confirmed sections to KB / Runbook / ADR / Plan over multiple PRs.
- `archive`: preserve historical content outside the active path after mapping.
- `unverified`: do not edit content until the target canonical owner is clear.

## Initial High-Risk Set

| old_path | current_role | target_canonical | action | preservation | status |
|----------|--------------|------------------|--------|--------------|--------|
| `AI_HANDOFF_PROMPT.txt` | Legacy AI prompt; formerly told agents to use `EXEC_PLAN.md` and `docs/INDEX.md` as current state. | `AGENTS.md`; `docs/AI_START_HERE.md`; relevant KB / Runbook / ADR / Plan. | redirect | Kept the path and replaced the body with a short current-start pointer in PR4. | aligned_pr4 |
| `README.md` | Human repository overview; formerly described `EXEC_PLAN.md` as progress and implementation guidance. | `docs/AI_START_HERE.md`; `docs/plans/docs-canonicalization-roadmap.md`; existing module docs. | keep | Kept README as project overview; revised stale `EXEC_PLAN.md` guidance in PR4. | aligned_pr4 |
| `docs/guides/development.md` | Developer guide; formerly prioritized giant `docs/INDEX.md` and `EXEC_PLAN.md` in the startup flow. | `docs/AI_START_HERE.md`; `.cursor/rules/`; relevant KB / Runbook / ADR / Plan. | keep | Kept developer guide; revised the startup section and legacy references in PR4. | aligned_pr4 |
| `docs/REFACTORING_PLAN.md` | Completed old refactoring plan based on former `EXEC_PLAN.md`-centered model. | `docs/plans/docs-canonicalization-roadmap.md`. | redirect | Kept original body as history; added `superseded_by` and a short superseded notice in PR4. | aligned_pr4 |
| `docs/INDEX.md` | Oversized global index with narrative updates and many links. | Thin global navigation; domain indexes where needed; canonical KB / Runbook / ADR / Plan. | split | Expanded below in PR5. Thin one domain per PR while preserving old links. | expanded_pr5 |
| `docs/guides/deployment.md` | Mixed deployment procedure, deployment diary, run IDs, troubleshooting, and feature history. | Deployment Runbook for current procedure; KB / Plan / Evidence for history and incidents. | split | Expanded below in PR5. Do not shorten until procedure sections and history sections are mapped separately. | expanded_pr5 |
| `docs/guides/verification-checklist.md` | Common validation plus feature-specific acceptance history. | Common validation Runbook; feature-specific Runbook or Plan entries. | split | Expanded below in PR5. Do not shorten until common checks and feature checks are mapped separately. | expanded_pr5 |
| `EXEC_PLAN.md` | Legacy historical log with corruption-like text, long lines, and many inbound links. | Existing canonical KB / Runbook / ADR / Plan; future archive path only after mapping. | archive | Freeze as historical log; do not rewrite, infer, or shorten until useful sections are mapped. | frozen |

## PR5 Expanded Target Map

This expansion identifies the next safe thinning units. It does not move
content and does not make a target canonical unless that target already owns
the topic.

| source_area | current_payload | target_canonical | action | preservation | next_status |
|-------------|-----------------|------------------|--------|--------------|-------------|
| `docs/INDEX.md` latest-update blocks | Date-stamped narrative updates and deployment summaries. | Existing linked KB / Plan / ADR / Runbook / API documents. For kiosk leaderboard current specification, use `docs/knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md`. | split | PR6-PR441 thinned selected recent blocks. PR50-PR51 moved remaining onsite smoke validation for seiban list and note-modal registration from `docs/INDEX.md` into KB-297. Continue by domain. | partial_pr441 |
| `docs/INDEX.md` purpose/category navigation | Navigation tables and audience-oriented entry links. | `docs/INDEX.md` as thin global navigation. | keep | Keep this file as a lightweight index; avoid adding narrative update logs. | keep_thin |
| `docs/knowledge-base/index.md` category and issue tables | KB navigation mixed with status notes and some deployment facts. | `docs/knowledge-base/index.md` as thin KB navigation; individual KB files for details. | split | Shorten after `docs/INDEX.md` first-pass thinning; do not duplicate KB detail text. | pending_after_global_index |
| `docs/knowledge-base/index.md` update history | Chronological deployment and validation notes that duplicate KB / deployment / EXEC_PLAN history. | Existing KB files, Plans, Runbooks, or Evidence paths referenced by each entry. | split | Map by domain before deleting text; preserve links that external docs use. | map_before_edit |
| `docs/guides/deployment.md` top deployment diary | Date-stamped feature deploy logs, run IDs, Phase12 outcomes, and feature history. | Related KB / Plan / Evidence documents for each feature; deployment guide should not be the fact owner. | split | Do not bulk-delete. Move only entries whose canonical owner is already clear. | map_by_domain |
| `docs/guides/deployment.md` standard procedure sections | Network mode, Pi5/Pi4/Pi3 update steps, rollback, troubleshooting, operational checklists. | Future standard deployment Runbook, or this file as a temporary procedure entrypoint until the Runbook exists. | keep | Keep executable steps reachable until a Runbook replacement is created and linked. | runbook_needed |
| `docs/guides/verification-checklist.md` common checks | Backup, offline, monitoring, deploy, CI/CD, and result-recording checks. | Future common validation Runbook. | keep | Keep as checklist until the Runbook exists; avoid adding feature acceptance history. | runbook_needed |
| `docs/guides/verification-checklist.md` feature-specific checks | Long-lived CSV and feature acceptance sections mixed into the common checklist. | Feature-specific KB / Plan / Runbook entries. | split | Move only after the target document exists and the old section can point to it. | map_by_feature |
| `EXEC_PLAN.md` Progress / Surprises / Decision Log / Outcomes / Next Steps | Legacy project-wide narrative with corruption-like text and many long lines. | Existing canonical KB / Runbook / ADR / Plan documents; future archive note only after mapping. | archive | Do not rewrite, infer, or shorten yet. Use only as historical cross-check. | frozen |

## PR3 Inventory Snapshot

From `docs/_meta/document-inventory.json` before adding this ledger:

| Path | Lines | Inbound | Local links | Notes |
|------|------:|--------:|------------:|-------|
| `AI_HANDOFF_PROMPT.txt` | 17 | 0 | 1 | Legacy AI prompt, no frontmatter. |
| `README.md` | 319 | 2 | 19 | Human overview with stale `EXEC_PLAN.md` guidance. |
| `docs/guides/development.md` | 559 | 16 | 16 | Has frontmatter; stale startup order. |
| `docs/REFACTORING_PLAN.md` | 124 | 1 | 8 | Has frontmatter; no status yet. |
| `docs/INDEX.md` | 1,831 | 14 | 935 | 85 long lines; oversized index. |
| `docs/guides/deployment.md` | 5,161 | 448 | 377 | 8 long lines; largest tracked text doc. |
| `docs/guides/verification-checklist.md` | 1,147 | 76 | 80 | 1 long line; mixed common and feature checks. |
| `EXEC_PLAN.md` | 4,658 | 42 | 749 | 327 long lines; corruption flags present. |

## 2026-11 Docs Drift Audit Archive

Docs that were finished one-off records, superseded procedures, or duplicates
were moved out of the active path. Inbound relative links were rewritten to the
new location (`EXEC_PLAN.md` was not edited, so its links to these paths are
historical). Docs kept in place with a status note are not listed here.

| old_path | target_canonical | action | preservation |
|----------|------------------|--------|--------------|
| `docs/guides/backup-dropbox-status-investigation.md` | `docs/knowledge-base/infrastructure/backup-restore.md` | archive | Body moved to `docs/archive/guides/backup-dropbox-status-investigation.md`. |
| `docs/guides/backup-dropbox-status-investigation-results.md` | `docs/knowledge-base/infrastructure/backup-restore.md` | archive | Body moved to `docs/archive/guides/backup-dropbox-status-investigation-results.md`. |
| `docs/guides/backup-error-handling-improvements.md` | `docs/knowledge-base/infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善` | archive | Body moved to `docs/archive/guides/backup-error-handling-improvements.md`. |
| `docs/guides/backup-restore-verification-results.md` | `docs/knowledge-base/infrastructure/backup-restore.md` | archive | Body moved to `docs/archive/guides/backup-restore-verification-results.md`. |
| `docs/guides/backup-restore-verification-execution.md` | `docs/guides/backup-verification-checklist.md` | archive | Body moved to `docs/archive/guides/backup-restore-verification-execution.md`. |
| `docs/guides/backup-restore-verification.md` | `docs/guides/backup-verification-checklist.md` | archive | Body moved to `docs/archive/guides/backup-restore-verification.md`. |
| `docs/guides/backup-verification-results.md` | `docs/guides/backup-verification-checklist.md` | archive | Body moved to `docs/archive/guides/backup-verification-results.md`. |
| `docs/guides/backup-script-integration-verification.md` | `docs/knowledge-base/infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認` | archive | Body moved to `docs/archive/guides/backup-script-integration-verification.md`. |
| `docs/guides/backup-schedule-history-mismatch-analysis.md` | `docs/knowledge-base/infrastructure/backup-restore.md#kb-194-スケジュール自動実行時にバックアップ履歴が記録されない問題` | archive | Body moved to `docs/archive/guides/backup-schedule-history-mismatch-analysis.md`. |
| `docs/guides/backup-target-management-verification.md` | `docs/guides/backup-configuration.md` | archive | Body moved to `docs/archive/guides/backup-target-management-verification.md`. |
| `docs/guides/backup-verification.md` | `docs/guides/backup-verification-checklist.md` | archive | Body moved to `docs/archive/guides/backup-verification.md`. Still-valid facts merged into the canonical doc first. |
| `docs/guides/csv-dashboard-verification.md` | `docs/guides/csv-import-export.md` | archive | Body moved to `docs/archive/guides/csv-dashboard-verification.md`. |
| `docs/guides/csv-import-history-migration.md` | `docs/guides/csv-import-export.md` | archive | Body moved to `docs/archive/guides/csv-import-history-migration.md`. |
| `docs/guides/dropbox-token-solution.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-token-solution.md`. |
| `docs/guides/dropbox-refresh-token-implementation.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-refresh-token-implementation.md`. |
| `docs/guides/dropbox-token-setup-pi5.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-token-setup-pi5.md`. |
| `docs/guides/dropbox-oauth-policy-compliance.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-oauth-policy-compliance.md`. |
| `docs/guides/dropbox-oauth-policy-compliance-corrected.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-oauth-policy-compliance-corrected.md`. |
| `docs/guides/dropbox-oauth-verification-checklist.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-oauth-verification-checklist.md`. |
| `docs/guides/dropbox-integration-verification.md` | `docs/guides/external-integration-ledger.md` | archive | Body moved to `docs/archive/guides/dropbox-integration-verification.md`. |
| `docs/guides/gmail-auto-protocol-phase1-verification.md` | `docs/plans/gmail-auto-protocol-progress.md` | redirect | Body moved to `docs/archive/guides/gmail-auto-protocol-phase1-verification.md`. Old path kept as a pointer stub. |
| `docs/guides/dropbox-setup-guide.md` | `docs/guides/dropbox-oauth-setup-guide.md` | archive | Body moved to `docs/archive/guides/dropbox-setup-guide.md`. Still-valid facts merged into the canonical doc first. |
| `docs/guides/local-alerts-verification.md` | `docs/guides/local-alerts.md` | archive | Body moved to `docs/archive/guides/local-alerts-verification.md`. |
| `docs/guides/measuring-instruments-verification.md` | `docs/knowledge-base/KB-314-kiosk-loan-card-display-labels.md` | archive | Body moved to `docs/archive/guides/measuring-instruments-verification.md`. |
| `docs/guides/measuring-instrument-loan-events-verification.md` | `docs/knowledge-base/KB-344-unified-loan-analytics.md` | archive | Body moved to `docs/archive/guides/measuring-instrument-loan-events-verification.md`. |
| `docs/guides/slack-webhook-setup-step-by-step.md` | `docs/guides/slack-webhook-setup.md` | archive | Body moved to `docs/archive/guides/slack-webhook-setup-step-by-step.md`. Still-valid facts merged into the canonical doc first. |
| `docs/guides/phase3-schedule-run-and-auto-backup-test-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3-schedule-run-and-auto-backup-test-results.md`. |
| `docs/guides/ui-visibility-color-theme-deployment-results.md` | `docs/requirements/ui-visibility-color-theme.md` | archive | Body moved to `docs/archive/guides/ui-visibility-color-theme-deployment-results.md`. |
| `docs/guides/phase3-authentication-clarification.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-authentication-clarification.md`. |
| `docs/guides/phase3-browser-console-verification.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-browser-console-verification.md`. |
| `docs/guides/phase3-complete-verification-summary.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-complete-verification-summary.md`. |
| `docs/guides/phase3-dropbox-token-refresh-fix.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-dropbox-token-refresh-fix.md`. |
| `docs/guides/phase3-error-handling-test-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-error-handling-test-results.md`. |
| `docs/guides/phase3-mandatory-verification-execution.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-mandatory-verification-execution.md`. |
| `docs/guides/phase3-mandatory-verification-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-mandatory-verification-results.md`. |
| `docs/guides/phase3-mandatory-verification-step-by-step.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-mandatory-verification-step-by-step.md`. |
| `docs/guides/phase3-mandatory-verification-steps.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-mandatory-verification-steps.md`. |
| `docs/guides/phase3-manual-verification-current-step.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-manual-verification-current-step.md`. |
| `docs/guides/phase3-manual-verification-steps.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-manual-verification-steps.md`. |
| `docs/guides/phase3-next-steps.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-next-steps.md`. |
| `docs/guides/phase3-next-tasks.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-next-tasks.md`. |
| `docs/guides/phase3-production-readiness-assessment.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-production-readiness-assessment.md`. |
| `docs/guides/phase3-production-usage-clarification.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-production-usage-clarification.md`. |
| `docs/guides/phase3-real-device-verification-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-real-device-verification-results.md`. |
| `docs/guides/phase3-real-device-verification-status.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-real-device-verification-status.md`. |
| `docs/guides/phase3-real-device-verification-steps.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-real-device-verification-steps.md`. |
| `docs/guides/phase3-schedule-crud-test-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-schedule-crud-test-results.md`. |
| `docs/guides/phase3-schedule-run-and-auto-backup-test-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-schedule-run-and-auto-backup-test-results.md`. |
| `docs/guides/phase3-token-refresh-test-results.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-token-refresh-test-results.md`. |
| `docs/guides/phase3-verification-checklist.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-verification-checklist.md`. |
| `docs/guides/phase3-verification-clarification.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-verification-clarification.md`. |
| `docs/guides/phase3-verification-complete-summary.md` | `docs/analysis/dropbox-csv-integration-status.md` | archive | Body moved to `docs/archive/guides/phase3/phase3-verification-complete-summary.md`. |
| `docs/guides/auto-startup-status.md` | `docs/guides/client-initial-setup.md` | archive | Body moved to `docs/archive/guides/auto-startup-status.md`. |
| `docs/guides/ai-ssh-access.md` | `AGENTS.md` | archive | Body moved to `docs/archive/guides/ai-ssh-access.md`. Still-valid facts merged into the canonical doc first. |
| `docs/guides/ansible-error-handling.md` | `docs/runbooks/deploy-status-recovery.md` | redirect | Body moved to `docs/archive/guides/ansible-error-handling.md`. Old path kept as a pointer stub. |
| `docs/guides/phase2-real-device-verification.md` | `docs/guides/csv-import-export.md` | archive | Body moved to `docs/archive/guides/phase2-real-device-verification.md`. |
| `docs/guides/photo-loan-test-plan.md` | `docs/guides/verification-checklist.md` | archive | Body moved to `docs/archive/guides/photo-loan-test-plan.md`. |
| `docs/guides/pi3-deployment-verification.md` | `docs/guides/deployment.md` | archive | Body moved to `docs/archive/guides/pi3-deployment-verification.md`. |
| `docs/guides/raspberry-pi4-restart-commands.md` | `docs/guides/client-initial-setup.md` | archive | Body moved to `docs/archive/guides/raspberry-pi4-restart-commands.md`. |
| `docs/guides/signage-deployment.md` | `docs/guides/deployment.md` | archive | Body moved to `docs/archive/guides/signage-deployment.md`. |
| `docs/guides/signage-layout-config-verification.md` | `docs/knowledge-base/infrastructure/signage.md` | archive | Body moved to `docs/archive/guides/signage-layout-config-verification.md`. |
| `docs/guides/signage-layout-config-verification-results.md` | `docs/knowledge-base/infrastructure/signage.md` | archive | Body moved to `docs/archive/guides/signage-layout-config-verification-results.md`. |
| `docs/guides/signage-test-plan.md` | `docs/guides/verification-checklist.md` | archive | Body moved to `docs/archive/guides/signage-test-plan.md`. |
| `docs/guides/setup-clients-status-agent.md` | `docs/guides/client-initial-setup.md` | archive | Body moved to `docs/archive/guides/setup-clients-status-agent.md`. |
| `docs/guides/ui-visibility-color-theme-deployment-results.md` | `docs/requirements/ui-visibility-color-theme.md` | archive | Body moved to `docs/archive/guides/ui-visibility-color-theme-deployment-results.md`. |
| `docs/guides/ui-visibility-color-theme-remaining-tasks.md` | `docs/requirements/ui-visibility-color-theme.md` | archive | Body moved to `docs/archive/guides/ui-visibility-color-theme-remaining-tasks.md`. |
| `docs/guides/ui-visibility-color-theme-real-device-verification.md` | `docs/requirements/ui-visibility-color-theme.md` | archive | Body moved to `docs/archive/guides/ui-visibility-color-theme-real-device-verification.md`. |
| `docs/guides/stability-improvement-test.md` | `docs/plans/stability-improvement-plan.md` | archive | Body moved to `docs/archive/guides/stability-improvement-test.md`. |
| `docs/guides/validation-7-usb-import.md` | `docs/guides/verification-checklist.md` | redirect | Body moved to `docs/archive/guides/validation-7-usb-import.md`. Old path kept as a pointer stub. |
| `docs/guides/ssh-setup.md` | `docs/guides/client-initial-setup.md` | redirect | Body moved to `docs/archive/guides/ssh-setup.md`. Old path kept as a pointer stub. |
| `docs/guides/security-test-plan.md` | `docs/plans/security-hardening-execplan.md` | archive | Body moved to `docs/archive/guides/security-test-plan.md`. |
| `docs/knowledge-base/troubleshooting-knowledge.md` | `docs/knowledge-base/index.md` | redirect | Pointer only; no body kept. Old path kept as a pointer stub. |
| `docs/knowledge-base/kiosk-video-call-health-check.md` | `docs/guides/webrtc-verification.md` | archive | Body moved to `docs/archive/knowledge-base/kiosk-video-call-health-check.md`. |
| `docs/knowledge-base/kb-kiosk-rigging-return-cancel-investigation.md` | `docs/runbooks/kiosk-loan-status-repair.md` | archive | Body moved to `docs/archive/knowledge-base/kb-kiosk-rigging-return-cancel-investigation.md`. Still-valid facts merged into the canonical doc first. |
| `docs/knowledge-base/infrastructure/ports-baseline-20260118.md` | `docs/runbooks/ports-unexpected-and-port-exposure.md` | archive | Body moved to `docs/archive/knowledge-base/infrastructure/ports-baseline-20260118.md`. |
| `docs/knowledge-base/KB-340-api-ocr-vlm-boundary-refactor-deploy.md` | `docs/decisions/ADR-20260402-inference-foundation-phase1.md` | archive | Body moved to `docs/archive/knowledge-base/KB-340-api-ocr-vlm-boundary-refactor-deploy.md`. |
| `docs/knowledge-base/KB-332-kiosk-active-loan-card-modern-surface.md` | `docs/knowledge-base/KB-323-kiosk-return-card-button-layout.md` | archive | Body moved to `docs/archive/knowledge-base/KB-332-kiosk-active-loan-card-modern-surface.md`. Still-valid facts merged into the canonical doc first. |
| `docs/knowledge-base/KB-333-signage-compact24-footer-kiosk-cancel-readability.md` | `docs/knowledge-base/infrastructure/signage.md` | archive | Body moved to `docs/archive/knowledge-base/KB-333-signage-compact24-footer-kiosk-cancel-readability.md`. |
| `docs/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md` | `docs/runbooks/dgx-system-prod-local-llm.md` | redirect | Body moved to `docs/archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md`. Old path kept as a pointer stub. |
| `docs/knowledge-base/KB-363-dgx-resource-spark-status-fallback.md` | `docs/runbooks/dgx-system-prod-local-llm.md` | archive | Body moved to `docs/archive/knowledge-base/KB-363-dgx-resource-spark-status-fallback.md`. |
| `docs/knowledge-base/KB-388-cursor-state-db-corruption-external-ssd-recovery.md` | `docs/guides/mac-storage-migration.md` | archive | Body moved to `docs/archive/knowledge-base/KB-388-cursor-state-db-corruption-external-ssd-recovery.md`. Still-valid facts merged into the canonical doc first. |
| `docs/knowledge-base/KB-400-pi5-bluegreen-cleanup-monitor-lock.md` | `docs/runbooks/deploy-status-recovery.md` | archive | Body moved to `docs/archive/knowledge-base/KB-400-pi5-bluegreen-cleanup-monitor-lock.md`. |
| `docs/knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md` | `docs/runbooks/kiosk-ime-diagnosis.md` | archive | Body moved to `docs/archive/knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md`. |
| `docs/knowledge-base/KB-investigation-kiosk-ime-and-power-regression.md` | `docs/runbooks/kiosk-power-operation-recovery.md` | archive | Body moved to `docs/archive/knowledge-base/KB-investigation-kiosk-ime-and-power-regression.md`. |
| `docs/runbooks/mac-target-location-migration.md` | `docs/knowledge-base/KB-297-kiosk-due-management-workflow.md` | archive | Body moved to `docs/archive/runbooks/mac-target-location-migration.md`. |
| `docs/runbooks/pi5-minimal-downtime-deploy.md` | `docs/guides/deployment.md` | archive | Body moved to `docs/archive/runbooks/pi5-minimal-downtime-deploy.md`. |
| `docs/runbooks/zero2w-tanaban-edge-setup.md` | `docs/runbooks/zero-edge-agent.md` | redirect | Body moved to `docs/archive/runbooks/zero2w-tanaban-edge-setup.md`. Old path kept as a pointer stub. |
| `docs/runbooks/pi5-blue-green-deploy.md` | `docs/runbooks/deploy-status-recovery.md` | archive | Body moved to `docs/archive/runbooks/pi5-standard-ansible-diagnosis-2026-08.md`. Still-valid facts merged into the canonical doc first. |
| `docs/runbooks/local-llm-tailscale-sidecar.md` | `docs/runbooks/dgx-system-prod-local-llm.md` | redirect | Body moved to `docs/archive/runbooks/local-llm-tailscale-sidecar.md`. Old path kept as a pointer stub. |

## Next Step

PR442 should continue `docs/INDEX.md` thinning for another domain, or create the
standard deployment / validation runbook targets before shortening those guides.
