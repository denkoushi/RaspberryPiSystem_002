# 工場業務システム（RaspberryPiSystem_002）

工場の現場業務を支える社内システムです。Raspberry Pi 5 のサーバーと、現場に置いた Raspberry Pi 4 のキオスク端末（NFC リーダー付き）で構成されます。当初は工具の持出返却を記録するシステムでしたが、現在は生産日程と負荷調整、組立の要領書とチェックシート、計測機器、トルクレンチ、サイネージ、チャットによる操作案内などへ広がっています。

本リポジトリには、サーバーの API と Web 画面、端末側のエージェント、端末への一括反映の仕組み（Ansible）、運用文書がまとまっています。

## 主な機能

現場の端末（キオスク）で使う機能です。画面ごとの操作説明は `docs/kiosk-operation-guide/` にあります。

- 持出返却: 工具・計測機器・吊具の持出と返却を NFC カードで記録します。持出時の写真記録にも対応しています。
- 生産日程: 納期の管理、順位の入力、負荷調整、進捗の一覧を扱います。
- 自主検査と部品測定: 検査図面の登録、測定値の記録、記録の承認、手順書（要領書）の表示と編集を行います。
- 組立: 要領書、チェックシート、作業セッション、記録の承認、トレーサビリティ、教育用の画面があります。
- トルクレンチ: 専用エージェントでレンチと接続し、締付けの記録を取り込みます。
- 配膳（棚在庫）と購買: 品目在庫、配膳の確認履歴、購買注文の照会を扱います。
- モバイル: スマートフォンでの置き場登録、パレット可視化、スキャン作業に対応します。
- 手順掲示板と機械信号: 工程の手順掲示板と、設備の稼働信号の表示があります。
- サイネージ: 工場内の表示端末へ、工具の状況や生産日程をスライドで表示します。
- チャット案内: 画面右下の丸いボタンから、操作の質問や問い合わせを送れます。
- 呼び出しと音声: 現場からの呼び出しと、音声入力・通話の機能があります。

管理画面（`/admin`）では、従業員・品目・端末のマスタ、CSV 取込、バックアップ、監視カメラ、各種設定を扱います。

## システム構成

```
  管理者・現場の端末
        |  HTTPS
        v
  Raspberry Pi 5（サーバー、Docker Compose で稼働）
    Caddy -> Web（React + Vite）
          -> API（Fastify + Prisma）-> PostgreSQL
        ^
        |  API 呼び出し
  Raspberry Pi 4 キオスク ... Chromium の画面 + 各種エージェント
  Raspberry Pi 3 サイネージ ... 表示専用
```

- サーバー: Raspberry Pi 5 を1台。Docker Compose で API、Web、PostgreSQL、Caddy を動かします（定義は `infrastructure/docker/`）。
- 端末: Raspberry Pi 4 のキオスク 8 台、Raspberry Pi 3 のサイネージ 1 台（`infrastructure/ansible/inventory.yml` の定義による）。端末側には NFC、バーコード、トルクレンチ、状態送信などのエージェントがあり、`clients/` にあります。
- 反映方式: Ansible による一括更新です。`scripts/update-all-clients.sh` がサーバーと端末を順に更新します。
- 外部連携: Gmail、Dropbox、Slack などと連携します（[外部連携台帳](./docs/guides/external-integration-ledger.md)）。
- DGX Spark（ローカル LLM の実行基盤）の排他調停、個人用 Pi 5 の管理画面、温度・履歴の監視は、別リポジトリ [`denkoushi/DGXSparkControlPlane`](https://github.com/denkoushi/DGXSparkControlPlane) の担当です。本リポジトリは業務キオスク、業務管理画面、業務 Pi 5 と Pi 4、および業務側からの DGX API 利用を担当します。通常は片方のリポジトリだけを変更し、DGX の互換 API や認証方式を変えるときだけ、両方を確認して別々の PR で進めます。詳細は [責任分界の正本](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md) を参照してください。

## ディレクトリ構成

- `apps/api`: サーバー API（Fastify + Prisma）
- `apps/web`: キオスクと管理画面の Web UI（React + Vite）
- `apps/android-haizen-shell`: 配膳用 Android アプリの外枠
- `clients/`: 端末側エージェント（NFC、バーコード、トルクレンチ、配膳、状態送信、監視カメラなど）
- `packages/`: API と Web で共有するライブラリ
- `services/`: 補助サービス
- `infrastructure/`: Docker 定義（`docker/`）、Ansible（`ansible/`）、端末イメージ（`image/`）
- `scripts/`: 反映、バックアップ、検査、運用用のスクリプト
- `e2e/`: Playwright による E2E テスト
- `docs/`: 運用文書、設計判断、ナレッジベース
- `security/`: 依存関係の例外とシークレット検査の基準

## 文書の案内

担当者は次の順に読むと全体をつかめます。全文書の索引は [docs/INDEX.md](./docs/INDEX.md) です。

1. [アーキテクチャ概要](./docs/architecture/overview.md): システム全体の構成
2. [開発ガイド](./docs/guides/development.md): 開発環境と開発の流れ
3. [デプロイメントガイド](./docs/guides/deployment.md) と [クイックスタート](./docs/guides/quick-start-deployment.md): 本番への反映手順
4. [デプロイ状態の復旧手順](./docs/runbooks/deploy-status-recovery.md): 反映が途中で止まったときの復旧
5. [運用マニュアル](./docs/guides/operation-manual.md) と [Runbook 一覧](./docs/runbooks/): 日常運用と障害対応
6. [ナレッジベース](./docs/knowledge-base/index.md): 過去の障害と対処の記録
7. [設計判断の記録（ADR）](./docs/decisions/): 重要な設計判断とその理由
8. [キオスク操作ガイド](./docs/kiosk-operation-guide/): 現場向けの画面ごとの操作説明
9. [モジュール文書](./docs/modules/): 工具管理、計測機器、サイネージなどの機能別仕様
10. [システム要件定義](./docs/requirements/system-requirements.md): 機能要件と非機能要件

端末の新規導入は [client-initial-setup.md](./docs/guides/client-initial-setup.md) を参照してください。古い手作業の構築手順は [manual-setup-legacy.md](./docs/guides/manual-setup-legacy.md) に残しています。

## 開発の始め方

1. Node.js 24 以上（推奨: 24.x）をインストールし、リポジトリのルートで `npm install -g "$(node -p "require('./package.json').packageManager")"` を実行します。
2. Python 3.11 と Poetry をインストールします。
3. ルートで `pnpm install` を実行して依存を取得します。
4. `poetry install -C clients/nfc-agent` で NFC エージェントの依存を入れます。
5. 必要な `.env` を `.env.example` からコピーします。

API の開発:

- Prisma マイグレーション: `cd apps/api && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma migrate dev`
- シード投入: `cd apps/api && DATABASE_URL="..." pnpm prisma db seed`
- サーバー起動: `cd apps/api && pnpm dev`
- テスト: `cd apps/api && pnpm test`
- エラーレスポンスの `requestId` でログを検索できます。詳細は [開発ガイド](./docs/guides/development.md) と [エラーハンドリングガイド](./docs/guides/error-handling.md) を参照してください。

Web の開発:

- 開発サーバー: `cd apps/web && pnpm dev`（既定: http://localhost:4173）
- Lint、テスト、ビルド: `cd apps/web && pnpm lint && pnpm test && pnpm build`
- リポジトリ全体の lint: `pnpm lint --max-warnings=0`（自動修正は `pnpm lint --fix`）
- キオスク端末は `.env` の `VITE_AGENT_WS_URL`（既定: `ws://localhost:7071/stream`）でローカルの NFC エージェントに接続します。
- マスタの一括登録は管理画面の「一括登録」ページから `employees.csv` と `items.csv` を選んで行います（[CSV 取込・出力仕様](./docs/guides/csv-import-export.md)）。

E2E テスト:

1. PostgreSQL を起動します: `pnpm test:postgres:start`
2. API を起動します: `cd apps/api && pnpm dev`
3. Web を起動します: `cd apps/web && pnpm dev`
4. テストを実行します: `pnpm test:e2e`（UI モードは `pnpm test:e2e:ui`、ブラウザ表示ありは `pnpm test:e2e:headed`）

個別のエラー（Prisma、Docker ビルド、画面の 404 など）の対処は [トラブルシューティング](./docs/knowledge-base/troubleshooting-knowledge.md) とナレッジベースにあります。

## 本番反映

標準はローリング更新です。

1. 対象のブランチと、そのブランチの CI 成功を確認します。
2. `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan` で、対象と順序を確認します。
3. `--limit <パターン>`（全台のときは `--full-fleet`）を付けて実行します。
4. 実行後に、状態とヘルスチェックを確認します。

手順、端末ごとの制約、失敗時の復旧は [デプロイメントガイド](./docs/guides/deployment.md) と [復旧手順](./docs/runbooks/deploy-status-recovery.md) が正本です。実行中のプロセスの強制終了や、ロックや実行記録の手編集で標準手順を迂回しないでください。

## 開発の進め方

- 変更は専用のブランチから Pull Request で行い、CI の全チェックの合格を必須とします。
- main ブランチは保護しています。設定手順は [CI 必須化とブランチ保護設定ガイド](./docs/guides/ci-branch-protection.md) と [ブランチ保護ルール設定手順](./.github/BRANCH_PROTECTION_SETUP.md) を参照してください。
- 重要な変更や障害対応は、ナレッジベース、ADR、Runbook、Plan のいずれかに記録します。
- AI エージェントを使う作業の規約は [AGENTS.md](./AGENTS.md) にあります。
