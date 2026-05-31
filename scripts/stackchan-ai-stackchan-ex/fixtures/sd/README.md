# StackChan SD カード用フィクスチャ（bring-up）

`AI_StackChan_Ex` の SD レイアウトに合わせた最小ファイルです。

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
