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

各マイルストーンの詳細な実行手順と検証方法は ExecPlan を確認してください。
