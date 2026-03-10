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

## 6. 関連ドキュメント

- [KB-297 B第7段階（実績工数CSV連携）](../knowledge-base/KB-297-kiosk-due-management-workflow.md#b第7段階実績工数csv連携--全体ランキング連携2026-03-10)
- [deploy-status-recovery.md](./deploy-status-recovery.md)（実機検証チェックリスト）
- [deployment.md](../guides/deployment.md)（デプロイ標準手順）
