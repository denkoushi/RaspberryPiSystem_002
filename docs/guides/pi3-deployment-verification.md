---
title: Pi3デプロイ検証手順
tags: [デプロイ, 検証, ラズパイ3]
audience: [運用者, 開発者]
last-verified: 2026-01-16
related: [deployment.md]
category: guides
update-frequency: medium
---

# Pi3デプロイ検証手順

## 目的

Pi3デプロイの成功率向上のため、改修後の動作を検証し、問題が発生した場合の原因特定を容易にする。

## 検証項目

### 1. systemdマスクの動作確認

**目的**: `systemctl mask --runtime`が正しく動作し、サービスファイルとの競合が発生しないことを確認

**手順**:
```bash
# Pi3にSSH接続
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86"

# デプロイ前のサービスファイル状態を確認
ls -la /etc/systemd/system/signage-lite.service

# デプロイ実行（Pi5から）
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3

# デプロイ中のサービスファイル状態を確認（別ターミナルから）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -la /etc/systemd/system/signage-lite.service'"
```

**期待結果**:
- デプロイ前: `/etc/systemd/system/signage-lite.service`は実ファイルとして存在
- デプロイ中（preflight後）: `/run/systemd/system/signage-lite.service`が`/dev/null`へのシンボリックリンクとして存在（ランタイムマスク）
- デプロイ後: `/etc/systemd/system/signage-lite.service`は実ファイルとして存在（ランタイムマスクは解除済み）

**確認ポイント**:
- `systemctl mask --runtime`の実行がエラーなく完了していること
- サービスファイルの競合エラーが発生していないこと
- デプロイログに「Failed to mask unit」エラーが含まれていないこと

### 2. メモリ使用状況の確認

**目的**: デプロイ前後でメモリが120MB以上確保されていることを確認

**手順**:
```bash
# Pi3にSSH接続
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86"

# デプロイ前のメモリ状態を確認
free -m

# デプロイ実行（Pi5から）
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3

# デプロイ中のメモリ状態を確認（別ターミナルから、30秒間隔で3回）
for i in {1..3}; do
  echo "=== Check $i ==="
  ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'free -m'"
  sleep 30
done
```

**期待結果**:
- デプロイ前: 利用可能メモリ >= 120MB
- デプロイ中: 利用可能メモリ >= 120MB（サービス停止により確保）
- デプロイ後: 利用可能メモリ >= 120MB（サービス再起動後も維持）

**確認ポイント**:
- プレフライトチェックでメモリ不足エラーが発生していないこと
- デプロイ中にメモリが枯渇していないこと

### 3. Ansibleタスクの進行確認

**目的**: デプロイが特定のタスクで停止していないことを確認

**手順**:
```bash
# Pi5からデプロイ実行
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3 2>&1 | tee /tmp/pi3-deploy.log

# ログを確認
grep -E "TASK|PLAY RECAP|failed|unreachable" /tmp/pi3-deploy.log | tail -20

# デバッグログを確認（Mac上）
cat /Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug.log | jq -r '.message' | sort | uniq -c
```

**期待結果**:
- `PLAY RECAP`が出力され、`failed=0`であること
- デバッグログに`preflight_systemd_state`、`preflight_memory_snapshot`、`before_start_signage_timers`が記録されていること
- 最後のタスクが`Start signage-lite service`であること

**確認ポイント**:
- デプロイが10-15分以内に完了すること
- 特定のタスクでハングしていないこと
- エラーメッセージが出力されていないこと

### 4. プロセス重複の確認

**目的**: 複数のAnsibleプロセスが重複実行されていないことを確認

**手順**:
```bash
# Pi5上でAnsibleプロセスを確認
ssh denkon5sd02@100.106.158.2 "ps aux | grep -E '(ansible|AnsiballZ)' | grep -v grep"

# Pi3上でAnsibleプロセスを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ps aux | grep -E \"(ansible|AnsiballZ)\" | grep -v grep'"
```

**期待結果**:
- デプロイ実行中: 1つの`ansible-playbook`プロセスと、Pi3上に1つの`AnsiballZ`プロセスのみが存在
- デプロイ完了後: Ansibleプロセスが存在しない

**確認ポイント**:
- 複数のAnsibleプロセスが同時実行されていないこと
- 古いAnsibleプロセスが残っていないこと

## 成功条件

以下のすべての条件を満たす場合、Pi3デプロイは成功とみなします：

1. **デプロイ完了**: `PLAY RECAP`が出力され、`failed=0`、`unreachable=0`であること
2. **所要時間**: デプロイが10-15分以内に完了すること
3. **systemdマスク**: `systemctl mask --runtime`がエラーなく実行され、サービスファイルとの競合が発生していないこと
4. **メモリ確保**: デプロイ前後で利用可能メモリが120MB以上であること
5. **サービス起動**: デプロイ後、`signage-lite.service`と`signage-lite-update.timer`が正常に起動していること
6. **プロセス重複**: 複数のAnsibleプロセスが重複実行されていないこと

## 失敗時の対応

### systemdマスクエラーが発生した場合

**症状**: ログに「Failed to mask unit: File '/etc/systemd/system/signage-lite.service' already exists」が出力される

**対応**:
1. Pi3上でサービスファイルの状態を確認: `ls -la /etc/systemd/system/signage-lite.service`
2. サービスファイルが実ファイルの場合、手動でランタイムマスクを実行: `systemctl mask --runtime signage-lite.service`
3. デプロイを再実行

### メモリ不足エラーが発生した場合

**症状**: プレフライトチェックで「CRITICAL: Insufficient memory available」が出力される

**対応**:
1. Pi3上でメモリ状態を確認: `free -m`
2. サービスを手動で停止: `sudo systemctl stop signage-lite.service signage-lite-update.timer`
3. 数秒待機後、メモリ状態を再確認
4. メモリが120MB以上確保されたら、デプロイを再実行

### デプロイが特定のタスクで停止した場合

**症状**: デプロイログの最後のタスクが特定のタスクで止まっている

**対応**:
1. デバッグログを確認: `cat /Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug.log | jq -r '.message' | sort | uniq -c`
2. 最後に記録されたメッセージを確認し、停止位置を特定
3. Pi3上で該当サービスの状態を確認
4. 必要に応じて、手動でサービスを再起動してからデプロイを再実行

### 複数のAnsibleプロセスが実行されている場合

**症状**: `ps aux | grep ansible`で複数のプロセスが表示される

**対応**:
1. すべてのAnsibleプロセスをkill: `pkill -9 ansible-playbook; pkill -9 -f AnsiballZ`
2. 数秒待機
3. プロセスが完全に終了したことを確認
4. デプロイを再実行

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [KB-086: Pi3サイネージデプロイ時のsystemdタスクハング問題](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題)
- [KB-089: Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)
