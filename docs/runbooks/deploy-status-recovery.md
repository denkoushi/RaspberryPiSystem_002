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

## 3. 関連ドキュメント

- [ADR-20260306: 端末別メンテナンス状態](../decisions/ADR-20260306-deploy-status-per-client-maintenance.md)
- [deployment.md](../guides/deployment.md): デプロイ標準手順
- [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装)
