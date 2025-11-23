# 監視・アラートガイド

最終更新: 2025-01-XX

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムの監視とアラート設定について説明します。

## 監視対象

- **APIヘルスチェック**: データベース接続、メモリ使用量
- **Dockerコンテナ**: コンテナの稼働状態
- **ディスク使用量**: ディスク容量の監視
- **メモリ使用量**: システムメモリの監視
- **メトリクス**: Prometheus形式のメトリクスエンドポイント

## APIヘルスチェック

### エンドポイント

```
GET /api/system/health
```

### レスポンス例

```json
{
  "status": "ok",
  "timestamp": "2025-01-XXT00:00:00.000Z",
  "checks": {
    "database": { "status": "ok" },
    "memory": { "status": "ok" }
  },
  "memory": {
    "rss": 150,
    "heapTotal": 50,
    "heapUsed": 30,
    "external": 10
  },
  "uptime": 3600
}
```

### ステータスコード

- `200`: すべてのチェックが正常
- `503`: 1つ以上のチェックが失敗

## メトリクスエンドポイント

### エンドポイント

```
GET /api/system/metrics
```

### レスポンス形式

Prometheus形式のテキストを返します。

### メトリクス一覧

- `db_connections_total`: データベース接続数
- `loans_active_total`: アクティブな貸出数
- `employees_active_total`: アクティブな従業員数
- `items_active_total`: アクティブなアイテム数
- `process_memory_bytes`: プロセスメモリ使用量（バイト）
- `process_uptime_seconds`: プロセス起動時間（秒）
- `nodejs_version_info`: Node.jsバージョン情報

### 使用例

```bash
# メトリクスを取得
curl http://localhost:8080/api/system/metrics

# Prometheusでスクレイプする場合
# prometheus.ymlに以下を追加:
#   - job_name: 'raspberry-pi-system'
#     static_configs:
#       - targets: ['localhost:8080']
#     metrics_path: '/api/system/metrics'
```

## 監視スクリプト

`scripts/server/monitor.sh`を使用してシステム全体を監視できます。

### 使用方法

```bash
# 手動実行
/opt/RaspberryPiSystem_002/scripts/server/monitor.sh

# cronで定期実行（5分ごと）
*/5 * * * * /opt/RaspberryPiSystem_002/scripts/server/monitor.sh >> /var/log/system-monitor.log 2>&1
```

### 監視項目

1. **APIヘルスチェック**: `/api/system/health`エンドポイントの確認
2. **Dockerコンテナ**: すべてのコンテナが稼働中か確認
3. **ディスク使用量**: 90%を超えている場合はエラー、80%を超えている場合は警告
4. **メモリ使用量**: 90%を超えている場合はエラー、80%を超えている場合は警告

### ログ出力

監視結果は`/var/log/system-monitor.log`に記録されます。

### アラート通知

`ALERT_EMAIL`環境変数を設定すると、エラー発生時にメール通知が送信されます。

```bash
# 環境変数を設定
export ALERT_EMAIL="admin@example.com"

# 監視スクリプトを実行
/opt/RaspberryPiSystem_002/scripts/server/monitor.sh
```

## 外部監視ツールとの連携

### Prometheus

Prometheusを使用してメトリクスを収集する場合：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'raspberry-pi-system'
    static_configs:
      - targets: ['raspberry-pi-5:8080']
    metrics_path: '/api/system/metrics'
    scrape_interval: 30s
```

### Grafana

Grafanaでダッシュボードを作成する場合：

1. Prometheusをデータソースとして追加
2. 以下のクエリを使用してダッシュボードを作成：
   - `loans_active_total`: アクティブな貸出数
   - `employees_active_total`: アクティブな従業員数
   - `items_active_total`: アクティブなアイテム数
   - `process_memory_bytes{type="heapUsed"}`: ヒープメモリ使用量

### Nagios / Zabbix

HTTPチェックプラグインを使用して`/api/system/health`エンドポイントを監視：

```bash
# Nagios例
check_http -H raspberry-pi-5 -p 8080 -u /api/system/health -e "200"
```

## トラブルシューティング

### APIヘルスチェックが失敗する

1. Dockerコンテナが稼働しているか確認：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps
   ```

2. APIログを確認：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api
   ```

3. データベース接続を確認：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT 1;"
   ```

### メトリクスエンドポイントが応答しない

1. APIサーバーが稼働しているか確認
2. エンドポイントのパスが正しいか確認（`/api/system/metrics`）
3. ファイアウォール設定を確認

### 監視スクリプトがエラーを報告する

1. ログファイルを確認：
   ```bash
   tail -f /var/log/system-monitor.log
   ```

2. 手動で各チェックを実行：
   ```bash
   curl http://localhost:8080/api/system/health
   docker compose -f infrastructure/docker/docker-compose.server.yml ps
   df -h /
   free -h
   ```

## ベストプラクティス

1. **定期的な監視**: cronで5分ごとに監視スクリプトを実行
2. **ログローテーション**: ログファイルが大きくなりすぎないようにローテーション設定
3. **アラート閾値の調整**: 環境に応じてディスク使用量やメモリ使用量の閾値を調整
4. **外部監視ツールの活用**: PrometheusやGrafanaを使用して可視化
5. **バックアップとの連携**: 監視スクリプトとバックアップスクリプトを連携させて、異常検知時に自動バックアップを実行

