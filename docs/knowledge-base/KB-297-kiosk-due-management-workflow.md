---
title: KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装
tags: [production-schedule, kiosk, due-management, priority]
audience: [開発者, 運用者]
last-verified: 2026-03-07
related:
  - ../decisions/ADR-20260307-kiosk-due-management-model.md
  - ../guides/csv-import-export.md
category: knowledge-base
---

# KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装

## Context

- 生産スケジュールで「行単位の納期設定」だけでは、現場リーダーが製番単位で全体調整しづらい
- 切削判定が「研削以外すべて」だったため、塗装系コード（`10`, `MSZ`）が切削に混入する運用課題があった
- 既存画面との互換を保ちつつ、製番単位納期管理へ段階移行する必要があった

## Symptoms

- 製番納期を部品・工程へ反映する作業が手動で重い
- 部品優先順位の保存先がなく、提案順と実運用順を分離できない
- 工程カテゴリ（研削/切削）の切替結果が実態とずれる

## Investigation

- H1: `ProductionScheduleRowNote.dueDate` のみで製番単位運用を吸収できる  
  - Result: REJECTED（行単位のみで、製番全体更新/再読込が困難）
- H2: 製番納期を別テーブル化し、既存行へwritebackすれば互換維持できる  
  - Result: CONFIRMED
- H3: 切削除外リストをロケーション別設定にすれば、現場差異へ追従できる  
  - Result: CONFIRMED

## Root cause

- 既存モデルが「行単位最適化」で、製番単位の意思決定（納期・優先順）を保持する境界がなかった

## Fix

- DBに以下を追加
  - `ProductionScheduleSeibanDueDate`（製番納期）
  - `ProductionSchedulePartPriority`（製番内の部品優先順位）
  - `ProductionScheduleResourceCategoryConfig`（切削除外リスト）
- キオスク専用APIを追加
  - `GET /api/kiosk/production-schedule/due-management/summary`
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/due-date`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/part-priorities`
- `DueDateWritebackService`で製番納期更新時に既存`row dueDate`へ反映（互換維持）
- 管理コンソールに切削除外設定API/UIを追加
  - `GET/PUT /api/production-schedule-settings/resource-categories`
- キオスクに新画面を追加
  - `/kiosk/production-schedule/due-management`

## Prevention

- ポリシー層を分離して、工程カテゴリ判定・表面処理優先を呼び出し側から隔離
- 切削除外リストはロケーション別設定で変更可能にし、コード修正なしで運用調整可能
- 回帰防止として、ポリシーユニットテストとキオスク統合テスト（due-management系）を追加

## デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-093857-20934`、`state: success`、約15分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - Prismaマイグレーション: 36件適用済み、スキーマ最新
  - キオスクAPI: `/api/tools/loans/active`（両Pi4）200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - deploy-status: `GET /api/system/deploy-status` に `x-client-key` 付与で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## 追加実装（2026-03-07）

- 登録製番同期: 納期管理の左ペインを `search-state.history` 同期に変更し、検索追加・保持・×削除を生産スケジュール画面と共通化
- 機種名表示: 納期管理サマリと部品優先順位ヘッダに `machineName` を追加
- 工程進捗表示（案A）: 部品行ごとに `processes[]` を表示し、完了工程をグレーアウト
- FHINCD単位表面処理: `ProductionSchedulePartProcessingType` を追加し、生産スケジュール画面/納期管理画面の更新を同一マスタへ集約
- 候補値の編集可能化: `ProductionScheduleProcessingTypeOption` を追加し、管理コンソールの設定画面で候補（code/label/priority/enabled）を編集可能化
- 検証: API統合テスト `kiosk-production-schedule.integration.test.ts` と `apps/api`,`apps/web` lint を通過

## References

- `apps/api/prisma/schema.prisma`
- `apps/api/src/services/production-schedule/due-management-query.service.ts`
- `apps/api/src/services/production-schedule/due-management-command.service.ts`
- `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- `apps/web/src/pages/admin/ProductionScheduleSettingsPage.tsx`
