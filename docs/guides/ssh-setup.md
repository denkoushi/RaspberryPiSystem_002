# SSH鍵ベース運用ガイド（サーバー -> Raspberry Pi クライアント）

現場に設置した複数台のRaspberry Piクライアントへ、サーバー（Raspberry Pi 5）から安全に一括接続するための標準手順です。Phase 1.1の成果物として、以下を完了させます。

- サーバー側で専用のSSH鍵を生成し、適切なパーミッションを設定する
- 各クライアントに公開鍵を配布してパスワードレス接続を実現する
- 必要に応じてパスワード認証を無効化する
- 接続テストと記録を残す

## ⚠️ 重要な前提知識

**MacからRaspberry Pi 3/4への直接SSH接続は不要です**。

- Macからは**Raspberry Pi 5にのみSSH接続**します
- Raspberry Pi 5上でAnsibleが実行され、Pi5からPi3/4にSSH接続して更新を実行します
- このドキュメントは、**Pi5からPi3/4へのSSH接続**を設定する手順です

詳細は [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) を参照してください。

## 前提条件

- サーバー（Raspberry Pi 5）から各クライアントへパスワードでSSH接続できる状態
- サーバー上で `pi` もしくは管理者ユーザーとして作業可能
- `ssh-copy-id` が利用できない環境の場合は、公開鍵を手動で転送できる手段（scp、VNC等）を準備

## 1. 鍵ペアの生成

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/raspi-clients -C "batch-update" -N ""
chmod 600 ~/.ssh/raspi-clients
```

- 生成されたファイル
  - `~/.ssh/raspi-clients` : 秘密鍵（共有禁止）
  - `~/.ssh/raspi-clients.pub` : 公開鍵（各クライアントへ配布）
- バックアップは暗号化されたメディアで管理し、Gitには絶対に含めない

## 2. 公開鍵の配布

### 2.1 ssh-copy-id を用いる場合（推奨）

```bash
for host in pi-kiosk-01 pi-kiosk-02; do
  ssh-copy-id -i ~/.ssh/raspi-clients.pub pi@$host
done
```

- 初回のみ各ホストのパスワード入力が必要
- 共有ネットワーク上で `pi-kiosk-01` 等のmDNSが解決できない場合はIPアドレスを指定

### 2.2 手動で配置する場合

```bash
scp ~/.ssh/raspi-clients.pub pi@pi-kiosk-01:/tmp/raspi-clients.pub
ssh pi@pi-kiosk-01 "mkdir -p ~/.ssh && cat /tmp/raspi-clients.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

- `authorized_keys` に追記した後は、一時ファイルを削除しておく

## 3. 設定確認

1. サーバーから接続テスト
   ```bash
   ssh -i ~/.ssh/raspi-clients pi@pi-kiosk-01 hostname
   ```
2. パスワードを要求されずに `hostname` が返れば成功
3. 必要に応じて `/etc/ssh/sshd_config` の `PasswordAuthentication no` を設定し、`sudo systemctl restart ssh` で反映

## 4. 実施記録テンプレート

`docs/logs/ssh-key-rollout.md`（任意の記録ファイル）へ、以下の形式で追記してください。

```
## 2025-12-02
- 実施者: 山田
- 秘密鍵の保存先: /root/.ssh/raspi-clients
- 対象ホスト:
  - pi-kiosk-01 (192.168.0.30)
  - pi-kiosk-02 (192.168.0.31)
- 確認結果: ansible ping success
```

## 5. トラブルシュート

| 症状 | 原因候補 | 対処 |
|------|----------|------|
| `Permission denied (publickey)` | 公開鍵が登録されていない / 権限が厳しすぎる | クライアント側 `~/.ssh` を 700, `authorized_keys` を 600 に設定 |
| `ssh: Could not resolve hostname` | ホスト名が解決できない | `/etc/hosts` へ追記、またはIPアドレスを使用 |
| 接続はできるがAnsibleで失敗 | `sudo` 権限不足 | `pi` ユーザーを `sudo` グループに所属させる、`ansible.cfg` の `become` 設定を確認 |

## 6. 次のステップ

- すべてのクライアントへの鍵配布が完了したら、`infrastructure/ansible/inventory.yml` にホストを登録
- `ansible all -m ping` を実行し、結果ログを `docs/logs/` に保存
- これが完了すると Phase 1.2（Ansible導入）の準備が整います
