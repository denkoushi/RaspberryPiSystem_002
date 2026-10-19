# Kiosk self-inspection item invalidation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md`.

## Purpose / Big Picture

キオスクの自主検査一覧で、未開始・入力中・承認待ち・完了・承認済みの行を、管理
パスワードと必須理由を使って不可逆に一覧から除外できるようにする。削除は物理削除
ではなく監査可能な論理無効化とし、同じ日程行の自主検査は再開始・紙帳票再発行でき
ない。削除済みの測定値、検査員値、承認、NFC操作、紙帳票、機器貸出履歴は保持し、
「記録確認・承認」の削除履歴から読取専用で確認できる。

## Progress

- [x] (2026-07-31) `main` とローカル追跡 `origin/main` が
  `ab57a4abed3fd6ccf2b3dbb0a8b7372fc406a4db` で一致し、対象領域に競合がないことを確認。
- [x] (2026-07-31) `feat/kiosk-self-inspection-item-invalidation` を作成。
- [x] (2026-07-31) Prisma schema と157本目のexpand-only migrationを追加。
- [x] (2026-07-31) ライフサイクル、アイテムロック、session row lock、
  通常経路のfail-closed guardを追加。
- [x] (2026-07-31) 無効化・履歴API、Web削除操作、読取専用の削除履歴を追加。
- [x] (2026-07-31) API/Webテスト、ADR、KB-320、KB-390、runbookを更新。
- [x] (2026-07-31) 固有名・tmpfsの一時PostgreSQL 15で全migration、SQL制約、
  EXPLAIN、統合テストを検証し、一時資源を削除。
- [x] (2026-07-31) API/Web lint・build、focused/関連回帰テスト、Prisma検証、
  実画面の1/2/3ペイン確認、差分検査を完了。

## Surprises & Discoveries

- 自主検査の未開始行は `SelfInspectionSession` ではなく生産日程の
  `CsvDashboardRow` だけで表現される。したがってセッションだけを無効化しても未開始行
  は削除できない。
- 紙帳票は別の検査ではなく同じ `SelfInspectionSession` へ入力する経路であり、削除時に
  `ISSUED` / `OCR_REVIEW` を止めなければQRから後続入力できる。
- 自動保存、検査員入力、使用前点検、承認、reset、紙帳票OCRが複数サービスに分かれて
  いるため、セッション行ロック後の共通active guardが必要。
- PostgreSQLの `pg_advisory_xact_lock` は `void` を返すため、Prismaのraw queryで
  直接選択するとデコードできない。戻り値を `text` へcastすることで、同一トランザクション
  内のロック取得を型安全に確認できる。
- 使用前点検本体とoperation auditが別トランザクションだった。削除との競合で本体だけ
  書き込まれる窓を閉じるため、同じrow lock取得済みトランザクションへaudit appendも移した。
- 通常一覧の `invalidatedAt IS NULL ORDER BY updatedAt DESC LIMIT ...` は複合索引だけでは
  大半が有効行の場合に効率が不安定なため、active行だけの部分索引を追加した。
- in-app browserでは `window.prompt()` が未対応で、管理パスワードを要求する履歴画面の
  手動確認だけは通せなかった。履歴表示の認証・読取専用契約はWebテストと実DB API統合
  テストで確認した。

## Decision Log

- Decision: 無効化の一意単位は既存 `sessionBusinessKey`
  （製造order・工程・資源CD・日程行ID）と同じ文字列にする。
  Rationale: 未開始と開始済みを同じ不変キーで扱い、再作成をDB一意制約でも防ぐ。
  Date/Author: 2026-07-31 / Codex
- Decision: `SelfInspectionSession.invalidatedAt` と独立した
  `SelfInspectionItemInvalidation` 監査行を同一トランザクションで作る。
  Rationale: active queryを単純・高速にしつつ、理由と実行者のappend-only監査を保持する。
  Date/Author: 2026-07-31 / Codex
- Decision: アイテムキーの transaction advisory lock の後に session row lock を取る。
  Rationale: セッションが存在しない開始競合と、存在する書込競合の両方を直列化する。
  Date/Author: 2026-07-31 / Codex
- Decision: 生産日程行への外部キーは作らない。
  Rationale: CSV世代変更後も削除監査を失わない。
  Date/Author: 2026-07-31 / Codex
- Decision: `ISSUED` / `OCR_REVIEW` の紙帳票だけを削除トランザクションで
  `CANCELLED` にし、`IMPORTED` / `SUPERSEDED` は履歴として変更しない。
  Rationale: 未取込の後続入力だけを確実に止め、既に成立した監査証跡を保存する。
  Date/Author: 2026-07-31 / Codex
- Decision: IndexedDBの順位ボードキャッシュ削除をReact Queryの日程再取得より先に
  awaitする。
  Rationale: 再取得完了後に古い永続キャッシュが復元される競合を避け、削除直後のUIを
  fail-closedにする。
  Date/Author: 2026-07-31 / Codex
- Decision: active session一覧向けに
  `SelfInspectionSession_idx_active_updated` 部分索引をmigrationへ含める。
  Rationale: 有効行だけを更新日時降順で取得する通常経路を、データ比率に依存せず
  LIMITまで索引走査できるようにする。
  Date/Author: 2026-07-31 / Codex

## Outcomes & Retrospective

全5表示状態で、管理パスワードと必須理由による不可逆な削除操作を追加した。未開始は
日程行スナップショット、開始済みはsessionの論理無効化と監査行で扱い、同じbusiness
keyの再開始・紙発行を拒否する。通常一覧・承認・公差外・順位装飾・加工機ボードから
削除済みを除外し、古い画面、QR、OCR、全mutationからの書込みは共通409で閉じた。
履歴画面は未開始・開始済みの双方を読取専用で表示する。

検証実績:

- 新規API統合テスト6件、新規focused Webテスト21件に成功。
- 関連API統合37件、API unit 109件、関連Web 184件に成功。
- 既存DB統合の自主検査create/complete、使用前点検・貸出、組立無効化4件に成功
  （同じ絞り込み実行内の非対象100件はskip）。
- API/Web lintとbuild、Prisma validate/generate、`git diff --check` に成功。
- 1280px未満、1280px、1536px超で1/2/3ペイン、dialogのoverflowなし、入力制約、
  実削除後の即時行除外を確認。
- 完全な空DBへ157 migrationを適用し、`migrate status` が最新であることを確認。
  理由CHECK、nullable列、`ON DELETE RESTRICT`、一意・部分索引をSQLで確認。
- 5,000件fixtureの `EXPLAIN (ANALYZE, BUFFERS)` でbusiness key一意索引、
  日程行＋日時索引、削除日時索引、有効session部分索引の利用を確認。
- 固有名のtmpfsコンテナを停止・自動削除し、同prefixのcontainer、volume、networkが
  0件であることを確認。既存DB・既存Docker資源は変更していない。

本番deploy、push、PR、復元API、履歴の物理削除、機器貸出の自動返却は計画どおり対象外。

## Context and Orientation

自主検査の中心は
`apps/api/src/services/part-measurement/self-inspection.service.ts` と、その配下の
mutation guard、serialization、decorationである。デジタル開始は
`resolveOrCreateSession`、紙帳票開始は `self-inspection-paper-report-issue.service.ts`
がそれぞれ `SelfInspectionSession` をupsertする。通常画面は
`KioskSelfInspectionPage.tsx`、監査に再利用する画面は
`KioskSelfInspectionRecordApprovalPage.tsx` である。

`itemBusinessKey` は既存 `sessionBusinessKey` と同じ正規化規則を使う。無効化とは、
業務データを削除せず、active queryから除外し、全変更経路を409で閉じる操作を指す。

## Plan of Work

Prismaへnullableな `SelfInspectionSession.invalidatedAt` と無効化監査モデルを追加し、
既存行を更新しないexpand-only migrationを作る。次にアイテムキーのadvisory lock、
active session guard、パスワードadapter、ライフサイクルserviceを実装する。

デジタル開始、紙帳票発行、resetはアイテムキーロックを共有する。既存のセッション変更
経路はsession row lock直後にactive guardを通す。通常一覧、承認一覧、装飾、加工機
ボードは `invalidatedAt = null` だけを返す。紙帳票の印刷・QR・OCR・取込も削除済みを
拒否する。

APIへ無効化、履歴一覧、履歴詳細を追加する。Webの自主検査テーブルへ削除ボタンと
専用ダイアログを加え、成功後はReact Queryと永続順位ボードキャッシュを更新する。
記録確認画面へ「削除済み」モードを追加し、無効化スナップショットと保存済み記録を
読取専用表示する。

## Concrete Steps

Repository root:

    cd /Users/tsudatakashi/RaspberryPiSystem_002

Prisma生成と静的検証:

    pnpm --filter @raspi-system/api exec prisma generate --schema prisma/schema.prisma
    pnpm --filter @raspi-system/api exec prisma validate --schema prisma/schema.prisma

Focused testsは新規API統合ファイル、自主検査一覧・テーブル・履歴画面、既存の紙帳票・
actor auth・draft・reset・assembly削除を実行する。DBテストは固有名、tmpfs、ランダム
localhost portの `pgvector/pgvector:pg15` のみを使い、trapで必ず削除する。

## Validation and Acceptance

- 全表示状態の行から、パスワードと1〜500文字の理由で削除できる。
- requestId再送は同じ結果、別用途・二重削除は409。
- 削除後は通常一覧、日程候補、承認、公差外、順位・加工機ボードから消える。
- 同じアイテムのデジタル開始・紙発行・全変更API・resetは409。
- active紙帳票はCANCELLED、既存の測定・承認・監査・貸出行数は変わらない。
- 削除履歴で未開始と開始済みを読取専用確認できる。
- 開始・自動保存・承認・紙発行・resetとの競合に500や孤児データがない。
- 新規DBへ全migrationが適用され、対象queryのEXPLAINが意図した索引を使う。
- 一時container、volume、networkが残らない。

## Idempotence and Recovery

migrationは追加だけであり、再実行はPrismaのmigration ledgerで冪等である。無効化API
はrequestIdで冪等にする。テストfixtureは一時DBごと破棄し、既存DBをcleanup対象に
しない。失敗時にdown migrationや既存データ削除をせず、branch上でforward fixする。

## Interfaces and Dependencies

POST `/api/part-measurement/self-inspection/items/invalidate` は、session targetまたは
schedule-row target、`accessPassword`、`reason`、UUID `requestId` を受け取る。
GET `/api/part-measurement/self-inspection/invalidations` と `/:id` は履歴一覧・詳細を返す。

`SelfInspectionItemLifecycleService` はpassword access port、Prisma transaction、
item-key lock repositoryだけへ依存する。Web tableは無効化APIを直接呼ばず、親pageから
渡されたcallbackだけを起動する。
