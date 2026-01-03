# キオスククライアントステータス表示の現状調査レポート

調査日: 2026-01-03
調査者: AI Assistant
目的: キオスクで自端末の温度を表示する機能の実装に向けた現状調査

## 調査概要

### 要件
- **キオスク（端末Aで開く）**: 端末Aの温度を表示
- **キオスク（端末Bで開く）**: 端末Bの温度を表示
- **管理コンソール**: 全端末（A、B等）の温度を一覧表示
- **更新間隔**: 60秒に統一

### 現状の問題
1. キオスクは現在Pi5（サーバー）の温度を表示している（`useSystemInfo()`）
2. Pi3のうち1台のステータス情報が取得できていない

## データベーススキーマの調査

### ClientDeviceテーブル
```prisma
model ClientDevice {
  id           String        @id @default(uuid())
  name         String
  location     String?
  apiKey       String        @unique  // x-client-keyとして使用
  defaultMode  String?       @default("TAG")
  lastSeenAt   DateTime?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}
```

### ClientStatusテーブル
```prisma
model ClientStatus {
  id            String    @id @default(uuid())
  clientId      String    @unique  // status-agentが送信するCLIENT_ID
  hostname      String
  ipAddress     String
  cpuUsage      Float
  memoryUsage   Float
  diskUsage     Float
  temperature   Float?
  uptimeSeconds Int?
  lastBoot      DateTime?
  lastSeen      DateTime  @default(now())
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### 重要な発見

**問題点**: `ClientDevice`と`ClientStatus`の間に**直接的なリレーションがない**

- `ClientDevice.id` (UUID) ≠ `ClientStatus.clientId` (status-agentの設定値)
- `ClientDevice.apiKey` = `x-client-key` (キオスクが持っている)
- `ClientStatus.clientId` = `status-agent`の設定ファイルの`CLIENT_ID`

## status-agentの設定構造

### 設定ファイル (`status-agent.conf`)
```bash
API_BASE_URL="https://raspi5.local:8080/api"
CLIENT_ID="pi3-signage-01"          # ClientStatus.clientIdとして保存される
CLIENT_KEY="replace-with-api-key"   # x-client-keyとして送信、ClientDevice.apiKeyと一致
LOCATION="工場1階ラインA"
```

### status-agentの動作フロー

1. **設定読み込み**: `CLIENT_ID`と`CLIENT_KEY`を読み込む
2. **メトリクス収集**: CPU温度、使用率等を収集
3. **API送信**: `POST /api/clients/status`に送信
   - ヘッダー: `x-client-key: CLIENT_KEY`
   - ボディ: `{ clientId: CLIENT_ID, hostname, temperature, ... }`

## APIエンドポイントの調査

### POST /api/clients/status

**現在の実装**:
```typescript
app.post('/clients/status', async (request) => {
  const clientKey = normalizeClientKey(request.headers['x-client-key']);
  
  // ClientDeviceをupsert（apiKeyで特定）
  const clientDevice = await prisma.clientDevice.upsert({
    where: { apiKey: clientKey },
    update: { name: metrics.hostname, lastSeenAt: now },
    create: { name: metrics.hostname, apiKey: clientKey, lastSeenAt: now }
  });

  // ClientStatusをupsert（clientIdで特定）
  const status = await prisma.clientStatus.upsert({
    where: { clientId: metrics.clientId },
    create: { clientId: metrics.clientId, hostname, temperature, ... },
    update: { hostname, temperature, ... }
  });
});
```

**問題点**:
- `ClientDevice`と`ClientStatus`が独立して保存される
- `x-client-key`から`ClientStatus`を直接取得できない

### GET /api/clients/status

**現在の実装**:
```typescript
app.get('/clients/status', { preHandler: canViewStatus }, async (request) => {
  // 認証: JWT必須（ADMIN/MANAGER/VIEWER）
  const statuses = await prisma.clientStatus.findMany({
    orderBy: { hostname: 'asc' }
  });
  // 全端末のステータスを返す
});
```

**問題点**:
- キオスクはJWTを持たない（`x-client-key`のみ）
- 全端末のステータスを返すため、セキュリティリスクがある

## キオスク側の実装調査

### 現在の実装 (`KioskLayout.tsx`)

```typescript
const { data: systemInfo } = useSystemInfo();
// systemInfo.cpuTemp → Pi5（サーバー）の温度
```

### useSystemInfo()の実装

```typescript
export function useSystemInfo() {
  return useQuery({
    queryKey: ['system-info'],
    queryFn: getSystemInfo,  // GET /api/system/system-info
    refetchInterval: 10_000,  // 10秒間隔
  });
}
```

### GET /api/system/system-info

```typescript
app.get('/system/system-info', async (request, reply) => {
  // Pi5（サーバー）の/sys/class/thermal/thermal_zone0/tempを読み取る
  const tempData = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
  cpuTemp = tempMillidegrees / 1000;
});
```

## 紐づけ方法の調査

### 現状の紐づけ方法

1. **`hostname`で紐づける**（`GET /clients/status`で使用）
   - `ClientDevice.name` = `ClientStatus.hostname`
   - 問題: `hostname`は変更可能で、一意性が保証されない

2. **`clientId`で紐づける**（`POST /clients/status`で使用）
   - `ClientStatus.clientId` = status-agentの`CLIENT_ID`
   - 問題: `ClientDevice.id`とは別物

3. **`apiKey`で紐づける**（`POST /clients/status`で使用）
   - `ClientDevice.apiKey` = `x-client-key`
   - 問題: `ClientStatus`に`apiKey`フィールドがない

## Pi3の1台がステータス情報を取得できていない原因の仮説

### 考えられる原因

1. **status-agentが動作していない**
   - systemdサービスが停止している
   - 設定ファイルが不正または未設定

2. **CLIENT_IDの不一致**
   - `status-agent`の`CLIENT_ID`が設定されていない
   - `CLIENT_ID`が重複している

3. **ネットワーク接続の問題**
   - APIへの接続が失敗している
   - `x-client-key`が正しく送信されていない

4. **データベースの問題**
   - `ClientStatus`レコードが作成されていない
   - `clientId`が重複している

## 実装方針の検討

### 方針A: ClientStatusにclientDeviceIdを追加（推奨）

**メリット**:
- 確実な紐づけが可能
- 将来の拡張に強い

**デメリット**:
- スキーマ変更が必要（マイグレーション）
- 既存データの移行が必要

**実装内容**:
```prisma
model ClientStatus {
  // ...
  clientDeviceId String?  // 追加
  clientDevice   ClientDevice? @relation(fields: [clientDeviceId], references: [id])
}
```

### 方針B: hostnameで紐づける（現状維持）

**メリット**:
- スキーマ変更不要
- 実装が簡単

**デメリット**:
- `hostname`の一意性が保証されない
- 将来の拡張に弱い

### 方針C: CLIENT_IDをClientDevice.idと同じにする

**メリット**:
- スキーマ変更不要

**デメリット**:
- status-agentの設定変更が必要
- 既存端末の再設定が必要

## 推奨実装方針

### 短期対応（最小変更）

1. **キオスク専用エンドポイント追加**
   - `GET /api/kiosk/self-status`
   - 認証: `x-client-key`必須
   - 返却: 自端末のステータスのみ（`hostname`で紐づけ）

2. **キオスク側の実装変更**
   - `useSystemInfo()` → `useKioskSelfStatus()`
   - 更新間隔: 60秒に統一

### 長期対応（堅牢な実装）

1. **スキーマ変更**
   - `ClientStatus`に`clientDeviceId`を追加
   - `ClientDevice`とのリレーションを確立

2. **API実装変更**
   - `POST /api/clients/status`で`clientDeviceId`を保存
   - `GET /api/kiosk/self-status`で`clientDeviceId`で検索

## 次のステップ

1. **Pi3の1台のステータス取得問題の調査**
   - Pi3にSSH接続して`status-agent`の動作確認
   - 設定ファイルの確認
   - ログの確認

2. **実装方針の決定**
   - 短期対応か長期対応か
   - スキーマ変更の可否

3. **実装開始**
   - キオスク専用エンドポイントの実装
   - キオスク側の表示変更

