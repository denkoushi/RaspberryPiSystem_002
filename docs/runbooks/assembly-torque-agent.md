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

## 実機fixture採取（Milestone 2B）

実機がない間は、Mac上で読み取り、匿名化、検証の契約を確認できる。

```bash
cd clients/torque-agent
poetry run torque-capture replay \
  --input tests/fixtures/capture_contract/synthetic-key-events.jsonl \
  --synthetic
poetry run torque-capture validate \
  --fixtures tests/fixtures/capture_contract
```

`capture_contract`はCEM3-BTLA出力を模したものではない。実機由来の匿名化済みfixtureだけを`tests/fixtures/cem3_btla/`へ配置し、実payloadが揃うまでは同ディレクトリも正式parser profileも作らない。

### 1. 採取情報を記録する

採取日ごとに次を手元の作業記録へ残す。実製造番号をGit管理文書へ書かない。

- ファームウェア版
- 有効にした出力項目とその順序
- 単位と小数点表記
- TAB／ENTER等の終端設定
- 同じメモリを再送する実機操作
- 利用可能な実機台数

製造番号、トルク値、単位、メモリ番号を必須出力にし、可能なら機器日時と機器判定も有効にする。文字列、区切り、日時、判定表記は事前に仮定しない。

### 2. agentを止めて排他採取する

対象Piでagentだけを停止し、対象`/dev/input/by-id/*`が解放されたことを確認する。CLIが取得失敗した場合もagentを自動停止しない。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque stop torque-agent
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque ps torque-agent
mkdir -p /var/lib/torque-agent/capture-private
chmod 700 /var/lib/torque-agent/capture-private
```

以下は`poetry install`済み環境で実行する。各`<capture-id>`は新しいディレクトリ名とし、既存先を再利用しない。標準タイムアウトは120秒で、Ctrl-Cやタイムアウトでも取得済みイベントと`interrupted`／`timeout`状態が残る。

```bash
cd /opt/RaspberryPiSystem_002/clients/torque-agent
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<normal-id> --scenario normal --expected-frames 3 --firmware '<firmware>' --output-config '<output-config-label>'
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<below-id> --scenario below_limit --expected-frames 3 --firmware '<firmware>' --output-config '<output-config-label>'
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<above-id> --scenario above_limit --expected-frames 3 --firmware '<firmware>' --output-config '<output-config-label>'
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<repeat-id> --scenario repeated_memory --expected-frames 2 --firmware '<firmware>' --output-config '<output-config-label>'
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<rapid-id> --scenario rapid_consecutive --expected-frames 5 --firmware '<firmware>' --output-config '<output-config-label>'
```

`/dev/input/event*`と一般キーボードは拒否され、`--no-grab`は存在しない。CLIの標準出力にはpayload本文や製造番号が出ず、件数だけが出る。採取後に権限を確認する。

```bash
find /var/lib/torque-agent/capture-private -type d -exec stat -c '%a %n' {} \;
find /var/lib/torque-agent/capture-private -type f -exec stat -c '%a %n' {} \;
```

### 3. replay、匿名化、fixture検証

raw captureと置換表はGit外の安全な場所へ置く。置換表は実値をコマンドラインへ出さず、次の形式で0600にする。

```json
{
  "literals": [
    { "source": "<real-serial-a>", "replacement": "SERIAL_A" }
  ]
}
```

```bash
chmod 600 /var/lib/torque-agent/private/cem3.torque-redactions.json
poetry run torque-capture replay \
  --input /var/lib/torque-agent/capture-private/<normal-id>
poetry run torque-capture sanitize \
  --input /var/lib/torque-agent/capture-private/<normal-id> \
  --redactions /var/lib/torque-agent/private/cem3.torque-redactions.json \
  --output tests/fixtures/cem3_btla/SERIAL_A/normal.jsonl
```

`sanitize`は各置換元が1回以上存在し、置換後に実値が残らない場合だけ書き出す。同じ手順で5つの実測シナリオを作る。`partial`、`missing_field`、`bad_number`、`unsupported_unit`は実payloadの契約確定後に作る派生fixtureであり、`provenance=derived`として実測と区別する。

```bash
poetry run torque-capture validate \
  --fixtures tests/fixtures/cem3_btla \
  --available-device-count <1-or-2> \
  --redactions /var/lib/torque-agent/private/cem3.torque-redactions.json
git status --short
git ls-files | rg 'torque-capture-private|torque-redactions|events\.sqlite3' && exit 1 || true
```

複数実機が利用可能と記録した場合だけ`--available-device-count 2`とし、`SERIAL_A`と`SERIAL_B`の両方を必須にする。raw captureはfixture承認まで保持し、承認後もCLIから自動削除しない。保全期間や削除は別の承認済み運用判断とする。

### 4. agentを再起動する

採取コマンドの終了後は、成功・失敗にかかわらずagentを明示的に戻す。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque start torque-agent
curl --fail --silent http://127.0.0.1:7073/health
```

実機fixtureのレビューでは、観測されたフィールド順、区切り、単位、終端だけを正式parserへ許可する。推測による代替形式は追加しない。

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
- `HID_DECODE_FAILED`: 未対応キーを含むため、文字を黙って落としたpayloadはAPIへ送っていない。終端とキー監査を実機fixture調査へ回し、既知文字への推測変換はしない。

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
