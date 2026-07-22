# 組立 torque-agent 運用Runbook

## 目的と現在のゲート

`torque-agent`は、許可済みBluetooth HIDトルクレンチをPi4上で排他取得し、組立作業画面の現在位置へ結び付け、SQLiteへ先に保存してからPi5 APIへ送る。Pi5/PostgreSQLの接続リースを正本とし、常に1本・1端末・1作業セッションだけを有効にする。CEM3-BTLAの通常3件・連続5件を匿名化して固定し、厳密な`cem3-btla-hogp-v1` profileを登録済みである。リース機能と外付けBluetoothガードはローカル実装・自動試験済みだが、まだデプロイしていない。

このRunbookは実機準備と安全な確認手順を定義する。デプロイ、実機設定変更、クライアントキー発行はそれぞれ明示的な承認後に行う。

## 導入前チェック

1. 管理画面`/admin/tools/torque-wrenches`で型番、物理製造番号、校正期限、保管場所、状態、設定履歴、適合グループを登録する。
2. 検証済みCEM3-BTLA設定を使う。`Cn_o=ON`、`An_o=OFF`、`Jd_o=ON`、`Sn_o=ON`、`dt_o=ON`、`bA_o=OFF`、`Un_o=ON`、`dLm=TAB`、`End=ENTER`、`kEY=JP`、`ZEro=OFF`である。
3. 実測の順序はメモリ番号、トルク、単位、合否判定、製造番号、日付、時刻の7項目である。設定または機種プロファイルを変えた場合は既存parserで推測せず、新しい実測fixtureとして扱う。
4. 初回ペアリングは対象端末で接続リースを取得した後、このRunbookに従って手動実施する。画面からペアリングしない。ペアリング後、Ansibleが完全一致した対象だけへ作る安定名を確認する。

```bash
find /dev/input/by-id -maxdepth 1 -type l -print
readlink -f /dev/input/by-id/<candidate>
```

`/dev/input/event*`、`hciN`、一般キーボードを設定してはいけない。外付けコントローラーはUSB vendor/product、レンチはBluetooth HID bustype・vendor/product・name・uniqで別々に同定し、必ず対象レンチ固有の`/dev/input/by-id/*`を使う。

ペアリングは本体電源ON後3分以内に開始する。ホスト側の登録を消した場合は、本体側のペアリング情報も消してから再登録する。`bluetoothctl`の文言だけを成功判定にせず、最終的に`Paired: yes`、`Bonded: yes`、HIDサービス解決、安定した`/dev/input/by-id/*`の全てを確認する。

レンチが複数ホストのボンドを保持できない場合は、画面ペアリング機能を追加しない。移動先で明示的にリース取得または現物確認引継ぎを行い、旧端末の外付けBluetoothがOFFになったことを確認してから、移動先で手動再ペアリングする。

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

`capture_contract`はCEM3-BTLA出力を模したものではない。`tests/fixtures/cem3_btla/`には実機由来の匿名化済み通常・連続fixtureと、それから作った明示的な派生fixtureだけを置く。正式parser profileはこの実測形だけを受理する。

### 1. 採取情報を記録する

採取日ごとに次を手元の作業記録へ残す。実製造番号をGit管理文書へ書かない。

- ファームウェア版
- 有効にした出力項目とその順序
- 単位と小数点表記
- TAB／ENTER等の終端設定
- 同じメモリを再送する実機操作の有無
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
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<normal-id> --scenario normal --expected-frames 3 --firmware '<firmware>' --output-config '<output-config-label>' --terminator enter
poetry run torque-capture capture --device /dev/input/by-id/<approved-device> --output /var/lib/torque-agent/capture-private/<rapid-id> --scenario rapid_consecutive --expected-frames 5 --firmware '<firmware>' --output-config '<output-config-label>' --terminator enter
```

同一メモリ再送操作が実機に存在する場合だけ`repeated_memory`を2件採取する。現行レンチにはその機能がないため必須にせず、synthetic capture契約とagentのeventId冪等性テストで検証する。実測した体裁のfixtureを作ってはならない。

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

`sanitize`は各置換元が1回以上存在し、置換後に実値が残らない場合だけ書き出す。実測必須は`normal`と`rapid_consecutive`である。任意の`repeated_memory`が存在する場合は2件以上を要求する。`partial`、`missing_field`、`bad_number`、`unsupported_unit`は実payloadから作る派生fixtureであり、`provenance=derived`として実測と区別する。下限・上限の合否はAPIが受信値と工程条件で判定するため、レンチが`NG_MAN`で送信を抑止するNG値を実測fixtureの必須条件にしない。

```bash
poetry run torque-capture validate \
  --fixtures tests/fixtures/cem3_btla \
  --available-device-count <1-or-2> \
  --redactions /var/lib/torque-agent/private/cem3.torque-redactions.json
git status --short
git ls-files | rg 'torque-capture-private|torque-redactions|events\.sqlite3' && exit 1 || true
```

複数実機が利用可能と記録した場合だけ`--available-device-count 2`とし、`SERIAL_A`と`SERIAL_B`の両方を必須にする。raw captureはfixture承認まで保持し、承認後もCLIから自動削除しない。保全期間や削除は別の承認済み運用判断とする。

normal 3件とrapid-consecutive 5件が揃った現行fixtureは`validate`が成功する。synthetic fixtureは引き続き`repeated_memory`を含まなければならない。

### 4. agentを再起動する

採取コマンドの終了後は、成功・失敗にかかわらずagentを明示的に戻す。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque start torque-agent
curl --fail --silent http://127.0.0.1:7073/health
```

実機fixtureのレビューでは、観測されたフィールド順、区切り、単位、終端だけを正式parserへ許可する。推測による代替形式は追加しない。

### ペアリング／HIDが成立しない場合

- 青ランプの点灯だけで成功としない。広告検出、LE接続、SMP鍵交換、`Bonded: yes`、HIDサービス解決を順に切り分ける。
- `LE Read Remote Used Features`直後の`Connection Failed to be Established (0x3e)`でSMPが一度も見えない場合はparser、API、出力設定の問題ではない。同じpair操作を無制限に繰り返さず、HCIログをGit外へ保全する。
- `Pairing successful`が表示されても`Paired/Bonded`が残らずSMP交換が無い場合は成功扱いしない。
- コントローラー設定を一時変更した場合は、標準のBR/EDR+LEと接続パラメータ、`bluetooth`、`kiosk-browser`、`lightdm`を復元してから終了する。
- 同じPi／レンチで解消しない場合は別Bluetoothコントローラーまたは取説の対応端末でA/B確認し、本体ファームウェア版も記録する。過去に同じ組合せで受信できた事実がある場合、単発の失敗だけでLinux非対応と断定しない。
- 外付けコントローラーで解消した場合も`hci1`や`event5`を保存しない。USB IDとHID identityの完全一致で安定linkを生成し、内蔵コントローラーを一括unblock・無効化しない。

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
torque_agent_bluetooth_adapter:
  usb_vendor_id: "<four-lowercase-hex>"
  usb_product_id: "<four-lowercase-hex>"
torque_agent_hid_links:
  - link_name: bluetooth-<approved-wrench>-event-kbd
    name: <exact-hid-name>
    uniq: <exact-lowercase-bluetooth-address>
    vendor_id: "<four-lowercase-hex>"
    product_id: "<four-lowercase-hex>"
torque_agent_hid_devices:
  - path: /dev/input/by-id/bluetooth-<approved-wrench>-event-kbd
    parserProfile: cem3-btla-hogp-v1
```

外付けBluetoothガードはUSB vendor/productが完全一致するコントローラーだけを操作する。`hciN`は保存せず、初期状態とリース無し状態はOFFである。内蔵BluetoothとNFCはガードの操作対象にしない。`/run/torque-bluetooth-guard/`の指示ファイルを手動作成してはいけない。

APIとキオスクWebが同originなら`torque_agent_browser_origins`は空にし、別originのときだけWeb originを明示する。`TORQUE_ENABLE_SYNTHETIC_FIXTURE`は本番で常に`false`とする。生成される`clients/torque-agent/.env`は0600で、リポジトリへ追加しない。

## 起動とヘルス確認

対象ホストを1台に限定した承認済みAnsible反映後、次を確認する。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque ps torque-agent
curl --fail --silent http://127.0.0.1:7073/health
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque logs --tail=100 torque-agent
```

`/health`の`ok=true`はプロセスが応答したことだけを表す。締付入力を開始できるのは`ready=true`のときだけであり、`ready`には有効なPi5リース、外付けBluetooth電源、対象HIDの存在、排他取得、作業画面heartbeatが全て含まれる。`queuedEvents`はAPI送信待ち、`localAuditEvents`はbinding無しまたは解析失敗でサーバーへ割り当てなかった入力である。

リースが無い状態でagentが先に起動しても異常ではない。この状態では外付けBluetoothはOFFで、`ready=false`になる。agentは有効なリースを取得した後だけ設定済みの同一by-id pathを待ち、接続後に排他取得する。切断途中の文字列は次回接続へ結合せず、新しいdecoderで再開する。

## 作業前・作業中の確認

1. REQUIRED組立作業を開き、現在の丸数字と締付条件を確認する。
2. 候補の製造番号を選び、現物の製造番号と下限・規定・上限表示を照合して確認する。
3. `このレンチを使用開始`を押す。既存確認が再利用されても、自動的には接続リースを取得しない。
4. `Bluetooth接続待ち`の間は締め付けない。`入力待機中`になった後だけ締め付ける。
5. 所有中は作業終了前に`使用終了`を押す。作業完了時は自動解放される。画面離脱時の解放に失敗しても8秒TTLで回収される。
6. 丸数字の切替後、同じ条件・同じ物理レンチ・同じ最新設定なら確認を再利用できるが、新しい使用開始操作が必要な状態では画面表示に従う。条件、レンチ、設定履歴が変わった場合は再確認する。
7. 誤レンチ、校正切れ、状態不適合、設定不一致、現在位置不一致、未対応単位、リース無し、旧世代、別端末、別セッションでは位置が進まないことを確認する。

### 別端末へ移動する

通常は元端末で`使用終了`を押し、レンチを移動先の約1m以内へ持ち出し、移動先で確認後に`このレンチを使用開始`を押す。Pi4同士が10m以内でも別フロアで100m以上離れていても操作は同じである。

元端末で終了を押し忘れた場合だけ、移動先で表示された所有端末名・場所を確認し、`現物が手元にあるため引き継ぐ`を二段階で確定する。旧世代は即時fenceされるが、移動先のBluetoothは旧リース期限＋1秒までONにならない。旧端末の画面は自動再取得しない。

最初の作業1件をウォームアップとして捨ててはいけない。最初のフレームが欠けた場合は作業を進めず、`HID_DECODE_FAILED`または不完全captureとして原因を確認する。

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
- `CONNECTION_LEASE_REQUIRED`: 強制有効化後にリース無しで届いた入力である。使用開始操作とagentのリース状態を確認する。イベントは監査保存され、工程は進まない。
- `CONNECTION_LEASE_FENCED`: 引継ぎ後の旧世代イベントである。再送を止めるためAPIは業務拒否をHTTP 200でackする。旧画面から自動再取得せず、新しい使用開始操作を行う。
- `通信断`または`ready=false`: Pi5更新、ガード電源、HID存在、排他取得のいずれかが成立していない。9秒以内に外付けBluetoothがOFFになることを優先し、復旧前の締付入力は行わない。

## 安全な再起動

SQLite volumeを維持したままagentだけを再起動する。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque restart torque-agent
curl --fail --silent http://127.0.0.1:7073/health
```

再起動後、未送信イベントは同じイベントIDで再送される。2xx確認後だけoutboxから消える。

Pi再起動では`/run`のリース指示が消えるため、外付けBluetoothはOFFのまま起動する。作業画面で現物確認と新しい使用開始操作を行うまでONにしてはいけない。

## 切戻し

異常時は締付作業を止め、対象端末のagentだけを停止する。API、既存DB、他エージェントは変更しない。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml --profile torque stop torque-agent
sudo systemctl status torque-bluetooth-guard --no-pager
```

停止後9秒以内に外付けBluetoothがOFFになることを確認する。volumeやSQLiteを削除しない。管理者例外入力は通信経路の代替であり、誤レンチ・校正・状態・設定や接続リースの安全条件を迂回できない。復旧後は現物確認と使用開始をやり直し、拒否実績とローカル監査を照合する。

接続リース強制を有効にする公開APIはADMIN／MANAGER専用・理由必須で、一方向である。Release Aの単独StoneBase試験とlease-capable rollback基準を確認する前にactivation gateを開けない。有効化後は旧legacy版へ直接戻さず、やむを得ない場合は先に両端末のtorque-agentを停止する。

## 2端末実機受入（工場で実施）

この節はレンチ、StoneBase、Assembly-01、Pi5へ接続できる状態で、配備・ペアリング・有効化の個別承認後に実施する。自宅やレンチ不在時には実施済みにしない。

1. enforcement未有効のRelease Aで、StoneBaseだけの従来トルク登録を確認する。
2. 両端末がBluetooth圏内でも、所有端末の外付けBluetoothだけがONになることを確認する。
3. StoneBaseで使用終了し、Assembly-01へ移動して使用開始・接続・登録を確認する。
4. 終了押し忘れを再現し、現物確認引継ぎでStoneBaseのOFF後にAssembly-01がONになることを確認する。
5. Assembly-01からStoneBaseへの通常切替と引継ぎを確認する。
6. 別フロアへ移動して同じ操作が成立することを確認する。
7. Pi5通信を遮断し、9秒以内の外付けBluetooth OFF、接続解除、入力停止を確認する。
8. 両Piを再起動し、リース無しでは外付けBluetoothがOFFのままであることを確認する。
9. 上記がすべて成功した後だけ、別承認で対象レンチのenforcementを有効化し、リース無し入力の拒否監査を確認する。

## 関連資料

- [クライアント Docker agent 追加 Runbook](client-agent-addition.md)
- [複数端末接続リースExecPlan](../plans/assembly-torque-wrench-connection-lease-execplan.md)
- [複数端末接続リースADR](../decisions/ADR-20260722-assembly-torque-wrench-connection-lease.md)
- [実装・検証ExecPlan](../plans/assembly-torque-wrench-traceability-execplan.md)
- [設計判断ADR](../decisions/ADR-20260717-assembly-torque-wrench-traceability.md)
- [組立トルク管理の現仕様](../plans/kiosk-assembly-torque-management-mvp.md)
- [torque-agent README](../../clients/torque-agent/README.md)
