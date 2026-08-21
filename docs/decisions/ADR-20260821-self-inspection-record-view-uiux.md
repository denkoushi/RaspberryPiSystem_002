---
id: ADR-20260821-self-inspection-record-view-uiux
status: accepted
scope: kiosk self-inspection list and record-review read/action boundaries
date: 2026-08-21
source_of_truth: this file
related_code: apps/api/src/services/part-measurement/self-inspection/use-cases/record-approval.ts, apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx, apps/web/src/pages/kiosk/KioskSelfInspectionRecordApprovalPage.tsx
related_docs: ../plans/kiosk-self-inspection-record-view-uiux-execplan.md, ../knowledge-base/KB-320-kiosk-part-measurement.md, ../runbooks/kiosk-part-measurement.md
validation: Web component and Playwright layout tests, isolated PostgreSQL migration replay, API integration tests, SQL and EXPLAIN
open_items: cursor pagination beyond the existing 200-record limit is out of scope
---

# ADR-20260821: 自主検査の記録閲覧・操作認証・一覧情報階層

## Context

自主検査一覧は製造orderと資源CDを先に見せ、製番・機種名・品名や更新時刻を素早く比較しにくい。状態と操作も複数色の文字・ボタンに分かれ、次に何をするかが読み取りづらい。一方、既存ペインと各アイテムの外枠を広げると隣接表示を侵食するため、既存の予約領域内で情報を再配置する必要がある。

検査記録確認は共有パスワードで画面全体を閉じているが、APIの読取境界は有効な端末client-keyまたはJWTである。共有パスワード検証は操作権限を表すtokenを発行せず、登録ポリシーPUTはclient-keyだけでも実行できるため、画面入口と操作保護の責務が一致していなかった。また、詳細な10選択肢を上位filterとして並べると、現場で「未完了を見る」「完了記録を見る」「削除履歴を見る」という判断を妨げる。

## Decision

1. 検査記録確認のGETは共有パスワードを要求せず、有効な端末client-keyまたは従来のJWTを読取境界とする。client-keyなしの匿名公開はしない。
2. 上位filterは **未完了**、**完了記録**、**削除履歴** の3分類とする。詳細なworkflow stateは削除せず、各記録内で状態と次の行動を説明する。
3. `GET .../record-approvals` に任意の `scope=completed_records` を追加する。これは承認記録を持つsessionと、検査員最終判定で完了したsessionをDBで集約してから既存の201件取得・200件返却を適用する。既存の`state`値と意味は変えず、`scope`との同時指定は400とする。削除履歴は既存の監査専用APIを使う。
4. 最終承認の本人証跡は従来どおりACTIVE社員NFCとする。閲覧中はNFC読取を開始せず、承認可能な記録で明示的に承認を開始した間だけ有効にする。
5. 計測機器登録ポリシーのkiosk変更は、PUT body内の共有パスワードをAPIが検証してから更新する。誤り・欠落は403とし、試行回数を既存パスワード検証と同じ10回/分に制限する。ADMIN/MANAGER JWTの既存管理経路は共有パスワード不要のまま維持する。パスワードや許可状態は画面に保持しない。
6. 自主検査一覧は既存の1／2ペインとアイテム外枠を維持する。製番・機種名・品名を白色21pxの一行identityとして優先し、製造order、資源名、更新、進捗を灰色の一行metaへ置く。長文は折返さずellipsisとaccessibleな全文を使う。
7. 資源は日本語名を主表示、CDを補助表示とし、名称不明時だけCDへfallbackする。更新日時は実データの`updatedAt`だけを「最終更新」とし、`occurredAt`を代用しない。表示はAsia/Tokyoの分までで秒を出さない。
8. 状態色は中立、注意、危険の意味に限定する。操作は次の推奨操作を最大1つだけprimary、他をsecondary、削除をdangerとし、色だけで意味を伝えない。

## Consequences

端末は画面を開いてすぐ記録を閲覧でき、承認や設定変更の時だけ必要な本人確認へ進める。既存client-key、NFC証跡、詳細状態、DTO、200件上限は維持される。新しい完了集約とnullableな生産日程`updatedAt`は後方互換な追加契約であり、Prisma列追加は不要である。

一覧は長文を全表示できない場合があるが、外枠を守るため一行省略を優先し、hoverと支援技術で全文を確認可能にする。正確な総件数や200件以降のcursor paginationは別要件とする。

## Validation

1280×760、1536×864、1920×1080でペイン数、外枠、アイテム高、21px identity、一行meta、横overflow、30.8px操作を比較する。APIはlegacy state互換、完了集約、201件truncation、client-key認証、NFC承認、設定PUTのJWT/kiosk分岐を隔離PostgreSQL上で検証する。全migration replay、SQL catalog、対象queryの`EXPLAIN (ANALYZE, BUFFERS)`も記録する。

## Supersedes / Superseded By

- Amends: KB-320の2026-06-26「入口ゲート」と2026-07-31「一覧レイアウト契約」
- Extends: `ADR-20260731-self-inspection-item-invalidation`
- Superseded by: none
