# Zero 2 W（棚番エッジ）セットアップ Runbook

最終更新: 2026-05-06（**断片 `sudo_nopasswd_commands`（Pi4 準拠の限定 NOPASSWD）**・[KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)）

## 目的

Raspberry Pi **Zero 2 W**（例: ホスト名 `zero2w-tanaban01`）を、**キオスク UI なし**のエッジ端末として本システムに繋ぐ。**status-agent**（管理画面での死活・メトリクス）と **Tailscale** までを標準とする。**配膳（棚番）スキャン送信**はリポジトリの **`clients/haizen-agent/`**（HID → `POST /api/mobile-placement/haizen-scans`）を参照。運用・API 契約は [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)・[mobile-placement.md](../api/mobile-placement.md)。

### 中長期の配膳（棚番）連携イメージ（仕様メモ）

- **現場操作は最小**: 棚番は端末に **事前プリセット**（本 Runbook 後の別実装で、管理 Web やモバイルから設定する想定）。現場では **移動票のバーコード 1 スキャン**、または **分配 QR + 移動票** の 2 スキャンのみ、などに寄せる。
- **アーキテクチャ**: USB バーコードリーダー（HID）→ **Zero 2 W** → Wi-Fi / Tailscale → **Pi 5**（PostgreSQL・API・Web）→ 必要なら **Android タブレット**は結果表示用ブラウザのみ（Zero に USB で直繋ぎ必須ではない）。

## 前提

- Raspberry Pi OS **Lite（64-bit）**・SSH でログインできること（例: `ssh zero2w-tanaban01@zero2w-tanaban01.local`）。
- 工場の **Pi 5** が Tailscale 上で API（HTTPS 443）を提供していること。
- 本番デプロイ（`update-all-clients.sh`）は **Pi 5 上で Ansible を実行**する。自宅端末へは **Pi 5 から Tailscale で SSH できる**必要がある（`.local` は Pi 5 からは解決されないことが多い）。

### Tailscale とタグ

- Zero は **Tailscale 参加**が推奨（重さは **ユーザ空間デーモン + 暗号化トンネル**程度で、**バーコード程度のペイロード送信用途ではボトルネックになりにくい**）。工場 ACL は [tailscale-policy.md](../security/tailscale-policy.md) を正とする。
- **ヘッドレス棚番エッジ**の検証では **`tag:signage`**（Pi3/サイネージ系と同系統のクライアント）を割り当て、**`tag:server`（Pi 5）からの SSH**で Ansible を流すパターンが実績あり。**`tag:kiosk` と同一視しなくてよい**（キオスク用 ACL・UI 前提が異なる）。

### Tailscale SSH と OpenSSH

- Pi 4 増設時と同様、**標準 OpenSSH（ホスト鍵・`authorized_keys`）** を使う場合は Zero 上で次を実施する。
  ```bash
  sudo tailscale set --ssh=false
  ```
- **Tailscale SSH**（有料プラン機能）のみに依存しない運用を推奨する場合も、上記は **[client-initial-setup.md](../guides/client-initial-setup.md)** の流れと揃える。

## ネットワーク・SSH の実務（重要）

### Mac から Zero へ直接 SSH しない（設計に合わせる）

- 運用方針では **SSH 入口は admin（Mac）→ server（Pi 5）** とし、**Pi 5 → clients** が更新経路である（[tailscale-policy.md](../security/tailscale-policy.md)）。
- そのため **Mac から Zero の Tailscale IP へ直行 SSH**すると、ACL により **タイムアウト／hang** になり得る。**トラブルではなく経路選択のミスマッチ**の可能性がある。
- **推奨**: `ssh pi5-user@<Pi5-Tailscale-IP>` 後に `ssh zero2w-user@<Zero-Tailscale-IP>`。または Pi 5 に **`ssh-copy-id`** 済みの鍵で Zero へログインできる状態を作る（Runbook 手順 4）。

### 到達確認の順序

1. Zero 上で `tailscale ip -4` → **100.x の IPv4** を控える。
2. Pi 5 から `ssh -o BatchMode=yes zero2w-user@100.x.x.x 'echo OK'`（鍵認証の確認）。
3. 管理 API でクライアントが見えるか、`status-agent.timer` が active かを見る。

## 手順概要

| 順 | 場所 | 内容 |
|----|------|------|
| 1 | Zero 2 W | Tailscale インストール・`tailscale up`・管理画面でタグ（ACL に合わせる。例: `tag:signage`） |
| 2 | Zero 2 W | `sudo tailscale set --ssh=false`（**標準 SSH（鍵）を使う**ため） |
| 3 | Zero 2 W | `tailscale ip -4` で **100.x の IPv4** を控える |
| 4 | Pi 5 | `ssh-copy-id` 等で **Pi 5 の鍵**を Zero 2 W の `authorized_keys` に載せる（[client-initial-setup.md](../guides/client-initial-setup.md) Step 2 相当） |
| 5 | Mac / Pi 5 | `infrastructure/ansible/inventory-zero2w-edge-fragment.sample.yml` を **`inventory-zero2w-edge-fragment.yml` にコピー**し、**`ansible_host` を上記 100.x に置換**する（ローカル用ファイルはリポジトリの `.gitignore` に含める） |
| 6 | Pi 5 | `ClientDevice` 登録: 断片の `status_agent_client_key` と一致させる。`inventory.yml` にホストを**マージしていない**場合は `POST /api/clients` か、一時的に `inventory.yml` に同キーを書いて `./scripts/register-clients.sh` |
| 7 | Pi 5 | **OS Lite: `git` 未導入なら** Zero 上で `sudo apt-get update && sudo apt-get install -y git`（下記「トラブルシュート」参照） |
| 8 | Pi 5 | 専用 playbook で **common + client** のみ適用（下記コマンド） |

## Pi 5 での Ansible（推奨）

リポジトリ直下（Pi 5 の `/opt/RaspberryPiSystem_002` を想定）:

```bash
cd infrastructure/ansible
# 断片を編集済みであること（ansible_host = Zero の Tailscale IPv4）
# haizen-agent 等を含むブランチへ追従させるときは ANSIBLE_REPO_VERSION を明示（既定は main）
ANSIBLE_REPO_VERSION=main ansible-playbook playbooks/zero2w-edge-setup.yml \
  -i inventory.yml \
  -i inventory-zero2w-edge-fragment.yml \
  --limit zero2w-tanaban01
```

- 第 1 インベントリで `group_vars/all.yml`（`api_base_url` 等）を読み込む。
- 第 2 インベントリで **Zero 2 W のホスト変数と到達先 IP** を足すだけなので、**工場用 `inventory.yml` に自宅端末を恒久追加しない**運用ができる。
- **リポジトリ追従ブランチ**: playbook は環境変数 **`ANSIBLE_REPO_VERSION`**（未設定時は **`main`**）で `git checkout` / `reset` する。`clients/haizen-agent/` を含む変更を Zero に載せるまで **`feat/...`** 等を明示し、**`main` にマージ済みなら `main` のみ**でよい。
- **sudo パスワード / 限定 NOPASSWD**: Zero の sudo が **対話パスワード必須**のとき、Pi5 からは **`ansible-playbook ... -e ansible_become_password='…'`** で通す（**平文が履歴に残り得る**）。**推奨（2026-05-06）**: 断片に **`sudo_nopasswd_commands`** を追加し、**工場 Pi4 と同趣旨**に **`client` ロール**が **`/etc/sudoers.d/…`** を配布する（**status-agent / haizen-agent の `systemctl`**・**reboot/poweroff**。キオスク browser 無しのため **kiosk-browser 行は不要**）。**例は** `inventory-zero2w-edge-fragment.sample.yml`。**検証**: Zero 上で **`sudo -n true`**、Pi5 から **`ansible … -m ping -b`**。詳細は [KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)。

## 登録用 API キー（例）

断片例および本 Runbook では次を例とする（運用で変える場合は DB・断片を同時に合わせる）。

- **apiKey / x-client-key**: `client-key-zero2w-tanaban01-edge1`
- **status_agent_client_id**: `zero2w-tanaban01-edge1`

`register-clients.sh` のキー検証を通すため、**8 文字以上・テンプレ文字列でない**こと。

### ClientDevice 登録時の注意（curl）

- **Pi 5 上で** JSON を **`/tmp/body.json` に保存してから** `curl -d @/tmp/body.json` するなど、**シェル一段で多重量子化**しない（クォート破壊で 400 になり得る）。
- 登録後、管理画面のクライアント一覧に **`clientId` / `apiKey` 相当**が表示されることを確認。

## TLS 注意

- 既存 Pi5 は自己署名証明書運用のため、初期導入の `status-agent` は **`status_agent_tls_skip_verify: "1"`** を前提とする（断片サンプルに含める）。
- 設定ファイルでは **`/etc/raspi-status-agent.conf`** の **`TLS_SKIP_VERIFY="1"`**。
- 社内 CA を整備して Zero 2 W 側に信頼チェーンを入れたあとで、必要なら `0` に戻す。

## 動作確認

- 管理 UI のクライアント一覧に当該端末が現れ、メトリクスが更新されること。
- Zero 2 W 上: `systemctl status status-agent.timer --no-pager`

API の疎通（配膳など）:

```bash
curl -sk "https://<Pi5-Tailscale-IP>/api/mobile-placement/registered-shelves" \
  -H "x-client-key: client-key-zero2w-tanaban01-edge1"
```

（200 想定。401 なら `ClientDevice` 未登録またはキー不一致）

### 配膳 API（haizen）E2E（Pi5 で実行推奨）

[KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) の **「実機検証」** 節に **`PATCH haizen-preset-shelf`** → **`POST haizen-scans`** → **`GET haizen-current`** の順を記載。日程 CSV と一致しない製造 order でも **`UNRESOLVED` で 200** になり得る（契約どおり）。

## haizen-agent（HID → Pi5 API）

リポジトリの **`clients/haizen-agent/`** を参照。**標準配備**: **`client` ロール**の `haizen-agent.yml`（`haizen_agent_enabled: true` のホスト）で **`/etc/raspi-haizen-agent.conf`** と **`haizen-agent.service`** を配布。**Zero 上**では `python3-evdev`（HID 利用時・Ansible が `haizen_agent_install_evdev` 既定で導入）と、設定 **`API_BASE_URL`（Pi5 の HTTPS オリジン・`/api` なし）**・**`X_CLIENT_KEY`**・**`HAIZEN_TLS_VERIFY_MODE`**（`insecure` = 自己署名許容 / `system` = OS 信頼ストアで検証）・任意 **`HAIZEN_HID_DEVICE`**。

- **デバイス**: `ls /dev/input/by-id/*-event-kbd` で **安定パス**を選ぶ。
- **systemd**: リポジトリ同梱の **`clients/haizen-agent/haizen-agent.service`**（`zero2w-edge-setup.yml` + 断片インベントリで有効化）。現行 unit は **root 実行**。**`/etc/raspi-haizen-agent.conf` は `root:root` + `chmod 640`** とし、**`x-client-key` を world-readable にしない**。**`WorkingDirectory`** は **`/opt/RaspberryPiSystem_002/clients/haizen-agent`**（上記 playbook で **haizen を含むブランチ**に追従したあとで有効）。
- **確認**: `systemctl is-active haizen-agent.service` と `journalctl -u haizen-agent.service` に起動ログ（**`tls_verify_mode=…`**）があること。

**補足（TLS 移行）**: 初期は **`HAIZEN_TLS_VERIFY_MODE=insecure`**（Ansible 既定 `haizen_agent_tls_verify_mode`）。Pi5 前段に **検証可能な証明書**を載せたらインベントリで **`haizen_agent_tls_verify_mode: "system"`** に変更し playbook を再適用（失敗時は **`insecure` に戻す**）。

**補足（旧手順）**: 過去版は **専用 systemd の Ansible タスク未同梱**のため手配置が実績とした。現在は **`roles/client/tasks/haizen-agent.yml`** が正本。

## トラブルシュート

### Ansible: `git: command not found`

- **原因**: Raspberry Pi OS **Lite** に **git が入っていない**。
- **対処**: Zero 上で  
  `sudo apt-get update && sudo apt-get install -y git`  
  のあと **playbook を再実行**。

### status-agent: `CERTIFICATE_VERIFY_FAILED` / self-signed certificate

- **原因**: Pi 5 API が **自己署名 TLS** なのに **`TLS_SKIP_VERIFY=0`**（既定相当）。
- **対処**:
  1. インベントリ断片に **`status_agent_tls_skip_verify: "1"`** を記載し playbook を再適用、または
  2. Zero 上の **`/etc/raspi-status-agent.conf`** を **`TLS_SKIP_VERIFY="1"`** にし、  
     `sudo systemctl restart status-agent.timer status-agent.service`。
- **記録**: [KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)

### Mac から Zero の Tailscale IP へ SSH できない / hang

- **原因**: [tailscale-policy.md](../security/tailscale-policy.md) の **admin → signage 直 SSH が許可されていない**構成が典型。
- **対処**: **Pi 5 経由**で Zero に入る。別途 ACL で admin→signage を開ける**設計判断が必要**（横移動面増）。

### `curl` / `POST /api/clients` で JSON エラー

- **原因**: ネストしたシェルでの **引用符エスケープミス**。
- **対処**: Pi 5 で **heredoc または `-d @file`** で JSON を渡す。

### Ansible: `Missing sudo password`

- **記録**: [KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)（**become**・**NOPASSWD**）。
- **運用メモ（2026-05-05）**: `zero2w-edge-setup.yml` は `become: true` のため、Zero が sudo パスワード必須設定なら  
  `ansible-playbook ... -e ansible_become_password='...'` を明示する（平文引数の扱いに注意）。
- **再発防止（2026-05-06）**: 断片へ **`sudo_nopasswd_commands`** を足し、**サンプル断片**どおり **`client` ロール経由で限定 sudoers を配布**する。適用後は **`ansible_become_password` なし**で playbook を再走できる。広域健全性は `./scripts/deploy/verify-phase12-real.sh` で **PASS 43 / WARN 0 / FAIL 0** を再確認済み（記録は [deployment.md](../guides/deployment.md)）。

### `haizen-agent` が `inactive` になる（ログに `hid=stdin`）

- **症状**: `haizen-agent.service` は `ExecStart` を実行して終了コード 0 だが、Ansible の「active 判定」で失敗する。ログに `haizen-agent start ... hid=stdin` が出る。
- **原因**: `haizen_agent_hid_device` 未設定で stdin フォールバックになり、systemd 常駐サービスとして維持されない。
- **対処**: 断片インベントリに `haizen_agent_hid_device` を設定する。例:  
  `haizen_agent_hid_device: "/dev/input/by-id/usb-TMC_HIDKeyBoard_1234567890abcd-event-kbd"`  
  （`ls /dev/input/by-id/*-event-kbd` で実機の安定パスを確認）。

### `haizen-agent`: `CHDIR`（WorkingDirectory が無い）

- **原因**: Zero の `/opt/RaspberryPiSystem_002` が **`clients/haizen-agent` を含まないブランチ**（例: 古い `main`）のまま。
- **対処**: Pi5 で **`ANSIBLE_REPO_VERSION` を haizen 取り込み済みブランチにして** `zero2w-edge-setup.yml` を再実行。

### `haizen-agent`: `Permission denied`（`/etc/raspi-haizen-agent.conf`）

- **原因**: 過去の手配置や独自 unit で **非 root 実行**しているのに、設定が **`root:root` + `mode 600`** のまま。
- **対処**: 現行標準は **Ansible 配備の root 実行 unit** に揃える。独自に `User=` を付ける場合のみ、当該ユーザー/グループで **読取可能な最小権限**へ調整する。 [KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)

### Ansible: Pi5 から Zero へ `ssh: connect to host … port 22: Connection timed out`

- **症状**: `zero2w-edge-setup.yml` の先頭で **`zero2w-tanaban01` が `UNREACHABLE`**。メッセージ例: **`Failed to connect to the host via ssh: … port 22: Connection timed out`**。
- **原因（典型）**: Zero が **オフ／未接続**、**Tailscale 未参加**、断片の **`ansible_host` が古い 100.x**（Zero で `tailscale ip -4` と突き合わせ）、**Pi5→client の ACL で 22/tcp が拒否**、現場 LAN 経路の問題。
- **対処**: 上記 **「到達確認の順序」**（Zero で 100.x 取得 → **Pi5 から** `ssh -o BatchMode=yes zero2w-user@100.x 'echo OK'`）を満たしてから playbook を再実行。**2026-05-05 実績**: `feat/zero2w-haizen-edge-hardening` 反映後の Pi5 本番は成功したが、当該 Zero は Pi5 から **未到達のまま playbook 未完**となった（詳細・Run ID は [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)）。
- **追記（2026-05-05）**: Zero 再起動後に Pi5→Zero SSH は復旧し、`ansible_become_password` + `haizen_agent_hid_device` 設定で playbook 完走（`failed=0`）を確認。

## 関連ドキュメント

- [新規クライアント端末の初期設定手順](../guides/client-initial-setup.md)
- [配膳スマホ Runbook](./mobile-placement-smartphone.md)（`x-client-key`・API 例）
- [アーキテクチャ概要](../architecture/overview.md)（専用エージェント + REST/WebSocket）
- [KB-367: 実地トラブルシュートまとめ](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)

## 注意

- **本番フルデプロイに自宅 Zero を載せない**: Pi 5 から到達不能なホストを `inventory.yml` の kiosk/signage に追加すると、デプロイが **UNREACHABLE** で止まり得る。自宅検証は **断片インベントリ + `--limit`** か専用 playbook のみ推奨。
- バーコード **HID** リーダー向け **`haizen-agent`** は、キオスク向け **USB シリアル barcode-agent**（`barcode_agent_enabled`）とは別実装。**仕様・契約**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)。
