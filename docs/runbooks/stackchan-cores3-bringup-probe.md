# StackChan CoreS3 bring-up probe（最小ファーム）

最終更新: 2026-07-05

## 運用ステータス: **全面停止**

**StackChan 実機への probe / `AI_StackChan_Ex` upload は当面すべて停止する。追加 flash は行わない。**

実機は **公式 StackChan-UserDemo-V1.4.1** のまま保持する（ハード故障ではないことを目視確認済み）。

### 確定事項（2026-05-31）

| 項目 | 結論 |
|------|------|
| 公式ファーム | **StackChan-UserDemo-V1.4.1** — `erase_flash` + `write_flash` @ 0x0 後、**画面表示できる**（ハード正常） |
| Step B | **以前一度**「CoreS3 probe B」等が表示できた。その**後**はシリアル・SD・3 YAML 正常でも **画面真っ黒** |
| E1 | **m5stack-avatar なし**・M5Unified + `M5Canvas` 単純描画のみでも **真っ黒**（brightness=255、createSprite OK） |
| 原因の切り分け | **m5stack-avatar 単体が主因ではない** |
| 疑う層 | `AI_StackChan_Ex` / probe の **PlatformIO 設定**、**M5Unified**、**board（esp32s3box）**、**Arduino core**、**LCD/backlight 初期化**、**flash / partition / boot 状態** のいずれかの **表示互換性問題** |
| 再 upload 禁止 | **full `AI_StackChan_Ex`**、**safe mode**、**voice overlay**、**utterance overlay**、**bring-up probe 全般** |

### 禁止（継続）

- 上記 **再 upload 禁止** 一覧のすべて
- 理由のない **erase / write**（公式復旧済みの状態を壊さない）
- probe 再開は **別途意思決定・Runbook 更新後**のみ

### 再開検討の差分分析（2026-07-05・build-only）

**結論**: 最新 `AI_StackChan_Ex` の `m5stack-cores3` build-only は成功したが、実機 upload 停止は継続する。M5Unified/M5GFX 側に `board_M5StackChan` 対応が入ったことは前進だが、公式 StackChan 系の電源・表示初期化との差分がまだ残るため、build-only 成功だけでは ADR-20260531 を解除しない。

| 項目 | 2026-05-31 probe | 2026-07-05 `AI_StackChan_Ex` | 公式 StackChan 系 | 判定 |
|------|------------------|------------------------------|-------------------|------|
| build | probe build/upload 済み、再確認で黒画面 | `pio run -e m5stack-cores3` **SUCCESS** | 公式 UserDemo は 2026-05-31 に表示復旧済み | build-only は前進。upload 許可ではない |
| upstream commit | local probe | `ronron-gh/AI_StackChan_Ex` `b5322e0795b2d8b17acfa65953b0194fe75b7dc1` | `stack-chan/stack-chan` develop `e33094a4e9688318823a5775979a2620d49d0c0e` も参照 | 参照元は固定済み |
| PlatformIO / framework | `espressif32@6.3.2`, Arduino | `espressif32@6.3.2`, Arduino framework `3.20009.0` | UserDemo は IDF/LVGL 系。現在公式 develop は Moddable `m5stackchan_cores3` platform | 公式表示経路とは別物 |
| board | `esp32s3box` | `esp32s3box` + `-DARDUINO_M5STACK_CORES3` | 公式 develop は `m5stackchan_cores3` subplatform | PlatformIO board 差は残る |
| partition | `my_cores3_16MB.csv` | `my_cores3_16MB.csv` | 公式 web flash は `bootloader.bin` @ 0, `partition-table.bin` @ 0x8000, `xs_esp32.bin` @ 0x10000 | 実機状態への影響は未検証 |
| M5Unified / M5GFX | M5Unified `0.2.7` | M5Unified `0.2.15`, M5GFX `0.2.24` | UserDemo は M5Unified 不使用。現在公式 develop は Moddable target | M5Unified 側は改善 |
| StackChan board detection | なし | M5GFX が `board_M5StackChan` を自動判定。GC0308 + M5IOE1 `0x6F` fw `>=0x04` で StackChan 判定 | 公式 develop は `m5stackchan_cores3` platform | 改善。ただし実機未確認 |
| LCD / backlight | `M5.Display`, `M5Canvas`, `setBrightness()` | M5GFX `Panel_M5StackCoreS3` + `Light_M5StackCoreS3` 経路 | UserDemo は IlI9342/LVGL/専用 HAL。公式 develop は追加 AXP2101 power patch を持つ | 差分あり。ここが主ゲート |
| AXP2101 power rails | probe 側は明示 patch なし | M5GFX が `0x90`, `0x94`, `0x95`, `0x99` 等を扱う | 公式 develop `setup-target.js` は `0x90`, `0x97`, `0x69`, `0x30`, `0x94`, `0x95`, `0x27`, `0x62` を patch | 公式側の電源初期化がより広い |

#### build-only 実測（2026-07-05）

```bash
cd /private/tmp/AI_StackChan_Ex-spark-restart/firmware
env PLATFORMIO_CORE_DIR=/private/tmp/pio-core pio run -e m5stack-cores3
```

結果:

```text
Environment     Status    Duration
--------------  --------  ------------
m5stack-cores3  SUCCESS   00:04:24.450
```

サイズ:

```text
RAM:   21.1% (used 68996 bytes from 327680 bytes)
Flash: 39.0% (used 2558133 bytes from 6553600 bytes)
firmware.bin: 2.4M
```

依存:

```text
Platform espressif32 @ 6.3.2
framework-arduinoespressif32 @ 3.20009.0
M5Unified @ 0.2.15
M5GFX @ 0.2.24
stackchan-arduino @ 0.0.7+sha.b7b98f5
ArduinoJson @ 7.4.3
ESP8266Audio @ 1.9.9
YAMLDuino @ 1.5.0
FastLED @ 3.10.3
```

#### upload 再開条件（2026-07-05 時点）

upload 再開を検討する場合でも、以下をすべて満たすまで実機へ書き込まない。

1. 公式ファームの現時点表示を目視確認する。
2. build-only 成功ログと依存バージョンを ExecPlan に記録する。
3. 上記 AXP2101 power rail / LCD init 差分を reviewer に確認させる。
4. 最初の flash 候補は custom overlay なしの upstream `AI_StackChan_Ex` `m5stack-cores3` に限定する。
5. user が「この候補を flash してよい」と明示承認する。
6. upload 後に黒画面化したら追加実験を止め、公式ファーム復旧へ戻す。

---

## 目的（参考・履歴）

`AI_StackChan_Ex` 本体を焼く前に、**画面・USB Serial・SD マウント**だけを CoreS3 実機で確認する計画だった。
2026-05-31 時点で **probe 経路の表示は未解決のため停止**。

## 成果物（リポジトリ内・**upload 停止中**）

| パス | 内容 |
|------|------|
| `cores3-probe/` | Step A/B — SD + YAML + `M5.Display` テキスト |
| `cores3-probe-stepc/` 〜 `stepc3/` | Step C 系 Avatar 切り分け |
| `cores3-probe-stepe/` 〜 `stepe2/` | Step E 系 単発描画切り分け |
| `fixtures/sd/yaml/SC_BasicConfig.yaml` | 最小 `SC_BasicConfig` 正本 |
| `mac_usb_cores3_probe*.sh` | build / upload / monitor ラッパ |

`env:m5stack-cores3-probe` は upstream `m5stack-cores3` と同型の **PlatformIO 設定**（下記）。Wi‑Fi・LLM・Servo・WakeWord は含まない。

### PlatformIO 共通（probe 全 env）

```ini
platform = espressif32@6.3.2
board = esp32s3box
framework = arduino
board_build.arduino.memory_type = qio_qspi
board_build.arduino.partitions = my_cores3_16MB.csv  ; cores3-probe/ 配下
board_build.f_flash = 80000000L
build_flags = -DBOARD_HAS_PSRAM -DARDUINO_M5STACK_CORES3
lib_deps (Step B) = M5Unified@0.2.7, ArduinoJson, YAMLDuino
```

**公式 UserDemo との差**: 公式は **ESP-IDF v5.5** + **stack-chan 専用 HAL**（IlI9342、LVGL、`StackChanAvatarDisplay`、AXP 経由バックライト）。probe は **Arduino + M5Unified の汎用 `M5.Display`** 経路。

### 時系列サマリ（2026-05-31 確定）

| Phase | 結果 |
|-------|------|
| Step B 初回 | 画面 **OK**（歴史） |
| Step C〜E1 | シリアル多くは正常、目視 **真っ黒** |
| Step B 再確認 | シリアル **3/3 YAML OK**、目視 **真っ黒** |
| 公式 UserDemo V1.4.1 | erase + write @0x0、目視 **OK** |
| **以降** | **probe / AI_StackChan_Ex upload 禁止** |

## Step A — build のみ（Mac）

```bash
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe.sh build
```

## Step B — SD 設定 YAML（build のみ・upload は許可後）

`AI_StackChan_Ex` と同じ SD パスを **存在確認 + YAML パース**（失敗時も **再起動しない**）。

| ラベル | パス |
|--------|------|
| SC_ExConfig | `/app/AiStackChanEx/SC_ExConfig.yaml` |
| SC_SecConfig | `/yaml/SC_SecConfig.yaml` |
| SC_BasicConfig | `/yaml/SC_BasicConfig.yaml` |

```bash
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe.sh build
```

画面・Serial に各項目の **OK/FAIL** を表示（Step A の SD マウントも含む）。

#### Step B 再確認（2026-05-31・E1 FAIL 後）

| 項目 | シリアル |
|------|----------|
| SD | **OK** |
| SC_ExConfig / SC_SecConfig / SC_BasicConfig | **exists=yes yaml=OK**（3/3） |
| assert / 再起動 | **なし**（38 秒） |
| 目視 | **真っ黒**（シリアル・SD・3 YAML は正常）→ **probe 継続停止** |

## probe 停止（2026-05-31）

- Step B は **以前は表示できていた**が、再確認でも **目視真っ黒**。
- E2 / Step C 系 / `AI_StackChan_Ex` 本体 upload は **行わない**。
- 次は **公式ファーム（M5Burner / UserDemo bin）で表示基準点に復旧**してから判断。

## 公式ファーム復旧（2026-05-31）

| 手順 | 結果 |
|------|------|
| `erase_flash` | **成功**（ESP32-S3、約 6.5s） |
| `StackChan-UserDemo-V1.4.1.bin` @ 0x0 | **成功**（12,783,792 B、Hash verified） |
| シリアル（書込直後） | **stack-chan 1.4.1** 起動、IlI9342/LVGL/`Turning display on`、Backlight **75** |
| 目視（USB 抜き差し後） | **CONFIRMED** — 公式 UI 表示。ハード故障ではない |
| 以降 | 実機は **公式ファームのまま保持**。probe / コミュニティ firmware の **追加 flash 禁止** |

```bash
# 実施済み（参考）
python3 .../esptool.py --port /dev/cu.usbmodem1101 --baud 921600 erase_flash
python3 .../esptool.py ... write_flash -z --flash_mode dio --flash_freq 80m --flash_size detect \
  0x000 /path/to/StackChan-UserDemo-V1.4.1.bin
```

`/yaml/SC_BasicConfig.yaml` が無い SD では、probe が **fixtures と同じ最小 YAML を 1 回だけ自動作成**（既存は上書きしない）。手動配置の正本は [`fixtures/sd/yaml/SC_BasicConfig.yaml`](../../scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_BasicConfig.yaml)。

## Step C — Avatar-only（**実機目視 FAIL**・Step D へ進まない）

| 項目 | 結果 |
|------|------|
| シリアル | `avatar: init OK`、再起動ループなし |
| 画面 | **真っ黒**（probe テキストも顔も見えない） |

| パス | 内容 |
|------|------|
| `cores3-probe-stepc/` | GitHub `m5stack-avatar` v0.8.2 + `avatar.init(16)` |
| `mac_usb_cores3_probe_stepc.sh` | build / upload / monitor |

Wi‑Fi / ChatGPT / WebAPI / WakeWord / Servo タスク / voice overlay は含まない。

## Step C1 / C2 / C3 — Avatar 原因切り分け（build のみ・upload は許可後）

| Step | ディレクトリ | 差分の要点 |
|------|--------------|------------|
| **C1** | `cores3-probe-stepc1/` | `avatar.init()`（既定 `colorDepth=1`）。GitHub v0.8.2 |
| **C2** | `cores3-probe-stepc2/` | `avatar.init(16)` のまま、**1 秒周期**で `setBrightness(128)` + `fillScreen` + テキスト再描画（Avatar が黒で上書きするか確認） |
| **C3** | `cores3-probe-stepc3/` | **`AI_StackChan_Ex/firmware/lib/m5stack-avatar`**（ローカル vendored）+ `init(16)` |

共通: Wi‑Fi / SD / ChatGPT / WebAPI / WakeWord / Servo / voice **なし**。

```bash
# C1
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepc_sub.sh c1 build

# C2
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepc_sub.sh c2 build

# C3（要 AI_StackChan_Ex クローン）
export STACKCHAN_AI_STACKCHAN_EX="${STACKCHAN_AI_STACKCHAN_EX:-$HOME/AI_StackChan_Ex}"
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepc_sub.sh c3 build
```

**C3 のライブラリ出所**: `$STACKCHAN_AI_STACKCHAN_EX/firmware/lib/m5stack-avatar`（`library.json` の version は **0.8.2**。AI_StackChan_Ex 本家ファームと同じ vendored コピー）。

**upload 推奨順（目視切り分け）**: ~~C1~~ **FAIL** → **C2 → C3**。C2 で Avatar 描画タスクの上書きを観察。C3 は本番と同じ lib。

### Step C1 — **FAIL**（2026-05-31）

| 項目 | 結果 |
|------|------|
| 実機目視 | **画面真っ暗** |
| シリアル | `avatar: init OK` 直後 **`xQueueGenericSend` assert** → **再起動ループ**（35 秒で boot バナー約 20 回） |
| 結論 | CoreS3 では **`avatar.init()` / `colorDepth=1` は採用しない**（本番を `init()` に寄せない） |

### Step C2 — **FAIL**（2026-05-31）

| 項目 | 結果 |
|------|------|
| 実機目視 | **画面真っ暗** |
| シリアル | `overlay: tick=2,3` のあと **`xQueueGenericSend` assert** → **再起動ループ** |
| backtrace | `loop()` → `redrawProbeOverlay()` → `fillScreen` と Avatar `drawLoop` の **M5.Display 同時アクセス** |
| 方針 | **M5.Display を Avatar と別タスクから無ロック共有しない**（loop からの `fillScreen` 上書きテストは再実施しない） |
| 解釈 | 1Hz 上書き probe は競合で落ちるため、「黒塗り上書き」の切り分けには使えない。Step C（loop 描画なし）を基準に C3 へ |

### Step C3 — **FAIL**（2026-05-31）

| 項目 | 結果 |
|------|------|
| lib | `$STACKCHAN_AI_STACKCHAN_EX/firmware/lib/m5stack-avatar`（vendored） |
| シリアル（38 秒） | boot **1 回**、`init OK`、**assert / 再起動なし** |
| 実機目視 | **画面真っ黒** |
| 結論 | **GitHub v0.8.2 と vendored の差分は黒画面の主因ではない** |

### Step E — 単発描画（Avatar タスクなし・build のみ）

| パス | 内容 |
|------|------|
| `cores3-probe-stepe/` | setup() 内で (1) 単純スプライト probe (2) `Avatar::draw()` 1 回（**`init()` なし**） |
| `mac_usb_cores3_probe_stepe.sh` | build / upload / monitor |

`M5.Display` を **loop / Avatar タスクから触らない**。Wi‑Fi / SD / LLM / Servo / voice なし。

```bash
export STACKCHAN_AI_STACKCHAN_EX="${STACKCHAN_AI_STACKCHAN_EX:-$HOME/AI_StackChan_Ex}"
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepe.sh build
```

### Step E — **FAIL**（2026-05-31）

| 項目 | 結果 |
|------|------|
| 実機目視 | **画面真っ黒** |
| シリアル | 320×240、brightness=128、createSprite **OK**、pushSprite done、Face::draw done、**assert/再起動なし** |
| 結論 | **スプライト未表示 vs Face 黒上書きは未分離** → E1/E2 に分割 |

### Step E1 — 単純スプライトのみ（build のみ・upload 許可後）

| パス | 内容 |
|------|------|
| `cores3-probe-stepe1/` | M5Unified のみ（**m5stack-avatar なし**）、スプライト + 直接テキスト |
| `mac_usb_cores3_probe_stepe1.sh` | build / upload / monitor |

**目視**: SPRITE OK が見える → 表示経路正常・Face が黒上書き。真っ黒 → M5Unified/ボード設定側（Step A/B との差分調査）。

#### Step E1 — **FAIL**（2026-05-31）

| 項目 | 結果 |
|------|------|
| 実機目視 | **画面真っ黒** |
| シリアル | 320×240、brightness=**255**、createSprite **OK**、pushSprite done、**assert/再起動なし** |
| 結論 | **m5stack-avatar は原因ではない**。**E2 は upload しない** |

#### Step E2 — **保留**（E1 FAIL のため upload 見送り）

### Step E2 — Face::draw のみ（build のみ・E1 目視後に upload 判断）

| パス | 内容 |
|------|------|
| `cores3-probe-stepe2/` | vendored avatar、`init()` なし、`delay(3000)` 後に `Face::draw` 1 回 |
| `mac_usb_cores3_probe_stepe2.sh` | build / upload / monitor |

```bash
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepe1.sh build

export STACKCHAN_AI_STACKCHAN_EX="$HOME/AI_StackChan_Ex"
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe_stepe2.sh build
# E2 upload は E1 目視後
```

## Step A — upload（許可後）

```bash
STACKCHAN_USB_PORT=/dev/cu.usbmodem1101 \
  ./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe.sh upload
```

シリアル:

```bash
./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe.sh monitor
```

### 期待

- 画面: **CoreS3 probe OK**（SD 失敗時は副行に `SD: FAIL`）
- Serial: `=== CoreS3 probe boot ===` / `sd: OK` または `sd: FAIL`
- SD ピン: `GPIO_NUM_4`, `SPI`, `25000000`（`AI_StackChan_Ex` の `main.cpp` / `SDUtil.cpp` と同じ）

### USB Serial が見えない場合

```bash
STACKCHAN_PROBE_PIO_ENV=m5stack-cores3-probe-usbcdc \
  ./scripts/stackchan-ai-stackchan-ex/mac_usb_cores3_probe.sh build
```

## 段階ロードマップ（この Runbook の後）

| Step | 内容 |
|------|------|
| A | 本 probe（画面・Serial・SD） |
| B | `SC_ExConfig.yaml` 等の SD 設定読込のみ |
| C | Avatar のみ — **FAIL（黒画面）** |
| C1–C3 | Avatar 切り分け — **すべて FAIL** |
| E | 単発描画（Avatar タスクなし・`Face::draw` / スプライト） |
| D | `chat/simple` safe mode — **停止（実施しない）** |
| （旧計画）voice overlay | **停止（実施しない）** |

## 実機が真っ黒のとき（公式復旧）

1. USB 抜く → 電源長押し OFF → 5 秒 → USB 挿し直し → 電源短押し
2. 改善なし → **M5Burner** で公式ファーム（esptool 単体 bin より優先）
3. 画面復旧後、上記禁止を守ってから probe を検討

## References

- [ADR-20260531-stackchan-cores3-probe-display-halt.md](../decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md)
- [stackchan-ai-stackchan-ex README](../../scripts/stackchan-ai-stackchan-ex/README.md)
- [KB-stackchan-community-firmware-supply-chain.md](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
- [stackchan-community-text-only-e2e.md](./stackchan-community-text-only-e2e.md)
