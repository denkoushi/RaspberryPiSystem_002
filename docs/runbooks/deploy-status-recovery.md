# メンテナンス画面が戻らない場合の復旧手順

**対象**: デプロイ完了後もキオスクがメンテナンス画面のままになる場合

**想定事象**: デプロイは成功したが、特定のキオスク端末だけメンテナンス画面が消えない

---

## 1. 原因の切り分け

| 症状 | 想定原因 |
|------|----------|
| 対象端末のみメンテ表示 | デプロイ中にその端末がオフラインになり、フラグ解除を取得できなかった |
| 全キオスクがメンテ表示 | deploy-status.json が残存している（デプロイ失敗/中断時のクリア漏れ） |

---

## 2. 復旧手順

### 2.1 強制解除（Pi5上で deploy-status.json を削除）

```bash
# Macから実行（Pi5のTailscale IPで接続）
ssh denkon5sd02@100.106.158.2 "rm -f /opt/RaspberryPiSystem_002/config/deploy-status.json"
```

- 全キオスクのメンテナンス表示が解除される（最大5秒以内にポーリングで反映）
- デプロイ中に実行しないこと（デプロイ対象端末のメンテ表示が消える）

### 2.2 確認

```bash
# APIで状態確認（キオスクは x-client-key 付きでポーリングするため、直接確認する場合は client-key が必要）
curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk1"
# {"isMaintenance":false} が返ればOK
```

---

## 3. 実機検証チェックリスト（deploy-status v2 デプロイ後）

デプロイ完了後に以下を確認する（2026-03-06 実機検証で実施済み）:

| 項目 | コマンド/手順 | 期待値 |
|------|---------------|--------|
| API ヘルス | `curl -sk https://100.106.158.2/api/system/health` | `status: "ok"` または `"degraded"` |
| deploy-status API（raspberrypi4） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `{"isMaintenance":false}` |
| deploy-status API（raspi4-robodrill01） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspi4-robodrill01-kiosk1"` | `{"isMaintenance":false}` |
| キオスク API | `curl -sk "https://100.106.158.2/api/tools/loans/active" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | 200 OK |
| 納期管理 API | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/triage" -H "x-client-key: client-key-raspberrypi4-kiosk1"` ほか daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / **actual-hours/stats** | 200 OK |
| actual-hours/stats 返却整合 | `curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/actual-hours/stats" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` が返る |
| サイネージ API | `curl -sk "https://100.106.158.2/api/signage/content"` | 200 OK、`layoutConfig` 含む |
| backup.json | `ssh denkon5sd02@100.106.158.2 "ls -lh /opt/RaspberryPiSystem_002/config/backup.json"` | ファイル存在・サイズ 0 でない |
| マイグレーション | `ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status"` | 未適用なし |
| Pi4 サービス | **Pi5経由で** `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no tools03@100.74.144.79 'systemctl is-active kiosk-browser.service status-agent.timer'"`（raspberrypi4） | 両方 `active` |
| Pi4 サービス（robodrill01） | `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no tools04@100.123.1.113 'systemctl is-active kiosk-browser.service status-agent.timer'"` | 両方 `active` |
| Pi3 signage-lite | Pi5経由で `ssh denkon5sd02@100.106.158.2 "ssh -o StrictHostKeyChecking=no signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"` | `active` |

---

## 4. Pi4/Pi3 サービス確認の接続経路

**重要**: MacからPi4/Pi3へ直接SSHするとタイムアウトする。本構成では**Pi5経由**で接続する（[ansible-ssh-architecture.md](../guides/ansible-ssh-architecture.md) 参照）。

- Mac → Pi5（denkon5sd02@100.106.158.2）にSSH
- Pi5 → Pi4/Pi3（tools03/tools04/signageras3@各IP）にSSH

## 5. Pi4デプロイハング時の復旧手順（2026-03-09 追加）

**注記**: 通常は Pi4 を 1 台ずつ直列実行する運用（`deploy_serial.kiosk: 1`）のため、本手順が必要になる事象は稀。過去に `--limit "server:kiosk"` で Pi5 + Pi4 を並列デプロイ中、Pi5 フェーズ完了後に Pi4 キオスクフェーズでハングする事象が発生した（[KB-300](../knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時)）。直列化適用後も、ネットワーク障害等で同様のハングが発生した場合に本手順を参照する。

### 5.1 ハングの判定

- リモートログが 10 分以上更新されない
- `state: running` のまま `exit` ファイルが生成されない
- ログ末尾が `TASK [common : Ensure repository parent directory exists]` 等で止まっている

### 5.2 復旧手順

1. **ハングしたプロセスの停止**（Pi5 上で実行中の ansible-playbook 等を kill）
   ```bash
   # リモートの PID を確認（status.json の runId から .pid ファイルを参照）
   ssh denkon5sd02@100.106.158.2 "ps aux | grep ansible-update"
   # 親プロセス（bash /tmp/ansible-update-*.sh）と ansible-playbook を kill
   ssh denkon5sd02@100.106.158.2 "kill -TERM <親PID> <ansible-playbook-PID> 2>/dev/null || true"
   ```

2. **ロックファイルの確認・削除**（cleanup が実行されない場合）
   ```bash
   ssh denkon5sd02@100.106.158.2 "rm -f /opt/RaspberryPiSystem_002/logs/.update-all-clients.lock"
   ```

3. **Pi4 を単体で再デプロイ**
   ```bash
   export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
   ./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspberrypi4" --detach --follow
   ./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit "raspi4-robodrill01" --detach --follow
   ```

4. **実機検証チェックリスト**（セクション 3）に従って確認

---

## 6. 関連ドキュメント

- [ADR-20260306: 端末別メンテナンス状態](../decisions/ADR-20260306-deploy-status-per-client-maintenance.md)
- [deployment.md](../guides/deployment.md): デプロイ標準手順
- [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装)
- [KB-300](../knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時): Pi4 デプロイハングの詳細
