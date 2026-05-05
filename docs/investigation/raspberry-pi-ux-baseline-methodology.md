# Raspberry Pi UX ベースライン採取（方法論）

変更前後の比較用。実装ブランチ `improve/pi-ux-phase-c` 起点。

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
