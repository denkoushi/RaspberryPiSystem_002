# 実績工数 Canonical / Feature バックフィル手順

**対象**: 実績工数CSVのCanonical差分化（Raw append-only + Canonical winner選定 + Feature再集約）をDeployした後、既存のRawデータをCanonical/Featureへ反映する場合

**想定事象**: Deploy完了後、`actual-hours/stats` で `totalCanonicalRows: 0` または `totalFeatureKeys: 0` のまま。既存のRawはあるが、Canonical/Featureが空。

---

## 1. 前提条件

- **Deploy完了済み**: Canonical差分化コードが本番に反映されていること
- **マイグレーション適用済み**: `ProductionScheduleActualHoursCanonical` テーブルが存在すること
- **Rawデータが存在**: `ProductionScheduleActualHoursRaw` に既存データがあること（Gmail月次取込や手動importで投入済み）

---

## 2. 実行順序（推奨）

1. **コミット・プッシュ** → CI成功
2. **Deploy** → 本番に新コード反映
3. **本番DBバックフィル** → 既存RawからCanonical/Featureを再構築

**理由**: バックフィルは新コード（Canonical resolver、ImportOrchestrator）に依存するため、先にDeployしてから実行する。

---

## 3. バックフィル実行手順

### 3.1 Pi5サーバー上でAPIコンテナ内実行

```bash
# MacからPi5へSSH（Tailscale IP）
ssh denkon5sd02@100.106.158.2

# APIコンテナ内でバックフィル実行（locationKey はデフォルト "default"）
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm backfill:actual-hours:prod
```

### 3.2 locationKey を指定する場合

Gmail CSV取込の `metadata.locationKey` で `default` 以外を設定している場合は、環境変数で指定する。

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml exec -e ACTUAL_HOURS_LOCATION_KEY=your-location api pnpm backfill:actual-hours:prod
```

### 3.3 期待される出力例

```
[backfill-actual-hours] locationKey=default
[backfill-actual-hours] Canonical rebuild: { sourceRows: 150, candidateKeys: 45, canonicalCreated: 40, canonicalUpdated: 5, canonicalSkipped: 0 }
[backfill-actual-hours] Feature rebuild: { featureKeysCreated: 45, featureKeysUpdated: 0 }
[backfill-actual-hours] Done.
```

---

## 4. 検証

バックフィル完了後、以下で件数整合を確認する。

```bash
# x-client-key は任意のキオスク用 client-key で可
curl -sk "https://100.106.158.2/api/kiosk/production-schedule/due-management/actual-hours/stats" \
  -H "x-client-key: client-key-raspberrypi4-kiosk1"
```

期待値の例:

- `totalRawRows`: Raw件数（0でなければOK）
- `totalCanonicalRows`: Canonical件数（0より大きい）
- `totalFeatureKeys`: Featureキー数（0より大きい）
- `topFeatures`: 上位特徴量の配列

---

## 5. トラブルシューティング

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `totalCanonicalRows: 0` のまま | Rawが空、または locationKey 不一致 | Rawの存在確認（`SELECT COUNT(*) FROM "ProductionScheduleActualHoursRaw"`）。locationKey を環境変数で指定 |
| スクリプトが `Cannot find module` で失敗 | ビルド未実施またはパス誤り | `pnpm build` 後に再実行。コンテナ内は `dist/` を参照するため、`tsx` で直接実行する `pnpm backfill:actual-hours` が正しい |
| 権限エラー | DB接続・Prisma設定 | `.env` の `DATABASE_URL` を確認。コンテナ内では `docker-compose.server.yml` の環境変数が適用される |

---

## 6. 大容量CSVの手動投入（分割投入）

**想定事象**: 約 6MB 超の一括送信で `413 Payload Too Large` になる（[KB-301](../knowledge-base/api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる)）

### 6.1 分割投入の手順

1. **CP932 の CSV を UTF-8 に変換**（必要に応じて）
   ```bash
   iconv -f CP932 -t UTF-8 data_20210101_20221231.csv > data_20210101_20221231_utf8.csv
   ```

2. **約 25 万文字ごとにチャンク分割**して、順次 `POST /api/kiosk/production-schedule/due-management/actual-hours/import` を実行する
   - 例: 6.4MB のファイルを約 250KB（約 25 万文字）ごとに分割 → 約 25 チャンク
   - 各チャンクは CSV ヘッダー行を含む完全な形式（または API が許容する形式）で送信する

3. **全チャンク投入後**、`GET /actual-hours/stats` で件数整合を確認する
   - `totalRawRows`: Raw 件数
   - `totalCanonicalRows`: Canonical 件数
   - `totalFeatureKeys`: Feature キー数

### 6.2 実績例（2026-03-10）

- 対象: `data_20210101_20221231.csv`（6.4MB）、`data_20230101_20241231.csv`（5.5MB）
- 方法: 約 25 万文字ごとに分割し、48 チャンクで順次投入
- 結果: `totalRawRows: 205766`, `totalCanonicalRows: 146644`, `totalFeatureKeys: 10436`

---

## 7. 関連ドキュメント

- [KB-297 B第7段階（実績工数CSV連携）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#b第7段階実績工数csv連携--全体ランキング連携2026-03-10)
- [KB-301 413 Payload Too Large](../knowledge-base/api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる)
- [deploy-status-recovery.md](./deploy-status-recovery.md)（実機検証チェックリスト）
- [deployment.md](../guides/deployment.md)（デプロイ標準手順）
