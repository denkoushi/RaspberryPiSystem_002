---
title: Pi5 Blue/Green診断Runbook
status: active
scope: standard coordinator Pi5 API/Web release diagnosis
last_verified: 2026-07-16
source_of_truth: docs/runbooks/pi5-blue-green-deploy.md
related_docs:
  - ../guides/deployment.md
  - ./deploy-status-recovery.md
  - ../plans/deployment-foundation-refactor-execplan.md
---

# Pi5 Blue/Green診断Runbook

Pi5の通常デプロイは `scripts/update-all-clients.sh` のcoordinatorだけが実行する。このRunbookは状態の読み取りと原因調査に使い、Blue/Green内部commandを手で進める手順ではない。

## 標準状態確認

```bash
scripts/update-all-clients.sh --status RUN_ID
```

Pi5について次を確認する。

- phaseがhost config、migration、candidate build、switch、stability、cleanupのどこか
- desired/current SHA
- active slotとAPI/Web image
- config digestとmigration digest
- load evidenceと5分安定化の期限
- rollbackまたはcleanup結果

## 正常な処理順

1. host configをrun専用manifestで収束する。
2. migration planとlive ledgerを検証する。
3. run-scoped candidate API/Web imageをbuildする。
4. inactive slotを準備してhealthとloadを確認する。
5. gatewayをcandidateへ切り替える。
6. 5分間の安定化を観測する。
7. previous slotをcleanupし、live image/config/migration evidenceをfleet stateへ記録する。

candidate build後のload証跡は最終gateで再利用する。5分の安定化時間は維持する。

## 失敗時

実行中なら理由付きの協調cancelを使う。

```bash
scripts/update-all-clients.sh --cancel RUN_ID --reason "中止理由"
scripts/update-all-clients.sh --status RUN_ID
```

coordinatorはmanifestに基づいてhost config、image/runtime、gatewayを復旧し、検証できない場合はmaintenanceを維持してPi5 evidenceを `unknown` にする。後続端末へは進まない。

原因修正後は、対象SHAのCI成功を確認し、新しいread-only planから標準runを開始する。interrupted handoffがあればcoordinatorが先に整合・cleanupし、成功を確認してから新releaseを計画する。

## healthの必須条件

- checkout HEADが目標SHA
- active API/Web imageが目標releaseに一致
- active slot、gateway、scheduler roleが整合
- config digestとmigration digestが一致
- API/Web healthと認証済みendpointが成功
- migration ledgerの欠落・checksum不一致なし

HTTP 401、取得失敗、古いimage、digest不一致を成功扱いにしない。

## database

databaseをdown migrationしない。実行可能なのは、旧APIと新APIの両方が動作できるExpand-only migrationだけである。rollback時もschemaを戻さず、旧API互換を維持する。

## 禁止事項

- 内部Blue/Green scriptのprepare、switch、rollback、cleanup、reconcileを手動実行する
- Phase 2やlegacy Composeへ迂回する
- container、gateway、schedulerを個別に操作して成功状態を作る
- coordinator processをkillする
- lockやfleet/run stateを削除・編集する
- migrationを手動で巻き戻す

追加調査はsystemd journal、container/image inspect、認証済みhealth endpointを読み取り専用で行う。変更操作が必要なら、対象、理由、手順を整理して新しい明示承認を得る。

当時の直接操作と2026-07-12の受入記録は [historical Pi5 Runbook](../archive/runbooks/pi5-blue-green-deploy-legacy-2026-07.md) に保存した。現行の復旧全般は [deploy status recovery](./deploy-status-recovery.md) を参照する。
