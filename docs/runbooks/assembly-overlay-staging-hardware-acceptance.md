---
title: 組立手順書 Overlay staging 受入・性能計測 Runbook
status: active
scope: staging-only AssemblyProcedureDocument editor, kiosk view, ROI/Poppler/OCR measurement
last_verified: 2026-08-22
source_of_truth: docs/runbooks/assembly-overlay-staging-hardware-acceptance.md
related_docs:
  - ../guides/deployment.md
  - ./pi5-blue-green-deploy.md
  - ./deploy-status-recovery.md
  - ../../scripts/perf/measure-kiosk-perf.mjs
  - ../../scripts/perf/measure-kiosk-documents-api.mjs
---

# 組立手順書 Overlay staging 受入・性能計測 Runbook

このRunbookは、組立手順書（`AssemblyProcedureDocument`）の編集・公開と、公開済み手順書のキオスク表示を、**専用stagingだけ**で受け入れるための正本である。対象はMacからstaging URLを操作する確認、Pi4/Pi5の観測、および許可されたstaging fixtureの後片付けに限る。

> **今回の作業では実行禁止:** deploy、rollback、SSH、Docker操作、DB操作、実機への接続、production/TalkPlazaへの接続は行わない。今回実施できるのは、ローカルのinventory境界・構文・契約検証と、この手順書の整備だけである。

## 0. 境界と前提

- 対象SHAはCI成功済みの40文字SHAを一つだけ指定する。ローカルのfeature worktreeのHEADや未コミット差分をデプロイ証拠にしない。
- stagingのinventoryは `infrastructure/ansible/inventory-staging.yml`、変数は `infrastructure/ansible/group_vars/staging.yml` と専用private host varsを使う。productionの `inventory.yml`、TalkPlazaの `inventory-talkplaza.yml`、本番DB/asset path/credentialは使わない。
- 現在コミットされているstaging boundaryは `staging_deploy_enabled: false` と placeholder hostである。専用Pi5/Pi4、private vars、承認済みSHAが揃うまで、実行可能なstaging deployとして扱わない。
- stagingのDB名、Docker compose project、network、storage rootはproductionと別であることをplanで確認する。少しでも一致または未解決なら停止する。
- access password、`x-client-key`、JWT、Vault、API responseのsecretは、approved secret managerまたは既存のキオスク設定からその場で注入する。ファイル、shell history、TSV、screenshotへ保存しない。
- `scripts/ci/run-deploy-contracts-local.sh` はproduction/TalkPlaza inventoryも構文検証対象にするため、この受入では実行しない。必要なstaging boundary検証だけを下記のコマンドで行う。

受入担当は次の値を承認済みのstaging情報で置き換える。値はfixture専用とし、productionのIDやURLを入れない。

```bash
export STAGING_WEB_BASE='https://<approved-staging-host>'
export STAGING_API_BASE="${STAGING_WEB_BASE}/api"
export STAGING_INVENTORY='infrastructure/ansible/inventory-staging.yml'
export STAGING_LIMIT='staging-pi5:staging-pi4-kiosk01'
export STAGING_CLIENT_KEY='<injected-staging-client-key>'
export TEST_SOURCE_DOCUMENT_ID='<published-staging-source-document-id>'
export TEST_DRAFT_DOCUMENT_ID='<staging-draft-document-id>'
export TEST_WORK_SESSION_ID='<staging-work-session-id>'
export EVIDENCE_DIR="<approved-local-evidence-dir>/<run-id>"
```

`STAGING_ACCESS_PASSWORD` は環境変数へ長時間残さず、承認済みのsecret injectionまたは対話入力で一時利用する。

### 未確定4情報（接続前に必ず埋める）

| # | 未確定情報 | 記録する値 | 未確定のままの扱い |
|---:|---|---|---|
| 1 | 端末到達先 | 各Pi4/Pi5のTailscale/DNS名または固定IP、inventoryのhost名との対応 | 接続・plan・deployをしない |
| 2 | SSH identity | staging専用SSH user、鍵の保管/受渡し経路、標準Ansible executorからの到達可否 | SSH/接続確認をしない |
| 3 | DB / storage | staging専用DBの新設場所・方式、asset/storage root、productionとの分離 | fixture投入・ROI/OCR POSTをしない |
| 4 | secret経路 | Vault値の受渡し方法、既存標準password file経路の利用可否、client/access key注入元 | secretをコピーせず停止 |

release SHA/CI artifact、test fixture ID、approver/window/evidence dir、CPU/memory/temp/RSS閾値は、この4項目とは別の受入前提として全て埋める。

### 接続前 checklist

- [ ] 作業対象は `inventory-staging.yml` と明示されたstaging hostだけで、`inventory.yml` / `inventory-talkplaza.yml` / TalkPlaza URLが混ざっていない。
- [ ] staging専用DB、compose project、Docker network、storage root、client key、access passwordの注入元を確認した。secret本文はMacへ保存していない。
- [ ] exact SHA、CI成功、artifact digest、rollback evidence、approver、window、evidence dir、resource thresholdsを記録した。
- [ ] `git status --short` と `git diff --check` を実施し、feature worktreeの既存変更をdeploy証拠にしないと確認した。
- [ ] staging boundary test、inventory graph/list、playbook syntax-checkがmanaged hostへの接続なしでPASSした（または不足原因を記録した）。
- [ ] このRunbookの作業では実機接続、`--detach`、rollback、merge、commit、pushを実行しないと確認した。

## 1. read-only inventory / plan

### 1.1 ローカル境界確認

Macから次だけを実行する。いずれもmanaged hostへ接続しない。

```bash
python3 -m unittest scripts/ci/tests/test_staging_inventory_boundary.py

ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg \
ANSIBLE_VAULT_PASSWORD_FILE=infrastructure/ansible/.vault-pass.example \
ansible-inventory -i infrastructure/ansible/inventory-staging.yml --graph

ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg \
ANSIBLE_VAULT_PASSWORD_FILE=infrastructure/ansible/.vault-pass.example \
ansible-inventory -i infrastructure/ansible/inventory-staging.yml --list \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("server=" + ",".join(d.get("server",{}).get("hosts",[]))); print("kiosk=" + ",".join(d.get("kiosk",{}).get("hosts",[])))'

ANSIBLE_CONFIG=infrastructure/ansible/ansible.cfg \
ANSIBLE_VAULT_PASSWORD_FILE=infrastructure/ansible/.vault-pass.example \
ANSIBLE_ROLES_PATH=infrastructure/ansible/roles \
ansible-playbook -i infrastructure/ansible/inventory-staging.yml \
  infrastructure/ansible/playbooks/deploy-release-standard.yml --syntax-check \
  --extra-vars '{"release_sha":"0000000000000000000000000000000000000000","release_run_id":"syntax-check","release_pi5_api_image":"unused:syntax","release_pi5_web_image":"unused-web:syntax","release_signage_artifact_sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
```

`.vault-pass.example` は、暗号化secretを読むためではなく、repositoryのAnsible configが要求するpassword-fileをredacted validationで満たすためだけに使う。実際のVault passwordやprivate host varsはMacへコピーしない。構文確認で `signage` が見つからないというwarningが出る場合は、staging inventoryがPi5/Pi4専用であることを記録し、managed hostへ接続せず終了する。

### 1.2 print-plan → 承認 → 実行

専用Pi5/Pi4が provision 済みで、private varsの存在を内容非参照で確認でき、かつ別途承認された場合だけ、canonical wrapperのplanを作る。`--print-plan` はinventoryとAnsibleの `--list-hosts` / `--list-tasks` だけを実行し、remote host/runtimeを変更しない。ただしbranchのexact SHA解決のためGit originへ問い合わせる。

```bash
mkdir -p "$EVIDENCE_DIR"
scripts/update-all-clients.sh <approved-branch> "$STAGING_INVENTORY" \
  --print-plan --limit "$STAGING_LIMIT" \
  | tee "$EVIDENCE_DIR/print-plan.json"
shasum -a 256 "$EVIDENCE_DIR/print-plan.json" > "$EVIDENCE_DIR/print-plan.sha256"
```

plan JSONの次を、CI artifact manifestと二人以上の承認者が照合する。

| 項目 | 合格条件 |
|---|---|
| `releaseSha` | 承認済みCI成功SHAと完全一致 |
| `inventory` / `limit` | `inventory-staging.yml` と専用Pi5/Pi4だけ。暗黙の全fleetでない |
| `executionOrder` | Pi5/Pi4 profile、host、image identityが想定どおり |
| runtime path | `/opt/RaspberryPiSystem_002-staging`、`raspisys-staging-*`、`borrow_return_staging` 等がproductionと分離 |
| rollback | `release_pi5` / `release_kiosk` のrole内rescue rollbackとhealth確認がplan/CI証跡にある |
| approval | operator、approver、plan hash、SHA、artifact digest、target、時刻を記録 |

現状の `staging_deploy_enabled: false`、placeholder host、未解決private varsのままplanを通そうとしない。別途承認された場合の実行コマンドは次の形だが、**今回の作業では実行しない**。

```bash
# 承認後の別作業でのみ実行。今回禁止。
scripts/update-all-clients.sh <approved-branch> "$STAGING_INVENTORY" \
  --limit "$STAGING_LIMIT" --detach

# 上記が返した同じ runId の状態確認だけを行う。
scripts/update-all-clients.sh --status <run-id> --inventory "$STAGING_INVENTORY"
```

`--detach` は一度だけ起動し、返却されたrun IDをそのまま `--status` に渡す。手入力SSH、個別compose、直接Ansible、別monitor loopを追加しない。終了判定はsystemd raw fields（`ActiveState=active`, `SubState=exited`, `Result=success`, `ExecMainStatus=0`）、Ansible `failed=0` / `unreachable=0`、role health、対象SHA/artifact digestの一致をすべて満たした時だけとする。

## 2. 失敗時のrescue rollback

rollbackの所有者は標準Ansible roleである。Pi5は `release_pi5` のslot/migration/health/rescue rollback、Pi4は `release_kiosk` のrollback task（旧release file、systemd、agent image、browser/status-agent health）を一次証拠とする。

1. 失敗したrun IDを保持し、`--status` のsystemd raw fields、Ansible recap、roleのrescue rollback、healthだけを読み取る。
2. DBのdown migration、手動release file復元、`docker compose down`、直接SSHによるservice操作は行わない。
3. rollbackがterminal failure、scope逸脱、SHA/digest不一致、health未確認のいずれかなら、同じrunを再起動しない。
4. 原因を修正した後、同じcanonical entrypointで新しいread-only planを作り、改めて承認を得る。

状態の読み分けと復旧記録は [deploy-status-recovery.md](./deploy-status-recovery.md) に従う。`scripts/deploy/verify-phase12-real.sh` はPOST/PUTを含む混在スクリプトなので、readonly受入の証拠として全体実行しない。

## 3. Pi4 キオスク受入

Pi4へMacから直接SSHしない。承認済みのstaging URLと、既存のPi5→Pi4標準観測経路だけを使う。fixtureは公開済みsourceから作った専用draft一つとし、実業務documentを編集しない。

### 3.1 画面・編集シーケンス

| 順序 | 操作 | 合格条件 |
|---:|---|---|
| 1 | staging assembly libraryで `PUBLISHED` sourceを選び、access passwordで認証して改版draftを作成 | sourceは不変、draftに新しいedit versionが付く |
| 2 | TEXTを追加・編集し、選択ROIから候補を取得。候補が空なら手入力 | text、bbox、font/色、ページindexがdraftに保持される。`source` はレスポンスの `poppler` または `coordinate-ocr` として記録 |
| 3 | IMAGEをROIから追加 | `assetId`、`relativeUrl`、`sha256`、`byteSize`、`contentType=image/jpeg` が返り、画像が壊れず表示される |
| 4 | ARROWと、必要ならRECTANGLE/LINE/ELLIPSEを追加・移動・編集 | overlayの座標、線幅、色、向きがページ投影後も可視 |
| 5 | 保存 | save responseのedit versionが増え、保存後reloadでoverlayが一致する |
| 6 | previewから公開確認を行いpublish | publish成功、source/draft状態が期待どおり、公開後のreadonly表示で編集APIが呼ばれない |

### 3.2 viewport / full / crop / scroll

同じfixtureを次のviewportで確認する。pixel screenshotの一致判定は使わず、DOMの状態、画像のnatural size、overlayの投影、overflowだけを判定する。

| viewport | 確認 |
|---|---|
| 1366 x 768 | toolbar、ページ画像、overlay、操作ボタンが重ならず、横overflowがない |
| 1920 x 1080 | contain/fitの余白が過大にならず、overlayが画像と同じ座標系で追従する |
| 900 x 900 | 縦スクロールでページ下部へ到達でき、overlayがずれず、操作可能な幅を保つ |

各viewportで次を一度ずつ行う。

- **full:** ページ全体を表示し、source imageの四隅とTEXT/IMAGE/ARROWを目視する。
- **crop:** crop設定されたtemplate stepを開き、同じoverlay idの位置がcrop投影後も合うことを確認する。
- **scroll:** ページ上端から下端までスクロールし、blank page、横スクロール、画像とoverlayのずれがないことを確認する。

### 3.3 readonly view のROI/OCRゼロ

公開済みtemplate/sequenceを通常のreadonly順序で開いた後、ブラウザのDevTools Consoleで次を実行する。最初に `performance.clearResourceTimings()` を実行してから画面を再読込する。

```js
performance.getEntriesByType('resource')
  .map((entry) => entry.name)
  .filter((url) => /\/regions\/(image|text)|\/ocr(?:\/|\?|$)|\/roi(?:\/|\?|$)/i.test(url))
```

結果は空配列でなければ不合格である。readonlyの許可される通信は sequence/page/asset のGETだけであり、`/regions/image`、`/regions/text`、`/ocr`、`/roi` のPOST/GETを「動作確認のため」に発生させてはならない。可能なら標準のstaging access log/health観測でも同じ時間窓を照合する。

## 4. Pi4 CPU / memory / temperature 観測

次は、承認済みstaging端末の**host-side read-only shell**で実行する観測コマンドである。Macからの直接SSHコマンドとして実行しない。端末名、観測時刻、操作（full/crop/scroll）をTSVへ記録する。Pi4のcontainer名は実機で解決し、未解決ならN/Aを記録する。

```bash
date -Is
uptime
free -m
awk '/^MemTotal:|^MemAvailable:/{print}' /proc/meminfo
vcgencmd measure_temp 2>/dev/null || awk '{printf "temp=%.1fC\n", $1/1000}' /sys/class/thermal/thermal_zone0/temp
docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
```

full/crop/scrollを操作する前後、および操作中に1秒間隔で60サンプル採る場合は、観測専用の出力先を使う。

```bash
mkdir -p '<approved-local-evidence-dir>/<run-id>/pi4'
printf 'timestamp\thost_cpu_pct\tmem_available_mb\ttemp_c\tcontainer_stats\n' \
  > '<approved-local-evidence-dir>/<run-id>/pi4/host.tsv'

cpu_ticks() { awk '/^cpu / { idle=$5+$6; total=0; for (i=2; i<=NF; i++) total+=$i; print idle, total; exit }' /proc/stat; }
for sample in $(seq 1 60); do
  before=( $(cpu_ticks) )
  sleep 1
  after=( $(cpu_ticks) )
  cpu_pct=$(awk -v i0="${before[1]}" -v t0="${before[2]}" -v i1="${after[1]}" -v t1="${after[2]}" 'BEGIN { d=t1-t0; printf "%.2f", d > 0 ? 100-((i1-i0)*100/d) : 0 }')
  mem_mb=$(awk '/^MemAvailable:/{printf "%.0f", $2/1024; exit}' /proc/meminfo)
  temp_c=$(vcgencmd measure_temp 2>/dev/null | sed -n 's/.*=\([0-9.]*\).*/\1/p')
  if [ -z "$temp_c" ]; then temp_c=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp); fi
  stats=$(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' 2>/dev/null | tr '\n' ';')
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$cpu_pct" "$mem_mb" "$temp_c" "$stats" \
    >> '<approved-local-evidence-dir>/<run-id>/pi4/host.tsv'
done
```

承認者が先に閾値を決め、記録表に明記する。最低限、ピークCPU、最低available memory、最高temperature、container memory usage、通信/画面エラー数を記録する。閾値未設定のままPASSにしない。

## 5. Pi5 ROI / Poppler / OCR 性能計測

Pi5のROI endpointはPOSTであり、`regions/image` はassetを作成する。`regions/text` もsource PDFをPopplerで読み、空候補時にOCRへfallbackする計算経路である。したがって、次の計測は**明示承認済みのstaging fixtureだけ**で行い、production document、共有asset dir、既存draftは使わない。

### 5.1 fixtureとAPI共通値

- Poppler path用に、テキストレイヤーを持つstaging PDF fixtureを用意する。
- OCR fallback用に、画像ベースのstaging PDF fixtureを用意する。テキストレイヤーがない実PDFしかない場合、Popplerが空候補になりOCR fallbackへ進んだことをレスポンスの `source` で記録する。
- `PAGE_INDEX` とbboxは同じ正規化座標を使う（例: `xRatio=0.10, yRatio=0.10, widthRatio=0.30, heightRatio=0.20`）。
- warmup 3回後に20サンプル（`n=20`）を直列で採る。各レスポンスのHTTP status、total ms、候補source、assetIdを保存する。
- `regions/image` は20個のtest assetを作るため、同じ専用draftで測定後にそのdraftを通常のdiscard-revision lifecycleで破棄し、asset GCの結果を確認する。途中でdiscardした場合は新しい専用draftを作る。

```bash
export PAGE_INDEX=0
export BBOX_JSON='{"xRatio":0.10,"yRatio":0.10,"widthRatio":0.30,"heightRatio":0.20}'
export SAMPLE_COUNT=20
mkdir -p "$EVIDENCE_DIR/pi5" "$EVIDENCE_DIR/pi5/responses"
printf 'operation\tsample\thttp_status\ttotal_ms\tsources\tasset_id\n' \
  > "$EVIDENCE_DIR/pi5/requests.tsv"
```

secretは次のようにstdin/secret managerから一時注入する。`STAGING_ACCESS_PASSWORD` をecho、log、TSVへ出力しない。

```bash
read -r -s -p 'staging access password: ' STAGING_ACCESS_PASSWORD
printf '\n'
```

### 5.2 readonly sequence baseline

通常表示のzero-ROI証拠と、GETのベースラインを別に採る。次はfixtureを変更しない。

```bash
for sample in $(seq 1 20); do
  curl -sS -o /dev/null \
    -H "x-client-key: ${STAGING_CLIENT_KEY}" \
    -w "sequence_get\t${sample}\t%{http_code}\t%{time_total}\n" \
    "${STAGING_API_BASE}/assembly/work-sessions/${TEST_WORK_SESSION_ID}/procedure-sequence" \
    | awk -F '\t' '{printf "%s\t%s\t%s\t%.3f\t\t\n", $1,$2,$3,$4*1000}' \
    >> "$EVIDENCE_DIR/pi5/requests.tsv"
done
```

readonly browser windowについては、Pi4の §3.3 と同じResource Timingを保存し、ROI/OCR endpointの件数を0とする。GET sequenceの成功率と、ROI/OCRの0件は別の判定列にする。

### 5.3 text candidates（Poppler / OCR）

次の関数はレスポンスをローカルの専用evidence dirに保存し、passwordをstdoutへ出さずにAPIへstdinで渡す。`jq`で候補の `source` を集計する。レスポンスがエラーでもstatusと時間を記録し、そのサンプルを成功p50/p95へ混ぜない。

```bash
measure_text_region() {
  local label="$1" document_id="$2" sample="$3"
  local response="$EVIDENCE_DIR/pi5/responses/${label}-${sample}.json"
  local body result status seconds sources
  body=$(jq -cn \
    --arg password "$STAGING_ACCESS_PASSWORD" \
    --argjson pageIndex "$PAGE_INDEX" \
    --argjson bbox "$BBOX_JSON" \
    '{accessPassword:$password,pageIndex:$pageIndex,bbox:$bbox}')
  result=$(printf '%s' "$body" | curl -sS -o "$response" \
    -H "x-client-key: ${STAGING_CLIENT_KEY}" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    -w $'\t%{http_code}\t%{time_total}' \
    "${STAGING_API_BASE}/assembly/procedure-documents/${document_id}/regions/text")
  status="${result#*$'\t'}"; status="${status%%$'\t'*}"
  seconds="${result##*$'\t'}"
  sources=$(jq -r '[.candidates[]?.source] | unique | join(",")' "$response" 2>/dev/null || printf 'response-error')
  printf '%s\t%s\t%s\t%.3f\t%s\t\n' "$label" "$sample" "$status" "$(awk -v s="$seconds" 'BEGIN {print s*1000}')" "$sources" \
    >> "$EVIDENCE_DIR/pi5/requests.tsv"
}

for sample in $(seq 1 3); do measure_text_region poppler_warmup "$POPPLER_FIXTURE_DOCUMENT_ID" "$sample"; done
for sample in $(seq 1 "$SAMPLE_COUNT"); do measure_text_region poppler "$POPPLER_FIXTURE_DOCUMENT_ID" "$sample"; done
for sample in $(seq 1 3); do measure_text_region ocr_warmup "$OCR_FIXTURE_DOCUMENT_ID" "$sample"; done
for sample in $(seq 1 "$SAMPLE_COUNT"); do measure_text_region ocr "$OCR_FIXTURE_DOCUMENT_ID" "$sample"; done
```

`poppler` / `coordinate-ocr` の候補sourceがレスポンスにない場合は、その経路を推測しない。サーバーの構造化ログまたはfixtureの候補sourceで確認できた経路だけを表へ記載し、未計測は `not instrumented` とする。

### 5.4 image region（ROI crop）

`regions/image` はassetを作るため、textと同じdraftに混ぜず、専用の `IMAGE_FIXTURE_DOCUMENT_ID` を使う。asset responseの `assetId` と相対URLを保存するが、passwordは保存しない。

```bash
measure_image_region() {
  local label="$1" document_id="$2" sample="$3"
  local response="$EVIDENCE_DIR/pi5/responses/${label}-${sample}.json"
  local body result status seconds asset_id
  body=$(jq -cn \
    --arg password "$STAGING_ACCESS_PASSWORD" \
    --argjson pageIndex "$PAGE_INDEX" \
    --argjson bbox "$BBOX_JSON" \
    '{accessPassword:$password,pageIndex:$pageIndex,bbox:$bbox}')
  result=$(printf '%s' "$body" | curl -sS -o "$response" \
    -H "x-client-key: ${STAGING_CLIENT_KEY}" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    -w $'\t%{http_code}\t%{time_total}' \
    "${STAGING_API_BASE}/assembly/procedure-documents/${document_id}/regions/image")
  status="${result#*$'\t'}"; status="${status%%$'\t'*}"
  seconds="${result##*$'\t'}"
  asset_id=$(jq -r '.asset.assetId // ""' "$response" 2>/dev/null || true)
  printf '%s\t%s\t%s\t%.3f\t\t%s\n' "$label" "$sample" "$status" "$(awk -v s="$seconds" 'BEGIN {print s*1000}')" "$asset_id" \
    >> "$EVIDENCE_DIR/pi5/requests.tsv"
}

for sample in $(seq 1 3); do measure_image_region image_warmup "$IMAGE_FIXTURE_DOCUMENT_ID" "$sample"; done
for sample in $(seq 1 "$SAMPLE_COUNT"); do measure_image_region image "$IMAGE_FIXTURE_DOCUMENT_ID" "$sample"; done
```

Asset quality is PASS only when the response has `contentType=image/jpeg`, positive `byteSize`, a 64-hex `sha256`, a unique `assetId`, and the returned `relativeUrl` loads with a nonzero `naturalWidth`/`naturalHeight` in the staging browser. Do not infer image quality from HTTP 200 alone.

### 5.5 p50 / p95 集計

次の集計はMac上の保存済みTSVだけを読む。p50/p95はHTTP 2xxのwarm sampleを対象にし、エラー数は別に報告する。

```bash
python3 - "$EVIDENCE_DIR/pi5/requests.tsv" <<'PY'
import csv
import math
import sys
from collections import defaultdict

rows = defaultdict(list)
errors = defaultdict(int)
with open(sys.argv[1], newline='', encoding='utf-8') as handle:
    for row in csv.DictReader(handle, delimiter='\t'):
        operation = row['operation']
        try:
            status = int(row['http_status'])
            ms = float(row['total_ms'])
        except (KeyError, ValueError):
            continue
        if 200 <= status < 300:
            rows[operation].append(ms)
        else:
            errors[operation] += 1

for operation, values in sorted(rows.items()):
    values.sort()
    p50 = values[max(0, math.ceil(len(values) * 0.50) - 1)]
    p95 = values[max(0, math.ceil(len(values) * 0.95) - 1)]
    print(f'{operation}\tn={len(values)}\tp50_ms={p50:.1f}\tp95_ms={p95:.1f}\terrors={errors[operation]}')
for operation, count in sorted(errors.items()):
    if operation not in rows:
        print(f'{operation}\tn=0\tp50_ms=NA\tp95_ms=NA\terrors={count}')
PY
```

`requests.tsv` の operation/sourceを確認し、Poppler/OCRの経路が識別できないときはendpoint全体の値を経路別値として再利用しない。

| operation / path | warmup | n | p50 ms | p95 ms | 2xx/errors | source evidence |
|---|---:|---:|---:|---:|---:|---|
| readonly sequence GET | 0 | 20 |  |  |  | Resource Timing / TSV |
| ROI image crop | 3 | 20 |  |  |  | `assetId`, quality check |
| text candidate / Poppler | 3 | 20 |  |  |  | response `source=poppler` |
| text candidate / OCR fallback | 3 | 20 |  |  |  | response `source=coordinate-ocr` |

## 6. Pi5 CPU / memory / temperature / container RSS

ROI/text計測と同じ時間窓で、承認済みstaging Pi5のhost-side read-only shellから1秒間隔60サンプルを採る。Macから直接SSHしない。container名は実機のstaging composeから読み取り、production project名を使わない。

```bash
mkdir -p '<approved-local-evidence-dir>/<run-id>/pi5'
printf 'timestamp\thost_cpu_pct\tmem_available_mb\ttemp_c\tcontainer_stats\n' \
  > '<approved-local-evidence-dir>/<run-id>/pi5/host.tsv'

cpu_ticks() { awk '/^cpu / { idle=$5+$6; total=0; for (i=2; i<=NF; i++) total+=$i; print idle, total; exit }' /proc/stat; }
for sample in $(seq 1 60); do
  before=( $(cpu_ticks) )
  sleep 1
  after=( $(cpu_ticks) )
  cpu_pct=$(awk -v i0="${before[1]}" -v t0="${before[2]}" -v i1="${after[1]}" -v t1="${after[2]}" 'BEGIN { d=t1-t0; printf "%.2f", d > 0 ? 100-((i1-i0)*100/d) : 0 }')
  mem_mb=$(awk '/^MemAvailable:/{printf "%.0f", $2/1024; exit}' /proc/meminfo)
  temp_c=$(vcgencmd measure_temp 2>/dev/null | sed -n 's/.*=\([0-9.]*\).*/\1/p')
  if [ -z "$temp_c" ]; then temp_c=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp); fi
  stats=$(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' 2>/dev/null | tr '\n' ';')
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$cpu_pct" "$mem_mb" "$temp_c" "$stats" \
    >> '<approved-local-evidence-dir>/<run-id>/pi5/host.tsv'
done
```

container RSSを別列で求める場合は、実機で名前を確認したstaging API containerだけを対象にする。下記はPIDと `/proc` のread-only観測である。

```bash
API_CONTAINER='<staging-api-container-name>'
API_PID=$(docker inspect -f '{{.State.Pid}}' "$API_CONTAINER")
printf 'container=%s pid=%s\n' "$API_CONTAINER" "$API_PID"
awk '/^VmRSS:|^VmHWM:/{print}' "/proc/${API_PID}/status"
```

記録表には host CPU平均/最大、available memory最小、temperature最大、API/Web containerのCPU平均/最大、MemUsage/RSS平均/最大、HTTP errorsを記録する。閾値（例: sustained CPU、温度、最低available memory、container memory limit）は実機ownerが計測前に承認し、後から都合よく変更しない。

## 7. 受入終了後のrollback、cleanup と完了判定

受入後にstagingを直前のreleaseへ戻す必要がある場合も、手動でslot、file、container、DBを戻さない。対象を直前の承認済みSHAへ固定し、canonical wrapperで新しいread-only planを作ってから、別の明示承認を得て限定実行する。既存release中の異常は `release_pi5` / `release_kiosk` のrescue rollbackが先に自動実行され、そのrunの `--status` とrole結果を一次証拠にする。

```bash
# 受入終了後にrollbackが必要な場合の承認前plan。今回の作業では実行しない。
scripts/update-all-clients.sh <approved-previous-branch> "$STAGING_INVENTORY" \
  --print-plan --limit "$STAGING_LIMIT" \
  | tee "$EVIDENCE_DIR/post-acceptance-rollback-plan.json"

# 別途承認後に一度だけ実行し、返却された同じrun IDを確認する。
scripts/update-all-clients.sh <approved-previous-branch> "$STAGING_INVENTORY" \
  --limit "$STAGING_LIMIT" --detach
scripts/update-all-clients.sh --status <rollback-run-id> --inventory "$STAGING_INVENTORY"
```

rollback完了は、`ActiveState=active`、`SubState=exited`、`Result=success`、`ExecMainStatus=0`、Ansible `failed=0` / `unreachable=0`、Pi5/Pi4 health合格、直前SHA一致が揃った時だけとする。`--status` が非終端、rollback terminal failure、health未確認ならstagingを受入完了にせず停止する。DB down migrationは行わず、原因修正後に新しいplanを作る。

1. test draftだけを通常UIのdiscard-revision lifecycleで破棄する。未参照のROI assetがGCされたことを、返却されたasset IDとstagingのbounded GC/read-only reportで確認する。
2. fixture専用で作成したdocumentを削除する場合も、exact IDを指定し、template/markerで使用中なら削除せずownerへ戻す。source published document、既存asset、production storageを削除しない。
3. ローカルevidenceは承認済みの保存先へ移動した後、今回のrun ID配下だけを削除する。`docker system prune`、広域 `rm`、DB truncate、storage tree全消去を行わない。
4. stagingの一時process、browser context、計測ファイル、test assetが残っていないことを確認する。
5. 報告には、run ID、plan hash、SHA、target host、rollback state、Pi4 viewport結果、readonly ROI/OCR request count、Pi5 p50/p95、CPU/memory/temp/RSS、cleanup receipt、未確認事項を含める。

### 受入記録表

| gate | command / evidence | expected | observed | status | operator / time |
|---|---|---|---|---|---|
| inventory boundary | staging boundary test / graph | staging placeholder-only、production/TalkPlaza参照なし |  |  |  |
| syntax | staging playbook `--syntax-check` | local parse success、remote 0件 |  |  |  |
| plan | print-plan JSON + SHA256 | exact SHA、scope、image、rollback一致 |  |  |  |
| approval | approver record | 二者承認、run ID、digest記録 |  |  |  |
| Pi4 full/crop/scroll | viewport table / evidence | 3 viewportで投影・scroll・overflow合格 |  |  |  |
| Pi4 readonly | Resource Timing / access log | ROI/OCR endpoint 0件 |  |  |  |
| Pi5 API | `requests.tsv` | 2xx/error、asset quality、sourceを記録 |  |  |  |
| Pi5 performance | p50/p95 table | Poppler/OCRを混同せず記録 |  |  |  |
| host resources | `pi4/host.tsv`, `pi5/host.tsv` | owner-approved thresholds内 |  |  |  |
| rollback | `--status` raw fields / role result | successまたはrescue rollbackの一次証拠 |  |  |  |
| cleanup | discard/GC receipt | test asset/document/evidence residue 0 |  |  |  |

次のいずれかは即時停止条件である: exact SHA/digest不一致、inventory host mismatch、production/TalkPlaza URLまたはpath検出、未承認の`--detach`、rollback証拠欠落、readonly画面でROI/OCR request検出、HTTP error、source path不明、asset quality不合格、owner-approved resource threshold超過、cleanup residue、またはsecretのログ出力。

## 8. 既存計測ツールとの関係

既存の `scripts/perf/measure-kiosk-perf.mjs` はPlaywrightでキオスク画面とassembly first/next pageのブラウザ時間を測れる。`scripts/perf/measure-kiosk-documents-api.mjs` は `procedureSequence` を含むAPIのmedianを測れる。これらはhost CPU/memory/temp、container RSS、ROI endpointのPoppler/OCR path別p50/p95、readonly request countを自動測定しないため、本RunbookのTSV観測を併用する。

実行時は、既存のseed/manifestが参照するfixtureをstaging専用DB・asset dirへ限定し、次のようにbase URLとclient keyだけを注入する。seed scriptはDB/storageを変更するので、実機・productionへ向けない。

```bash
PERF_WEB_BASE_URL="$STAGING_WEB_BASE" \
PERF_API_BASE_URL="$STAGING_API_BASE" \
PERF_CLIENT_KEY="$STAGING_CLIENT_KEY" \
node scripts/perf/measure-kiosk-perf.mjs "$EVIDENCE_DIR/kiosk-perf.json"

PERF_API_BASE_URL="$STAGING_API_BASE" \
PERF_CLIENT_KEY="$STAGING_CLIENT_KEY" \
node scripts/perf/measure-kiosk-documents-api.mjs "$EVIDENCE_DIR/kiosk-documents-api.json"
```

今回の作業ではstaging URLがなく、上記fixture/seed/実機計測は未実行である。実行時のtemporary Docker、DB、asset directoryは専用namespaceで作成し、終了時に同じrun IDのcleanup receiptを残す。
