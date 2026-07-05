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

### 自動配置スクリプト（Mac + 取り外した SD）

[`../../prepare-spark-sd.sh`](../../prepare-spark-sd.sh) は `/Volumes/<SD_VOLUME_NAME>` 配下だけを書き込む。実値は環境変数で渡し、標準出力には endpoint やボリューム名を出さない。**デフォルトは dry-run**（`STACKCHAN_SD_APPLY=1` で実書き込み）。既存 `SC_ExConfig.yaml` / `SC_SecConfig.yaml` がある場合は `STACKCHAN_SD_OVERWRITE=1` が必要（上書き前に `.bak.<timestamp>` を作成）。

**Operator 手順（2 段階・ローカルターミナルのみ）**

1. **Phase A（dry-run）**: `STACKCHAN_SD_APPLY` は**未設定**のまま `prepare-spark-sd.sh` を実行。`[DRY-RUN]` のみ出ることを確認。
2. **Phase B（apply）**: Phase A 確認後、`STACKCHAN_SD_OVERWRITE=1`（既存 YAML がある場合）と `STACKCHAN_SD_APPLY=1` を付けて再実行。汎用 `[OK]` のみ期待。
3. agmsg/チャットへボリューム名・IP・SSID・パスワード・token・生成 YAML を貼らない。

`wifi.txt` は書き込まない（`yaml/SC_SecConfig.yaml` を正とする。旧 runbook の `wifi.txt` 併記は bring-up 安定化用の別経路）。

## Scope-2 voice prep (STT_BRIDGE, build-only)

Prep-only patch in repo (no SD write, no upload until separate review):

- Patch script: [`../../apply_stt_private_bridge.py`](../../apply_stt_private_bridge.py) — idempotent `CloudSpeechClient.cpp` change; `--revert` removes `/* STT_BRIDGE_PATCH_* */` blocks.
- Build flags (operator-local placeholders only):
  `STT_BRIDGE_URL=http://<PRIVATE_PI5_LAN_IP>:18080/api/stackchan/stt`
  optional `STT_BRIDGE_STACKCHAN_TOKEN` if bridge enforces token.
- When `STT_BRIDGE_URL` is empty/unset at build time, upstream Google STT path is unchanged.
- SD `llm.type: 4` / `customEndpoint` stays as text-only proof; no utterance overlay.
- Rollback: `apply_stt_private_bridge.py --revert` on firmware tree, or reflash current known-good binary; stop on black screen / serial loss / display regression.
- Upload requires separate reviewer approval (masked flags, artifact, serial watch plan).

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
