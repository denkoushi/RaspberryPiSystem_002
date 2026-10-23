# コード健全化 第2期

この ExecPlan は生きた文書であり、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を作業の進行に合わせて更新する。書式と運用は `.agent/PLANS.md` に従う。

前期の計画と結果は [コード保守性の改善プログラム](code-health-refactor-execplan.md) にある（本計画はその残りと、前期の後に測り直して分かった弱点を扱う）。

## Purpose / Big Picture

前期（2026-10-17〜10-19）で、ファイル行数の歯止め、重複関数の共通化、業務 Hermes 部品の独立、巨大ファイル 5 本の分割、画面側のデータ取得の鍵（queryKey）の一部集約、業務エラーの HTTP 変換の一部集約、個人用コードの別リポジトリへの移設を終えた。2026-10-19 に測り直すと、画面側の鍵の直書きがまだ 285 か所、ファイル配信ルートの独自のエラー応答が 30 か所、テストのない 950 行超のファイルが 6 本、サポートの終わった ESLint 8 が残っていた。

この計画が完了すると、開発者は画面の鍵やエラー応答を一か所の定義から選ぶだけでよくなり、大きなファイルに手を入れる前にテストで今の動きを確かめられる。10 年保守する前提で、道具（lint）の更新が止まっている状態も解消する。どの段階でも本番の動作は変えないことを原則にする。例外は段階6（存在しないデータの削除・更新に対する応答を 400 から 404 に変える）だけで、ユーザーの判断を経てから行う。

業務のシステムと私用（個人用 Pi5、個人用 Hermes、Discord、DGX Control Plane）を混ぜない境界を前提にする。本計画が変更するのはこの業務リポジトリだけで、個人用のコードは前期の段階9で `denkoushi/DGXSparkControlPlane` へ移し終えている。業務 Hermes（キオスクの Chat の質問応答）のファイルは他のセッションが頻繁に変更しているので、前期と同じく本計画の分割の対象から外す。

## Progress

- [x] 段階1: 生産スケジュール設定の更新時に何も無効化していない鍵 2 つを消す。（2026-10-19 #2129、反映済み）
- [x] 段階2: 画面側の queryKey の直書き（285 か所）を領域ごとの定義へ集める。部品測定、バックアップ、計測機器と工具、サイネージとクライアント端末、残りの順。
  - [x] 自主検査と部品測定（#2131、285 → 231）
  - [x] バックアップと CSV 取込設定（#2132、285 → 237）
  - [x] 計測機器・吊具・工具（#2133、285 → 236）
  - [x] サイネージ・端末管理・システム状態（#2134、285 → 254）
  - [x] キオスク・要領書・稼働信号・可視化ダッシュボード（#2135、285 → 243）
  - [x] 管理画面の残り（CSV ダッシュボード・部品測定テンプレート・パレット機械イラスト・貸出レポート、#2141、61 → 39）
  - [x] キオスク在庫・タグ管理・作業指示・置き場の部品検索（#2142、61 → 32）
  - [x] マスタ取込後の無効化（`system.ts`、#2143、61 → 55）。#2138 で鍵の綴り違いを直した後に進めた。
  - [x] キオスクのパレット可視化の盤面（#2146、4 → 2）
  - 数字は各 PR の作成時点の main 比で、PR ごとの減り分は重ならない。2026-10-19 に #2141〜#2143 と #2146 を反映済みで、ユーザーの実機確認も済んだ。残る 2 か所（`DgxResourceDashboard.tsx` と `local-llm.ts`）は私用の DGX 側の画面なので本計画では触らない。
- [x] 段階3: ファイル配信ルートの 400/404/500 応答（9 ファイル 30 か所）を共通の小関数へ集め、部品測定の図面テンプレートの 4 か所を DomainHttpError へ移す。
  - [x] ファイル配信 9 ルートの読み込み失敗時の応答を `routes/storage/shared.ts` の `sendStorageReadError` へ集める（#2151）。応答とログは 1 文字も変えず、9 ルートの前後の値をテスト 57 件で固定した。パスがない 400 は文言と判定がルートごとに違うため、各ルートに残した。
  - [x] 図面テンプレートの 404/409 の 4 か所を `DomainHttpError` へ移す（#2152）。番号と文言は同じで、本文に `requestId` と `timestamp` が加わる。
  - 2026-10-19 に #2151 と #2152 を反映し、ユーザーの実機確認も済んだ。
- [x] 段階4: テストがあり変更の多い大きいファイルを分ける（在庫の service、製番ボードの画面、在庫の登録タブ、在庫の画面、組立の作業画面、組立の型定義）。
  - [x] 在庫の service（`item-inventory.service.ts`、1234 → 186 行、#2156）。写真・選択肢・取込登録・入出庫などを別ファイルの関数へ移し、クラスは 1 行の呼び出しだけにした。公開名 8 個は再エクスポートで同じ。
  - [x] 製番ボードの画面（`ProductionScheduleGrindingPlanningBoardPage.tsx`、1424 → 781 行、記録 1391 → 773、#2157）。600 行未満までは分けず、フックと表示の塊を `features/kiosk/grindingPlanningBoard/` へ移すところで止めた。
  - [x] 在庫の画面（`KioskItemInventoryPage.tsx`、722 → 543 行、#2158）
  - [x] 組立の型定義（`features/assembly/types.ts`、764 → 78 行、#2159）。7 ファイルへ移し、`types.ts` は再エクスポートだけにした。同じファイルを触る下書きの #1002 は main と衝突したまま止まっているので待たず、閉じずに残した。
  - [x] 組立の作業画面（`KioskAssemblyWorkSessionPage.tsx`、797 → 514 行、#2161）。テストの安定化 #1538 を先にマージしてから分けた。
  - [x] 在庫の登録タブ（`InventoryRegistrationTab.tsx`、737 → 543 行、#2171）。#2144 のマージ後に分けた。
  - 2026-10-19 に #2156〜#2161 を反映し、「在庫」「製番ボード」「組立」の実機確認も済んだ。#2171 も反映し、2026-10-20 に「登録待ち」タブの実機確認が済んだ。行数の記録は、web で 4 件を外して 1 件を下げ、api で 1 件を外した。
- [ ] 段階5: テストのない大きいファイル 6 本に、今の動きを固定するテストを足す。足し終えたものから分割を検討する。
  - [x] 検査図面の作成画面と自主検査の画面（各 12 件、#2174）。
  - [x] 納期管理の画面（12 件、#2176）。備考の保存に失敗したとき文言を出さずに入力欄を開いたままにする今の動きも、そのまま固定した。
  - [x] 部品測定のテンプレート処理（`part-measurement-template.service.ts`、10 件、#2178）。既存のテストで行の約 83% が通っていたので、残りの読み出しの入口だけに足した。
  - [ ] 作業手順の保存処理（`prisma-work-instruction-repository.ts` ほか）。既存の結合テスト 45 件が CI で動いていなかったので、新しく書かずに CI で有効にする（#2177）。ローカルでは保存処理の行の通過率が 0% から約 67% になった。
  - [x] 手動順番の画面（12 件＋フック 2 件、#2179）。テストを書く途中で不具合が見つかったため、修正と合わせて段階5とは別の PR にした（下の Surprises を参照）。
  - 2026-10-20 に #2174、#2176、#2178 をマージした（テストだけのため反映なし）。#2179 はマージして Pi5 へ反映した（run 20261020-040530-ea4a14）。手動順番の画面の実機確認と、#2177 のマージが残っている。分割の検討は、これらが済んでから行う。
- [x] 段階6（要判断）: 共通のエラーハンドラーが受け止める Prisma の P2025 を 400 ではなく 404 で返す。（2026-10-22 #2198、反映済み）
  - 2026-10-21 に洗い出した。ルートや service で受け止めずに P2025 が共通のエラーハンドラーまで届くのは、9 か所である。アイテムの更新、吊具の更新・削除、吊具タグの削除、サイネージのスケジュールと PDF の更新・削除、キオスク文書の有効・無効の切り替えが該当する。画面側で応答の番号を見て表示を分ける 39 か所は、どれもこの 9 か所を呼ばない。変わるのは管理画面 4 つで、ほかの人が先に消したデータを操作したときの文言だけである（「データベースエラーが発生しました。」から「対象のデータが見つかりません」へ変わる）。
  - ユーザーの了承を得て、`error-handler.ts` の Prisma の 2 つの分岐（型で判定する分岐と、型の判定が外れたときの予備の分岐）に P2025 を足し、404 で返すようにした。
  - 結合テスト `rigging-tags.integration.test.ts` に、存在しない吊具タグの削除が 400 を返すという今の動きを固定したテストがあった。CI で失敗して気づいたので、期待値を 404 に直した。
  - 2026-10-22 にマージし（fb406e5a）、Pi5 へ反映した（run 20261021-232817-34da4c、成功、health 200）。
- [x] 段階7（要判断）: ESLint 8 を 9 へ上げ、設定を新しい形式へ移す。行数の歯止めの記録スクリプトも合わせて直す。（2026-10-22 #2220、#2227）
  - 2026-10-22 にユーザーの「今すぐやる」の回答を受けて始めた。ESLint は 9.39.5 にした（`eslint-plugin-import` 2.32.0 が 10 系に対応していないため 9 系に留める）。typescript-eslint は 8.71.1、`eslint-plugin-react-hooks` は 5.2.0（7 系で増える React Compiler 向けの規則を入れないため）。
  - #2220 で apps/api を、#2227 で apps/web と packages の 4 つを `eslint.config.mjs` へ移した。依存の向きの規則と日本語の文言、`import/no-cycle`、行数のラチェット（`eslint-max-lines-baseline.json`）と個別の上限は同じ内容で移した。`scripts/ci/max-lines-baseline.mjs` は #2220 で 8 と 9 の両方に対応させ、#2227 で 8 の分岐を外した。
  - 確かめたこと: `pnpm -r lint --max-warnings=0` が通る。`apps/api/src` と `apps/web/src` に 650 行の仮ファイルを置くと `File has too many lines (650). Maximum allowed is 600` で失敗する（確認後に削除）。`max-lines-baseline.mjs check api` / `check web` の出力が移行前と同じ。lint の対象ファイルの一覧が移行前と同じ（api 2305、web 1955、kiosk-sop-core 14、part-search-core 9、shared-types 46、shelf-layout-core 7）。移行前後の規則一覧の差が、下の Decision Log に書いたものだけである。
  - 2026-10-22 に #2220（e6483c10）と #2227（cde31f9d）をマージした。#2220 は Pi5 へ反映し（run 20261022-021946-b30856、health 200）、#2227 は後続を含む f8cda1ca として Pi5 へ反映した（run 20261022-075628-bb2afe）。開発時の道具だけの変更なので、本番の動作は変わらない。

## Surprises & Discoveries

- Observation: 業務 Hermes のファイルの直近 90 日の変更回数は 1 回と少なく見えるが、2026-10-17 に `services/assembly/` から `services/business-hermes/` へ移したためで、移動前の履歴が数に入っていない。画面側の `HermesFloatingChat.tsx` は 90 日で 35 回変更されており、実際の変更頻度は高い。
  Evidence: `git log --since=90.days --oneline -- <path>`（`--follow` なし）の結果。
- Observation: 型の `any` は少なく、健全である。apps/api のテスト以外で 14 か所（lint の例外指定は 16 か所）、apps/web で 2 か所。本計画の対象にしない。
  Evidence: `rg -c ':\s*any\b|as any\b|<any>' apps/api/src apps/web/src`（テストと生成物を除く）。
- Observation: lint の例外指定は apps/api に 99 か所あり、うち 73 か所が `no-await-in-loop`（順番に待つ必要がある DB 処理）、apps/web は 22 か所のうち 19 か所が `react-hooks/exhaustive-deps` だった。後者は画面の再描画の条件に関わり、外すと動きが変わり得るので、本計画では数えるだけにする。
  Evidence: `rg -o 'eslint-disable(-next-line|-line)?\s+[@a-z/-]+' apps/*/src` の集計。

- Observation: `apps/web/src/api/hooks/system.ts` の `useImportMasterSingle` は、計測機器と吊具の CSV 取込の後に `['measuringInstruments']` と `['riggingGears']` を無効化しているが、実在の鍵は `'measuring-instruments'` と `'rigging-gears'` なので何も無効化しておらず、取込後に一覧が自動で更新されない。直すと動きが変わるため段階2では値をそのまま残し、別の PR で扱う。→ #2138 で直した（2026-10-19 反映）。
  Evidence: `rg -n "'measuringInstruments'\]|'riggingGears'\]|'measuring-instruments'|'rigging-gears'" apps/web/src`。
- Observation: 段階2の PR は互いに別のファイルを触るように分けたが、`clients.ts` の `['kiosk-config']` や `system.ts` の `employees` / `items` のように、別の PR の定義を使う箇所は、その PR のマージ後に残りの組で扱う。
  Evidence: #2133〜#2135 の本文。
- Observation: 鍵の名前を変える PR（#2142 で `inventoryKeys.items` → `itemsAll`）と、古い名前を使う別の PR（#2140）が前後してマージされると、両方とも単独では CI が通るのに main で `queryKey: undefined` になる。#2147 で直した（2026-10-19）。名前を変える PR は、同じ鍵を触る作業中の PR がないかをマージ前に確かめる。
  Evidence: main 966fe7f0 の CI（`inventorySetupMutations.test.tsx`）の失敗と #2147。
- Observation: `node scripts/ci/max-lines-baseline.mjs update web` は、今回分けたファイル以外の記録も実際の行数まで下げる（段階4では毎回 `HermesFloatingChat.tsx` が 1083 → 1082 になった）。業務 Hermes のファイルは本計画で触らないため、その行は毎回手で元に戻し、`check` が通ることを確かめた。
  Evidence: #2159、#2161、#2171 の作成時の `update web` の出力。
- Observation: 組立の型定義を分けたとき、キオスクの操作マニュアルの元ファイル記録（`apps/web/src/generated/kiosk-sop/assembly-procedure-template/manifest.json`）が古いと commit 前のチェックで止まった。画面は変わらないので `pnpm kiosk-sop:source-refresh` で記録だけ更新した。
  Evidence: #2159 の pre-commit の出力。
- Observation: 段階5の前提の「テストのない 6 本」のうち api の 2 本は当てはまらなかった。テンプレート処理は既存のテストで約 83% 通っており、作業手順の保存処理にはテストがあったが、`WORK_INSTRUCTION_INTEGRATION=true` と 127.0.0.1 の DB を要求する作りで、CI（`localhost`）では一度も動いていなかった。
  Evidence: カバレッジの出力と、`apps/api/src/**/work-instruction*.integration.test.ts` の冒頭の条件。
- Observation: キオスクの「手動順番」画面で機器の「編集」を押すと、再描画が止まらなくなる（"Maximum update depth exceeded"）。`useManualOrderCardState` の返す関数が描画ごとに作り直され、それを依存にした画面の `useEffect` が毎回状態を書き換えていた。2026-03-20 の 76818cce から続いていた。現場で使っている画面のため、ユーザーの指示で急ぎの修正 PR（#2179）にした。
  Evidence: #2179 のテスト。修正を外すと再発防止の 2 件が失敗する。
- Observation: typescript-eslint 8 は、型を作るためだけに使う定数（`typeof X[number]` でしか参照しない値の一覧）を未使用として警告するようになった。apps/web の `inspectionDrawingSopAnnotations.ts` の 1 件だけが該当し、書き方は意図どおりなので、理由付きの無効化コメントを 1 行足した。段階7でソースに触れたのはこの 1 行だけである。
  Evidence: #2227 の移行後の `pnpm -r lint --max-warnings=0` の出力。
- Observation: #2227 の CI で、lint と関係のない API テスト（`part-measurement-drawing-placement-jev-reorder.test.ts` の同時実行数の確認）が一度だけ落ちた。10ms のタイマーで同時に 2 件以上動いたことを見るテストで、混んだ CI では外れ得る。ローカルで 5 回とも通り、失敗したジョブの再実行で通った。
  Evidence: run 39735559159 の 1 回目と再実行。

## Decision Log

- Decision: 各段階は別のブランチと PR にし、毎回 `origin/main` から `python3 -m scripts.git_lifecycle.cli start --branch <name>` で切る。マージと本番反映は進捗追跡セッションに PR 番号と head の SHA を渡して任せる。
  Rationale: 前期と同じ。追加の速いこのリポジトリでは長く生きるブランチが数日で衝突する。本番反映の窓口を一つにする運用に従う。
  Date/Author: 2026-10-19 / Claude
- Decision: 段階1は、効いていない 2 つの鍵を正しい鍵へ置き換えるのではなく、定数、そのテストの 2 行、`settings.ts` の 2 行の無効化をまとめて消す。
  Rationale: 今は何も無効化していないので、消しても動きは変わらない。正しい鍵（`leaderboardShellAll` と `leaderboardBoardAll`）に置き換えると、同じ処理の `scheduleAll` が前方一致ですでに無効化している鍵を二重に無効化するだけになる。
  Date/Author: 2026-10-19 / Claude
- Decision: 分割の順位は「行数 × 直近 90 日の変更回数」が大きく、かつテストがあるものから付ける。テストのない大きいファイルは先にテストを足す（段階5）まで分けない。
  Rationale: 変更の多いファイルほど分けた効果が大きい。テストのないファイルは書き写しの誤りに気づけない。
  Date/Author: 2026-10-19 / Claude
- Decision: 単一インスタンス（API を 1 台で動かす前提）の解消はコードの段階にしない。必要になったときの判断材料を Context に書くだけにする。
  Rationale: 今の業務は Pi5 1 台で足りており、台数を増やす予定は確認されていない。前期の段階8で、直す必要のある箇所は `docs/architecture/single-instance-state.md` に一覧化済みである。
  Date/Author: 2026-10-19 / Claude
- Decision: Prisma 5.22 から 6 以降への更新は本計画に入れず、要判断に置く。
  Rationale: 実行時の DB 処理に関わるので振る舞い不変を保証できず、移行の手順と確認が別の計画の大きさになる。
  Date/Author: 2026-10-19 / Claude
- Decision: 段階6で P2025 の応答を 404 に変える。文言は既存の 404 にそろえて「対象のデータが見つかりません」とし、本番以外では Prisma のメッセージを後ろに付ける。
  Rationale: 2026-10-21 にユーザーが了承した。表示が変わるのは、まれな場面の文言だけである。既存の 404 は「アイテムが見つかりません」の形だが、共通のエラーハンドラーではどの種類のデータかを確実には言えないため、「対象のデータ」とした。
  Date/Author: 2026-10-21 / Claude
- Decision: 段階7は「同じ強さで移す」ため、ESLint 9 と typescript-eslint 8 の推奨設定で増えた規則は設定で止め、旧来の動きに揃える。止めたのは `no-constant-binary-expression`、`no-empty-static-block`、`no-unused-private-class-members`、`no-new-native-nonconstructor`、`@typescript-eslint/no-unused-expressions`、`no-require-imports`（旧来の `no-var-requires` を有効にする）、`prefer-namespace-keyword`。型検査付きの設定では `no-array-delete`、`no-unsafe-unary-minus`、`only-throw-error`、`prefer-promise-reject-errors` も止め、`no-floating-promises` と `restrict-template-expressions` の既定値を旧来に合わせた。`no-unused-vars` は catch の引数を見ず、使われていない無効化コメントも報告しない。廃止された `ban-types` は後継の 3 規則で置き換え、空の interface は許す。上流で推奨から外れた `no-inner-declarations`、`no-class-assign`、`no-with` は外れたままにする。
  Rationale: 段階7の目的は道具の更新で、指摘の基準を変えることではない。増えた規則を有効にすると多くのファイルの書き換えが要り、並行する PR と衝突する。新しい規則を使うかどうかは、必要になったときに 1 規則ずつ別の PR で決める。
  Date/Author: 2026-10-22 / Claude
- Decision: `--ext` が廃止されたので、lint は `eslint .`（api と packages）と `eslint src`（web）にし、設定側で .ts/.tsx だけに絞る。新しい形式は JavaScript とドットファイルも既定で対象にするため、それらは除外して対象を移行前と同じにする。
  Rationale: 対象ファイルを増やすと、今まで見ていなかった設定ファイル類の指摘が出て、同じ強さの移行にならない。
  Date/Author: 2026-10-22 / Claude

## 要判断（その段階に着いたときにユーザーへ一度だけ確認する）

段階6: 存在しないデータを削除・更新しようとしたときの応答を 400 から 404 に変えてよいか。画面側で応答の番号によって表示を分けている箇所が 38 か所あり、段階6の最初の手順でそのうち削除・更新に関わるものを洗い出して、表示が変わる画面を添えて確認する。

段階7: ESLint 9 への更新をいつ行うか。開発時の道具だけの変更で本番には影響しないが、すべての lint 設定と行数の歯止めの仕組みに触れるので、並行して進む他のセッションの PR がしばらく lint の書き方の違いで衝突し得る。他の大きな変更が落ち着いた時期を選ぶ。

本計画の外: Prisma 5.22 を上げる時期（別の計画にする）。API を 2 台以上にする必要が出たとき（Context の判断材料を参照）。

## Outcomes & Retrospective

（各段階の完了時に記入する）

## Context and Orientation

リポジトリは pnpm のワークスペースで、`apps/api`（Fastify と Prisma のサーバー、TypeScript）、`apps/web`（React と Vite の画面。キオスクと管理画面）、`packages/*`（共有型などの小さな共通パッケージ）からなる。サーバー側は `apps/api/src/routes`（HTTP の入口）、`apps/api/src/services`（業務処理）、`apps/api/src/lib`（共通部品）の三層で、`apps/api/eslint.config.mjs`（段階7の前は `.eslintrc.cjs`）が依存の向き（routes → services → lib）を強制している。配備は `scripts/update-all-clients.sh` から Ansible で Pi5 サーバーと Pi4 キオスクへ反映する。

用語を定める。queryKey は、画面側のデータ取得ライブラリ（TanStack Query）が取得結果を覚えておくときの名札で、`['kiosk-production-schedule', 'leaderboard-shell', params]` のような配列である。保存や更新の後に「この名札で始まる取得結果を捨てて取り直す」（無効化、`invalidateQueries`）ことで画面を最新にする。名札を各ファイルに直書きすると、一文字違いで無効化が効かなくなる。前期では移動棚配置、工具・貸出、生産スケジュールの名札を `apps/web/src/api/queryKeys/` の定義ファイル（`tools.ts`、`productionSchedule.ts`）に集め、値をテストで固定した。

`DomainHttpError` は `apps/api` の業務エラーで、HTTP の番号と画面向けの文言を持つ。ルートで投げると共通のエラーハンドラー `apps/api/src/plugins/error-handler.ts` が `{ message, requestId, timestamp }` などの決まった形で応答する。既存の `ApiError` の分岐を変えないよう、`ApiError` を継承していない。P2025 は Prisma（DB を操作するライブラリ）が「更新・削除しようとした行が見つからない」ときに投げるエラーの番号で、前期にルートで受け止める 3 か所を `apps/api/src/lib/prisma-errors.ts` の `throwIfPrismaNotFound` に集めた。

ラチェット（歯止め）は、現状より悪くなることだけを禁止し、良くなった分は記録を下げて固定する仕組みを指す。ファイル行数のラチェットの記録は `apps/api/eslint-max-lines-baseline.json`（30 件）と `apps/web/eslint-max-lines-baseline.json`（22 件）で、`scripts/ci/max-lines-baseline.mjs` が作り直す。記録の行数は空行とコメントを除いて数えるので、`wc -l` の値より小さい。本計画の順位付けは `wc -l`、受け入れ（分割後に記録を下げる）は記録の値で行う。

2026-10-19 の測定値（`origin/main` ceee3557、テストと生成物を除く）を段階ごとに記す。

画面側の queryKey の直書き（`queryKey: [` の出現）は 285 か所で、225 か所が `apps/web/src/api/hooks/` にある。ファイル別では `part-measurement.ts` 50、`backup.ts` 43、`measuring-instruments.ts` 24、`tools.ts` 17（工具・貸出の残り）、`signage.ts` 16、`kiosk.ts` 15、`kiosk-documents.ts` 10、`clients.ts` 10、`system.ts` 9、`machine-signal.ts` 7、`csv-visualization.ts` 7、`rigging.ts` 6 である。残り 60 か所は `features/kiosk` 18、`features/admin` 15、`pages/admin` 12、`pages/kiosk` 8 などに散っている。名札の先頭語では `self`（自主検査）52、`backup` 26、`csv` 23、`signage` 17、`measuring` 12 が多い。無効化の直書き `invalidateQueries({ queryKey: [` は 175 か所あり、多くは同じファイルの中にある。

ルートでの独自のエラー応答は、`apps/api/src/routes/storage/`（写真、PDF、図面、組立手順の画像などのファイル配信）の 9 ファイルに 30 か所あり、どれも「パスがない 400」「ファイルがない 404」「読み込み失敗 500」を `{ message }` で返す同じ形である。文言はファイルごとに違う（例 `PDFが見つかりません`、`図面が見つかりません`）。ほかに `routes/part-measurement/visual-templates.ts` に `{ message }` だけの 404/409 が 4 か所ある。形の違う独自応答は残す。`routes/system/deploy-status.ts` の `{ code }` だけの応答 9 か所（端末の配備状況の報告用で、端末側のスクリプトが `code` を読む）、`routes/system/health.ts` などの `{ error }`、編集ロックの 409（`lease` を一緒に返す）、音声入力の `error.statusCode` の受け渡し（`routes/assembly/procedure-document-revisions.ts`）、業務 Hermes の応答がそれにあたる。

共通のエラーハンドラーは、ルートで受け止めなかった Prisma のエラーのうち P2003（外部キー違反）と P2002（重複）に詳しい文言を付け、それ以外を一律に 400「データベースエラー」で返す。P2025 もここで 400 になるが、意味の上では 404 が正しい。P2025 をコード中で扱っているのは 4 ファイルだけなので、ハンドラーを直せば広く効く。画面側では応答の番号で表示を分ける箇所が 38 か所ある（`rg "status === (400|404)|status !== 404|\.status === 4" apps/web/src`）。

大きいファイル（`wc -l`、括弧内は直近 90 日の変更回数）は次のとおり。テストがあり変更の多いものは、`apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx` 1,424 行（35）、`apps/api/src/services/item-inventory/item-inventory.service.ts` 1,205 行（19）、`apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` 797 行（18）、`apps/web/src/features/assembly/types.ts` 764 行（16、型だけ）、`apps/web/src/features/kiosk/inventory/setup/InventoryRegistrationTab.tsx` 730 行（22）、`apps/web/src/pages/kiosk/KioskItemInventoryPage.tsx` 721 行（22）である。

同名のテストがない大きいファイルは、`apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx` 1,698 行（8）、`apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx` 1,494 行（6）、`apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx` 1,252 行（2）、`apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx` 958 行（3）、`apps/api/src/services/part-measurement/part-measurement-template.service.ts` 1,506 行（5）、`apps/api/src/services/work-instructions/repositories/prisma-work-instruction-edit.repository.ts` 1,722 行（5）である。画面のファイル 100 本のうち 67 本に同名のテストがない。

変更の少ない大きいファイル（例 `signage.renderer.ts` 1,744 行、6）は分けても効果が小さいので後回しにする。業務 Hermes の大きいファイル（`business-hermes-mcp.service.ts` 1,985 行、`business-hermes-consultation.service.ts` 1,756 行、`HermesFloatingChat.tsx` 1,125 行、`HermesChatPanel.tsx` 712 行）は対象外である。

依存の古さでは、lint の道具 ESLint が 8.57.1 で、8 系は 2024-10 にサポートが終わっている。設定は旧形式の `apps/api/.eslintrc.cjs` と `apps/web/.eslintrc.cjs` で、行数の記録スクリプト `scripts/ci/max-lines-baseline.mjs` も旧形式の Node API（`new ESLint({ useEslintrc: false, overrideConfig })`）を使う。Prisma は 5.22.0、React は 18.3.1、TypeScript は 5.9.3、Node は 24 である。

単一インスタンスの判断材料として、API を 2 台以上にする必要が出るのは、Pi5 1 台の CPU やメモリが業務の負荷で足りなくなったとき、または止まらない構成（1 台が壊れても業務を続ける）を求められたときである。そのときは `docs/architecture/single-instance-state.md` の「複数台で正しく動かなくなるもの」（OAuth の state、PIN と在庫設定パスワードの失敗回数、要求回数の制限、通話の接続、DGX の起動・停止の順番待ちなど）を先に DB か Redis へ移し、次に定期処理を 1 台だけで動かす仕組みを入れる。順番はその文書の「複数台にするときの順番（案）」に従う。今はこの条件に当たる兆候が確認されていないので、本計画ではコードを変えない。

## Plan of Work

段階1は、`apps/web/src/api/hooks/production-schedule/settings.ts` の 93〜94 行目にある `productionScheduleQueryKeys.kioskLeaderboardShellAll` と `kioskLeaderboardBoardAll` の無効化 2 行を消し、`apps/web/src/api/queryKeys/productionSchedule.ts` の同名の定数 2 つと、`productionSchedule.test.ts` の 33〜34 行目のテストを消す。同じ処理の `scheduleAll` の無効化は残す。PR は 1 本。

段階2は、領域ごとに 1 本の PR で、`apps/web/src/api/queryKeys/<領域>.ts` に名札の定義を作り、`apps/web/src/api/hooks/<領域>.ts` と、同じ名札を直書きしている画面や部品の直書きを置き換える。定義ファイルには、置き換え前の配列と等しいことを確かめるテストを `<領域>.test.ts` に付ける（前期の `tools.test.ts` と同じ書き方）。値と配列の長さは変えない。順番は件数の多い順に、部品測定と自主検査（`part-measurement.ts` 50 と `self` で始まる名札）、バックアップ（43）、計測機器と工具の残り（24 + 17）、サイネージとクライアント端末とシステム（16 + 10 + 9）、キオスクと要領書とその他の残り、の 5 本前後とする。`mutationKey` と画面の保存設定のキーは前期と同じく対象外。

段階3は、`apps/api/src/routes/storage/` に、パスの検証とファイルの読み込みで 400/404/500 を返す共通の小関数（例 `sendStorageFileError`、置き場所は `apps/api/src/routes/storage/shared.ts`）を作り、9 ファイルの 30 か所から呼ぶ。文言はファイルごとに引数で渡し、応答の本文は 1 文字も変えない。続けて `routes/part-measurement/visual-templates.ts` の 4 か所を `DomainHttpError` に移す（本文に `requestId` と `timestamp` が加わる。画面側が `message` だけを読むことを `apps/web/src/api/domains/part-measurement.ts` で確かめてから行う）。PR は 2 本。

段階4は、1 ファイル 1 本の PR で、Context に挙げたテストのある 6 本を、中身の書き写しだけで小さいファイルへ分ける。公開する名前（export）の一覧が分割の前後で一致することを確かめ、`node scripts/ci/max-lines-baseline.mjs update api|web` で記録を下げる。変更の多いファイルは、始める前に `gh pr list --state open --search <ファイル名>` で他のセッションの進行中の PR を確かめ、ある場合はそのマージを待つ。PR は 6 本前後。

段階5は、テストのない 6 本に、今の動きを固定するテストを足す。画面は主な表示と操作（一覧が出る、入力して保存すると API が呼ばれる）を、service と repository は主な入口の戻り値を確かめる。テストだけの PR を 3〜4 本出し、足し終えたファイルから段階4と同じ手順で分割を検討する。

段階6は、まずユーザーの判断を得る（要判断）。準備として、画面側で応答の番号を見て表示を分ける 38 か所のうち、削除・更新の失敗に関わるものを一覧にする。了承を得たら、`apps/api/src/plugins/error-handler.ts` の Prisma の分岐に P2025 の場合を足して 404 を返し、文言は既存の 404 と同じ書き方にする。ルートで受け止めていない削除・更新の P2025 が 404 になることをテストで確かめる。PR は 1 本。

段階7は、ESLint を 9 系へ上げ、`.eslintrc.cjs` を新しい形式の `eslint.config.mjs` へ移す。依存の向きの規則、ファイル行数のラチェット、個別の厳しい行数上限を同じ強さで移し、`scripts/ci/max-lines-baseline.mjs` を新しい API に合わせる。apps/api、apps/web、記録スクリプトの順で 2〜3 本の PR にする。

## Concrete Steps

作業場所は各段階の worktree のルート。開始と終了は次のとおり。

    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch refactor/<段階の名前>
    （作業）
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web test -- <変更した領域のテスト>
    pnpm --filter @raspi-system/api test -- <変更した領域のテスト>

ファイルを分けて小さくしたら、記録を下げてコミットに含める。

    node scripts/ci/max-lines-baseline.mjs update api
    node scripts/ci/max-lines-baseline.mjs update web

docs を含む PR で `docs/_meta/document-inventory.*` が衝突したら、main 側を取ってから次で作り直す。

    node scripts/docs/audit-docs.mjs --write

## Validation and Acceptance

各段階の共通の受け入れ条件は、lint、変更した領域のテスト、CI がすべて成功し、本番反映後に進捗追跡セッションが API の health 200 と反映後の API エラー 0 件を確かめることである。キオスクや管理画面に関わる段階は、反映後にユーザーへ実機確認を頼む。確認を頼むのは反映が済んでからにする。

段階1の受け入れは、`productionSchedule.test.ts` が通り、反映後にキオスクの「順位ボード」と「生産スケジュール」で、管理画面の設定を変えた後に表示が更新されることである。

段階2の受け入れは、各定義ファイルの等値テストが通り、`rg -c "queryKey: \[" apps/web/src` の件数が PR ごとに減ることである。反映後の確認画面は、部品測定と自主検査の回はキオスクの「部品測定」「検査図面」「自主検査」、バックアップの回は管理画面の「バックアップ」、計測機器と工具の回はキオスクの「計測機器 持出」「持出」と管理画面の「計測機器ジャンル」、サイネージとクライアント端末の回は管理画面の「サイネージ」「クライアント端末」、残りの回はキオスクの「要領書」である。

段階3の受け入れは、ファイル配信の各ルートの 400/404/500 応答の本文が変わらないことを全体一致テストで固定し、それが通ることである。反映後、キオスクの「持出」（写真）、「要領書」（PDF）、「部品測定」（図面）、「組立」（手順書の画像）で画像と PDF が表示されることを確かめる。

段階4と段階5の受け入れは、分けたファイルの公開名の一致、既存と新しいテストの成功、ラチェットの記録が下がったことである。反映後、分けたファイルの画面（「製番ボード」「在庫」「組立」「検査図面」「自主検査」「納期管理」「手動順番」）の表示と主な操作を確かめる。

段階6の受け入れは、存在しない ID の削除・更新が 404 を返すテストが通り、要判断で挙げた画面の表示が想定どおりであることである。

段階7の受け入れは、新しい設定で lint が通り、前期と同じ確かめ方でラチェットが働くことである。すなわち `apps/web/src` に 650 行の新しいファイルを置くと `File has too many lines (650). Maximum allowed is 600` で失敗し、確認後に元へ戻す。本番の動作には影響しない。

## Idempotence and Recovery

どの段階も PR 単位で戻せる。本番で問題が出たら、進捗追跡セッションが直前の正常な main の SHA へ標準の経路で戻す。段階2と段階3は値と本文をテストで固定してから置き換えるので、テストが落ちたら置き換えを戻して差を調べる。段階7で lint が通らなくなった場合は、旧設定ファイルを戻す PR で元に戻せる。

## Artifacts and Notes

（各段階の証拠をここに短く残す）

## Interfaces and Dependencies

段階2の定義ファイルは `apps/web/src/api/queryKeys/` に置き、`as const` の配列か配列を返す関数として公開する。段階3の共通の小関数は `apps/api/src/routes/storage/` の中だけで使い、routes から lib への依存の向きを守る。段階6は `apps/api/src/plugins/error-handler.ts` と `apps/api/src/lib/prisma-errors.ts` に触れる。段階7は `eslint` 9 系、`@typescript-eslint` の対応版、`eslint-plugin-import` と `eslint-plugin-react-hooks` の対応版を必要とする。
