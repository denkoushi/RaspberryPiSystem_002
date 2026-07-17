# torque-agent

複数の許可済み `/dev/input/by-id/*` HID機器を排他取得し、入力イベントをSQLiteへ先に保存してから組立APIへ送るローカルエージェントです。ローカル制御APIは `127.0.0.1:7073` のみで待ち受けます。

## CEM3-BTLA parser gate

CEM3-BTLAの実出力フォーマットはまだ固定していません。実機から製造番号、トルク、単位、メモリ番号を含む匿名化fixtureを採取・承認するまでは、CEM3-BTLA用プロファイルを登録しない設計です。`synthetic-delimited-fixture-v1` はテスト専用で、実機形式を推測したものではありません。

## Safety properties

- 設定した `/dev/input/by-id` のみを開き、`grab()` でブラウザーへのキー漏れを防止します。
- 有効なブラウザheartbeatがない入力は別作業へ推測割当せず、SQLiteの`torque_local_audit`へ理由付きで残します。
- 解析できない入力もHID監視を停止させず、原文・機器パス・parser profile・エラーをローカル監査へ残します。
- イベントIDをSQLiteの主キーにし、2xx応答後だけ削除します。
- タイムアウト・ネットワーク障害・5xx/4xxは同じイベントIDのまま、最大30秒の上限付きバックオフで再送します。
- heartbeatのCORSはAPI originと明示許可したキオスクWeb originに限定し、ワイルドカードを拒否します。
- 現在位置の確認IDが無いheartbeatは旧bindingを即時解除し、TTLが切れるまで前の丸数字へ紐付け続けません。

ローカル監査は新しいものから最大10,000件を保持する。API送信対象の`torque_outbox`とは分離され、後から作業セッションへ推測再送しない。

## Environment

環境変数は `.env.example` を参照する。秘密のクライアントキーや現場固有の実デバイスパスはコミットしない。

- `TORQUE_API_BASE_URL`: Pi5 APIのorigin。末尾`/api`は付けない
- `TORQUE_CLIENT_KEY`: このキオスク端末として登録済みのクライアントキー
- `TORQUE_HID_DEVICES_JSON`: `/dev/input/by-id/*`と承認済みparser profileの配列
- `TORQUE_QUEUE_PATH`: outboxとローカル監査を持つSQLiteファイル
- `TORQUE_LOCAL_PORT`: loopback heartbeat/healthポート。標準は7073
- `TORQUE_HEARTBEAT_TTL_SECONDS`: 作業画面bindingの有効秒数
- `TORQUE_BROWSER_ORIGINS_JSON`: APIとWebが別originの場合に追加許可するキオスクWeb originのJSON配列。API originは自動許可され、ワイルドカードは使用不可
- `TORQUE_ENABLE_SYNTHETIC_FIXTURE`: テスト専用。本番は必ず`false`

## Development verification

```bash
cd clients/torque-agent
poetry install
poetry run pytest
poetry run ruff check .
```

Poetryがない開発Macでは、リポジトリを変更しない一時実行として次も使用できる。

```bash
PYTHONPATH=. pytest -q
uvx ruff==0.4.2 check .
```

## Health and queue inspection

```bash
curl --fail --silent http://127.0.0.1:7073/health
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque logs --tail=100 torque-agent
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque exec torque-agent \
  python -c 'from pathlib import Path; from torque_agent.queue_store import QueueStore; q=QueueStore(Path("/data/torque-events.sqlite3")); print({"queued": q.count(), "localAudit": q.local_error_count()})'
```

`queuedEvents`はAPI応答待ち、`localAuditEvents`はbinding無しまたは解析失敗でサーバーへ割り当てなかった入力である。SQLiteファイルを直接削除して復旧してはいけない。

本番導入、実機fixture採取、安全な再起動・切戻しは[組立torque-agent Runbook](../../docs/runbooks/assembly-torque-agent.md)を参照する。
