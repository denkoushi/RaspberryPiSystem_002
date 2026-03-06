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
| deploy-status API（Pi4 kiosk1） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | `{"isMaintenance":false}` |
| deploy-status API（Pi4 kiosk2） | `curl -sk "https://100.106.158.2/api/system/deploy-status" -H "x-client-key: client-key-raspberrypi4-kiosk2"` | `{"isMaintenance":false}` |
| キオスク API | `curl -sk "https://100.106.158.2/api/kiosk/tools/loans/active" -H "x-client-key: client-key-raspberrypi4-kiosk1"` | 200 OK |
| サイネージ API | `curl -sk "https://100.106.158.2/api/signage/content"` | 200 OK、`layoutConfig` 含む |
| backup.json | `ssh denkon5sd02@100.106.158.2 "ls -lh /opt/RaspberryPiSystem_002/config/backup.json"` | ファイル存在・サイズ 0 でない |
| マイグレーション | `docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status` | 未適用なし |
| Pi4 サービス | `ssh denkon5sd02@<Pi4_IP> "systemctl is-active kiosk-browser.service"` | `active` |
| Pi3 signage-lite | `ssh denkon5sd02@<Pi3_IP> "systemctl is-active signage-lite.service"` | `active` |

---

## 4. 関連ドキュメント

- [ADR-20260306: 端末別メンテナンス状態](../decisions/ADR-20260306-deploy-status-per-client-maintenance.md)
- [deployment.md](../guides/deployment.md): デプロイ標準手順
- [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装)
