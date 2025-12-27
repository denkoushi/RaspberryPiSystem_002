---
title: デプロイ トラブルシューティング
tags: [デプロイ, トラブルシューティング, Ansible, RaspberryPi]
audience: [運用者, 開発者]
last-verified: 2025-12-27
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

## それでも解決しない場合（調査の進め方）

1. `logs/ansible-precheck-*.json` の `checks[]` で **最初にfail/warnになった項目**を特定
2. `logs/ansible-update-*.log` の `PLAY RECAP` を確認し、`failed/unreachable` の対象を特定
3. 対象KBを参照し、再発防止策（設定/運用）まで反映する

