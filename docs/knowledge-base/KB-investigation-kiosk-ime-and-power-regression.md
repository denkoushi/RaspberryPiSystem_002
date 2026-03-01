# KB調査: キオスク備考欄の日本語入力モード切替・電源ボタンの同時不具合

**作成日**: 2026-02-28  
**更新**: 2026-03-01（電源機能SOLIDリファクタ完了・電源操作遅延の原因特定を追記）  
**状態**: ✅ 電源ボタン修正完了（clientKey対応）→ 電源機能SOLIDリファクタ完了（ClientKeyResolverモジュール化）、IMEは Chromium 135+ リグレッション対策を適用  
**関連**: [frontend.md#KB-276](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善), [ansible-deployment.md#KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題), [ansible-deployment.md#KB-285](./infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる), [power-function-solid-refactor-execplan.md](../plans/power-function-solid-refactor-execplan.md)

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

## 電源機能SOLIDリファクタ（2026-03-01）

clientKey 解決の責務分離と複数キオスク対応の恒久化を実施。

- **ClientKeyResolver モジュール**: `apps/web/src/lib/client-key/` に types, config, sources, resolver, power-validator を新設
- **resolveClientKeyForPower**: 電源操作専用の解決ロジック。未解決時は実行せずアラート表示
- **KioskHeader**: `resolveClientKeyForPower(clientKey)` を使用し、`postKioskPower` に明示的な clientKey を渡す
- **電源操作遅延**: 実機検証で約20秒（poweroff）/約85秒（reboot）の遅延を確認。多段構成（API→dispatcher→Ansible→SSH）に起因。KB-285 に記録。連打防止画面の追加を Next Steps として検討

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

## Firefox 移行後の電源・連打防止オーバーレイ不具合（2026-03-01）

**事象**（raspi4-robodrill01 を Firefox に切り替え後）:
- 生産スケジュール・日本語入力: ✅ 正常動作
- 電源操作（再起動/シャットダウン）: ❌ 機能しない
- 連打防止オーバーレイ: ❌ 切り替わらない

### 根本原因（2026-03-01 特定済み）

**API コンテナの `power-actions` バインドマウントが「削除済み inode」を参照している。**

| 項目 | 内容 |
|------|------|
| **症状** | `POST /kiosk/power` が 500 を返す。エラー: `ENOENT: no such file or directory, open '.../power-actions/xxx.json'` |
| **根拠** | コンテナ内 `cat /proc/self/mountinfo \| grep power-actions` で `.../power-actions//deleted` を確認。`//deleted` はバインドマウント先のディレクトリが削除・再作成されたことを示す。 |
| **メカニズム** | Ansible の `file` タスクで `power-actions` が削除・再作成された（または過去のデプロイで再作成された）際、既に起動していた API コンテナは古い inode への参照を保持。ホストの新ディレクトリとは別の「削除済み」ディレクトリを見ており、書き込み・読み取りができない。 |
| **補足** | Firefox 固有ではない。`--limit` で Pi4 のみデプロイした場合、Pi5 の API は再起動されず、古いマウントのまま残る。 |

**即時対処**（Pi5 で実行）:
```bash
cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api
```

**検証結果（2026-03-01）**: 上記実施後、raspi4-robodrill01 の電源操作が正常に機能することを実機確認。

**恒久対策案**:
- server ロールで `power-actions` 作成/更新後に API コンテナ再起動を保証する（handler またはタスク順序の見直し）
- または Runbook に「Pi5 のみデプロイしていない場合、電源不具合時は API 再起動を実施」を追記

**診断手順**（原因特定前の確認用）:
1. **ブラウザ DevTools**（F12）で Console タブを開き、電源ボタン押下時のエラーを確認
2. **Network タブ**で `POST /kiosk/power` のステータスコード・レスポンスを確認
3. **Pi5 ログ**: `journalctl -u pi5-power-dispatcher.service -n 30`、`ls -la /opt/RaspberryPiSystem_002/power-actions/`
4. **マウント確認**: `docker compose exec api cat /proc/self/mountinfo | grep power-actions` で `//deleted` の有無を確認
5. **clientKey 確認**: 画面上部の「APIキー」表示が `client-key-raspi4-robodrill01-kiosk1` であることを確認

**ロールバック**（電源を優先する場合）: inventory で `kiosk_browser_engine: chromium` に戻す。

---

## 参照 KB

- [KB-244](./frontend.md#kb-244-pi4キオスクの備考欄に日本語入力状態インジケーターを追加): 備考欄の日本語入力、IBus 設定永続化
- [KB-276](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善): IBus 二重起動防止、リトライ、全角/半角キー追加
- [KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題): 電源操作の Jinja2/systemd/所有権問題
- [KB-225](./kiosk-input-protection-investigation.md): キオスク入力フィールド保護、clientKey の扱い
