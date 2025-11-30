---
title: システムアーキテクチャ概要
tags: [アーキテクチャ, 設計, システム構成]
audience: [アーキテクト, 開発者, 新規参加者]
last-verified: 2025-11-27
related: [infrastructure-base.md, ../decisions/001-module-structure.md]
category: architecture
update-frequency: low
---

# システムアーキテクチャ概要

## 全体構成

本システムは、Raspberry Pi 5（サーバー）と Raspberry Pi 4（クライアント）で構成される分散システムです。

```
┌─────────────────┐         ┌─────────────────┐
│  Raspberry Pi 5 │         │  Raspberry Pi 4  │
│    (サーバー)    │         │   (クライアント)  │
│                 │         │                 │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │   API     │◄─┼─────────┼─►│  Web UI   │  │
│  │ (Fastify) │  │  HTTPS  │  │  (React)  │  │
│  └───────────┘  │         │  └───────────┘  │
│       │         │         │       │         │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │PostgreSQL │  │         │  │NFC Agent  │  │
│  │   (DB)    │  │         │  │ (Python)  │  │
│  └───────────┘  │         │  └───────────┘  │
│                 │         │       │         │
└─────────────────┘         │  ┌───────────┐  │
                             │  │NFC Reader │  │
                             │  │RC-S300/S1 │  │
                             │  └───────────┘  │
                             └─────────────────┘
```

## モジュール構成

システムは以下のモジュールで構成されます：

### 1. 工具管理モジュール（tools）

工場内の工具・備品の持出・返却を管理します。

- **API**: `/api/tools/*`
- **フロントエンド**: `/admin/tools/*`
- **詳細**: [工具管理モジュール](../modules/tools/README.md)

### 2. ドキュメントビューワーモジュール（documents）

PDF/Excelファイルの閲覧・管理機能（将来実装予定）。

- **API**: `/api/documents/*`
- **フロントエンド**: `/admin/documents/*`
- **詳細**: [ドキュメントモジュール](../modules/documents/README.md)

### 3. 物流管理モジュール（logistics）

物流・配送管理機能（将来実装予定）。

- **API**: `/api/logistics/*`
- **フロントエンド**: `/admin/logistics/*`
- **詳細**: [物流管理モジュール](../modules/logistics/README.md)

## 技術スタック

### バックエンド

- **フレームワーク**: Fastify
- **ORM**: Prisma
- **データベース**: PostgreSQL 15
- **認証**: JWT
- **言語**: TypeScript

### フロントエンド

- **フレームワーク**: React 18
- **ビルドツール**: Vite
- **状態管理**: XState, React Query
- **スタイリング**: TailwindCSS
- **言語**: TypeScript

### インフラ

- **コンテナ**: Docker, Docker Compose
- **リバースプロキシ**: Caddy
- **OS**: Raspberry Pi OS 64bit

### NFCエージェント

- **言語**: Python 3.11
- **ライブラリ**: pyscard
- **フレームワーク**: FastAPI
- **キュー**: SQLite

## ディレクトリ構造

```
RaspberryPiSystem_002/
├── apps/
│   ├── api/              # Fastify API
│   │   ├── src/
│   │   │   ├── routes/   # ルートハンドラー
│   │   │   ├── services/ # サービス層
│   │   │   └── lib/      # 共通ライブラリ
│   │   └── prisma/       # Prismaスキーマ・マイグレーション
│   └── web/              # React Web UI
│       └── src/
│           ├── pages/    # ページコンポーネント
│           ├── components/ # UIコンポーネント
│           └── api/     # APIクライアント
├── packages/
│   └── shared-types/     # 共通型定義
├── clients/
│   └── nfc-agent/        # NFCエージェント（Python）
├── infrastructure/
│   └── docker/           # Dockerfile, Compose
└── docs/                 # ドキュメント
```

## データフロー

### 持出処理フロー

1. **NFCスキャン**: Pi4でアイテムタグ→従業員タグをスキャン
2. **WebSocket**: NFCエージェントがUIDをWeb UIに配信
3. **API呼び出し**: Web UIが`POST /api/tools/borrow`を呼び出し
4. **サービス層**: LoanServiceがビジネスロジックを実行
5. **データベース**: Prismaがトランザクションでデータを更新
6. **レスポンス**: APIがLoanオブジェクトを返却

### 認証フロー

1. **ログイン**: `POST /api/auth/login`で認証
2. **JWT発行**: サーバーがJWTトークンを発行
3. **リクエスト**: クライアントがJWTをAuthorizationヘッダーに付与
4. **検証**: FastifyがJWTを検証し、ユーザー情報を`request.user`に設定

## セキュリティ

- **認証**: JWT（管理者・マネージャー・ビューアー）
- **認可**: ロールベースアクセス制御（RBAC）
- **HTTPS**: CaddyによるTLS終端
- **クライアント認証**: APIキーによるデバイス認証

## スケーラビリティ

- **水平スケーリング**: 複数のPi4クライアントを追加可能
- **データベース**: PostgreSQLによるACID保証
- **オフライン対応**: NFCエージェントがSQLiteキューでオフライン対応

## クライアントデバイス統合

ｎRaspberry Pi 4に様々なデバイスを接続する際の統合パターンと拡張性について説明します。

### デバイス統合パターン

#### パターン1: ブラウザAPIを使用するデバイス（推奨）

**対象デバイス:**
- USBカメラ（`navigator.mediaDevices.getUserMedia`）
- マイク、位置情報、Bluetoothなど

**統合方法:**
1. ブラウザの標準APIを使用してデバイスにアクセス
2. データをクライアント側で処理・圧縮
3. HTTPS経由でサーバーAPIに送信

**メリット:**
- ✅ 追加のエージェントプログラムが不要
- ✅ ブラウザの標準機能を活用（クロスプラットフォーム対応）
- ✅ クライアント側で処理できるため、サーバー負荷が低い

**注意:**
- ⚠️ HTTPS接続が必要（セキュリティ要件）
- 詳細は[本番環境セットアップガイド](../guides/production-setup.md)を参照

#### パターン2: 専用エージェントを使用するデバイス

**対象デバイス:**
- NFCリーダー（Sony RC-S300/S1）
- バーコードリーダー、重量計など

**統合方法:**
1. Pythonエージェント（`clients/`ディレクトリ）を作成
2. デバイスドライバを使用してデバイスにアクセス
3. WebSocketまたはREST APIでブラウザに配信
4. オフライン耐性のためSQLiteキューを実装

**メリット:**
- ✅ 専用プロトコルに対応可能
- ✅ オフライン耐性を実装しやすい
- ✅ デバイス固有の処理を分離できる

### 拡張性の設計原則

1. **モジュール化された構造**: 各エージェントは`clients/`ディレクトリに独立して配置
2. **サービス層の分離**: サーバー側のAPIは、デバイスの種類に依存しないサービス層を提供
3. **型定義の共有**: `packages/shared-types/`で型定義を共有

### HTTPS設定の汎用性

ブラウザAPIを使用する全てのデバイスでHTTPS設定を再利用可能です。一度設定すれば、新しいデバイスを追加しても再設定不要です。詳細は[本番環境セットアップガイド](../guides/production-setup.md)を参照してください。

## 関連ドキュメント

- [クライアントデバイス統合アーキテクチャ](./client-device-integration.md) - デバイス統合パターンと拡張性
- [モジュール構成](./modules.md)
- [データベース設計](./database.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md) - 全体の進捗とマイルストーン

