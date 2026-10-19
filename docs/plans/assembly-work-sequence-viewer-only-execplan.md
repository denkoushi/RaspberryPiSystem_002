---
title: 組立作業画面 新ステップUI完全移行 ExecPlan
status: completed
created: 2026-07-27
branch: fix/assembly-work-sequence-viewer-only
related:
  - ./assembly-procedure-step-storyboard-execplan.md
  - ./assembly-crop-shared-marker-followup-execplan.md
  - ../decisions/ADR-20260726-assembly-template-procedure-steps.md
---

# 組立作業画面を常に新ステップUIで表示する

この文書は `.agent/PLANS.md` に従う living document である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業中も更新し、このファイルだけから再開できる状態を保つ。

## Purpose / Big Picture

キオスクの組立作業画面は、テンプレートに明示ステップが保存されているか、既存文書から全ページを自動展開しているかに関係なく、ストーリーボード、前手順・次手順、全体マップを備えた新ステップUIを表示する。APIが `mode: fallback` を返しても、表示可能な `documents` または `steps` があれば同じ新UIを使う。読込中、取得失敗、表示ページ0件も旧画面へ戻さず、新UI領域の状態表示として扱う。

現在は `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` が `mode === "configured"` の時だけ `AssemblyProcedureSequenceViewer` を表示し、それ以外では旧 `AssemblyProcedureCanvas` を直接表示する。本番の既存業務テンプレートは、APIが `document_expansion` の有効なステップを返していても `mode: fallback` であるため旧画面へ分岐する。本計画はこのWeb分岐と検証漏れを修正する。REST API、DB、Prisma migration、締付と必須チェックによる作業完了条件は変更しない。

## Progress

- [x] 2026-07-27: `main` のクリーン状態と `origin/main` との一致を確認し、`fix/assembly-work-sequence-viewer-only` を作成した。
- [x] 2026-07-27: 本番セッション、Web分岐、API resolver、既存テストを読み取り、fallbackレスポンスに有効ステップがあっても旧Canvasへ分岐する原因を特定した。
- [x] 2026-07-27: 新UI専用の読込状態、再試行、stale response破棄を行うhookを実装した。
- [x] 2026-07-27: 組立作業画面から旧Canvas分岐、`mode === "configured"`判定、主手順書への直接fallbackを削除した。
- [x] 2026-07-27: Web、Playwright、API統合の回帰テストを追加した。
- [x] 2026-07-27: ADR、索引、先行ExecPlanの後継リンクを更新した。
- [x] 2026-07-27: Web全1,534件、lint、build、Playwright 8件、隔離DBの組立API統合30件を完了した。
- [x] 2026-07-27: PR #1098の必須CI、CodeQL、secret scanが不変SHA `8ea1ffc0` で成功したことを確認し、`8338957ed3cee1f40bd123b0b2ea3afd0164acf1` としてmainへ統合した。
- [x] 2026-07-27: 標準rolling release `20260727-041613-dc7b07`でPi5と全キオスクのWeb identityを更新し、maintenance解除、同SHAのno-op plan、Phase12 `PASS 47 / WARN 0 / FAIL 0`を確認した。
- [x] 2026-07-27: `raspi4-assembly-01`で完了済みfallbackセッションと無効化済み明示crop検証セッションを読み取り専用で開き、両方が新ステップUIを表示する実機受入を完了した。

## Surprises & Discoveries

- Observation: 新viewer自身は `mode` を参照せず、`steps` がなければ `documents` から全ページステップを合成し、ページ0件では専用の空状態を表示できる。
  Evidence: `apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx` の `fallbackSteps` と空状態分岐。
- Observation: 本番の進行中セッション9件はすべて `mode: fallback`、`source: primary_fallback`、`stepSource: document_expansion` で、1件の有効な全体ステップを返していた。
  Evidence: 2026-07-27の本番read-only API確認。
- Observation: 配信中のWeb chunkには新UI文言が含まれるため、古いreleaseやブラウザcacheではなく実行時分岐が原因である。
  Evidence: 配信assetから「前手順」「次手順」「現在の丸数字へ」「全体を一時表示」を確認した。
- Observation: 追加した4件のWeb回帰テストは実装前にすべて失敗し、DOM上に旧Canvas test IDと「手順書」ヘッダーが現れた。
  Evidence: 変更前の対象Vitestは14件成功、4件失敗。実装後は既存分を含む18件すべて成功した。
- Observation: ローカルPlaywright設定はCI以外でWeb serverを自動起動しない。
  Evidence: 初回実行は8件すべて`localhost:4173`接続拒否になり、Viteを明示起動した再実行では8/8件成功した。
- Observation: 完了済み業務セッションは `mode: fallback` でも `stepSource: document_expansion` の全体ステップを持ち、版4のページ紐づき丸数字と矢視を新viewerで描画できた。
  Evidence: 本番read-only APIと `raspi4-assembly-01` の実画面で「手順 1/1」、左ストーリーボード、丸数字1〜3、矢視を確認した。
- Observation: 無効化済み検証セッションはsummary一覧には現れないが、監査証跡の既知IDでは読み取り可能で、`template_steps` の全体1件とcrop1件を保持していた。
  Evidence: Firefox履歴をread-onlyで参照して検証セッションを特定し、APIと実画面で「手順 1/2」「手順 2/2」、全体・矩形、共通丸数字1・2・4、矢視、チェック必須1/1、cropミニマップを確認した。矩形外の丸数字3はcropに表示されなかった。

## Decision Log

- Decision: APIの `mode` と `reason` はデータ由来の診断情報として残し、Webの画面選択には使わない。
  Rationale: 既存API利用者を壊さず、旧テンプレートの動的展開も新UIへ統一できるため。
  Date/Author: 2026-07-27 / Codex
- Decision: API取得中、取得失敗、空手順にも旧Canvasを使用しない。取得失敗では明示的な再試行を提供する。
  Rationale: 一瞬の旧UI表示と、通信異常を旧仕様と誤認する経路を同時に除くため。
  Date/Author: 2026-07-27 / Codex
- Decision: `AssemblyProcedureCanvas` moduleはエディタと新viewerの描画部品として残し、作業ページから直接表示する経路だけを削除する。
  Rationale: 「旧UIの撤去」と共有描画部品の破壊を混同しないため。
  Date/Author: 2026-07-27 / Codex

## Outcomes & Retrospective

PR #1098で組立作業画面の旧Canvas直表示経路を撤去し、APIの`mode`に関係なく新viewerを使うようにした。loading、error、emptyも新UI専用状態で扱い、公開API、DB、migration、作業完了条件は変更していない。

必須CI、CodeQL、secret scanが成功した不変SHAだけをmainへ統合し、標準rolling releaseでPi5 API/Webと全6キオスクのWeb identityを検証した。release後のplanは対象0件のno-opとなり、Phase12は47件すべて成功した。

実機では完了済みfallback業務セッションに「要領書」「手順 1/1」、ストーリーボード、前後・全手順操作、丸数字と矢視が表示された。明示cropの無効化済み検証セッションでは全体とcropを前後移動し、同じマーカーとチェック状態、矢視、cropミニマップを確認した。トルク、チェック、工程、テンプレート、業務データは変更していない。検証用Firefoxウィンドウを閉じて通常の組立トップへ戻し、Pi4/Pi5の一時ツールと画像を残存0にした。

## Context and Orientation

`apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` は作業セッション、NFCゲート、手順表示、締付操作を統合するページである。`apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx` は明示ステップと文書自動展開の両方を平坦なステップとして表示する。APIの `apps/api/src/services/assembly/assembly-procedure-sequence.service.ts` は、既存テンプレートで `mode: fallback` を返す場合にも `documents` と `document_expansion` の `steps` を生成している。

「fallback」は手順データがテンプレート版の明示文書列ではなく主手順書等から得られたことを示す。今後は旧画面を選ぶ意味にはしない。作業画面の現在ページはviewerが通知する文書種別、文書ID、ページ番号で表し、丸数字とチェックを同じ元ページから抽出する。

## Plan of Work

最初に手順取得を `idle`、`loading`、`ready`、`error` の判別可能な状態として返す専用React hookへ分離する。このhookはNFC認証前には取得せず、セッション変更時に古い結果を消し、遅れて完了した旧リクエストを無視し、失敗後の再試行を提供する。

次に作業ページから `hasConfiguredProcedureSequence`、`fallbackPageRef`、旧 `AssemblyProcedureCanvas` の描画分岐を削除する。`ready` ではレスポンスの `mode` に関係なくviewerを表示し、loadingとerrorには新UI領域内の専用表示を置く。現在ページがない時のマーカーは空配列とし、別文書や過去セッションのマーカーを表示しない。ヘッダーは常に「要領書」とする。

最後に本番と同じ `fallback + primary_fallback + document_expansion` fixtureをWebとPlaywrightへ追加し、API統合テストでもfallbackレスポンスに全体ステップが含まれることを固定する。ADRには作業画面の表示方針を追記し、既存の完了済みExecPlanは履歴を変えず後継リンクだけを追加する。

## Concrete Steps

作業ディレクトリはリポジトリルート `/Users/tsudatakashi/RaspberryPiSystem_002` とする。Codex同梱Node 24をPATH先頭に置き、対象Webテスト、Web全テスト、Web lint/build、対象Playwrightを実行する。

API統合テストは既存DBを使わない。固有名の `pgvector/pgvector:pg15` container、volume、networkと動的localhost portを作り、cleanup trapを登録して全migrationを適用する。そのDBに対して組立API統合テストを実行し、終了後はlabelで残存0件を確認する。DBスキーマとクエリを変更しないため、migration validator、制約SQL、EXPLAINは実行しない。

ローカル検証後にPRを作成し、必須CI、CodeQL、secret scanが成功した不変SHAだけをmainへ統合する。標準rolling releaseは以下を使い、直接SSH配布は行わない。

    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
    scripts/deploy/verify-phase12-real.sh

## Validation and Acceptance

Web単体テストは、configuredとfallbackの両方が新viewerを表示すること、初回読込中と再試行中に旧画像が出ないこと、取得失敗から再試行できること、空手順が専用メッセージになること、ヘッダーが「要領書」であることを確認する。作業ページのソースには `AssemblyProcedureCanvas` と `mode === "configured"` による表示分岐を残さない。

Playwrightは1366×768、1920×1080、900×900でfallback自動展開と明示cropの双方を通す。fallbackでも `手順 1/N`、全手順、前手順、次手順、現在の丸数字へ、丸数字と矢視が表示され、横overflowがないことを確認する。

本番反映後はread-only APIで既存業務セッションのfallbackステップを確認する。実機はまず完了済みfallbackセッションを開き、新UIだけが表示されることを確認する。該当セッションがない場合のみ利用者本人のNFCスキャンを待ち、進行中セッションで画面表示だけを確認する。トルク記録、チェック、工程移動、テンプレート変更は行わない。明示cropセッションの退行確認も成功するまで受入完了としない。

## Idempotence and Recovery

Web変更とテストは繰り返し実行できる。専用hookはセッション変更や再試行で古いPromise結果を反映しない。隔離DB資源は固有labelとtrapで必ず削除する。デプロイ失敗時は標準rolling releaseのsealed manifest、cancel、rollback契約に従い、手動で本番状態を書き換えない。

## Artifacts and Notes

実装前の原因証拠は、作業ページの `procedureSequence?.mode === "configured"` 条件、APIのfallbackレスポンスに含まれる `document_expansion` steps、本番配信chunkに存在する新UI文言である。

- Codex同梱Node 24.14.0でWeb全testを実行し、310ファイル、1,534件が成功した。
- Web lintはwarning 0、production buildは成功した。
- 対象Playwrightはfallback自動展開と明示cropを1366×768、1920×1080、900×900で実行し、8/8件が成功した。
- 固有名の一時PostgreSQLへ全156 migrationをfresh適用し、組立API統合test 30/30件が成功した。cleanup後のcontainer、volume、networkは各0件だった。
- 作業ページの静的検索で `AssemblyProcedureCanvas`、`hasConfiguredProcedureSequence`、`fallbackPageRef`、`mode === "configured"` は0件である。
- PR #1098は実装SHA `8ea1ffc013d18f28ab622553b28b8c479f3e53d4` の全必須check成功後、main SHA `8338957ed3cee1f40bd123b0b2ea3afd0164acf1` としてsquash統合した。
- rolling release `20260727-041613-dc7b07` はexit 0。Pi5 API/Webと全6キオスクの `controlPlaneWeb` claimがmain SHAでverifiedとなり、全端末のmaintenance clearが成功した。
- release後の `--print-plan` はmutation、activation、verification対象がすべて0件でwarningなし。Phase12は `PASS 47 / WARN 0 / FAIL 0` だった。
- 実機受入は既存の完了済みfallbackセッションと、取消・無効化済みの専用cropセッションだけを読み取り、作業状態を変更せずに行った。

## Interfaces and Dependencies

Web内部に `useAssemblyWorkProcedureSequence` を追加し、入力として `sessionId` と `enabled`、出力として判別可能な読込状態と `retry` を提供する。既存の `getAssemblyWorkSessionProcedureSequence` と `readAssemblyApiErrorMessage` を再利用し、新しい外部依存は追加しない。公開REST API、共有DTO、Prisma schemaは変更しない。
