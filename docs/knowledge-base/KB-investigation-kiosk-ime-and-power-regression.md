# KB調査: キオスク備考欄の日本語入力モード切替・電源ボタンの同時不具合

**作成日**: 2026-02-28  
**状態**: ✅ 電源ボタン修正完了（clientKey対応）、IMEは Chromium 135+ リグレッション対策を適用  
**関連**: [frontend.md#KB-276](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善), [ansible-deployment.md#KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題)

---

## Context

- **発生日**: 2026-02-28（昨日の修正後、再発）
- **稼働環境**: Pi5（サーバー）と Pi4 ロボドリル01（raspi4-robodrill01）が稼働中
- **事象**:
  1. 生産スケジュール備考欄の日本語入力モード切替が、また切り替わらない状態になった
  2. 同じタイミングで、シャットダウン・再起動ボタンも機能しなくなった
- **過去**: このあたりのロジックは相当実装に苦戦している（KB-244, KB-276, KB-237）

---

## 実態調査結果

### 1. 両不具合の関連性

| 項目 | 日本語入力（IBus） | 電源ボタン（再起動/シャットダウン） |
|------|-------------------|-----------------------------------|
| **実行場所** | Pi4（キオスク端末） | Pi5（サーバー）→ Ansible → Pi4 |
| **依存** | IBus/mozc、Chromium、X11 | Pi5 API、pi5-power-dispatcher、Ansible、SSH |
| **共通要因候補** | なし（別レイヤー） | なし（別レイヤー） |

**結論**: アーキテクチャ上は**直接の関連性は薄い**。ただし「同じタイミングで」発生しているため、以下が考えられる:

- **共通トリガー**: デプロイ、Pi4再起動、Chromium/OS更新など
- **raspi4-robodrill01固有**: 複数キオスク環境での clientKey 解決の不整合

---

### 2. 電源ボタン不具合の仮説（優先度高）

#### 仮説A: raspi4-robodrill01 の clientKey 不一致（**要検証**）

**根拠**:
- 電源操作は `POST /kiosk/power` に `x-client-key` でリクエスト
- `KioskHeader.tsx` は `postKioskPower({ action })` を呼び、**clientKey を明示渡していない**
- `api.defaults.headers.common['x-client-key']` は `setClientKeyHeader(getResolvedClientKey())` で設定
- `resolveClientKey()` は localStorage が空なら `DEFAULT_CLIENT_KEY` = `client-key-raspberrypi4-kiosk1` を返す
- **raspi4-robodrill01 の正しいキーは `client-key-raspi4-robodrill01-kiosk1`**
- Web アプリは Pi5 でビルドされ、全キオスクで同一バンドルを配信（`VITE_DEFAULT_CLIENT_KEY` はビルド時に固定）
- そのため raspi4-robodrill01 では `client-key-raspberrypi4-kiosk1` が送信され、pi5-power-dispatcher は **raspberrypi4**（kensakuMain）を対象にする
- raspberrypi4 がオフラインまたは別端末の場合、Ansible 接続失敗で電源操作が実行されない

**検証手順**:
1. raspi4-robodrill01 のブラウザ DevTools で `POST /kiosk/power` の Request Headers を確認 → `x-client-key` の値を記録
2. Pi5 上で `ls -la /opt/RaspberryPiSystem_002/power-actions/` と `ls -la .../power-actions/failed/` を確認
3. `journalctl -u pi5-power-dispatcher.service -n 50` でログ確認
4. `ansible-inventory -i inventory.yml --list` の `raspi4-robodrill01` の `status_agent_client_key` を確認

#### 仮説B: pi5-power-dispatcher の既知問題の再発（KB-237）

- Jinja2 テンプレート展開、systemd User、ディレクトリ所有権など
- KB-237 で修正済みだが、デプロイや権限変更で再発の可能性

**検証手順**:
- `systemctl status pi5-power-dispatcher.path` / `pi5-power-dispatcher.service`
- `ls -la /opt/RaspberryPiSystem_002/power-actions` の所有者
- `journalctl -u pi5-power-dispatcher.service` のエラーメッセージ

---

### 3. 日本語入力不具合の仮説（優先度高）

#### 仮説C: IBus の二重起動・エンジン未設定の再発（KB-276）

**根拠**:
- KB-276 で `--replace --single`、リトライロジック、全角/半角キー追加を実施
- Pi4 再起動後、`ibus-autostart.desktop` / `ibus-engine.desktop` の起動順や DBus 準備遅延で再発し得る

**検証手順**（raspi4-robodrill01 に SSH 接続）:
```bash
# IBus プロセス
pgrep -af ibus

# エンジン状態
ibus engine

# gsettings
gsettings get org.freedesktop.ibus.general engines-order
gsettings get org.freedesktop.ibus.general.hotkey triggers
```

#### 仮説D: Chromium 135+ IBus リグレッション（**確認済み・原因**）

- **Chrome 135 で IBus/IME が壊れる既知のリグレッション**（issue 408309963）
- raspi4-robodrill01 は Chromium 142 を稼働 → 135 以降のため影響あり
- IBus/mozc は起動済み（pgrep で確認済み）だが、Chromium 内で IME が動作しない

**対策**（2026-02-28 実施）:
- `--ozone-platform=x11` を kiosk-launch.sh に追加し、X11 経路を強制
- 実機検証が必要

---

### 4. ラズパイ標準機能との関連（安定稼働の要件整理）

| 機能 | ラズパイ/OS 側の仕様 | 本システムの依存 | 安定化の要件 |
|------|---------------------|------------------|--------------|
| **IME** | IBus + mozc（Debian/Raspberry Pi OS 標準） | キオスクユーザー（tools04）の autostart、gsettings | IBus の単一起動、エンジン設定のリトライ、ホットキー（全角/半角 + Ctrl+Space）の永続化 |
| **Chromium** | キオスクモード（`--kiosk`）で全画面・一部ショートカット制限 | 備考欄の textarea で日本語入力 | IME が OS 側で有効であれば、Chromium は基本的に透過。フォーカスや `inputmode` の扱いに注意 |
| **電源操作** | `systemctl reboot` / `poweroff` は sudo 要 | Pi5 → Ansible → Pi4 の SSH 経由で実行 | inventory の clientKey と Web の x-client-key の一致、pi5-power-dispatcher の正常動作、SSH 接続可能性 |

**推奨**:
- 複数キオスク対応時は、**端末ごとの clientKey を Web アプリに正しく渡す**仕組みが必要（現状は DEFAULT_CLIENT_KEY 固定の可能性が高い）
- IBus については、KB-276 の対策が Ansible で冪等に適用されているか、デプロイ対象に raspi4-robodrill01 が含まれているかを確認

---

## 実施した修正（2026-02-28）

### 電源ボタン（clientKey 不一致）

1. **KioskHeader**: `postKioskPower` に `clientKey` を明示渡す修正を実施
2. **resolveClientKey**: URL パラメータ `?clientKey=xxx` を最優先で読み取り、localStorage に保存
3. **inventory**: `kiosk_url` に `?clientKey={{ status_agent_client_key }}` を追加（raspberrypi4 / raspi4-robodrill01 両方）

### 日本語入力（Chromium 135+ リグレッション）

- **原因**: raspi4-robodrill01 が Chromium 142 を使用。Chrome 135 以降で IBus/IME が壊れる既知のリグレッション（issue 408309963）
- **対策**: `kiosk-launch.sh` に `--ozone-platform=x11` を追加し、X11 経路を強制
- デプロイ後、`kiosk-browser.service` を再起動して Chromium を再起動する

### デプロイ順序の修正（2026-02-28）

- **kiosk ロール**: kiosk-launch スクリプトまたは kiosk-browser.service 変更時に、kiosk-browser を再起動するタスクを追加
- 従来は client ロールの再起動が kiosk ロールより先に実行され、新しい URL（clientKey 付き）が反映されなかった

---

## 関連ファイル

- `apps/web/src/components/kiosk/KioskHeader.tsx`（`postKioskPower` 呼び出し、clientKey 未渡し）
- `apps/web/src/api/client.ts`（`resolveClientKey`, `setClientKeyHeader`, `postKioskPower`）
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`（IBus 設定）
- `infrastructure/ansible/templates/ibus-autostart.desktop.j2`
- `infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2`
- `infrastructure/ansible/inventory.yml`（raspi4-robodrill01 の status_agent_client_key）

---

## 参照 KB

- [KB-244](./frontend.md#kb-244-pi4キオスクの備考欄に日本語入力状態インジケーターを追加): 備考欄の日本語入力、IBus 設定永続化
- [KB-276](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善): IBus 二重起動防止、リトライ、全角/半角キー追加
- [KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題): 電源操作の Jinja2/systemd/所有権問題
- [KB-225](./kiosk-input-protection-investigation.md): キオスク入力フィールド保護、clientKey の扱い
