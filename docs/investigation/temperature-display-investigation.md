# 温度表示ロジックの調査結果

調査日: 2026-01-03

## 調査結果サマリー

### 結論: **各端末の温度は表示されていない（現状）**

| 画面/機能 | 表示される温度 | 取得元 | 備考 |
|---------|-------------|--------|------|
| **サイネージ（Pi3）** | ❌ **Pi5の温度** | Pi5の`/sys/class/thermal/thermal_zone0/temp` | サーバー側レンダラーがPi5の温度を画像に埋め込む |
| **キオスク（Pi4）** | ❌ **Pi5の温度** | Pi5の`/api/system/system-info` | `useSystemInfo()`がPi5の温度を取得 |
| **管理コンソール** | ✅ **各端末の温度** | `ClientStatus.temperature`（status-agent経由） | Pi3/Pi4それぞれの温度を表示 |

## 詳細調査結果

### 1. サイネージ（Pi3）の温度表示

**実装箇所**: `apps/api/src/services/signage/signage.renderer.ts`

```typescript
private async getSystemMetricsText(): Promise<string | null> {
  // Pi5（サーバー）上のファイルを読み取る
  const tempRaw = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
  const temperature = tempRaw ? `${(Number(tempRaw.trim()) / 1000).toFixed(1)}°C` : null;
  // ...
}
```

**動作フロー**:
1. Pi5（サーバー）上で`SignageRenderer`が実行される
2. Pi5の`/sys/class/thermal/thermal_zone0/temp`を読み取る
3. 温度をSVG画像に埋め込む
4. Pi3は`/api/signage/current-image`からJPEG画像を取得して表示

**結果**: Pi3のサイネージ画面には**Pi5の温度**が表示される（Pi3の温度ではない）

### 2. キオスク（Pi4）の温度表示

**実装箇所**: `apps/web/src/layouts/KioskLayout.tsx`

```typescript
const { data: systemInfo } = useSystemInfo();
// systemInfo.cpuTemp → Pi5（サーバー）の温度
```

**APIエンドポイント**: `GET /api/system/system-info`

```typescript
app.get('/system/system-info', async (request, reply) => {
  // Pi5（サーバー）の/sys/class/thermal/thermal_zone0/tempを読み取る
  const tempData = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
  cpuTemp = tempMillidegrees / 1000;
});
```

**結果**: Pi4のキオスク画面には**Pi5の温度**が表示される（Pi4の温度ではない）

### 3. 管理コンソールの温度表示

**実装箇所**: `apps/web/src/pages/admin/ClientsPage.tsx`

```typescript
const statusQuery = useClientStatuses();
// statusQuery.data → ClientStatus[]（各端末のステータス）
```

**データソース**: `ClientStatus`テーブル（status-agentが送信）

**動作フロー**:
1. Pi3/Pi4上で`status-agent.py`が実行される（60秒間隔）
2. 各端末の`/sys/class/thermal/thermal_zone0/temp`を読み取る
3. `POST /api/clients/status`に送信（`x-client-key`認証）
4. `ClientStatus`テーブルに保存
5. 管理コンソールが`GET /api/clients/status`で取得して表示

**結果**: 管理コンソールには**各端末（Pi3/Pi4）の温度**が表示される

## 実測データ（2026-01-03 19:14時点）

### DB上の`ClientStatus`テーブル

| clientId | hostname | ipAddress | temperature | lastSeen |
|----------|----------|-----------|-------------|----------|
| `raspberrypi3-signage1` | `raspberrypi` | `192.168.128.152` | **37.55°C** | 2026-01-03 10:14:03 |
| `raspberrypi4-kiosk1` | `raspberrypi` | `192.168.128.102` | **32.13°C** | 2026-01-03 10:13:25 |

**確認**: Pi3/Pi4それぞれの温度がDBに記録されている（status-agentが正常動作）

### 管理コンソールの表示

`GET /api/clients/status`のレスポンス:
- `raspberrypi3-signage1`: 37.55°C（Pi3の温度）
- `raspberrypi4-kiosk1`: 32.13°C（Pi4の温度）

**確認**: 管理コンソールには各端末の温度が正しく表示される

## 問題点の整理

### 問題1: サイネージ・キオスクで自端末の温度が表示されない

**現状**:
- サイネージ（Pi3）: Pi5の温度を表示
- キオスク（Pi4）: Pi5の温度を表示

**ユーザー要望**:
- サイネージ（Pi3）: Pi3の温度を表示
- キオスク（Pi4）: Pi4の温度を表示

**解決方法**:
- キオスク: `useSystemInfo()` → `useKioskSelfStatus()`に変更（`x-client-key`で自端末の`ClientStatus`を取得）
- サイネージ: サーバー側レンダラーで`ClientStatus`から該当端末の温度を取得（`x-client-key`で特定）

### 問題2: IPアドレスの変数化と実測値のズレ

**現状の問題**:
- `group_vars/all.yml`の`local_network.*_ip`が実測値とズレている
  - 設定値: `raspberrypi3_ip: "192.168.128.152"`
  - 実測値（status-agent送信）: `192.168.128.152`（一致）
  - 設定値: `raspberrypi4_ip: "192.168.10.224"`
  - 実測値（status-agent送信）: `192.168.128.102`（**不一致**）

**根本原因**:
- IPアドレスがハードコードされており、ネットワーク変更時に手動更新が必要
- 開発中にIPがコロコロ変わるため、設定ファイルと実測値がズレる

**解決方法**:
- Ansibleの`add_host`モジュールで動的にIPを取得
- `hostname -I`や`ip addr`でIPを取得して変数に設定
- 設定ファイルではなく、実行時に動的に解決する仕組みを導入

## 推奨される改善方針

### 1. 温度表示の修正（Pi3リソースを増やさない）

**キオスク（Pi4）**:
- `GET /api/kiosk/self-status`エンドポイントを追加（`x-client-key`認証）
- `ClientStatus`から該当端末のステータスを取得して返却
- `useKioskSelfStatus()`フックを追加（60秒間隔）

**サイネージ（Pi3）**:
- サーバー側レンダラーで`x-client-key`から`ClientDevice`を特定
- `ClientDevice`に対応する`ClientStatus`を取得して温度を埋め込む
- Pi3側の処理は一切変更不要（サーバー側のみの変更）

### 2. IPアドレスの動的取得

**Ansible Playbookでの動的IP取得**:
```yaml
- name: Get client IP address dynamically
  add_host:
    name: "{{ inventory_hostname }}"
    ansible_host: "{{ ansible_default_ipv4.address }}"
```

**設定ファイルからのIP削除**:
- `group_vars/all.yml`の`local_network.*_ip`を削除
- 実行時に`hostname -I`で取得したIPを使用

**疎結合・モジュール化の観点**:
- IPアドレスは実行時に動的に取得する
- 設定ファイルにハードコードしない
- ネットワーク変更に自動対応

## 関連ファイル

- `apps/api/src/services/signage/signage.renderer.ts`: サイネージレンダラー（Pi5の温度を表示）
- `apps/api/src/routes/system/system-info.ts`: システム情報API（Pi5の温度を返す）
- `apps/web/src/layouts/KioskLayout.tsx`: キオスクレイアウト（Pi5の温度を表示）
- `apps/web/src/pages/admin/ClientsPage.tsx`: 管理コンソール（各端末の温度を表示）
- `infrastructure/ansible/group_vars/all.yml`: IPアドレス設定（ハードコード）

