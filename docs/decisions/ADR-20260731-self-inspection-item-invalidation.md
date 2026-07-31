---
id: ADR-20260731-self-inspection-item-invalidation
status: accepted
scope: kiosk self-inspection item lifecycle and immutable invalidation audit
date: 2026-07-31
source_of_truth: this file
related_code: apps/api/src/services/part-measurement/self-inspection-item-lifecycle.service.ts, apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx
related_docs: ../plans/kiosk-self-inspection-item-invalidation-execplan.md, ../runbooks/kiosk-part-measurement.md
validation: isolated PostgreSQL migration, SQL and EXPLAIN checks, concurrency integration tests, Web tests
open_items: restoration and physical history deletion are out of scope
---

# ADR-20260731: 自主検査アイテムの不可逆な論理無効化

## Context

自主検査一覧には、セッション作成前の日程行と、測定・承認・紙帳票などの履歴を持つ
開始済みセッションが同時に現れる。誤った行を一覧から除外する必要がある一方、
セッションや測定値を物理削除すると品質記録の追跡性を失う。また、削除とデジタル開始、
紙帳票発行、自動保存、完了、承認、リセットが競合すると、削除済みアイテムへ新しい
業務データが書き込まれるおそれがある。

## Decision

1. 「削除」は管理パスワードと1〜500文字の理由を必須とする不可逆な論理無効化とする。
   復元、同一アイテムの再開始、紙帳票再発行は提供しない。
2. `SelfInspectionSession.invalidatedAt` に加え、セッション未作成の日程行も表現できる
   `SelfInspectionItemInvalidation` をappend-only監査として保存する。日程行には外部キーを
   張らず、CSV世代変更後も対象スナップショットを保持する。
3. セッション、測定値、検査員値、承認、NFC認証、操作履歴、紙帳票、機器貸出は物理削除
   しない。発行中の紙帳票 `ISSUED` / `OCR_REVIEW` だけを同じトランザクションで
   `CANCELLED` にする。
4. `itemBusinessKey` のPostgreSQL transaction advisory lockを最初に取得し、その後
   セッション行を `FOR UPDATE` する。デジタル開始、紙帳票発行、削除、リセットは同じ
   ロック順に統一する。
5. セッション変更経路は共通active guardを通し、削除済みへの通常参照・変更を
   `409 SELF_INSPECTION_ITEM_INVALIDATION_CONFLICT` で拒否する。履歴専用APIだけが
   削除済みデータを読取可能とする。
6. UUID `requestId` で同一対象・同一理由の再送だけを冪等にする。別対象・別理由への
   再利用、既削除、同時二重削除は409とする。
7. 通常一覧、承認一覧、公差外一覧、生産日程装飾、順位ボード、加工機ボードは削除済みを
   除外する。記録確認画面の「削除済み」モードは完全な読取専用とする。

## Consequences

誤登録を現場画面から除外しつつ、削除理由と削除前状態を含む品質監査を維持できる。
日程行単位の無効化も永続するため、同じCSV行からセッションを再作成できない。追加列・
追加テーブルだけのmigrationなので旧アプリは追加構造を無視できるが、DB容量は減らない。
機器貸出は別ライフサイクルのため削除時に自動返却しない。

## Validation

固有名・tmpfsの一時PostgreSQL 15へ全migrationを適用し、CHECK/FK/索引と
`EXPLAIN (ANALYZE, BUFFERS)`を確認する。5状態、未開始、紙帳票、冪等性、開始・発行との
競合をAPI統合テストで検証し、Webの削除ダイアログと読取専用履歴、既存組立削除の回帰、
lint/buildを確認する。

## Supersedes / Superseded By

- Extends: `ADR-20260726-assembly-auto-id-operator-access-invalidation`
- Superseded by: none
