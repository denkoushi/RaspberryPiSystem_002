# コード保守性の改善プログラム

この ExecPlan は生きた文書であり、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を作業の進行に合わせて更新する。書式と運用は `.agent/PLANS.md` に従う。

## Purpose / Big Picture

2026-10-17 の調査で、本システム（アプリ本体約 58 万行、配備・補助スクリプト約 13 万行）は層の向きの lint や循環参照禁止などの規律を持つ一方、追加速度（2026-07 以降で約 2,050 コミット）に整理が追いついていないことが分かった。具体的には、組立サービスのフォルダに無関係な Hermes（業務の質問応答）部品が 37 ファイル同居していること、同じ小関数が 10 回書き直されていること、1,000 行を超えて頻繁に変更されるファイルが多いこと、ファイルの肥大化を止める lint が一部にしか掛かっていないこと、本番から呼ばれない配備スクリプトや二重化した設定テンプレートがあることである。

この計画が完了すると、開発者は機能を追加するときに「どこに置くか」「どの共通部品を使うか」を迷わず、変更の影響が一つのまとまりの中に収まる。どの段階でも、本番の動作は変えない（振る舞いを保つリファクタリング）ことを前提にし、各段階の効果は lint、テスト、CI、本番反映後の動作確認で示す。

## Progress

- [x] (2026-10-17) 調査を実施し、所見を会話で報告した（本文の Context and Orientation に要点を再掲）。
- [x] (2026-10-17) 段階1: ファイル行数の歯止め（ラチェット）を apps/api と apps/web の ESLint に導入した。新しいファイルは 600 行まで、既存の大きいファイルは記録時の行数 +30 行までに制限する。
- [x] (2026-10-17) 段階1: PR #2080 をマージした（main fa1f7f00）。lint 設定だけの変更なので本番反映は不要。
- [x] (2026-10-17) 段階2: 重複した小関数を共通化した（製番リスト、文字列正規化、タイムアウト、機種コード判定など）。PR #2081、main 13d21554、Pi5 反映 run 20261017-053848-19d536 成功。
- [x] (2026-10-17) 段階3: 業務 Hermes の部品を `apps/api/src/services/assembly/` から `apps/api/src/services/business-hermes/` へ移した（ファイル移動と import の書き換えのみ）。PR #2082、main 621eb26f、Pi5 反映 run 20261017-063429-930dcc 成功（health 200）。反映後、キオスクの Chat で質問に回答が返ることをユーザーが確認した。移動先は不適合情報検索精度向上セッションへ連絡済み。
- [x] (2026-10-17) 段階4: 使われていない旧サイネージ用テンプレート 11 個を削除した（PR #2083、main 431ccdfc）。本番未使用の旧シェル `change-detector` / `impact-analyzer` と専用テストを削除し、手動プレイブック `manage-system-configs.yml` から `signage-lite.service` の管理を外した（PR #2084、main 4d82d49c）。どちらも本番反映は不要。
- [x] (2026-10-17) 段階4: `terminal-runtime-manifest.py` と `rollback-manifest.py` はユーザー判断で残し、本番未使用であることを本計画と `docs/plans/deploy-speed-optimization-execplan.md` に明記した。
- [x] 段階5: 頻繁に変更される巨大ファイルを 5 本分けた。画面側の組立 API 定義（PR #2085、main 83eaa0b5）、画面側の生産スケジュール API 定義（PR #2087、main 53fe3ea9）、画面側の生産スケジュール hook（PR #2088、main 73948300）、研削計画ボードの service（PR #2089、main c3291fda）、組立のルート定義（PR #2090、main 94e09541）。どれも中身は書き写しのみで、公開名の一致を機械的に確かめた。Hermes 系の大きいファイルは他セッションが頻繁に触るので対象外とした。#2088〜#2090 は 2026-10-17 に Pi5 へまとめて反映した（run 20261017-091529-dcfae1、成功、反映後の API エラー 0 件、health 200）。キオスクで生産スケジュール、順位ボード、負荷調整、製番ボード、組立の表示と操作をユーザーが確かめ、問題はなかった。
- [ ] 段階6: 画面側のデータ取得の書き方をそろえる。1 本目として移動棚配置と工具・貸出の queryKey を一か所で定義した（PR #2092）。2 本目として生産スケジュールの hook 6 ファイルの queryKey を `apps/web/src/api/queryKeys/productionSchedule.ts` に集めた（変更前後の配列の一致をテストで固定）。3 本目として、画面 3 つ、部品測定 hook、リーダー順位ボードの hook 2 つ、検索履歴の操作に残っていた生産スケジュール系の鍵の直書きを同じ定義に置き換えた（キー値と配列の長さは不変、新しく足した前方一致用の鍵もテストで固定）。`mutationKey` と画面の保存設定のキーは対象外。`settings.ts` の分割試行設定の更新時に無効化している `['kiosk-production-schedule-leaderboard-shell']` と `['kiosk-production-schedule-leaderboard-board']` は実際の鍵と一致せず何も無効化していないが、同じ処理の `scheduleAll` が順位ボードの鍵も前方一致で無効化しているため画面への影響はない。直すかは別に判断する。
- [ ] 段階7: 業務エラーを HTTP に変える場所をエラーハンドラーに集約する。1 本目として `DomainHttpError` を追加し、在庫と作業要領編集のルートから変換関数を外した（PR #2091、応答の本文は全体一致テストで固定）。組立の独自応答と Prisma の P2025 変換は別の回にする。
- [x] (2026-10-17) 段階6・7: 1 本目の #2091（main 62b5de34）と #2092（main 71311682）を Pi5 へ反映した（run 20261017-094007-1efeee）。反映後、キオスクの「持出」と「棚マスタ」の表示をユーザーが確かめ、問題はなかった。
- [x] (2026-10-17) 段階8: プロセスのメモリに持っている状態を洗い出し、[API の 1 台構成の前提](../architecture/single-instance-state.md) に記録した。現状は 1 台構成なのでコードは変えない。
- [x] (2026-10-18) 段階9: 個人用 Pi5、DGX、StackChan のコードは、新しいリポジトリを作らず、既存の個人用リポジトリ `denkoushi/DGXSparkControlPlane` へ移す（2026-10-17 ユーザー判断、Decision Log 参照）。個人用リポジトリ側で移して動作を受け入れてから、業務側の写しを消す。
- [x] (2026-10-17) 段階9: 業務側の写しのうち 3 つを消して Pi5 へ反映した。個人用 Pi5 の Pi 側 DGX keep-warm（本体、timer のテンプレートとタスク。2026-08-04 に中央 keep-warm へ移行済み）を外した（PR #2094、main 259829dd、run 20261017-100613-eeef5e）。業務 Pi5 の未使用の StackChan 会話 API `/api/system/stackchan/chat` と推論の用途 `stackchan_chat` を消した（PR #2095、main a2bdb7ec、run 20261017-103207-58f340）。未使用の確認は業務 Pi5 の API と Caddy のログで行ったが、ログは当日分しか残っていなかった。業務の管理画面から個人用 ComfyUI の起動・停止とカード、その URL 設定を消した（PR #2096、main 9e73b1b0、run 20261017-110014-fcc674）。運用モード「私用OK」は保存値の互換のため残した。3 回とも反映は成功し、API のエラー 0 件、health 200。Life Pilot の 7 ファイルは個人用 Hermes の他のファイルが読み込んでいるので、`scripts/private-pi5-hermes/` 全体と一緒に消す。
- [x] (2026-10-17) 段階9: 個人用 Hermes の Discord `/task` ブリッジ一式（グループ1。承認リレー、Daily Pilot、Interest Digest、tools / novel / research プロファイル、`validate_boundary_policy.py` など）の写しを消し、それだけを配る Ansible タスク 6 本と include を外した（PR #2100、main 57fbdfcd、Pi5 へは #2098 と一緒に main a550b318 として run 20261017-133011-51c154 で反映、成功、health 200）。個人用側は DGXSparkControlPlane #418 で同じものを配り、Discord の `/task` と Life ボタンを確認済み。グループ1の戻し先は個人用側の世代 0aa07b44 で、業務側の revert は使わない。Life Pilot のモジュール 6 本、ポリシー、テストと、その配布タスクは残した（グループ2の戻し先として使う）。
- [x] (2026-10-18) 段階9: 個人用 Hermes の基本導入（グループ2）の写しを消した。install、ufw、chat profile、browser tooling、gateway の plugin discovery 修正、verify、research / novel の verify の task 8 本と、`templates/private-pi5-hermes/`、`private-pi5-hermes-gateway.service.j2` を消した（PR #2109、main 934eda59、run 20261018-054417-e13ff7、成功、health 200）。移し先は DGXSparkControlPlane #420 の `rebuild_private_pi_hermes.yml`。raspi5-private では `--check --diff` だけを実行し、ok=33 changed=0 failed=0 だった（実際の適用はしていない。今の Pi との差分は 0）。発注元の判断で、これを受け入れの条件とした。`playbooks/private-pi5-hermes.yml` は残した。Life Pilot、DGX 実行環境の配布（keep-warm.yml）、Discord の配布と検証、gateway の再起動はまだ移しておらず、今の Pi のユニットを作り直せる経路がこの playbook だけだからである。
- [x] (2026-10-18) 段階9: StackChan bridge（グループ3）の写しを消した。`scripts/private-pi5-stackchan-bridge/`、`scripts/stackchan-ai-stackchan-ex/`、`private-pi5-stackchan-bridge.yml` とそのテンプレート 4 本が対象である（PR #2110、main 84c51632、run 20261018-051932-676db9、成功）。移し先は DGXSparkControlPlane #424 で、raspi5-private への適用は changed=0、/healthz 正常だった。StackChan は休眠中なので、話しかけての確認はユーザー判断で省いた。`dgx_runtime_client.py` とそのテスト、インベントリ断片の雛形は残した。keep-warm.yml がこのファイルを配っていて、Hermes の playbook がこの雛形を使うためである。keep-warm を移すときに一緒に消す。
- [x] (2026-10-18) 段階9: 個人用 ComfyUI（グループ4）の写しを消した。`scripts/dgx-private-comfyui/`（23 ファイル）が対象である（PR #2112、main 6f8be0c1、run 20261018-062942-52f28c、成功、health 200）。移し先は DGXSparkControlPlane #425 で、保管だけでどこにも配っていないため、個人用 Pi での確認はない。`scripts/dgx-local-llm-system/gateway-server.py` にある DGX 本体上の置き場所の既定値はリポジトリのファイルを指さないので残した。
- [x] (2026-10-18) 段階9: 個人用だけの文書 47 本（グループ5）を消し、DGXSparkControlPlane #426 の `docs/private-history/` へ移した。業務側に残る文書 14 本のリンクは移し先を指す書き方に直した（PR #2114、main dcdbcdb8、run 20261018-085731-a5acaf、成功）。
- [x] (2026-10-18) 段階9: 残っていた写し（グループ6）を消した。`scripts/private-pi5-hermes/`、`playbooks/private-pi5-hermes.yml`、その task 10 本とテンプレート 15 本、インベントリ断片の雛形が対象である（PR #2115、main 206bd3d4、run 20261018-105218-91da34、成功、health 200）。移し先は DGXSparkControlPlane #428 で、個人用 Pi への反映は移行担当の会話が確かめた。最後に `scripts/private-pi5-stackchan-bridge/`（`dgx_runtime_client.py` とそのテスト）を消した（PR #2116、main cd613b57、run 20261018-112759-56a950、成功、health 200。移し先は DGXSparkControlPlane #429）。これで業務リポジトリから個人用のコードの写しはなくなった。`.gitignore` の実インベントリ断片の除外行は、手元に残る実ファイルを誤ってコミットしないために残した。

## Surprises & Discoveries

- Observation: 製番リストの正規化 `normalizeFseibans` は 10 ファイルで定義され、引数の型（`string[]` と `string[] | undefined`）や重複除去の書き方が少しずつ違う。単純な置換では挙動が変わり得る。
  Evidence: `apps/api/src/services/production-schedule/*.ts` の各定義を比較した結果。
- Observation: ESLint の `max-lines` は空行とコメントを除いて数えるので、`wc -l` の行数より小さい。apps/api で 600 行を超えるのは 32 ファイル、apps/web は 25 ファイルだった。
  Evidence: `node scripts/ci/max-lines-baseline.mjs init api` の出力 "32 entries"、web は "25 entries"。
- Observation: `docs/_meta/document-inventory.*` は docs を含む PR がマージされるたびに書き換わるため、並行する PR がほぼ必ず衝突する。
  Evidence: PR #2084 が #2083、#2082 のマージのたびに、この 2 ファイルだけで衝突した。main 側を取ってから `node scripts/docs/audit-docs.mjs --write` で作り直せば解消する。
- Observation: `terminal-runtime-manifest.py` と `rollback-manifest.py` を呼ぶのは CI の契約テスト（`scripts/ci/run-deploy-contracts-local.sh` と専用テスト）だけで、本番の配備経路からは呼ばれていない。配備高速化の計画にある束ね役 `terminal_manifest_capture.py` も存在しない。
  Evidence: `infrastructure/` と `scripts/`（テストを除く）を両ファイル名で検索した結果。

## Decision Log

- Decision: 行数の歯止めは CI のワークフローではなく既存の ESLint 設定に入れる。
  Rationale: `pnpm lint --max-warnings=0` が既に CI で動くので、新しいジョブを足さずに済む。`.github/workflows/ci.yml` を変えると変更分類が unknown になり全検査が走る。
  Date/Author: 2026-10-17 / Claude
- Decision: 既存の大きいファイルの上限は「記録時の行数 +30 行」とし、厳密な現状値にはしない。
  Rationale: 他のセッションが並行して開発しており、現状値ちょうどにすると、進行中の小さな修正まで一斉に lint で止まる。30 行の余地で小修正は通しつつ、大きな追加は分割を促す。上限は `update` で下げるだけで、上げる操作は用意しない。
  Date/Author: 2026-10-17 / Claude
- Decision: 各段階は別のブランチと PR にし、毎回 `origin/main` から切る。マージと本番反映は進捗追跡セッションに渡す。
  Rationale: 長く生きるリファクタブランチは追加の速いこのリポジトリでは数日で衝突する。本番反映の窓口を一つにする運用（並行デプロイの衝突防止）に従う。
  Date/Author: 2026-10-17 / Claude
- Decision: 重複関数の共通化は、まず全定義を比べて意味ごとに分類し、意味の違うものは別の関数にする。共通関数には空配列、空白、重複、undefined の単体テストを付けてから呼び出し側を置き換える。
  Rationale: 定義ごとに細かい違いがあり、一つにまとめると静かに挙動が変わる恐れがある。
  Date/Author: 2026-10-17 / Claude

- Decision: 旧シェル `change-detector` / `impact-analyzer` は削除し、`terminal-runtime-manifest.py` / `rollback-manifest.py` は削除せず「本番未使用」と文書に明記するに留める。手動プレイブックからサイネージ定義を外す。
  Rationale: 前者は本番から呼ばれず、置き換え済み。後者は配備高速化の計画（Phase A3）で使う前提の部品なので残す。ユーザーが 2026-10-17 に判断した。
  Date/Author: 2026-10-17 / ユーザー判断、Claude 記録

- Decision: 段階9は新しいリポジトリを作らず、個人用の既存リポジトリ `denkoushi/DGXSparkControlPlane` へ移す。順番は、移行済みの写しの削除、個人用 Hermes の基本導入、StackChan、画像生成（ComfyUI）、個人用だけの文書。業務の Pi5 にある StackChan 会話の入口は記録で未使用を確かめてから消し、業務の管理画面の ComfyUI 起動・停止は消す。古い ComfyUI の設定 14 個と個人用だけの文書は個人用リポジトリへ移して残す。業務の内容が混ざった文書は移さない。
  Rationale: 2026-10-17 に一度「段階9はやめる」と判断した後、ユーザーが「新しいリポジトリを作らず、私用の DGXSparkControlPlane へ移す」案を了承した。2026-08-16 から個人用 Hermes はすでにそちらへ移行中で、新しいリポジトリを作る取り消しにくい操作が要らない。
  Date/Author: 2026-10-17 / ユーザー判断、Claude 記録

- Decision: 業務エラーの HTTP 変換は `ApiError` を継承しない `DomainHttpError` で行う。
  Rationale: `instanceof ApiError` で分岐して再送出している既存箇所があり、継承させるとその経路の動きが変わるため。
  Date/Author: 2026-10-17 / Claude

## 要判断（その段階に着いたときにユーザーへ一度だけ確認する）

（解決済み）本番から呼ばれていない配備スクリプト `scripts/deploy/terminal-runtime-manifest.py` と `scripts/deploy/rollback-manifest.py` は、2026-10-17 のユーザー判断で残すことにした（Decision Log 参照）。

（解決済み）個人用 Pi5、DGX、StackChan のコードの移し先（段階9）は、2026-10-17 のユーザー判断で既存の個人用リポジトリ `denkoushi/DGXSparkControlPlane` にした（Decision Log 参照）。

## Outcomes & Retrospective

（各段階の完了時に記入する）

## Context and Orientation

リポジトリは pnpm のワークスペースで、`apps/api`（Fastify と Prisma のサーバー、TypeScript）、`apps/web`（React と Vite の画面、キオスクと管理画面）、`packages/*`（共有型などの小さな共通パッケージ）からなる。配備は `scripts/update-all-clients.sh` が `scripts/deploy/standard-ansible-release.py` を呼び、Ansible（`infrastructure/ansible/`）で Pi5 サーバー、Pi4 キオスク、Pi3 サイネージへ反映する。

サーバー側は `apps/api/src/routes`（HTTP の入口）、`apps/api/src/services`（業務処理、46 の機能フォルダ）、`apps/api/src/lib`（共通部品）の三層で、`apps/api/.eslintrc.cjs` の `import/no-restricted-paths` が依存の向き（routes → services → lib）を強制している。機能フォルダの作りは揃っておらず、`work-instructions` や `inference` はデータ取得の層や外部接点の層が分かれている一方、`assembly`（100 ファイル）や `part-measurement`、`production-schedule` は平置きである。

「ラチェット」とは、現状より悪くなることだけを禁止し、良くなった分は記録を下げて固定する歯止めの仕組みを指す。本計画では `apps/api/eslint-max-lines-baseline.json` と `apps/web/eslint-max-lines-baseline.json` がその記録で、`scripts/ci/max-lines-baseline.mjs` が記録を作り直す。

## Plan of Work

段階1は、`scripts/ci/max-lines-baseline.mjs` を追加し、ESLint の Node API で `src` 配下（テストと生成物を除く）の各ファイルの行数を `max-lines` 規則と同じ数え方で数える。`init` は初回の記録を作り、`update` は記録を下げるか、600 行以下になったファイルを記録から外すだけで、上げることはしない。`check` は下げられる項目を表示するだけである。`apps/api/.eslintrc.cjs` と `apps/web/.eslintrc.cjs` の先頭で記録を読み込み、`overrides` の最初に「全体 600 行」と「記録にあるファイルごとの上限」を差し込む。既存の個別の厳しい上限（組立テンプレート編集など）は後ろにあるので、そちらが優先される。

段階2以降は、各段階の開始時にこの節へ具体的な編集内容を追記する。

## Concrete Steps

作業場所はリポジトリのルート（各段階の worktree）。

    node scripts/ci/max-lines-baseline.mjs init api    # 初回のみ。32 entries
    node scripts/ci/max-lines-baseline.mjs init web    # 初回のみ。25 entries
    pnpm --filter @raspi-system/api lint               # 成功すること
    pnpm --filter @raspi-system/web lint               # 成功すること

ファイルを分割して小さくしたら、次で記録を下げてコミットに含める。

    node scripts/ci/max-lines-baseline.mjs update api

## Validation and Acceptance

段階1の受け入れ条件は、既存のコードで lint が通り、かつ歯止めが働くことである。確認として、650 行の新しいファイルを `apps/web/src` に置くと `File has too many lines (650). Maximum allowed is 600` で失敗し、記録上限 1,215 行の `apps/web/src/api/domains/assembly.ts` に 40 行足すと `Maximum allowed is 1215` で失敗した。どちらも確認後に元へ戻した。本番の動作には影響しない（lint 設定のみ）。

各段階の共通の確認手順は、lint、変更した機能のテスト、CI を最終証拠とし、本番反映後に進捗追跡セッションが API の health と画面 1 枚を確認する。端末（キオスクやサイネージ）に関わる段階だけ、反映後にユーザーへ実機確認を依頼する。

## Idempotence and Recovery

`update` と `check` は何度実行しても安全で、記録を上げることはない。歯止めが原因で緊急の修正が通らない場合は、そのファイルを分割するのが本筋だが、どうしても必要なら該当ファイルの記録値をレビュー付きの PR で上げられる（記録は普通の JSON ファイル）。lint 設定を元に戻せば仕組み全体を取り外せる。

## Artifacts and Notes

（各段階の証拠をここに短く残す）

## Interfaces and Dependencies

`scripts/ci/max-lines-baseline.mjs` はワークスペースの `eslint`（8.x）と `@typescript-eslint/parser` を各アプリの `package.json` から解決して使う。追加の依存はない。
