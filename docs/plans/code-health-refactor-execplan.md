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
- [ ] 段階5: 1 本目として画面側の組立 API 定義 `apps/web/src/api/domains/assembly.ts` をテーマ別の 9 ファイルに分けた（PR #2085、main 83eaa0b5）。続きは変更頻度順に、生産スケジュールの研削計画ボード画面と service、画面側の生産スケジュール API 定義と hook、在庫 service、組立のルート定義を分ける。Hermes 系の大きいファイルは他セッションが頻繁に触るので後回しにする。
- [ ] 段階5（全体）: 頻繁に変更される巨大ファイルを分割する（組立のルート定義、部品測定のルート共通定義、サイネージ描画、画面側の API 定義）。
- [ ] 段階6: 画面側のデータ取得の書き方をそろえる（react-query の queryKey を一か所で定義、ページからの API 直接呼び出しを hook へ寄せる）。
- [ ] 段階7: 業務処理と HTTP の切り離し（業務エラーを HTTP に変換する場所を error handler に集約）を、1 機能ずつ段階的に進める。
- [ ] 段階8: プロセスのメモリに持っている状態（ログイン連携の一時情報など）を、複数台構成の前提が出たときに DB へ移す。現状は 1 台構成のため、制約として文書化するに留める。
- [ ] 段階9: 個人用 Pi5、DGX、StackChan のコードを業務リポジトリから分ける（要判断、後述）。

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

## 要判断（その段階に着いたときにユーザーへ一度だけ確認する）

（解決済み）本番から呼ばれていない配備スクリプト `scripts/deploy/terminal-runtime-manifest.py` と `scripts/deploy/rollback-manifest.py` は、2026-10-17 のユーザー判断で残すことにした（Decision Log 参照）。

個人用 Pi5、DGX、StackChan のコードを別リポジトリへ移すことは、新しいリポジトリの作成という外部に見える取り消しにくい操作を含むので、段階9の開始前に必ずユーザーに確認する。

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
