# コード健全化 第2期

この ExecPlan は生きた文書であり、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を作業の進行に合わせて更新する。書式と運用は `.agent/PLANS.md` に従う。

前期の計画と結果は [コード保守性の改善プログラム](code-health-refactor-execplan.md) にある（本計画はその残りと、前期の後に測り直して分かった弱点を扱う）。

## Purpose / Big Picture

前期（2026-10-17〜10-19）で、ファイル行数の歯止め、重複関数の共通化、業務 Hermes 部品の独立、巨大ファイル 5 本の分割、画面側のデータ取得の鍵（queryKey）の一部集約、業務エラーの HTTP 変換の一部集約、個人用コードの別リポジトリへの移設を終えた。2026-10-19 に測り直すと、画面側の鍵の直書きがまだ 285 か所、ファイル配信ルートの独自のエラー応答が 30 か所、テストのない 950 行超のファイルが 6 本、サポートの終わった ESLint 8 が残っていた。

この計画が完了すると、開発者は画面の鍵やエラー応答を一か所の定義から選ぶだけでよくなり、大きなファイルに手を入れる前にテストで今の動きを確かめられる。10 年保守する前提で、道具（lint）の更新が止まっている状態も解消する。どの段階でも本番の動作は変えないことを原則にする。例外は段階6（存在しないデータの削除・更新に対する応答を 400 から 404 に変える）だけで、ユーザーの判断を経てから行う。

業務のシステムと私用（個人用 Pi5、個人用 Hermes、Discord、DGX Control Plane）を混ぜない境界を前提にする。本計画が変更するのはこの業務リポジトリだけで、個人用のコードは前期の段階9で `denkoushi/DGXSparkControlPlane` へ移し終えている。業務 Hermes（キオスクの Chat の質問応答）のファイルは他のセッションが頻繁に変更しているので、前期と同じく本計画の分割の対象から外す。

## Progress

- [ ] 段階1: 生産スケジュール設定の更新時に何も無効化していない鍵 2 つを消す。
- [ ] 段階2: 画面側の queryKey の直書き（285 か所）を領域ごとの定義へ集める。部品測定、バックアップ、計測機器と工具、サイネージとクライアント端末、残りの順。
- [ ] 段階3: ファイル配信ルートの 400/404/500 応答（9 ファイル 30 か所）を共通の小関数へ集め、部品測定の図面テンプレートの 4 か所を DomainHttpError へ移す。
- [ ] 段階4: テストがあり変更の多い大きいファイルを分ける（在庫の service、製番ボードの画面、在庫の登録タブ、在庫の画面、組立の作業画面、組立の型定義）。
- [ ] 段階5: テストのない大きいファイル 6 本に、今の動きを固定するテストを足す。足し終えたものから分割を検討する。
- [ ] 段階6（要判断）: 共通のエラーハンドラーが受け止める Prisma の P2025 を 400 ではなく 404 で返す。
- [ ] 段階7（要判断）: ESLint 8 を 9 へ上げ、設定を新しい形式へ移す。行数の歯止めの記録スクリプトも合わせて直す。

## Surprises & Discoveries

- Observation: 業務 Hermes のファイルの直近 90 日の変更回数は 1 回と少なく見えるが、2026-10-17 に `services/assembly/` から `services/business-hermes/` へ移したためで、移動前の履歴が数に入っていない。画面側の `HermesFloatingChat.tsx` は 90 日で 35 回変更されており、実際の変更頻度は高い。
  Evidence: `git log --since=90.days --oneline -- <path>`（`--follow` なし）の結果。
- Observation: 型の `any` は少なく、健全である。apps/api のテスト以外で 14 か所（lint の例外指定は 16 か所）、apps/web で 2 か所。本計画の対象にしない。
  Evidence: `rg -c ':\s*any\b|as any\b|<any>' apps/api/src apps/web/src`（テストと生成物を除く）。
- Observation: lint の例外指定は apps/api に 99 か所あり、うち 73 か所が `no-await-in-loop`（順番に待つ必要がある DB 処理）、apps/web は 22 か所のうち 19 か所が `react-hooks/exhaustive-deps` だった。後者は画面の再描画の条件に関わり、外すと動きが変わり得るので、本計画では数えるだけにする。
  Evidence: `rg -o 'eslint-disable(-next-line|-line)?\s+[@a-z/-]+' apps/*/src` の集計。

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

## 要判断（その段階に着いたときにユーザーへ一度だけ確認する）

段階6: 存在しないデータを削除・更新しようとしたときの応答を 400 から 404 に変えてよいか。画面側で応答の番号によって表示を分けている箇所が 38 か所あり、段階6の最初の手順でそのうち削除・更新に関わるものを洗い出して、表示が変わる画面を添えて確認する。

段階7: ESLint 9 への更新をいつ行うか。開発時の道具だけの変更で本番には影響しないが、すべての lint 設定と行数の歯止めの仕組みに触れるので、並行して進む他のセッションの PR がしばらく lint の書き方の違いで衝突し得る。他の大きな変更が落ち着いた時期を選ぶ。

本計画の外: Prisma 5.22 を上げる時期（別の計画にする）。API を 2 台以上にする必要が出たとき（Context の判断材料を参照）。

## Outcomes & Retrospective

（各段階の完了時に記入する）

## Context and Orientation

リポジトリは pnpm のワークスペースで、`apps/api`（Fastify と Prisma のサーバー、TypeScript）、`apps/web`（React と Vite の画面。キオスクと管理画面）、`packages/*`（共有型などの小さな共通パッケージ）からなる。サーバー側は `apps/api/src/routes`（HTTP の入口）、`apps/api/src/services`（業務処理）、`apps/api/src/lib`（共通部品）の三層で、`apps/api/.eslintrc.cjs` が依存の向き（routes → services → lib）を強制している。配備は `scripts/update-all-clients.sh` から Ansible で Pi5 サーバーと Pi4 キオスクへ反映する。

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
