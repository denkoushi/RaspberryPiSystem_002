---
id: ADR-20260712-deploy-target-minimization-canary-hold
title: Deploy target minimization, canary hold, and Pi5 Blue/Green idempotent skip
status: superseded
date: 2026-07-16
superseded_by: ../plans/deployment-foundation-refactor-execplan.md
---

# ADR-20260712: Deploy target minimization, canary hold, and Pi5 Blue/Green idempotent skip

このADRの旧マーカー、任意の対象最小化、旧run制御は、8段階のデプロイ基盤リファクタリングで置換された。

現行判断は次のとおり。

- 対象最小化は標準動作で、`verified` の同一SHAだけを除外する。
- `unknown` hostは必ず対象に含める。
- release判断はfleet stateだけを正本にする。
- canary holdと明示approveは維持する。
- Pi5はlive image、config、migration evidenceが一致した場合だけ除外できる。

現行設計は [deployment foundation refactor ExecPlan](../plans/deployment-foundation-refactor-execplan.md)、操作は [deployment guide](../guides/deployment.md) を参照する。当時の判断と本番証跡は [historical ADR archive](../archive/decisions/ADR-20260712-deploy-target-minimization-canary-hold.md) に保存した。
