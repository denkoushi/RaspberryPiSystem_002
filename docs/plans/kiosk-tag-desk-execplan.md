# キオスク「タグ管理」デスク：NFCタグの紐づけ・切り離しとマスター編集の移設

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Follow `.agent/PLANS.md`.

## Purpose / Big Picture

現場では社員証・工具・計測機器・吊具にNFCタグを貼って、持出や承認などに使っている。タグの付け替えや、不要になったタグを外して再利用する作業は、これまで管理コンソール（管理者ログインが必要なWeb画面）の各マスター画面でUIDを手入力するしかなかった。しかも社員と工具の画面では、UID欄を空にして保存しても紐づけは外れなかった（APIが空文字を「変更なし」として扱うため）。

この変更で、キオスク端末に「タグ管理」タブが加わる。在庫の準備と同じ4桁の操作パスワードで開くと、1画面の中で次のことができる。タグをかざすと、どこに紐づいているか（社員・工具・計測機器・吊具・在庫タグ）と、最近の使用履歴が出る。確認のうえで「外す」を押すと紐づけが外れ、タグは未使用に戻る。未使用のタグをかざして一覧から相手を選べば紐づけられる。さらに、社員・工具・計測機器・吊具のマスター（登録・編集・削除）と吊具の点検記録の入力も、この画面でできる。管理コンソールの該当画面は、キオスクへの案内に置き換える。

画面の見た目は `https://claude.ai/artifact/1UNF8gFyeiRpuB4pGThxsf` のモックに合わせる（左に読み取ったタグ、右に紐づけ先の一覧、両者を線でつなぐ）。

## Progress

- [x] (2026-09-30) 既存画面・PIN・紐づけ先の調査、モック作成、ユーザー承認
- [x] (2026-09-30) API: キオスクPINガード、タグ横断照会、紐づけ・切り離し、付け外し記録テーブル、マスターCRUDの委譲（統合テスト5件）
- [x] (2026-09-30) Web: キオスク「タグ管理」画面（PIN、タグ面、一覧、編集パネル、吊具の点検記録、IDの手入力）
- [x] (2026-09-30) 管理コンソールの6画面を案内ページへ置き換え、ナビから外した
- [x] (2026-09-30) ローカル検証: Web全テスト 2236件、API関連統合テスト 177件、lint、型検査、実画面での付け外し・登録
- [ ] PR、CI、マージ、デプロイ（integrationPending）

## Surprises & Discoveries

- 社員・工具の更新APIは `nfcTagUid: ''` を「変更なし」に変換する（`apps/api/src/routes/tools/employees/schemas.ts` の `z.literal('').transform(() => undefined)`）。管理画面では紐づけを外せなかった。
- 計測機器と吊具は1台に複数タグを持てる（`MeasuringInstrumentTag` / `RiggingGearTag` は別テーブル）。社員と工具は1件に1タグ。
- どのタグ行も他テーブルから外部キーで参照されていない。外してもマスターや履歴（貸出、点検、承認スナップショット）は消えない。
- 在庫の4桁PIN検証は `apps/api/src/routes/item-inventory/index.ts` の中にだけある。ヘッダー `x-kiosk-access-password` で渡す方式。

## Decision Log

- Decision: 既存の管理APIの認可は変えず、キオスク専用ルート `/api/kiosk/tag-desk/*` を新設して既存サービスへ委譲する。
  Rationale: 既存の管理者向けルートや他の利用者への影響をなくし、PINで守る範囲をこのデスクに限定するため。
  Date/Author: 2026-09-30 / Claude
- Decision: PINは納期管理・在庫の準備と共通の4桁（`verifyDueManagementAccessPassword`、location `shared`）。在庫側のガードは触らず、同じ仕組みの共通ガード `apps/api/src/lib/kiosk-settings-pin.ts` を新設する。
  Rationale: ユーザー承認済み。在庫設定のエラーコードやテストを変えないため。
  Date/Author: 2026-09-30 / Claude
- Decision: 在庫の棚・数量・補充タグは、この画面では外すことだけ行う。付けるのは従来どおり「在庫の準備」。
  Rationale: ユーザー承認済み。在庫タグは棚の区画と種類を伴うため。
  Date/Author: 2026-09-30 / Claude
- Decision: 紐づけ時、UIDがどこかで使われていれば 409 で拒否する（先に外す）。相手が既にタグを持つ場合、社員・工具は `replace: true` のときだけ付け替える。計測機器・吊具は追加になる。
  Rationale: 二重登録を新たに作らないため。
  Date/Author: 2026-09-30 / Claude
- Decision: 付け外しを `NfcTagBindingEvent` テーブルに記録する（追加のみのマイグレーション）。
  Rationale: 外したタグを別の人に再利用すると、履歴スナップショットのUIDが別人を指す。いつ誰から外したかを追えるようにする。
  Date/Author: 2026-09-30 / Claude

## Outcomes & Retrospective

ローカルでは、1920×1080 の実画面で、PIN→二重登録タグの表示→片方を外す→未使用タグを一覧の相手に付ける→工具の登録→吊具の点検記録パネルまでを確認した。Mac ではNFCが無効なため、読み取り面に「IDを手で入れる」を加えた（実機のリーダー不調時の予備にもなる）。在庫タグをかざすと在庫画面へ飛ぶ全体ルーターは、`/kiosk/tag-desk` では止めた。

未完了: PR、main CI、マージ、Pi5 標準デプロイ、実機（Pi4 + NFCリーダー）での確認。

## Context and Orientation

API は `apps/api`（Fastify + Prisma + PostgreSQL）、Web は `apps/web`（React + Vite + TanStack Query + Tailwind）。キオスクは工場の端末（21.5インチ 1920×1080、Pi4 と NFC リーダー）で動く Web 画面で、管理者ログインはなく、端末ごとのクライアントキー（HTTP ヘッダー `x-client-key`）で API を呼ぶ。NFC の読み取りは `apps/web/src/hooks/useNfcStream.ts` がローカルのエージェントから受け取る。

タグの保存場所は5か所。`Employee.nfcTagUid` と `Item.nfcTagUid`（1件1タグ、列を null にすると外れる）、`MeasuringInstrumentTag.rfidTagUid` と `RiggingGearTag.rfidTagUid`（行を消すと外れる、1台複数可）、`InventoryNfcTag.uid`（在庫の棚・数量・補充タグ、行を消すと外れる）。スキーマは `apps/api/prisma/schema.prisma`。

移設元の管理画面は `apps/web/src/pages/tools/` の `EmployeesPage.tsx`、`ItemsPage.tsx`、`MeasuringInstrumentsPage.tsx`、`InstrumentTagsPage.tsx`、`RiggingGearsPage.tsx`、`UnifiedItemsPage.tsx`。ルートは `apps/web/src/App.tsx`、ナビは `apps/web/src/layouts/AdminLayout.tsx`。キオスクの上部タブは `packages/shared-types/src/kiosk/kiosk-header-tab-order.ts` の ID 一覧と、`apps/web/src/features/kiosk/kioskHeaderTabs/` の描画・ラベル。

既存のマスターサービスは `apps/api/src/services/tools/employee.service.ts`、`item.service.ts`、`apps/api/src/services/measuring-instruments/measuring-instrument.service.ts`、`apps/api/src/services/rigging/rigging-gear.service.ts`。入力スキーマは各ルートの `schemas.ts`。

## Plan of Work

API では、まず `apps/api/src/lib/kiosk-settings-pin.ts` に PIN ガードを作る。`x-client-key` で端末を確かめ、`x-kiosk-access-password` の4桁を共通パスワードと照合し、端末ごとに1分10回の失敗で 429 を返す。次に `NfcTagBindingEvent` モデルとマイグレーションを追加する。`apps/api/src/services/tag-desk/` に照会・紐づけ・切り離し・一覧・記録のサービスを置き、`apps/api/src/routes/kiosk/tag-desk.ts` から公開する。マスターの登録・編集・削除は同じルートファイルから既存サービスへ委譲する。

Web では `apps/web/src/features/kiosk/tag-desk/` に画面部品を作り、`apps/web/src/pages/kiosk/KioskTagDeskPage.tsx` を `/kiosk/tag-desk` に登録する。PIN 画面は在庫の準備の `InventoryPinPad` と同じ作り。上部タブに `tag_desk`（ラベル「タグ管理」）を加える。管理コンソールの6画面のルートは、キオスクへの案内を出す1画面に置き換え、ナビからは外す。

## Concrete Steps

作業ディレクトリは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-tag-desk`。

    pnpm --filter api prisma migrate dev --name nfc_tag_binding_event   # 開発DBがある場合。ない場合は SQL を手で書く
    pnpm --filter api test -- tag-desk
    pnpm --filter web test -- tag-desk
    pnpm lint && pnpm -r typecheck && pnpm --filter web build

## Validation and Acceptance

キオスクで「タグ管理」タブを開くと、4桁の入力を求められる。正しい4桁で一覧が出る。使用中のタグをかざすと、紐づけ先と最近の使用が左に出て、一覧の該当行が線でつながる。「外す」→「外す」で紐づけが外れ、一覧のタグ欄が「タグなし」になり、「最近の付け外し」に1行増える。同じタグで持出をしようとすると「タグが見つからない」扱いになる。未使用のタグをかざして一覧で「選ぶ」→「付ける」で紐づけられる。使用中のタグを別の相手に付けようとすると、どこで使われているかが表示されて拒否される。API の統合テストで、PIN なしは 403、誤りは 403、正しい PIN では紐づけ・切り離し・マスターの登録と編集ができることを確かめる。

## Idempotence and Recovery

マイグレーションはテーブルの追加だけで、既存データを変えない。外す操作は、既に外れている場合は 404 を返すだけで何も変えない。戻すときはキオスクで付け直すか、管理者がCSVで再登録する。

## Artifacts and Notes

モック: `https://claude.ai/artifact/1UNF8gFyeiRpuB4pGThxsf`

## Interfaces and Dependencies

すべてのルートは `x-client-key` と `x-kiosk-access-password` が必要。

    POST   /api/kiosk/tag-desk/verify-access-password   { password }            -> { success }
    GET    /api/kiosk/tag-desk/registry?kind=employee|item|instrument|rigging -> { rows: TagDeskRow[] }
    GET    /api/kiosk/tag-desk/tags/:uid                                       -> { uid, bindings: TagBinding[] }
    POST   /api/kiosk/tag-desk/bindings   { kind, targetId, uid, replace? }    -> { binding }
    DELETE /api/kiosk/tag-desk/bindings   { kind, bindingId }                  -> { ok }
    GET    /api/kiosk/tag-desk/events?limit=                                    -> { events }
    POST/PUT/DELETE /api/kiosk/tag-desk/employees|items|measuring-instruments|rigging-gears(/:id)
    POST   /api/kiosk/tag-desk/rigging-gears/:id/inspection-records
