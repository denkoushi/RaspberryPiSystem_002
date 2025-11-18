# Raspberry Pi NFC 工場持出返却システム

本リポジトリは Raspberry Pi 5 サーバー + Raspberry Pi 4 クライアントで構成される持出返却システムのモノレポです。全体の背景、マイルストーン、詳細手順は `EXEC_PLAN.md` を参照してください。.agent/PLANS.md の運用ルールに従って ExecPlan を更新しつつ実装を進めます。

## ディレクトリ概要

- `apps/api`: Fastify + Prisma を用いたサーバー API
- `apps/web`: React + Vite の Web UI（キオスク／管理画面）
- `clients/nfc-agent`: Sony RC-S300/S1 と連携する Python NFC ブリッジ
- `infrastructure/docker`: Dockerfile と Compose マニフェスト
- `scripts/`: サーバー・クライアントのセットアップスクリプト

## 開発準備

1. Node.js 18.18 以上（推奨: 20.x）と pnpm をインストールし、`corepack enable` を実行
2. Python 3.11 + Poetry をインストール
3. ルートで `pnpm install` を実行してワークスペース依存を取得
4. `poetry install -C clients/nfc-agent` で NFC エージェント依存をセットアップ
5. 必要な `.env` ファイルを `.env.example` からコピー

## API 開発メモ

- Prisma マイグレーション: `cd apps/api && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma migrate dev`
- シードデータ投入: `cd apps/api && DATABASE_URL="..." pnpm prisma db seed`
- サーバー起動: `cd apps/api && pnpm dev`
- テスト: `cd apps/api && pnpm test`

## Web アプリ開発メモ

- 開発サーバー: `cd apps/web && pnpm dev` (デフォルト: http://localhost:4173)
- Lint/Test/Build: `cd apps/web && pnpm lint && pnpm test && pnpm build`
- キオスク端末は `.env` の `VITE_AGENT_WS_URL`（既定: `ws://localhost:7071/stream`）でローカル NFC エージェントに接続する
- USB メモリからのマスタ一括登録は管理画面「一括登録」ページから `employees.csv` / `items.csv` を選択して実行する（CSVはUTF-8、ヘッダー行必須）

## 今後の拡張

- `ImportJob` テーブルと `/api/imports/*` エンドポイントを共通ジョブ管理基盤として用意しており、PDF/Excel ビューワーや将来の物流管理モジュールが同じ仕組みでジョブ履歴やファイル投入を扱える
- 新機能を追加する際は `apps/api/src/routes`・`apps/web/src/pages` で独立したモジュールを増やし、Docker Compose でサービスを疎結合に保つ

各マイルストーンの詳細な実行手順と検証方法は ExecPlan を確認してください。
