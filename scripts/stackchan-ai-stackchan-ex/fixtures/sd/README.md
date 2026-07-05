# StackChan SD カード用フィクスチャ（bring-up）

`AI_StackChan_Ex` の SD レイアウトに合わせた最小ファイルです。

## Spark / private Pi5 bridge テンプレート

| 項目 | 値 |
|------|-----|
| LLM 設定テンプレート | [`app/AiStackChanEx/SC_ExConfig.spark.template.yaml`](./app/AiStackChanEx/SC_ExConfig.spark.template.yaml) |
| 秘密設定テンプレート | [`yaml/SC_SecConfig.spark.template.yaml`](./yaml/SC_SecConfig.spark.template.yaml) |
| LLM endpoint | `http://<PRIVATE_PI5_LAN_IP>:18080/v1/chat/completions` |
| LLM type | `4`（OpenAI-compatible Chat Completions） |

### 手動配置（Spark / private Pi5 bridge）

1. StackChan から **microSD を取り外す**
2. Mac のカードリーダーに挿す（FAT32）
3. テンプレートを SD にコピーし、プレースホルダーだけ置き換える:

```bash
VOL="/Volumes/<SDボリューム名>"
mkdir -p "$VOL/app/AiStackChanEx" "$VOL/yaml"
cp scripts/stackchan-ai-stackchan-ex/fixtures/sd/app/AiStackChanEx/SC_ExConfig.spark.template.yaml \
  "$VOL/app/AiStackChanEx/SC_ExConfig.yaml"
cp scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_SecConfig.spark.template.yaml \
  "$VOL/yaml/SC_SecConfig.yaml"
```

`SC_ExConfig.yaml` の `<PRIVATE_PI5_LAN_IP>` は private Pi5 の現在の LAN IP または互換 alias に置き換える。`SC_SecConfig.yaml` の `apikey.aiservice` は `STACKCHAN_TOKEN` を bridge 側で設定する場合だけ同じ値にする。bridge 側で token を使わない場合は dummy 文字列でよい。

DGX / Spark の URL や token は SD に置かない。StackChan が知るのは private Pi5 の LAN URL だけにする。

## SC_BasicConfig.yaml

| 項目 | 値 |
|------|-----|
| 配置先（SD ルート相対） | `/yaml/SC_BasicConfig.yaml` |
| 正本 | [`yaml/SC_BasicConfig.yaml`](./yaml/SC_BasicConfig.yaml) |

### 手動配置（推奨）

1. StackChan から **microSD を取り外す**
2. Mac のカードリーダーに挿す（FAT32）
3. ボリューム直下に `yaml` フォルダを作り、本ファイルをコピー:

```bash
VOL="/Volumes/<SDボリューム名>"
mkdir -p "$VOL/yaml"
cp scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_BasicConfig.yaml "$VOL/yaml/"
```

4. SD を戻して電源 ON

### bring-up 時の自動配置（Step B probe）

`cores3-probe` は **`/yaml/SC_BasicConfig.yaml` が無いときだけ**、上記と同じ内容を SD に書き込みます（既存ファイルは上書きしません）。シリアルに `provisioned minimal SC_BasicConfig.yaml` と出ます。
