# KB-367: Zero 2 W 棚番エッジ — Tailscale・Ansible・status-agent（TLS・git）実地トラブルシュート

**記録日**: 2026-05-04  
**Status**: 記録済み・自宅検証端末で復旧・運用手順は Runbook へ集約

## Context

- Raspberry Pi **Zero 2 W**（例: ホスト名 `zero2w-tanaban01`）を **Raspberry Pi OS Lite（64-bit）** で構築し、工場の **Pi 5**（HTTPS API・自己署名 TLS）へ **status-agent** で接続する初期導入を行った。
- 標準の「Pi 5 からクライアントへ Ansible」は [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md) のとおり **`playbooks/zero2w-edge-setup.yml` + インベントリ断片**で行う。
- 運用方針: 自宅検証機など **本番 `inventory.yml` に載せたくない端末**は **`inventory-zero2w-edge-fragment.yml`（ローカル・`.gitignore`）** で IP と変数のみ差し込む。

## Symptoms

1. **Mac（`tag:admin`）から Zero 2 W（`tag:signage`）へ Tailscale IP で SSH**すると、認証プロンプト前に **接続が hang** したように見える。
2. **`zero2w-edge-setup.yml` 初回実行**で **`git: command not found`**（common ロールのリポジトリ同期が失敗）。
3. **`status-agent.service`** が **`[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate`** で失敗（Pi 5 API が自己署名のため）。
4. Pi 5 上で **`curl` + JSON で `POST /api/clients`** を多段シェルから実行した際、**クォートの多段エスケープ**で JSON が壊れた。
5. **`zero2w-edge-setup.yml`**（または Mac から Zero 直）で Ansible 実行時に **`Missing sudo password`**（become 失敗）。
6. Zero の **`git checkout` / `git reset`** が **`Permission denied`**（`/opt` 下のリポジトリが **root 所有**のまま、通常ユーザーが `git` で書けない）。
7. **`haizen-agent.service`** が **`status=200/CHDIR`** で落ちる（**`WorkingDirectory=/opt/.../clients/haizen-agent` が存在しない**。ブランチが古い等）。
8. **`haizen-agent`** が **`PermissionError: ... '/etc/raspi-haizen-agent.conf'`**（設定を **`root:root` + `600`** のまま **非 root ユーザー**で動かしている）。
9. `haizen_agent_hid_device` 未設定時、`haizen-agent` が **`hid=stdin`** で起動して直後に終了し、Ansible の再起動検証で **`inactive`** 扱いになる。

## Investigation

- **CONFIRMED（SSH）**: [tailscale-policy.md](../security/tailscale-policy.md) では **admin → server の SSH のみ**を原則とし、**server → signage の SSH**が更新経路。**admin → signage 直 SSH は Allowlist 外**になりやすく、動かない・不安定な挙動になり得る。
- **CONFIRMED（git）**: **OS Lite** 最小構成では **`git` が未インストール**のことがあり、**`common` の `git` 同期タスク**が最初に落ちる。
- **CONFIRMED（TLS）**: `status-agent` の **`TLS_SKIP_VERIFY`**（Ansible: `status_agent_tls_skip_verify`）が **`0`** のままだと、Pi 5 の **自己署名証明書を検証できず** HTTPS 送出が失敗する。
- **CONFIRMED（curl）**: シェル内の `"` / `'` の **ネストが深い**と JSON が壊れる。**here-doc** や Pi 5 上で **一時ファイルに JSON を書いてから `curl -d @file`** が安全。
- **CONFIRMED（sudo）**: Ansible の become が **対話パスワード**を要求する Zero では、**`ansible_become_password` を渡す**か Zero 上で **NOPASSWD（一時）** を入れないと playbook が最初の root タスクで止まる。
- **CONFIRMED（git 権限）**: **common ロール**は root でリポジトリを同期するが、作業ディレクトリの **所有者が期待とずれる**と、後続の **手動 `git`** が `Permission denied` になる。
- **CONFIRMED（haizen-agent CHDIR）**: **`zero2w-edge-setup.yml` の既定 `repo_version` は `main`**。**haizen-agent は feature ブランチ導入後に `clients/haizen-agent` が追加**されるため、`main` のみのクローンでは **ディレクトリ不在**。
- **CONFIRMED（haizen-agent conf）**: **`install -m 600`** 等で **`/etc/raspi-haizen-agent.conf` が root のみ読取**のままだと、**User= 通常ユーザー**の systemd ユニットが **開けない**。
- **CONFIRMED（haizen-agent stdin fallback）**: HID デバイス未指定だと service 起動ログに `hid=stdin` が出て常駐せず終了する。`haizen_agent_hid_device` に `/dev/input/by-id/*-event-kbd` を指定すると `active` を維持できる。

## Root cause

- **SSH**: 役割分離された ACL 下では **Pi 5 を踏み台（`tag:server` 経由）**するのが設計と一致する。**Mac 直は期待しない**。
- **git**: イメージの最小セットに **git が含まれない**。
- **TLS**: 本番 Pi 5 の **TLS 運用（自己署名）** とクライアントの **既定（検証 ON）** の不一致。
- **curl**: **シェルクォート**の人為ミス。
- **sudo/become**: **パスワード付き sudo** と Ansible の非対話実行の不一致。
- **git 権限**: **`/opt` リポジトリの uid/gid** と操作ユーザーの不一致。
- **haizen-agent**: **ブランチ／リポジトリ状態**と **設定ファイル ACL**。

## Fix（最小変更・実施済みパターン）

- **SSH**: 作業は **`ssh <pi5-user>@<pi5-tailscale-ip>`** 後に **`ssh <zero-user>@<zero-tailscale-ip>`**。初回のみ **`.local` + パスワード**で Zero に入り、**Pi 5 の公開鍵を `authorized_keys` に追加**。
- **git**（Zero 上）: `sudo apt-get update && sudo apt-get install -y git` の後、**playbook を再走**。
- **TLS**:
  - インベントリ断片に **`status_agent_tls_skip_verify: "1"`** を入れ、**playbook で `/etc/raspi-status-agent.conf` を再生成**するか、
  - 緊急時は Zero 上で **`TLS_SKIP_VERIFY="1"`** にし **`systemctl restart status-agent.timer` / `status-agent.service`**。
  - 中長期: **社内 CA /  Let's Encrypt 等で検証可能なチェーン**へ寄せたうえで **`0` に戻す**。
- **ClientDevice**: `inventory` の **`status_agent_client_key`** と **DB の `apiKey` を一致**させる。`curl` は **引用の単層化**（Pi 5 で heredoc）を推奨。
- **Ansible become**: Pi5 から実行する際 **`ansible-playbook ... -e ansible_become_password='…'`**（平文ログに残り得るため **運用上は NOPASSWD 一時ルール**も可）または Zero で **`/etc/sudoers.d/…`** に **限定 NOPASSWD**。
- **`clients/haizen-agent` を含むブランチへ同期**: Pi5 の `infrastructure/ansible` で  
  `ANSIBLE_REPO_VERSION='<対象ブランチ>' ansible-playbook playbooks/zero2w-edge-setup.yml …`  
  （**マージ後は `main`**）。Mac から Zero へ **Ansible を直接当てない**（ACL・経路は [tailscale-policy.md](../security/tailscale-policy.md)）。
- **`haizen-agent` 設定ファイル**: **`chown root:<実行ユーザー>`**、`chmod 640`（実行ユーザーが **グループ読取**で開ける）。
- **`haizen-agent` HID**: 断片インベントリへ **`haizen_agent_hid_device`** を設定（例: `"/dev/input/by-id/usb-TMC_HIDKeyBoard_1234567890abcd-event-kbd"`）。`ls /dev/input/by-id/*-event-kbd` で実機パスを確認してから再適用。

## Prevention

- Runbook [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md) に **手順・トラブルシュート**を集約。**サンプル断片** `inventory-zero2w-edge-fragment.sample.yml` には **`status_agent_tls_skip_verify: "1"`** を初期値として記載。
- **`inventory-zero2w-edge-fragment.yml`**（実 IP を含む）を **`.gitignore`** でコミットから除外。
- Tailscale の **端末タグ**は ACL と整合させる（検証端末は **`tag:signage`** で Pi 5 から SSH 可能な経路に載せた例あり。**`tag:kiosk` 前提の手順とは別**であることに注意）。
- **`haizen-agent`**: [KB-368](./KB-368-zero2w-haizen-placement-tracking.md) の **実機検証**と **systemd / 権限**を参照。将来は **Ansible でユニットと conf を配布**できると手戻りが減る。

## References

- [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)
- [KB-368: Zero2W 配膳追跡](./KB-368-zero2w-haizen-placement-tracking.md)
- [tailscale-policy.md](../security/tailscale-policy.md)
- [client-initial-setup.md](../guides/client-initial-setup.md)
- `infrastructure/ansible/playbooks/zero2w-edge-setup.yml`
- `infrastructure/ansible/inventory-zero2w-edge-fragment.sample.yml`
