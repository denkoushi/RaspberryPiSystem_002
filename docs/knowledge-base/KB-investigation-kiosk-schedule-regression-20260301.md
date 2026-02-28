# KB調査: キオスク生産スケジュールの不具合（静的解析＋実機ログ解析）

**作成日**: 2026-03-01  
**更新**: 2026-03-01（実機ログ解析で電源ボタン不具合の根本原因を確定）  
**手法**: 静的解析 → 実機ログ取得（Pi5 power-actions、raspi4-robodrill01 kiosk-launch.sh）  
**関連**: [KB-investigation-kiosk-ime-and-power-regression.md](./KB-investigation-kiosk-ime-and-power-regression.md), [KB-237](./infrastructure/ansible-deployment.md#kb-237), [KB-276](./frontend.md#kb-276)

---

## 環境（訂正後）

- **第2工場のみ**（トークプラザは存在しない）
- **Pi4 は2台**: raspberrypi4（kensakumaster、kensakuMain）と raspi4-robodrill01（RoboDrill01）
- **kensakumaster はシャットダウン中** → 稼働中の Pi4 は raspi4-robodrill01 のみ
- **全 Pi4 は同じ仕様で運用**

---

## 調査対象の不具合

1. **備考欄の日本語入力**: 日本語入力モードになるが、キー入力のたびに ibus-ui ウィンドウが出現しスムーズに入力できない
2. **シャットダウン・再起動ボタン**: 機能しない

---

## 電源ボタン不具合の要因（第2工場前提で再分析）

### 想定シナリオ（KB-investigation 仮説A に基づく）

| 段階 | 内容 |
|------|------|
| 1 | raspi4-robodrill01（稼働中）で電源ボタンを押す |
| 2 | `x-client-key` に `client-key-raspberrypi4-kiosk1` が送信される（DEFAULT にフォールバック） |
| 3 | pi5-power-dispatcher は clientKey でホストを特定 → **raspberrypi4**（kensakuMain）が対象 |
| 4 | raspberrypi4（kensakumaster）は**シャットダウン中**で SSH 不可 |
| 5 | Ansible 接続失敗 → 電源操作が実行されない |

**要因の本質**: raspi4-robodrill01 から送られる clientKey が `client-key-raspberrypi4-kiosk1` になっており、dispatcher がシャットダウン中の raspberrypi4 を対象にしてしまう。

### なぜ clientKey が誤るか（要検証）

- **inventory の設定**: raspi4-robodrill01 の kiosk_url は `?clientKey=client-key-raspi4-robodrill01-kiosk1` 付与済み。静的解析では正しい。
- **考えられる原因**:
  1. **kiosk_url が raspi4-robodrill01 に正しくデプロイされていない**（`--limit raspberrypi4` のみでデプロイ、raspi4-robodrill01 が未適用など）
  2. **初回ロード時の URL に clientKey が含まれていない**（ブックマークやリダイレクトでクエリが落ちている等）
  3. **localStorage に古い client-key-raspberrypi4-kiosk1 が残っている**（過去の運用で上書きされた）
  4. **「同じ仕様」運用で全 Pi4 に raspberrypi4 用の kiosk_url を意図的に配っている**（要確認）

### 実機ログ解析による確定（2026-03-01）

| 証拠 | 内容 |
|------|------|
| **power-actions ログ件数** | `client-key-raspberrypi4-kiosk1`: 26件 / `client-key-raspi4-robodrill01-kiosk1`: 5件 |
| **2/28 10:40 UTC の失敗ログ** | `client-key-raspberrypi4-kiosk1` で poweroff 要求 → Ansible が raspberrypi4 (100.74.144.79) をターゲット → `ssh: connect to host 100.74.144.79 port 22: Connection timed out` → **UNREACHABLE** |
| **2/28 10:44 UTC 以降** | `client-key-raspi4-robodrill01-kiosk1` で reboot/poweroff → `changed: [raspi4-robodrill01]` → **成功** |
| **raspi4-robodrill01 の kiosk-launch.sh** | `--app="https://100.106.158.2/kiosk?clientKey=client-key-raspi4-robodrill01-kiosk1"` で正しく設定されていることを確認 |

**根本原因（確定）**: raspi4-robodrill01 から誤って `client-key-raspberrypi4-kiosk1` が送信され、dispatcher がシャットダウン中の raspberrypi4（kensakumaster）をターゲットにして SSH タイムアウト → 電源操作が実行されない。

**なぜ誤った clientKey が送られたか**: 2/28 10:40 時点では、raspi4-robodrill01 の kiosk_url が古い（raspberrypi4 用）か、localStorage に古い値が残っていた可能性。10:44 以降は正しい clientKey で動作しているが、切り替わった直接要因（再起動・再読込・設定反映タイミングなど）はログのみでは断定不能。

---

## 日本語入力不具合の要因（静的解析）

### 設定の一貫性（問題なし）

- `kiosk-launch.sh.j2`: `--ozone-platform=x11` が設定済み（Chromium 135+ リグレッション対策）
- `ibus-autostart.desktop.j2`: `--replace --single --panel=disable` が設定済み
- `ibus.yml` / `defaults/main.yml`: `ibus_panel_show: 0`, `ibus_panel_show_im_name: false` が設定済み
- `ibus-kiosk-init.sh.j2`: ログイン時の gsettings 再適用とリトライロジックが実装済み

### 想定される残存要因（実機検証が必要）

1. **ibus-ui-gtk3 の変換候補ウィンドウ**: `--panel=disable` は IBus パネルを抑止するが、mozc の変換候補（ibus-ui-gtk3）は別コンポーネント。日本語変換時に候補ウィンドウが独立ウィンドウとして表示され、フォーカスを奪う可能性
2. **Chromium Wayland デフォルト**: `--ozone-platform=x11` が kiosk-browser.service 再起動後に有効か、実機で要確認
3. **IBus 二重起動の再発**: 起動順や DBus 準備遅延により、`--replace` が効かず二重起動する可能性

---

## 修正の方向性（実機検証後に確定）

### 電源ボタン

| 状態 | 内容 |
|------|------|
| **現状** | raspi4-robodrill01 の kiosk-launch.sh は正しい clientKey で設定済み。2/28 10:44 以降の電源操作は成功している。 |
| **再発防止** | デプロイ時に `--limit` で raspi4-robodrill01 を必ず含める。`update-all-clients.sh` で全 kiosk ホストを対象にするか、`--limit kiosk` で両方の Pi4 に適用する。 |
| **確認方法** | `ssh denkon5sd02@100.106.158.2 'ssh tools04@100.123.1.113 "grep -E \"app=|clientKey\" /usr/local/bin/kiosk-launch.sh"'` で clientKey が `client-key-raspi4-robodrill01-kiosk1` であることを確認。 |

### 日本語入力

| 優先度 | 内容 | 備考 |
|--------|------|------|
| 1 | 実機で `pgrep -af ibus`、`ibus engine`、`gsettings get org.freedesktop.ibus.panel show` を確認 | 現状確認 |
| 2 | mozc の変換候補をインライン表示にする設定の検討 | ibus-ui-gtk3 の挙動を抑制 |

---

## 関連ファイル

- `apps/web/src/api/client.ts`: resolveClientKey, DEFAULT_CLIENT_KEY
- `apps/web/src/layouts/KioskLayout.tsx`: getResolvedClientKey → KioskHeader
- `infrastructure/ansible/inventory.yml`: raspberrypi4, raspi4-robodrill01 の kiosk_url（両方 clientKey 付与済み）
- `infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2`: clientKey → ホスト解決ロジック
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`: --ozone-platform=x11, kiosk_url
- `infrastructure/ansible/roles/kiosk/tasks/ibus.yml`, `defaults/main.yml`
