# KB-314: キオスク持出一覧・サイネージの表記統一（撮影mode・端末場所ラベル削除）

## Context

- **いつ**: 2026-03-26
- **どこ**: キオスク `/kiosk/tag` 持出一覧（`KioskReturnPage`）、サイネージ Web プレビュー（`SignageDisplayPage`）、API サイネージ JSON/SVG（`signage.service` / `signage.renderer`）

## 仕様

- **写真撮影持出**（`item` なし・`photoUrl` あり）の1行目表示名は **`撮影mode`**（従来「写真撮影モード」。カード幅での `truncate` 緩和のため短縮）。
- **端末の設置場所**は **`formatClientDeviceLocationLabel` の値のみ**表示し、UI 上の **`端末場所:` / `端末場所：` プレフィックスは付けない**。
- **単一ソース**: `@raspi-system/shared-types` の `PHOTO_LOAN_CARD_PRIMARY_LABEL`（[`loan-card-display.ts`](../../packages/shared-types/src/tools/loan-card-display.ts)）。Web/API 双方が同一定数を参照。

## 実機検証（2026-03-26）

| 確認 | 方法 | 結果 |
|------|------|------|
| API ヘルス | `curl -sk https://100.106.158.2/api/system/health` | `status: ok`（メモリ使用率 WARN 表示は既存挙動） |
| サイネージ loans JSON | `curl -sk https://100.106.158.2/api/signage/content` | 写真貸出ツールの `name` が **`撮影mode`**、`clientLocation` が **値のみ**（例: `第2工場 - kensakuMain`） |
| Pi3 サイネージ | Pi5 経由 `ssh signageras3@<Pi3> 'systemctl is-active signage-lite.service && ls -lh /run/signage/current.jpg'` | `active`、画像更新時刻確認済み |

**デプロイ実績**（[deployment.md](../guides/deployment.md) 準拠・対象限定・順次）:

1. `--limit raspberrypi5` — Run ID `20260326-163504-12407`、success  
2. `--limit raspberrypi4` — `20260326-164331-18323`、success  
3. `--limit raspi4-robodrill01` — `20260326-164913-28204`、success  
4. `--limit "server:signage"`（Pi3 専用の **server + signage**）— `20260326-165418-16778`、約38分、`failed=0`

**キオスク画面の目視**: `/kiosk/tag` は実機ブラウザでキャッシュクリアまたは `kiosk-browser` 再起動後に確認推奨（下記 TS）。

## 知見

- **ESLint**: `as const` が文字列リテラルで `@typescript-eslint/no-unnecessary-type-assertion` に抵触する場合は **プレーン定数**で十分。
- **Pi3 デプロイ**: リソース僅少のため **`server:signage` を単独実行**（Pi4 と同時に走らせない）。プレフライトの自動停止・復旧に任せ、プロセスを途中で kill しない（[deployment.md §ラズパイ3](../guides/deployment.md)）。

## トラブルシューティング

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| キオスクが旧表記のまま | ブラウザキャッシュ・未デプロイの Pi4 | 対象 Pi4 でデプロイログ確認、`kiosk-browser` 再起動または強制リロード |
| `/api/signage/content` が旧 `name` | Pi5 API コンテナが旧イメージ | `--limit raspberrypi5` で再デプロイ、Docker 再ビルド確認 |
| `current-image` が 401 | 認証要のエンドポイント | **検証は `/api/signage/content` の JSON** または Pi3 上の `current.jpg` で代替 |
| Pi3 `PLAY RECAP` に `unreachable=1` | post_tasks 直後の一時 SSH 断 | [KB-216](./infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) — `failed=0` なら `systemctl is-active` で実測 |

## References

- 実装ブランチ: `feat/loan-card-display-labels`
- [modules/measuring-instruments/ui.md](../modules/measuring-instruments/ui.md)
- [guides/measuring-instruments-verification.md](../guides/measuring-instruments-verification.md)
- [guides/verification-checklist.md](../guides/verification-checklist.md)（6.6.5）
- [guides/deployment.md](../guides/deployment.md)
