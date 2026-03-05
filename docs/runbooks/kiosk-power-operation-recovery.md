---
title: Runbook: 電源操作・連打防止オーバーレイ不具合の復旧
tags: [運用, キオスク, 電源, power-actions, 復旧, runbook]
audience: [運用者, 開発者]
last-verified: 2026-03-05
related:
  - ../knowledge-base/KB-288-power-actions-bind-mount-deleted-inode.md
  - ../knowledge-base/KB-investigation-kiosk-ime-and-power-regression.md
  - ../knowledge-base/infrastructure/ansible-deployment.md#kb-237
category: runbooks
---

# Runbook: 電源操作・連打防止オーバーレイ不具合の復旧

## 目的

- キオスクの電源操作（再起動/シャットダウン）が機能しない、または連打防止オーバーレイが表示されない場合の復旧手順を提供する。
- 原因 KB-288: API コンテナの `power-actions` バインドマウントが削除済み inode を参照している場合の即時対処。

## 前提

- Pi5 サーバーへの SSH 接続が可能であること。
- キオスクは Pi5 API 経由で電源操作を行う（`POST /kiosk/power` → `power-actions` に JSON 書き込み → pi5-power-dispatcher）。

## 症状の確認

| 症状 | 確認方法 |
|------|----------|
| 電源ボタン押下で API が 500 を返す | ブラウザ DevTools の Network タブで `POST /kiosk/power` のステータスコードを確認 |
| 連打防止オーバーレイが表示されない | 電源ボタン押下後、黒画面オーバーレイが表示されない |
| マウントが `//deleted` を参照している | 下記「診断」の手順で確認 |

## 診断

Pi5 に SSH 接続し、以下を実行して原因を特定する。

```bash
# 1. API コンテナ内の power-actions マウント状態を確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /proc/self/mountinfo | grep power-actions"
```

**判定**:
- `.../power-actions//deleted` が含まれる → KB-288 の対象。即時対処を実施する。
- `.../power-actions` のみ（`//deleted` なし）→ 別原因（例: クライアント側の clientKey、KB-237 参照）。

## 即時対処（Pi5 で API コンテナ再起動）

```bash
# Pi5 に SSH 接続して実行
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api"
```

**実行後**:
- 数秒待機し、API が正常起動することを確認
- キオスクで電源ボタンを押し、電源操作が正常に機能することを実機確認

**実機検証結果（2026-03-05）**: 研削メイン（raspberrypi4）・raspi4-robodrill01 とも電源操作・連打防止オーバーレイが正常動作することを確認済み。

## 再発防止

- **恒久対策（2026-03-01 実装済み）**: server ロールの `power-actions` 作成タスクに `notify: restart api` を追加。Pi5 デプロイ時に `power-actions` が変更された場合、自動で API 再起動される。
- **`--limit` で Pi4 のみデプロイした場合**: Pi5 の server ロールは実行されず、API 再起動も行われない。過去に `power-actions` が削除・再作成されていた場合、API は古いマウントを参照している可能性がある。その場合は本 Runbook の即時対処を実施する。

## 関連 KB

- [KB-288](../knowledge-base/KB-288-power-actions-bind-mount-deleted-inode.md): power-actions バインドマウントの削除済み inode 参照
- [KB-237](../knowledge-base/infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題): 電源操作の Jinja2/systemd/所有権問題
- [KB-285](../knowledge-base/infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる): 電源操作遅延の仕様
