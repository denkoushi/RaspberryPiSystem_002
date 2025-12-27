---
title: デプロイ トラブルシューティング
tags: [デプロイ, トラブルシューティング, Ansible, RaspberryPi]
audience: [運用者, 開発者]
last-verified: 2025-12-27（試行錯誤の詳細記録追加）
related: [deployment.md, ansible-ssh-architecture.md, ../knowledge-base/infrastructure.md]
category: guides
update-frequency: high
---

# デプロイ トラブルシューティング

本ドキュメントは、デプロイが失敗した/止まった際に**最短で原因へ到達する**ための手順です。  
標準手順は [deployment.md](./deployment.md) を参照してください。

## まず最初に見るもの（ログの入口）

- **precheck（事前確認）**: `logs/ansible-precheck-YYYYMMDD-HHMMSS.json`  
  - `scripts/update-all-clients.sh` で実行した場合に生成されます（`--skip-checks`を除く）
  - `network_mode` / Pi5疎通 / ansible ping / メモリ / Pi3サービス停止 の結果がまとまっています
- **updateログ**: `logs/ansible-update-YYYYMMDD-HHMMSS.log`
- **updateサマリー**: `logs/ansible-update-YYYYMMDD-HHMMSS.summary.json`
- **healthログ**: `logs/ansible-health-YYYYMMDD-HHMMSS.log`
- **healthサマリー**: `logs/ansible-health-YYYYMMDD-HHMMSS.summary.json`
- **履歴（NDJSON）**: `logs/ansible-history.jsonl`（直近の成功/失敗のタイムライン）

## 症状別：よくある原因と対処

### 1) Pi4/Pi3 が `UNREACHABLE`（ansible ping 失敗）

**典型ログ**:
- `UNREACHABLE!` が `ansible ping` や `ansible-playbook` の出力に含まれる

**最重要チェック**:
- `network_mode` が環境に合っていない/デプロイ中に戻っている（Git更新で `local` に戻る）

**対処**:
- [deployment.md の network_mode 手順](./deployment.md#ネットワーク環境の確認デプロイ前必須) を再実施
- **KB**: [KB-094](../knowledge-base/infrastructure.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)

---

### 2) Pi3 デプロイが異常に遅い/ハングする（10-15分以上）

**典型ログ**:
- `git reset --hard` / `git clean` / `npm/pnpm` 等が長時間
- 途中でSSHがタイムアウトしがち

**原因（多い順）**:
- Pi3のメモリ不足（signage-liteが自動再起動してメモリを食う）
- Pi3のリポジトリが大きく遅れている（コミット差が多い）

**対処**:
- デプロイ前に Pi3 の `signage-lite`/timer を停止・無効化・**mask**（`mask --runtime`が重要）
- メモリ空きを確認（**available 120MB以上**）
- **KB**: [KB-089](../knowledge-base/infrastructure.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング), [KB-096](../knowledge-base/infrastructure.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約), [KB-097](../knowledge-base/infrastructure.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)

---

### 3) Pi3 へ SSH は ping が通るのに接続できない

**原因**:
- Pi3のメモリ逼迫/負荷で sshd が応答しない（signage-lite再起動ループ含む）

**対処**:
- 物理的再起動が必要になるケースがあります
- 再起動後、Pi3のサービス停止（KB-097手順）→デプロイを再実行
- **KB**: [KB-096](../knowledge-base/infrastructure.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約), [KB-097](../knowledge-base/infrastructure.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)

---

### 4) `Permission denied` / `unable to append to '.git/logs/...'`

**典型ログ**:
- `unable to append to '.git/logs/...': Permission denied`
- `Permission denied` で `git fetch` が失敗

**原因**:
- クライアント側の `/opt/RaspberryPiSystem_002` や `.git/` の所有者/権限が崩れている

**対処（まずはKBの標準プロセス）**:
- Pi4: **KB-095** の手順で `chown` と強制更新
- Pi3: `.git` の `chown` が必要になるケースあり（環境差分）

**KB**:
- [KB-095](../knowledge-base/infrastructure.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)

---

### 5) `the playbook: ... could not be found`（update-all-clients.sh）

**典型ログ**:
- `the playbook: infrastructure/ansible/playbooks/update-clients.yml could not be found`

**原因**:
- 実行ディレクトリとプレイブック/インベントリのパスの不一致

**対処**:
- `scripts/update-all-clients.sh` のリモート実行時は、Pi5側で `cd /opt/RaspberryPiSystem_002/infrastructure/ansible` した後に **相対パス**（`inventory.yml`, `playbooks/update-clients.yml`）を使う必要があります  
  - 既に修正済みのはずですが、再発した場合は差分を確認してください

---

### 6) `JSONDecodeError`（update-all-clients.sh のサマリー生成）

**典型ログ**:
- Pythonが `ansible-update-*.summary.json` を読む際に `JSONDecodeError`

**原因**:
- `set -euo pipefail` 下での `grep | ... || echo` 等により、サマリーが壊れる（改行混入など）

**対処**:
- `scripts/update-all-clients.sh` の `generate_summary()` が改行を除去し、`|| true` で安全に動く必要があります
  - 既に修正済みのはずですが、再発した場合は差分を確認してください

---

### 7) ansible pingがタイムアウトするが、直接SSHは成功

**典型ログ**:
- `ansible all -i inventory.yml -m ping` がタイムアウト（120秒）
- 直接 `ssh user@host` は成功
- 直接IP指定でansible pingも成功: `ansible all -i '100.105.224.86,' -u signageras3 -m ping` → SUCCESS

**原因**:
- `inventory.yml`の`ansible_ssh_common_args`に`-o RequestTTY=force`が設定されている
- `RequestTTY=force`はAnsibleのsftpファイル転送と干渉する
- Ansibleは`transport = smart`を使用し、sftpを優先するため、この問題が表面化する
- sftpサブシステムはTTYを期待しないため、RequestTTY=forceが競合し、ハングする

**調査手順（デバッグモードでの検証）**:
1. 直接IP指定でansible ping → 成功（inventory.ymlを使わない）
2. inventory.yml経由でansible ping → タイムアウト
3. `ansible_ssh_common_args`をオーバーライドして`RequestTTY=force`を削除 → 成功
4. 根本原因として`RequestTTY=force`を特定

**対処**:
- `inventory.yml`から`RequestTTY=force`を削除（`StrictHostKeyChecking=no`のみ残す）
- sudoのTTY要件は`/etc/sudoers`の`Defaults !requiretty`で解決すべき（SSHオプションではなく）
- **KB**: [KB-098](../knowledge-base/infrastructure.md#kb-098-ansible_ssh_common_argsのrequestttyforceによるansible-pingタイムアウト)

**修正後のinventory.yml**:
```yaml
      vars:
        # StrictHostKeyCheckingを無効化（ホストキー確認プロンプトを回避）
        # 注意: RequestTTY=forceはAnsibleのsftpファイル転送と干渉するため削除（KB-098参照）
        ansible_ssh_common_args: '-o StrictHostKeyChecking=no'
```

---

### 8) Pi3のメモリ不足でデプロイが失敗する

**典型ログ**:
- `Pi3の空きメモリが不足しています（available=97MB < 120MB）`
- サービス停止を実行してもメモリが解放されない

**原因**:
- Pi3のメモリ逼迫状態が続いている
- サービス停止だけではメモリが完全に解放されない
- sshdを含む全プロセスがメモリを消費している

**対処**:
1. **Pi3を再起動**（メモリを完全にリセット）
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo reboot'"
   sleep 60  # 再起動完了まで待機
   ```
2. **再起動後、サービス停止**（KB-097手順）
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop signage-lite.service signage-lite-update.timer status-agent.timer && sudo systemctl disable signage-lite.service signage-lite-update.timer status-agent.timer && sudo systemctl mask --runtime signage-lite.service'"
   ```
3. **メモリ確認**（120MB以上を確認）
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'free -m | awk \"NR==2 {print \\\$7}\"'"
   ```
4. **デプロイ実行**

**学んだこと**:
- サービス停止だけでは不十分な場合がある
- 再起動によりメモリが完全にリセットされ、sshdを含む全プロセスがクリーンな状態になる
- 再起動は「対処療法」ではなく、標準的な復旧手順（[KB-096](../knowledge-base/infrastructure.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）

**KB**: [KB-096](../knowledge-base/infrastructure.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約), [KB-097](../knowledge-base/infrastructure.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)

---

### 9) Pi5のGit状態問題でデプロイが失敗する

**典型ログ**:
- `error: Your local changes to the following files would be overwritten by checkout: infrastructure/ansible/inventory.yml`
- `git checkout`が失敗

**原因**:
- Pi5の`inventory.yml`にローカル変更がある（手動で修正した場合など）
- Ansibleが`git reset --hard`を実行しようとして、ローカル変更と競合する

**対処**:
```bash
# Pi5に接続
ssh denkon5sd02@100.106.158.2

# ローカル変更をstash
cd /opt/RaspberryPiSystem_002
git stash

# ブランチを更新
git checkout feature/gmail-attachment-integration
git reset --hard origin/feature/gmail-attachment-integration

# デプロイを再実行
```

**学んだこと**:
- Pi5のリポジトリにローカル変更がある場合、デプロイ前に`git stash`または`git reset --hard`を実行する必要がある
- `inventory.yml`などの設定ファイルは、Ansibleで管理するか、変更後にコミットする必要がある

---

### 10) デプロイが「中断された」ように見えるが、実際は成功している

**典型ログ**:
- Cursor側で「Command was aborted by the user」と表示
- デプロイログが途中で止まっているように見える

**原因**:
- Cursor側のSSH接続がタイムアウトまたはユーザー操作で中断された
- しかし、Pi5上のAnsibleプロセスは継続実行されている

**確認方法**:
```bash
# Pi5上のAnsibleプロセスを確認
ssh denkon5sd02@100.106.158.2 "ps aux | grep ansible | grep -v grep"

# Pi3のGit状態を確認（デプロイが完了しているか）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'cd /opt/RaspberryPiSystem_002 && git log --oneline -1'"

# Pi3のサービス状態を確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"
```

**学んだこと**:
- Mac側のSSH接続が切れても、Pi5上のAnsibleプロセスは継続実行される（`nohup`相当）
- デプロイの成功/失敗は、Pi5上のAnsibleプロセスの終了コードで判断する
- Pi3のGit状態とサービス状態を確認することで、デプロイの成功/失敗を判断できる

---

## それでも解決しない場合（調査の進め方）

1. `logs/ansible-precheck-*.json` の `checks[]` で **最初にfail/warnになった項目**を特定
2. `logs/ansible-update-*.log` の `PLAY RECAP` を確認し、`failed/unreachable` の対象を特定
3. 対象KBを参照し、再発防止策（設定/運用）まで反映する

