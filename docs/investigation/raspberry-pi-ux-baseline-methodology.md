# Raspberry Pi UX ベースライン採取（方法論）

変更前後の比較用。実装ブランチ `improve/pi-ux-phase-c` 起点。

## 本番反映（2026-05-05）

- Pi5 **`raspberrypi5` のみ** に `improve/pi-ux-phase-c` を適用。**Detach Run ID**: `ansible-update-20260505-190249-31447`（**`PLAY RECAP` `failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- 体感・数値の比較は、下記「観測項目」の手順で **変更後に再採取**すること（本書に数値は固定しない）。運用ログ: [deployment.md](../guides/deployment.md)（2026-05-05 **Pi5 UX 負荷緩和**項）·[EXEC_PLAN.md](../../EXEC_PLAN.md)。

## 観測項目

1. **API 起動**: `buildServer` 完了〜`listen` 完了まで（ログの時刻差）。
2. **主要操作**: キオスク画面でボタン押下〜UI反映（開発者ツール Network の TTFB・Total）。
3. **ポーリング負荷**: 同一画面で 1 分間の `/api` リクエスト数（Network フィルタ）。
4. **イベントループ**: `GET /api/system/metrics` の `nodejs_event_loop_delay_milliseconds`（既存メトリクス）。

## 推奨手順

- 本番相当 Pi 上で、負荷の低い時間帯に 3 回測定し中央値を記録。
- フェーズ完了ごとに同一手順で再採取。

## メモ

固有の数値は環境依存のため、このドキュメントには数値を固定記載しない。
