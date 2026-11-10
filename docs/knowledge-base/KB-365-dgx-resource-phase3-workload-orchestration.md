---
title: "KB-365 DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停（廃止）"
status: redirect
superseded_by: docs/decisions/ADR-20261017-dgx-resource-business-llm-only.md
redirect_to: docs/archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md
category: knowledge-base
---

# KB-365: DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停（廃止）

この KB が扱った Pi5 側のポリシー調停（`SET_POLICY` / `applyWorkloadChanges`）、`EXECUTE_TARGET_ACTION`、切替シナリオ、実験ラボ・Agent・私用 ComfyUI の起停、`stackchan_chat` は、[ADR-20261017](../decisions/ADR-20261017-dgx-resource-business-llm-only.md) により業務側から削除され、調停は DGXSparkControlPlane の責務になりました。

- 現行の運用: [DGX system-prod Runbook](../runbooks/dgx-system-prod-local-llm.md)
- 当時の記録（2026-05 の本番反映を含む）: [archive](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)
