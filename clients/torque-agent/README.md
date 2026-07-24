# torque-agent

複数の許可済み `/dev/input/by-id/*` HID機器を排他取得し、入力イベントをSQLiteへ先に保存してから組立APIへ送るローカルエージェントです。ローカル制御APIは `127.0.0.1:7073` のみで待ち受けます。保存済みイベントは送信処理を直ちに起こし、APIの2xx確認とoutbox削除後に`/stream` WebSocketから作業画面へ再取得の合図を送ります。

## CEM3-BTLA parser contract

CEM3-BTLAの通常出力3件と連続出力5件から、`cem3-btla-hogp-v1`の厳密parser adapterと匿名化fixtureを作成し、production registryへ登録済みです。`synthetic-delimited-fixture-v1`はテスト専用で、実機形式を推測したものではありません。本番デプロイは別の明示承認まで行いません。

観測済みの本体設定は`Cn_o=ON`、`An_o=OFF`、`Jd_o=ON`、`Sn_o=ON`、`dt_o=ON`、`bA_o=OFF`、`Un_o=ON`、`dLm=TAB`、`End=ENTER`、`kEY=JP`、`ZEro=OFF`です。payloadはメモリ番号、トルク、空白埋め単位、2文字の合否判定、7文字の製造番号、`YY/MM/DD`、時刻の7フィールドです。Pi/Linuxの`kEY=JP`経路では時刻区切りがアポストロフィとして観測されたため、このprofileはその実測形だけを受理します。

`tests/fixtures/cem3_btla/SERIAL_A/normal.jsonl`と`rapid_consecutive.jsonl`は実測・匿名化済みです。`partial`、`missing_field`、`bad_number`、`unsupported_unit`はその契約から作った派生fixtureです。実機に同一メモリ再送機能がないため、`repeated_memory`はsynthetic capture契約とeventId冪等性テストで検証し、実測fixtureは任意です。最初の測定をウォームアップとして捨てる運用はしません。

## Read-only capture kit

`torque-capture`はAPI、heartbeat、SQLite outboxへ接続しない、実機契約調査専用のCLIです。

- `capture`: Linux上の明示した`/dev/input/by-id/*`を必ず排他取得し、EV_KEYイベントをリポジトリ外へ0700/0600で保全する
- `replay`: rawイベントをデコーダーへ戻し、本文を出さずフレーム数、終端、未知キー数だけを表示する
- `sanitize`: Git外の0600置換表で実値を完全一致置換し、最小限の匿名化fixtureを生成する
- `validate`: fixture schema、由来、シナリオ、連番、終端、匿名化製造番号数を検証する

Macでは、実機形式を表さない`tests/fixtures/capture_contract`だけを使ってCLI境界を確認できます。

```bash
poetry run torque-capture replay \
  --input tests/fixtures/capture_contract/synthetic-key-events.jsonl \
  --synthetic
poetry run torque-capture validate \
  --fixtures tests/fixtures/capture_contract
```

終了コードは成功`0`、引数・安全条件違反`2`、未完了・タイムアウト`3`、機器・OSエラー`4`です。raw payloadは標準出力へ表示しません。実機採取の停止・再起動、匿名化、保全手順はRunbookに従ってください。

実機採取時はフィールド区切りのTABをフレーム終端にしないよう、終端を明示します。

```bash
poetry run torque-capture capture \
  --device /dev/input/by-id/<approved-device> \
  --output /var/lib/torque-agent/capture-private/<capture-id> \
  --scenario normal --expected-frames 3 \
  --firmware '<firmware>' --output-config '<output-config-label>' \
  --terminator enter
```

## Safety properties

- 設定した `/dev/input/by-id` のみを開き、`grab()` でブラウザーへのキー漏れを防止します。
- 起動時に設定済みlinkが未生成でも同じpathだけを待ち、Bluetooth切断後もfresh decoderで同じpathを再取得します。`eventN`探索や別キーボードへのfallbackはしません。
- 有効なブラウザheartbeatがない入力は別作業へ推測割当せず、SQLiteの`torque_local_audit`へ理由付きで残します。
- 解析できない入力もHID監視を停止させず、原文・機器パス・parser profile・エラーをローカル監査へ残します。
- 未対応HIDキーを黙って除去せず、実際の終端とキー情報を`HID_DECODE_FAILED`としてローカル監査へ残し、改変されたpayloadを送信しません。
- イベントIDをSQLiteの主キーにし、2xx応答後だけ削除します。
- タイムアウト・ネットワーク障害・5xx/4xxは同じイベントIDのまま、最大30秒の上限付きバックオフで再送します。
- heartbeatのCORSはAPI originと明示許可したキオスクWeb originに限定し、ワイルドカードを拒否します。
- 現在位置の確認IDが無いheartbeatは旧bindingを即時解除し、TTLが切れるまで前の丸数字へ紐付け続けません。

ローカル監査は新しいものから最大10,000件を保持する。API送信対象の`torque_outbox`とは分離され、後から作業セッションへ推測再送しない。

## Environment

環境変数は `.env.example` を参照する。秘密のクライアントキーをコミットしない。実デバイスpathはAnsibleがUSBコントローラーとBluetooth HIDの完全一致から生成する安定した`/dev/input/by-id`だけを使う。

- `TORQUE_API_BASE_URL`: Pi5 APIのorigin。末尾`/api`は付けない
- `TORQUE_CLIENT_KEY`: このキオスク端末として登録済みのクライアントキー
- `TORQUE_HID_DEVICES_JSON`: `/dev/input/by-id/*`と承認済みparser profileの配列
- `TORQUE_QUEUE_PATH`: outboxとローカル監査を持つSQLiteファイル
- `TORQUE_LOCAL_PORT`: loopback heartbeat/healthポート。標準は7073
- `TORQUE_HEARTBEAT_TTL_SECONDS`: 作業画面bindingの有効秒数
- `TORQUE_TLS_VERIFY_MODE`: `system`（既定、OSのCAで検証）または、自己署名Pi5に限定した`insecure`。inventoryで端末単位に明示し、全体既定を弱めない
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

`ws://127.0.0.1:7073/stream`は、許可済みブラウザOriginだけが接続できるローカル通知経路です。通知は`sessionId`、`sourceEventKey`、取得・確認時刻だけを含み、トルク値や製造番号は含みません。画面は通知後に既存APIを再取得し、WebSocket切断時は1.2秒ポーリングで復旧します。

`queuedEvents`はAPI応答待ち、`localAuditEvents`はbinding無しまたは解析失敗でサーバーへ割り当てなかった入力である。SQLiteファイルを直接削除して復旧してはいけない。

本番導入、実機fixture採取、安全な再起動・切戻しは[組立torque-agent Runbook](../../docs/runbooks/assembly-torque-agent.md)を参照する。
