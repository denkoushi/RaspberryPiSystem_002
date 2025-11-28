---
title: クライアントデバイス統合アーキテクチャ
tags: [アーキテクチャ, 設計, 拡張性, デバイス統合]
audience: [アーキテクト, 開発者]
last-verified: 2025-11-27
related: [overview.md, ../guides/https-setup-factory.md]
category: architecture
update-frequency: medium
---

# クライアントデバイス統合アーキテクチャ

## 概要

本システムは、Raspberry Pi 4（クライアント）に様々なデバイスを接続し、Raspberry Pi 5（サーバー）と連携する分散アーキテクチャを採用しています。デバイス統合は**モジュール化と拡張性**を重視した設計思想に基づいています。

## デバイス統合パターン

### パターン1: ブラウザAPIを使用するデバイス（推奨）

**対象デバイス:**
- USBカメラ（`navigator.mediaDevices.getUserMedia`）
- マイク（`navigator.mediaDevices.getUserMedia`）
- 位置情報（`navigator.geolocation`）
- Bluetooth（`navigator.bluetooth`）
- その他のWeb API対応デバイス

**統合方法:**
1. ブラウザの標準APIを使用してデバイスにアクセス
2. データをクライアント側で処理・圧縮
3. HTTPS経由でサーバーAPIに送信

**メリット:**
- ✅ 追加のエージェントプログラムが不要
- ✅ ブラウザの標準機能を活用（クロスプラットフォーム対応）
- ✅ クライアント側で処理できるため、サーバー負荷が低い
- ✅ デバイスドライバの管理が不要

**デメリット:**
- ⚠️ HTTPS接続が必要（セキュリティ要件）
- ⚠️ ブラウザの互換性に依存

**実装例:**
- カメラ: `apps/web/src/utils/camera.ts`（`captureAndCompressPhoto`）
- API: `apps/api/src/routes/tools/loans/photo-borrow.ts`

**HTTPS設定:**
- 自己署名証明書を使用したHTTPS設定が必要
- 詳細: [工場現場でのHTTPS設定ガイド](../guides/https-setup-factory.md)

---

### パターン2: 専用エージェントを使用するデバイス

**対象デバイス:**
- NFCリーダー（Sony RC-S300/S1）
- バーコードリーダー（シリアルポート接続）
- 重量計（シリアルポート接続）
- その他の専用プロトコルデバイス

**統合方法:**
1. Pythonエージェント（`clients/`ディレクトリ）を作成
2. デバイスドライバを使用してデバイスにアクセス
3. WebSocketまたはREST APIでブラウザに配信
4. オフライン耐性のためSQLiteキューを実装

**メリット:**
- ✅ 専用プロトコルに対応可能
- ✅ オフライン耐性を実装しやすい
- ✅ デバイス固有の処理を分離できる

**デメリット:**
- ⚠️ エージェントプログラムの開発・保守が必要
- ⚠️ デバイスドライバの管理が必要

**実装例:**
- NFCエージェント: `clients/nfc-agent/`
- WebSocket配信: `ws://localhost:7071/stream`
- オフラインキュー: SQLite（`queue_store.py`）

---

## 拡張性の設計原則

### 1. モジュール化された構造

```
clients/
├── nfc-agent/          # NFCリーダー用エージェント
├── barcode-agent/      # バーコードリーダー用エージェント（将来）
├── scale-agent/        # 重量計用エージェント（将来）
└── ...
```

**各エージェントの共通インターフェース:**
- `GET /api/agent/status`: デバイス接続状況・ステータス
- `GET /api/agent/queue`: 未送信イベントのプレビュー
- `WebSocket /stream`: リアルタイムイベント配信

### 2. サービス層の分離

サーバー側のAPIは、デバイスの種類に依存しないサービス層を提供：

```
apps/api/src/services/tools/
├── loan.service.ts     # ビジネスロジック（デバイス非依存）
├── employee.service.ts
└── ...
```

**メリット:**
- 新しいデバイスを追加しても、サービス層の変更が不要
- デバイス固有の処理はクライアント側で完結

### 3. 型定義の共有

`packages/shared-types/`で型定義を共有：

```typescript
// クライアントとサーバーで同じ型を使用
export interface PhotoBorrowPayload {
  employeeTagUid: string;
  photoData: string; // Base64 encoded
  clientId?: string;
}
```

**メリット:**
- 型安全性の確保
- フロントエンドとバックエンドの整合性

---

## 新しいデバイスの追加手順

### ケース1: ブラウザAPIを使用するデバイス（例: カメラ）

1. **クライアント側ユーティリティの作成**
   ```typescript
   // apps/web/src/utils/[device-name].ts
   export async function captureFromDevice(): Promise<string> {
     // ブラウザAPIを使用してデバイスからデータを取得
   }
   ```

2. **APIエンドポイントの追加**
   ```typescript
   // apps/api/src/routes/tools/[module]/[action].ts
   export function register[Action]Route(app: FastifyInstance): void {
     app.post('/[action]', async (request) => {
       // サービス層を呼び出し
     });
   }
   ```

3. **サービス層の実装**
   ```typescript
   // apps/api/src/services/tools/[module].service.ts
   export class [Module]Service {
     async [action](input: [Input]): Promise<[Output]> {
       // ビジネスロジックを実装
     }
   }
   ```

4. **HTTPS設定の確認**
   - ブラウザAPIを使用する場合は、HTTPS接続が必要
   - [工場現場でのHTTPS設定ガイド](../guides/https-setup-factory.md)を参照

### ケース2: 専用エージェントを使用するデバイス（例: NFCリーダー）

1. **エージェントの作成**
   ```bash
   clients/[device]-agent/
   ├── [device]_agent/
   │   ├── __init__.py
   │   ├── config.py
   │   ├── reader.py      # デバイス読み取りロジック
   │   ├── queue_store.py # オフラインキュー
   │   └── main.py        # FastAPIサーバー
   ├── pyproject.toml
   └── README.md
   ```

2. **共通インターフェースの実装**
   - `GET /api/agent/status`: デバイス接続状況
   - `WebSocket /stream`: リアルタイムイベント配信
   - `GET /api/agent/queue`: 未送信イベントのプレビュー

3. **フロントエンドの統合**
   ```typescript
   // apps/web/src/hooks/use[Device]Stream.ts
   export function use[Device]Stream() {
     // WebSocket接続とイベント処理
   }
   ```

4. **APIエンドポイントの追加**
   - サービス層を呼び出すエンドポイントを追加
   - デバイス固有の処理はクライアント側で完結

---

## HTTPS設定の汎用性

### なぜHTTPS設定が汎用的か

1. **ブラウザAPIのセキュリティ要件**
   - カメラ、マイク、位置情報、Bluetoothなど、多くのブラウザAPIはHTTPS接続を要求
   - 一度HTTPSを設定すれば、全てのブラウザAPI対応デバイスで使用可能

2. **設定の再利用性**
   - 自己署名証明書の設定は一度行えば、新しいデバイスを追加しても再設定不要
   - Caddyfile.localの設定は、全てのブラウザAPI対応デバイスに適用可能

3. **モジュール化された設定**
   - `Caddyfile.local`: 自己署名証明書用（工場現場向け）
   - `Caddyfile.production`: Let's Encrypt用（インターネット接続あり）
   - `Caddyfile`: HTTPのみ（開発用）

### 新しいデバイス追加時の影響

**ブラウザAPIを使用するデバイス:**
- ✅ HTTPS設定の変更不要（既存設定をそのまま使用）
- ✅ 証明書の再生成不要
- ✅ クライアント端末での証明書信頼設定も不要（既に設定済み）

**専用エージェントを使用するデバイス:**
- ✅ HTTPS設定の変更不要（エージェントはローカルホストで動作）
- ✅ ブラウザとの通信は既存のHTTPS接続を使用

---

## 設計思想の一貫性

### モジュール化による拡張性

1. **サーバー側のモジュール化**
   - `apps/api/src/routes/tools/`: 工具管理モジュール
   - `apps/api/src/routes/documents/`: ドキュメントモジュール（将来）
   - `apps/api/src/routes/logistics/`: 物流管理モジュール（将来）

2. **クライアント側のモジュール化**
   - `clients/nfc-agent/`: NFCリーダー用エージェント
   - `clients/[device]-agent/`: 新しいデバイス用エージェント（将来）

3. **共通基盤の提供**
   - 型定義の共有（`packages/shared-types/`）
   - サービス層の分離（`apps/api/src/services/`）
   - HTTPS設定の統一（`infrastructure/docker/Caddyfile.local`）

### 保守性の確保

1. **責務の分離**
   - デバイス固有の処理はクライアント側で完結
   - サーバー側はビジネスロジックに集中
   - エージェントはデバイスとブラウザの橋渡しのみ

2. **テスト容易性**
   - 各エージェントは独立してテスト可能
   - サービス層はデバイス非依存でテスト可能
   - モックモード（`AGENT_MODE=mock`）で開発・テストが容易

3. **ドキュメント化**
   - 各エージェントにREADME.mdを配置
   - 統合手順を明確化
   - トラブルシューティングガイドを提供

---

## まとめ

### HTTPS設定の汎用性

✅ **はい、汎用的です**

- ブラウザAPIを使用する全てのデバイスでHTTPS設定を再利用可能
- 一度設定すれば、新しいデバイスを追加しても再設定不要
- モジュール化された設定により、環境に応じて適切な設定を選択可能

### プロジェクト全体の設計思想との整合性

✅ **モジュール化による拡張性・保守性を確保**

1. **拡張性**
   - 新しいデバイスを追加する際の影響範囲が限定的
   - 既存の設定・コードを再利用可能
   - モジュール化された構造により、並行開発が容易

2. **保守性**
   - 責務の分離により、各モジュールの保守が容易
   - テスト容易性により、品質を維持しやすい
   - ドキュメント化により、新規参加者のオンボーディングが容易

3. **設計思想の一貫性**
   - サーバー側のモジュール化（`routes/tools/`, `services/tools/`）
   - クライアント側のモジュール化（`clients/nfc-agent/`）
   - インフラ設定のモジュール化（`Caddyfile.local`, `Caddyfile.production`）

**結論:** 今回のHTTPS設定は、プロジェクト全体の設計思想（モジュール化・拡張性・保守性）と完全に整合しており、今後様々なデバイスを追加する際にも流用可能な汎用的な手段です。

