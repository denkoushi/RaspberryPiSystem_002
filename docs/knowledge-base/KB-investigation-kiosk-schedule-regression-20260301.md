# KB調査: キオスク生産スケジュールの不具合（静的解析＋実機ログ解析）

**作成日**: 2026-03-01  
**更新**: 2026-03-01（実機ログ解析で電源ボタン不具合の根本原因を確定、電源機能SOLIDリファクタ完了・電源操作遅延の原因特定を追記）  
**手法**: 静的解析 → 実機ログ取得（Pi5 power-actions、raspi4-robodrill01 kiosk-launch.sh）  
**関連**: [KB-investigation-kiosk-ime-and-power-regression.md](./KB-investigation-kiosk-ime-and-power-regression.md), [KB-237](./infrastructure/ansible-deployment.md#kb-237), [KB-276](./frontend.md#kb-276), [KB-285](./infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる), [power-function-solid-refactor-execplan.md](../plans/power-function-solid-refactor-execplan.md)

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
| **電源機能SOLIDリファクタ（2026-03-01）** | ClientKeyResolver モジュール（`apps/web/src/lib/client-key/`）を新設。`resolveClientKeyForPower` で電源専用の clientKey 解決を実施。未解決時はアラート表示し実行しない。複数キオスク環境での誤ターゲット問題を恒久対策。 |
| **電源操作遅延** | ボタン押下から発動まで約20秒（poweroff）/約85秒（reboot）かかる。多段構成（API→dispatcher→Ansible→SSH）に起因。KB-285 に詳細。連打防止画面の追加を検討（[power-function-solid-refactor-execplan.md](../plans/power-function-solid-refactor-execplan.md) の Next Steps）。 |
| **再発防止** | デプロイ時に `--limit` で raspi4-robodrill01 を必ず含める。`update-all-clients.sh` で全 kiosk ホストを対象にするか、`--limit kiosk` で両方の Pi4 に適用する。 |
| **確認方法** | `ssh denkon5sd02@100.106.158.2 'ssh tools04@100.123.1.113 "grep -E \"app=|clientKey\" /usr/local/bin/kiosk-launch.sh"'` で clientKey が `client-key-raspi4-robodrill01-kiosk1` であることを確認。 |

### 日本語入力

| 優先度 | 内容 | 備考 |
|--------|------|------|
| 1 | 実機で `pgrep -af ibus`、`ibus engine`、`gsettings get org.freedesktop.ibus.panel show` を確認 | 現状確認 |
| 2 | mozc の変換候補をインライン表示にする設定の検討 | ibus-ui-gtk3 の挙動を抑制 |

---

## IME 診断スクリプト（2026-03-01 追加）

デプロイ時に自動実行される診断タスクにより、IBus 状態がログに記録される。

- **スクリプト**: `scripts/kiosk/diagnose-ime.sh`
- **Ansible タスク**: `infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml`
- **実行タイミング**: kiosk ロール適用時（`manage_kiosk_browser` が真のとき）
- **手動実行**: `docs/runbooks/kiosk-ime-diagnosis.md` を参照

### 診断結果の記録（2026-03-01 / run_id: 20260301-153319-22948）

デプロイ実行後、Ansible の出力から診断結果を取得し、以下に記録する。

| 項目 | 結果 | 判定 |
|------|------|------|
| ibus-daemon プロセス数 | `1` | ✅ 単一起動 |
| 起動引数に --replace --single --panel=disable | `あり` | ✅ 反映済み |
| 競合シグネチャ `--daemonize --xim` | `0` | ✅ 競合なし |
| gsettings panel show | `0` | ✅ パネル非表示 |
| gsettings panel show-im-name | `false` | ✅ エンジン名非表示 |
| XDG_SESSION_TYPE | `tty`（Ansible script 実行時） | ℹ️ 非対話実行のため参考値 |
| kiosk-launch.sh に --ozone-platform | `含まれる（x11）` | ✅ 反映済み |
| ibus-owner.desktop | `あり` | ✅ 単一オーナー補助有効 |
| im-launch.desktop override | `Hidden=true` | ✅ 競合autostart抑止有効 |

**分析メモ**:
- `raspi4-robodrill01` に単一オーナー化（`ibus_owner_mode: single-owner`）を先行適用し、`ibus-daemon` 二重起動は解消した。
- `ibus-ui-gtk3` はプロセス一覧に現れず、少なくとも IBus パネル経路の競合起動は抑止できている。
- ただし診断スクリプトの `ibus engine` は非対話セッション実行時に取得失敗する場合があり、これは `failed_when: false` でデプロイ継続する設計どおり。
- 最終確認として、備考欄の実入力（人手）でフォーカス奪取が再発しないことを確認する。

---

## 日本語入力不具合の差異分析（2026-03-02）

**事象**: 研削メイン（raspberrypi4）で日本語入力がスムーズにできない。RoboDrill01（raspi4-robodrill01）ではスムーズに入力できる。

**inventory.yml の差異**:

| 項目 | raspberrypi4（kensakuMain） | raspi4-robodrill01 |
|------|-----------------------------|---------------------|
| `ibus_owner_mode` | 未設定（デフォルト `legacy`） | `single-owner` |
| `ibus_disable_competing_autostart` | 未設定（デフォルト `false`） | `true` |

**根本原因**:
- kensakuMain は IBus 単一オーナー化が適用されていなかった。`legacy` モードでは `ibus-owner.desktop` が配置されず、`im-launch.desktop` 等の競合 autostart が抑止されない。
- その結果、`ibus-daemon` の二重起動や競合プロセスが発生し、ibus-ui ウィンドウがキー入力ごとに出現してフォーカスを奪う。

**対策（2026-03-02 実施）**:
- `inventory.yml` の raspberrypi4 に `ibus_owner_mode: "single-owner"` と `ibus_disable_competing_autostart: true` を追加。
- 研削メイン復帰後のデプロイで反映。実機検証は復帰後に実施。

**備考**: 研削メインはシャットダウン中のため、静的解析（inventory 比較）のみで原因を特定。RoboDrill01 で有効だった設定を kensakuMain にも適用する方針。

### 実機診断による真因確定（2026-03-02）

研削メイン（raspberrypi4）に接続し、`scripts/kiosk/diagnose-ime.sh` を実行。結果は以下。

| 項目 | 研削メイン（診断時） | 期待値 |
|------|----------------------|--------|
| 競合シグネチャ `--daemonize --xim` | **1件** | 0件 |
| 単一オーナー判定 | **FAIL** | PASS |
| ibus-owner.desktop | **なし** | あり |
| im-launch.desktop override | **なし** | Hidden=true |

**実プロセス**:
- `ibus-daemon -drx --replace --single --panel=disable...`（期待どおり）: 1プロセス
- `ibus-daemon --daemonize --xim`（競合）: 1プロセス ← **im-launch 由来**
- `ibus-ui-gtk3`: 起動中（キー入力時のフォーカス奪取の原因）

**真因（確定）**:
1. `ibus_owner_mode: legacy` のため `ibus-owner.desktop` が配置されていない
2. `ibus_disable_competing_autostart: false` のため `im-launch.desktop` の override が無く、競合 autostart が抑止されていない
3. `im-launch` が `ibus-daemon --daemonize --xim` で競合起動し、`ibus-ui-gtk3` がキー入力ごとに前面に出てフォーカスを奪う

**対策**: `inventory.yml` の raspberrypi4 に `ibus_owner_mode: "single-owner"` と `ibus_disable_competing_autostart: true` を追加し、デプロイで反映。実機検証はデプロイ後に実施。

### 実機検証完了（2026-03-02）

- **デプロイ**: Run ID `20260302-192312-6532`、raspberrypi4 に適用、`state: success`、`exitCode: 0`
- **デプロイ後 IME 診断**: プロセス数 1、競合シグネチャ 0件、単一オーナー判定 PASS、ibus-owner.desktop あり、im-launch override Hidden=true
- **実機検証**: 研削メインの備考欄で日本語入力がスムーズにできることを確認。ibus-ui ウィンドウの出現・フォーカス奪取は解消。

---

## Firefox移行準備の実装状況（2026-03-01）

### 目的

- `raspi4-robodrill01` のみ Firefox へ切り替え可能にし、他Pi4は Chromium 維持のまま運用する。
- ブラウザ起動ロジックを host 設定で切替できる構成へ分離する。

### 実装済み

- `roles/kiosk/defaults/main.yml`
  - `kiosk_browser_engine`, `kiosk_browser_mode` を追加
  - Chromium/Firefox のフラグ定義を分離
- `inventory.yml`
  - `raspi4-robodrill01` のみ `kiosk_browser_engine: firefox` を設定
- `roles/kiosk/tasks/main.yml`
  - ブラウザ実行ファイルの存在チェックを engine 別に分岐
  - Chromium 固有処理（互換symlink）を条件付き化
- `templates/kiosk-launch.sh.j2`
  - browser engine で `chromium/firefox` を分岐する構成に再設計

### 検証結果（このブランチ上）

| 項目 | 結果 |
|------|------|
| `deploy.yml` 構文チェック | ✅ pass |
| `deploy-staged.yml` 構文チェック | ✅ pass |
| 実機デプロイ（Mac → robodrill01） | ⚠️ 未実施（SSH認証/経路制約で適用不可） |
| 現在の robodrill01 稼働状態（切替前） | Chromium 稼働中を確認 |
| Firefox バイナリ存在 | `/usr/bin/firefox` の存在を確認 |

### ロールバック

- `inventory.yml` の `raspi4-robodrill01` で以下へ戻す:
  - `kiosk_browser_engine: chromium`
  - `kiosk_browser_mode: app-like`

---

## 関連ファイル

- `apps/web/src/lib/client-key/`: ClientKeyResolver モジュール（types, config, sources, resolver, power-validator）
- `apps/web/src/api/client.ts`: resolveClientKey, postKioskPower（clientKey オプション）
- `apps/web/src/components/kiosk/KioskHeader.tsx`: resolveClientKeyForPower, postKioskPower
- `infrastructure/ansible/inventory.yml`: raspberrypi4, raspi4-robodrill01 の kiosk_url（両方 clientKey 付与済み）
- `infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2`: clientKey → ホスト解決ロジック
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`: --ozone-platform=x11, kiosk_url
- `infrastructure/ansible/roles/kiosk/tasks/ibus.yml`, `defaults/main.yml`
- `scripts/kiosk/diagnose-ime.sh`: IME 診断スクリプト
- `infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml`: IME 診断 Ansible タスク
