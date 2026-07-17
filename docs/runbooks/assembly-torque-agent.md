# 組立 torque-agent 運用Runbook

## 目的と現在のゲート

`torque-agent`は、許可済みBluetooth HIDトルクレンチをPi4上で排他取得し、組立作業画面の現在位置へ結び付け、SQLiteへ先に保存してからPi5 APIへ送る。実装・Docker・Ansible契約は存在するが、CEM3-BTLAの正式parser profileは実機出力fixtureの承認まで有効化しない。

このRunbookは実機準備と安全な確認手順を定義する。デプロイ、実機設定変更、クライアントキー発行はそれぞれ明示的な承認後に行う。

## 導入前チェック

1. 管理画面`/admin/tools/torque-wrenches`で型番、物理製造番号、校正期限、保管場所、状態、設定履歴、適合グループを登録する。
2. CEM3-BTLA本体で、製造番号、トルク値、単位、メモリ番号を必須出力にする。可能なら機器日時と判定も追加する。
3. TABまたは改行を1送信の終端に設定する。フィールド順・区切り・小数点表記は推測せず記録する。
4. Pi4でペアリング後、対象だけを安定名で確認する。

```bash
find /dev/input/by-id -maxdepth 1 -type l -print
readlink -f /dev/input/by-id/<candidate>
```

`/dev/input/event*`や一般キーボードを設定してはいけない。必ず対象レンチ固有の`/dev/input/by-id/*`を使う。

## 実機fixture採取

本番agentを有効化する前に、隔離した入力確認環境で次を採取する。

- 正常範囲
- 下限未満、上限超過
- 同じメモリ番号の再送
- 連続入力
- 途中で分割された入力
- 欠損・不正形式
- 可能なら異なる2製造番号

原文から実在製造番号などを匿名化し、`clients/torque-agent/tests/fixtures/cem3_btla/`へ固定する。parserのテストは、完全イベント、途中入力、不正入力、連続入力、再送を区別しなければならない。採取前にCEM3-BTLAらしい区切りや順序をコードへ追加してはいけない。

## 端末設定

Ansible対象ホストで次の変数を秘密管理されたinventory/group varsへ設定する。値をGit管理文書へ貼らない。

```yaml
torque_agent_enabled: true
torque_agent_api_base_url: https://<pi5-origin>
torque_agent_client_key: <registered-client-key>
torque_agent_local_port: 7073
torque_agent_heartbeat_ttl_seconds: 8
# WebがAPIと別originの場合だけ指定。ワイルドカードは使用不可。
torque_agent_browser_origins:
  - https://<kiosk-web-origin>
torque_agent_hid_devices:
  - path: /dev/input/by-id/<approved-device>
    parserProfile: <fixture-approved-profile>
```

APIとキオスクWebが同originなら`torque_agent_browser_origins`は空にし、別originのときだけWeb originを明示する。`TORQUE_ENABLE_SYNTHETIC_FIXTURE`は本番で常に`false`とする。生成される`clients/torque-agent/.env`は0600で、リポジトリへ追加しない。

## 起動とヘルス確認

対象ホストを1台に限定した承認済みAnsible反映後、次を確認する。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque ps torque-agent
curl --fail --silent http://127.0.0.1:7073/health
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque logs --tail=100 torque-agent
```

正常時の`/health`は`ok=true`を返す。`queuedEvents`はAPI送信待ち、`localAuditEvents`はbinding無しまたは解析失敗でサーバーへ割り当てなかった入力、`bound`は有効な作業画面heartbeatの有無である。

## 作業前・作業中の確認

1. REQUIRED組立作業を開き、現在の丸数字と締付条件を確認する。
2. 候補の製造番号を選び、現物の製造番号と下限・規定・上限表示を照合して確認する。
3. 画面が`接続済み`かつ`トルク入力待機中`になった後だけ締め付ける。
4. 丸数字の切替時は一度bindingを解除する。同じ条件・同じ物理レンチ・同じ最新設定なら確認が自動再利用され、「トルク入力待機中」へ戻る。条件、レンチ、設定履歴が変わった場合は再確認する。
5. 誤レンチ、校正切れ、状態不適合、設定不一致、現在位置不一致、未対応単位では位置が進まないことを確認する。

## SQLite確認

キューや監査は削除せず、まず件数と最近のエラーを読み取る。

```bash
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque exec -T torque-agent \
  python - <<'PY'
from pathlib import Path
from torque_agent.queue_store import QueueStore

queue = QueueStore(Path('/data/torque-events.sqlite3'))
print({'queued': queue.count(), 'localAudit': queue.local_error_count()})
for row in queue.local_errors(limit=20):
    print({key: row[key] for key in ('created_at', 'reason', 'device_path', 'parser_profile', 'error')})
PY
```

- `queuedEvents`が増え続ける: API URL、端末キー、ネットワーク、API応答を確認する。イベントIDを変えたりDB行を消したりしない。
- `BINDING_MISSING_OR_EXPIRED`: 作業画面、7073到達性、heartbeat TTLを確認する。別セッションへ手動付替えしない。
- `PAYLOAD_PARSE_FAILED`: 原文をfixture候補として保全し、parser profileと実機出力設定を確認する。推測パーサーを追加しない。

## 安全な再起動

SQLite volumeを維持したままagentだけを再起動する。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque restart torque-agent
curl --fail --silent http://127.0.0.1:7073/health
```

再起動後、未送信イベントは同じイベントIDで再送される。2xx確認後だけoutboxから消える。

## 切戻し

異常時は締付作業を止め、対象端末のagentだけを停止する。API、既存DB、他エージェントは変更しない。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque stop torque-agent
```

volumeやSQLiteを削除しない。管理者例外入力は通信経路の代替であり、誤レンチ・校正・状態・設定などの安全条件を迂回できない。復旧後は現物確認をやり直し、拒否実績とローカル監査を照合する。

## 関連資料

- [実装・検証ExecPlan](../plans/assembly-torque-wrench-traceability-execplan.md)
- [設計判断ADR](../decisions/ADR-20260717-assembly-torque-wrench-traceability.md)
- [組立トルク管理の現仕様](../plans/kiosk-assembly-torque-management-mvp.md)
- [torque-agent README](../../clients/torque-agent/README.md)
