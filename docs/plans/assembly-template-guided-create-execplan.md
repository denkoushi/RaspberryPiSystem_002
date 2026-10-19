# Guide assembly template creation on one screen

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

組立テンプレートの新規作成者が、機種名を選んだだけで保存できるように見える状態をなくし、基本設定、文書と表示手順、工程と締付点、確認と保存の順で不足項目を把握できるようにする。編集は従来どおり一画面内で自由に往復できるが、保存はWebとAPIの必須条件をすべて満たした場合だけ可能になる。

文書集合、表示手順、工程、締付点という既存のデータ所有関係は維持する。HTTP API、Prisma schema、migration、Excel列は変更しない。

## Progress

- [x] (2026-07-27 20:45 JST) 現行ドキュメント、ADR、Web/API実装、テスト、Prisma schemaを調査した。
- [x] (2026-07-27 20:46 JST) `main`をfast-forward確認し、`feat/assembly-template-guided-create`を作成した。
- [x] (2026-07-27 20:47 JST) 本ExecPlanと設計ADRを作成した。
- [x] (2026-07-27 20:58 JST) Webのdraft型、表示名生成、適合グループ照合、readiness判定を純粋モジュールへ分離した。
- [x] (2026-07-27 21:01 JST) 4段階ガイド、構成ペイン、締付条件エディタ、工程順序・削除を実装した。
- [x] (2026-07-27 21:02 JST) 保存ゲートとpayload serializerをAPI契約へ一致させた。
- [x] (2026-07-27 21:12 JST) unit、React、Playwright、API統合テストを更新した。
- [x] (2026-07-27 21:23 JST) 隔離Postgresでmigration、SQL、EXPLAIN、関連テストを検証し、Docker資源を全削除した。
- [x] (2026-07-27 21:23 JST) full test、lint、build、差分健全性を確認した。

## Surprises & Discoveries

- Observation: 現行の保存ボタンは新規・雛形作成時に機種名だけを判定するが、APIは各工程の締付点、締結条件、適合グループまで要求する。
  Evidence: `KioskAssemblyTemplateEditorPage.tsx`の保存ボタン条件と、`apps/api/src/routes/assembly/index.ts`および`assembly-template.service.ts`の入力検証が一致していない。

- Observation: 左ペインの文書上下ボタンによる順序は保存直前に表示手順の初出順へ置換される。
  Evidence: `orderProcedureItemsByFirstStep`が保存payloadを生成し、現行Reactテストも手動移動より初出順を期待している。

- Observation: システムNodeはv18でpackage engine要件外だが、Codex bundled Node 24が利用可能である。
  Evidence: `node --version`はv18.20.8、workspace dependencyのNodeは`/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

- Observation: workspaceのpnpm wrapperは非対話実行時に古いストアのpurgeを試みるため、検証スクリプトではbundled Node 24から各CLIを直接起動する必要があった。
  Evidence: wrapper実行時のpurge確認を避け、Vitest、ESLint、TypeScript、Vite、Prisma、PlaywrightのCLI entry pointをNode 24で直接実行した。

- Observation: 最初のAPI型検査では生成済みPrisma Clientがschemaより古かったが、空の隔離DBへ接続した`prisma generate`後は型検査とproduction buildが成功した。
  Evidence: 最終検証スクリプトは`prisma validate`、`generate`、`migrate deploy`、`migrate status`の順で実行し、API buildも通過した。

- Observation: 900×900ではデスクトップ3ペインの高さ制約により左ペインが縮み切る可能性があった。
  Evidence: Playwrightの900×900ケースで検出し、`xl`未満の構成・締付条件ペインへスクロール可能な最小高さを設けた。

- Observation: 最初のfull Web testとlintは、新しいnullable数値契約へ未追従の既存fixture一件と、新規テストのimport順一件を検出した。
  Evidence: fixtureを明示的なトルク値へ更新し、import順をプロジェクト規約へ合わせた後、315 test filesと全lintが成功した。

- Observation: 関連Playwright仕様全体を追加実行すると、旧仮値のラベル、閉じた基本設定、認証直後のストーリーボード表示を前提とする既存assertionが見つかった。また、ペインの操作領域拡大後に古いcanvas矩形を再利用する座標テストが不安定になった。
  Evidence: 新しい白紙仕様と初期表示にassertionを合わせ、各canvas操作直前にbounding boxを再取得した後、関連仕様16件すべてが成功した。

## Decision Log

- Decision: 強制ウィザードではなく、同一画面上の4段階ガイドとクリック可能な未完了一覧を採用する。
  Rationale: 手順書を見ながら工程と締付条件を往復編集する既存操作を維持しつつ、初見利用者へ作成順を示せる。
  Date/Author: 2026-07-27 / user and Codex

- Decision: 新規の業務固有値を空欄にし、手順書指定時だけ文書と全ページ表示手順を初期化する。
  Rationale: 手順7、工程13、M6×30などを別製品へ誤流用する危険をなくす。
  Date/Author: 2026-07-27 / user and Codex

- Decision: 文書順は表示手順で最初に現れる順から算出し、独立した上下操作を廃止する。
  Rationale: 現行保存仕様とUIの競合をなくし、作業者が見る順序を唯一の並び順にする。
  Date/Author: 2026-07-27 / user and Codex

- Decision: ボルト表示名は新規では締結条件から自動生成し、既存値はカスタム値として保持する。
  Rationale: 二重入力を減らしながら、旧テンプレートの独自Excel表記を改版で失わない。
  Date/Author: 2026-07-27 / user and Codex

- Decision: 既存DBを検証に使用せず、固有label、volume、network、動的localhost portを持つ一時Postgresだけを使用する。
  Rationale: 既存コンテナ・DBのデータ変更を構造的に防止する。
  Date/Author: 2026-07-27 / user and Codex

## Outcomes & Retrospective

新規作成画面は、基本設定、文書と表示手順、工程と締付点、確認して保存の4段階を常設し、未完了項目から対象入力へ移動できるようになった。直接新規URLは文書を暗黙選択せず、手順書起点だけが文書と全ページ手順を初期化する。機種名だけでは保存できず、保存直前にもreadinessを再評価するため不完全なpayloadは送信されない。

文書順は表示手順の初出順を読み取り専用表示し、未使用文書を保存不可として扱う。工程は完了状態、上下移動、影響件数付き削除を持つ。新規締付点の業務値は空欄で、数値空欄を0へ変換しない。ボルト仕様は条件から自動生成され、既存の保存済み表記はカスタム値として保持される。新規画面の旧形式表示も除去した。HTTP API、Prisma schema、migration、Excel列は変更していない。

最終検証では、156 migrationを2つの空DBへ適用した。focused REQUIRED API契約は1件成功し、SQLで文書・工程・締付点・適合グループの関連行と異常系0件を確認した。20,100件fixtureに対する`EXPLAIN (ANALYZE, BUFFERS)`は`TorqueWrenchCapabilityGroup_idx_fastener_active`のIndex Scanを使用した。

全体ではAPI 470 files・2,473 tests、Web 315 files・1,567 tests、通し検証内の新規受入Playwright 4 testsが成功した。さらに同じPlaywright仕様ファイル全体16 testsを実行し、既存のズーム、マーカー、ストーリーボード、300手順仮想化を含めて成功した。Web/API lint、shared-types/API/Web production build、`git diff --check`も成功した。検証用container、volume、network、作業ディレクトリはtrapで削除し、専用labelの残存件数はすべて0だった。

既知の非阻害事項は、既存テスト群が出すReact Router future flag、`act(...)`、古いBrowserslist、大きいVite chunkの警告である。今回の変更に起因する失敗や未完了項目は残っていない。

## Context and Orientation

画面の調停は`apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx`が担い、文書構成は`apps/web/src/features/assembly/AssemblyTemplateProcedurePane.tsx`、draft変換は同フォルダの`assemblyTemplateDraft.ts`と`assemblyProcedureStepDraft.ts`が担う。API入力検証は`apps/api/src/routes/assembly/index.ts`、保存時の業務検証とtransactionは`apps/api/src/services/assembly/assembly-template.service.ts`にある。

`AssemblyTemplateProcedureItem`はテンプレートが利用する文書集合、`AssemblyTemplateProcedureStep`は作業画面へ表示する全体ページまたは矩形の平坦な順序である。明示ステップがある場合、文書の保存順は各文書がステップへ最初に現れる順から決まる。工程は一件以上必要で、各工程は一件以上の締付点を持つ。新規・改版は`traceabilityMode: REQUIRED`であり、各締付点に呼び径、正の長さ、材質、強度区分、有効かつ条件一致する適合グループが必要である。

## Plan of Work

まずWebの編集draftをAPI input型から分離し、空の数値を`null`として保持する。新規工程と締付点から業務固有の仮値を除去し、既存DTOから読み込む値はそのまま保持する。表示用ボルト仕様は自動・カスタムのmodeを持ち、保存時に一つの有効文字列へ解決する。

次にreadinessをReactから独立した純粋関数として実装する。基本設定、文書と表示手順、工程と締付点の問題を安定したコードとfocus targetへ変換し、確認段階は前三段階と適合グループcatalogの状態から導出する。ページはこの結果だけで保存可否とガイド表示を決め、保存イベントでも再評価する。

構成ペインは基本設定、表示手順由来の使用文書、工程設定へ責務を分ける。文書上下操作をなくし、工程には上下移動、完了状態、確認付き削除を追加する。右ペインの締付条件フォームは独立コンポーネントへ分離し、自動表示名と任意上書きを提供する。

最後に現行の誤った保存有効テストを修正し、純粋関数、React、Playwright、API統合テストで契約を固定する。隔離Postgresへ全migrationを適用し、SQL、EXPLAIN、APIテストを実行してcleanupを検証する。

## Concrete Steps

作業ディレクトリは`/Users/tsudatakashi/RaspberryPiSystem_002`とする。Nodeとpnpmは次を使用する。

    export PATH="/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/tsudatakashi/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"

focused Web test、API integration、Playwright、full test、lint、buildを順に実行する。Docker検証では`pgvector/pgvector:pg15`がなければpullし、固有tokenを付けたcontainer、volume、networkを作る。`pnpm test:postgres:start`は固定名の既存containerを削除するため使用しない。

## Validation and Acceptance

手順書行の「新規」から入ると、その文書と全ページ手順だけが入り、基本設定と工程は空欄でガイドが開く。直接`/kiosk/assembly/templates/new`へ入ると文書は自動選択されない。機種名だけでは保存できず、未完了一覧から不足欄へ移動できる。全工程に一件以上の完全な締付点があり、文書・表示手順・適合グループが有効な場合だけ保存できる。

文書番号は表示手順の移動へ追従し、文書上下ボタンは存在しない。新規締付点の表示名は条件から生成され、既存テンプレートの保存済み表示名は改版後も保持される。新規画面に「旧形式を取込」は出ず、旧形式を実際に読み込んだ編集画面だけに出る。

## Idempotence and Recovery

一時Docker資源は固有labelで識別し、EXIT、INT、TERMのtrapですべて削除する。cleanup後に同じlabelのcontainer、volume、networkが0件であることを検証する。migrationは空の一時DBへだけ適用する。

実装中にテストが失敗した場合は、その時点のProgressとSurprises & Discoveriesを更新してから原因を修正する。ユーザーの既存変更をstash、reset、checkoutで破棄しない。

## Artifacts and Notes

検証コマンドは`scripts/test/validate-assembly-template-guided-create.sh`へ固定した。最終実行結果は、migration 156件、fixture 20,100件、使用index `TorqueWrenchCapabilityGroup_idx_fastener_active`、Docker label residue 0である。

## Interfaces and Dependencies

`evaluateAssemblyTemplateReadiness`はdraft、文書、表示手順、ページ、適合グループcatalog状態を受け取り、`isReady`、段階状態、問題配列を返す。問題は`basic`、`document`、`step`、`area`、`bolt`のfocus targetを持つ。

`resolveAssemblyBoltSpec`はdraftの締結条件と表示名modeからAPIへ送る`boltSpec`を返す。`serializeAssemblyTemplateDraftAreas`はreadiness通過済みのdraftだけをAPI inputへ変換し、未入力数値を暗黙の0へしない。

締結文字のNFKC、空白除去、大文字化は`@raspi-system/shared-types`からWebとAPIの双方へ提供する。新しいHTTP endpoint、Prisma model、migration、外部libraryは追加しない。
