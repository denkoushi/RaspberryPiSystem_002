# KB-320: キオスク部品測定（テンプレ不一致・候補・スキャン）

## Context

キオスク `/kiosk/part-measurement` および API `/api/part-measurement/*` の初導入時に起きやすい事象のメモ。

## Symptoms

- 照会後、**テンプレートがありません** / 測定表が作れない。
- バーコードは読めるが **製造orderが解決しない**、または **候補が複数** でどれを選べばよいか分からない。
- **工程を切り替えたら** テンプレや候補の整合が取れなくなった。
- 図面付きテンプレなのに **図面が表示されない** / 「図面の読み込みに失敗」。

## Investigation

| 仮説 | 検証 | 結果の例 |
|------|------|----------|
| テンプレ未登録 | 管理 `/admin/tools/part-measurement-templates` またはキオスクテンプレ作成で、該当 **FIHNCD + 工程 + 資源CD** に **isActive** があるか | 無ければ作成 |
| 工程グループ不一致 | キオスクの切削/研削トグルとテンプレの `processGroup` | `cutting` テンプレしか無いのに研削で見ている等 |
| 資源CD不一致 | スケジュール行の `FSIGENCD` とテンプレの `resourceCd` | Phase2 以降はキーに資源CDが含まれる |
| 生産スケジュールに行がない | CSV ダッシュボード（生産スケジュール用）に `ProductNo` / `FSEIBAN` が存在するか | 取り込み遅延・別ダッシュボードを見ている |
| バーコード値が期待と違う | スキャン結果の生文字と解釈された `ProductNo` | プレフィックス付きならトリム規則を確認 |
| 図面が出ない | 業務テンプレに `visualTemplate` が付いているか、ストレージにファイルが残っているか、`GET /api/storage/part-measurement-drawings/...` が **JWT または有効な x-client-key** で 200 になるか | キオスクは Blob 取得で `x-client-key` を付与する実装。ファイル欠損は再アップロード |
| 図面が出ない（初回は出るのに **デプロイ／API再起動のあとだけ**） | ホストの `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings/` に該当 `{uuid}.*` があるか。`infrastructure/docker/docker-compose.server.yml` で API に当該ディレクトリが **bind mount** されているか | **未マウントのままだとコンテナ再作成で図面ファイルだけ消える**（DB の `drawingImageRelativePath` は残る）。compose 修正後に初回デプロイでホスト側ディレクトリ作成有無を確認 |
| Pi5 デプロイが `success` っぽく見えるのに `prisma migrate deploy` が `service "api" is not running` で落ちる | Pi5 の `PLAY RECAP` で `failed=1` になっていないか。`/opt/RaspberryPiSystem_002/logs/deploy/*.summary.json` の `totalHosts` / `failedHosts`、`docker compose ps -a` の `api` / `web` 状態、`docker inspect docker-api-1` の mount error を確認 | **2段の罠**がある。1) `part-measurement-drawings` の bind mount 先ディレクトリ未作成で `api` が `Created` のまま。2) `update-all-clients.sh` の recap 解析不備で **`failed=1` を success 扱い**し得た。修正後は summary が `PLAY RECAP` と一致し、rerun 前に `api/web` を `up -d` して自動復旧する |
| Phase12 で **`deploy-status` が一時的に `isMaintenance:true`** と FAIL | 直後に `curl …/api/system/deploy-status -H "x-client-key: …"` で再確認。デプロイ直後・`deploy-status.json` 更新タイミングで **数秒〜数十秒** だけメンテ表示になりうる | **再実行**で `isMaintenance:false` に戻れば環境差ではなく一時状態。常時 true のときは Pi5 の `config/deploy-status.json` とクライアント解決（`statusClientId`）を確認（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)） |
| Phase12 終盤 **`verify-services-real.sh` だけ**「Pi5に到達できません」 | `verify-phase12-real.sh` 本体は API/SSH で Pi5 に届いているのに、子スクリプトが **別途 ICMP** だけで判定している | **`verify-services-real.sh`** は ping 失敗時に **`GET …/api/system/health` が 200 相当なら Pi5 IP を確定**するフォールバックを持つ（2026-04-04 追補）。それでも失敗する場合は Tailscale/LAN の経路を確認 |

## Root cause（典型）

- **テンプレート未整備**（品番×工程の有効版がない）。
- **工程トグルと現場の認識がずれている**（API 契約は `cutting`/`grinding`）。
- **資源CDとテンプレのキーが一致しない**（Phase2 以降はテンプレ・シートとも `resourceCd` がキーに含まれる。移行データは `__LEGACY__` 等のプレースホルダがありうる）。
- **スケジュールデータに該当行がない**（ProductNo の typos、未取り込み）。
- **Docker 本番 compose で図面ディレクトリ未永続化**：図面は `PHOTO_STORAGE_DIR/part-measurement-drawings/` に保存されるが、`docker-compose.server.yml` では従来 **photos 等のみホスト bind** で、このサブディレクトリがマウントされていないと、`api` コンテナ再作成時に **実ファイルのみ消える**（DB は参照 URL を保持したまま）。
- **初回修正デプロイ時の host ディレクトリ欠落**：bind mount を追加しても、Pi5 ホストに `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings` が無いと Docker は `api` / `web` を **`Created` のまま**残し、直後の `pnpm prisma migrate deploy` が `service "api" is not running` で失敗する。
- **デプロイ失敗判定の recap 解析不備**：`update-all-clients.sh` の summary 生成が `PLAY RECAP` 行の空白を正しく解釈できず、`failed=1` でも `totalHosts: 0` / `failedHosts: []` / `success: true` を返す経路があった。

## Fix

- 管理画面でテンプレ登録 → 必要なら **有効化** で正しいバージョンを active にする。
- キオスクで工程を合わせ、**再度照会**する。
- データ側: 生産スケジュール CSV の取り込み・ダッシュボード ID を確認（開発者向け: `PRODUCTION_SCHEDULE_DASHBOARD_ID`）。
- **図面ファイル欠落（compose 未マウント）**: [`infrastructure/docker/docker-compose.server.yml`](../../infrastructure/docker/docker-compose.server.yml) で `part-measurement-drawings-storage` を `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings` にバインドし、API コンテナを再作成して反映。既に消えたファイルは **visual template の図面を再アップロード**するかテンプレを作り直す。
- **初回修正デプロイの復旧**: [`infrastructure/ansible/roles/server/tasks/main.yml`](../../infrastructure/ansible/roles/server/tasks/main.yml) で host ディレクトリを先に作成し、`prisma migrate deploy` の直前に `docker compose ... up -d api web` を実行して **`Created` に残ったコンテナを自動復旧**させる。
- **失敗判定の修正**: [`scripts/update-all-clients.sh`](../../scripts/update-all-clients.sh) の `PLAY RECAP` 解析を修正し、`failed/unreachable` を summary JSON に正しく反映させる。以後は **Pi5 の summary JSON と `PLAY RECAP` が一致**することを確認する。

## Prevention

- 新規品番投入時は **テンプレ先行登録** を運用ルールに含める。
- 候補が複数のときは **製番・品名・機種** を画面上で確認してから選択する（誤選択はスナップショットに残る）。
- 本番デプロイ後、`/opt/RaspberryPiSystem_002/storage/part-measurement-drawings/` がホストに存在し、バックアップ方針に **写真ストレージと同格で含める**（リストア時に図面も戻す）。
- `update-all-clients.sh --detach --follow` の成否は **Pi5 の `PLAY RECAP` と `*.summary.json` の両方**で見る。`failed=0` / `unreachable=0` と `totalHosts>0` が一致しない場合は success 扱いにしない。
- `prisma migrate deploy` が `service "api" is not running` なら、まず **`docker compose ps -a` で `Created` / mount error を確認**する。再実行前に `api/web` を `up -d` できる状態かを必ず見る。

## Current UI spec（2026-04-04）

- 部品測定シートのヘッダは **1 行優先 + 必要時のみ折り返し**。無意味な横余白を広く取らない。
- 測定値テーブルは **図面と表を左寄せで高密度表示**し、横方向に必要以上に広がらない。
- 測定値入力欄は **5桁程度が自然に収まる幅**を標準とする（`6ch`〜`10ch` 相当、等幅数字前提）。
- **編集画面（`/kiosk/part-measurement/edit/...`）上部帯**: `KioskPartMeasurementEditTopStrip` で **中央寄せ・`flex-wrap`**。メタ情報は `KioskPartMeasurementSheetMetaBlock`（`<dl>` + 個数・暗帯スタイル）に集約。旧 `KioskPartMeasurementSheetHeaderSection` は撤去。**静的モック**: [kiosk-part-measurement-header-strip.html](../design-previews/kiosk-part-measurement-header-strip.html)。

## キオスク・テンプレ候補選択と別資源テンプレ借用（2026-04-04）

- **画面**: `/kiosk/part-measurement/template/pick`（日程・照会からテンプレ未整備時は **先に候補選択**。新規作成は同画面から `template/new` へ）。
- **API**: `GET /api/part-measurement/templates/candidates`（`fhincd`・`processGroup`・`resourceCd` 必須・任意 `fhinmei` / `q`）。`matchKind`: `exact_resource` / `same_fhincd_other_resource` / `fhinmei_similar`。品番相違の `fhinmei_similar` は **selectable: false**（記録表作成不可）。
- **記録作成**: `POST /api/part-measurement/sheets` に **`allowAlternateResourceTemplate: true`** を付けると、**テンプレの資源CDと `resourceCdSnapshot` が不一致でも**同一 `fhincd`・同一工程なら下書き作成可（スナップショット資源は日程のまま）。通常時は省略（厳格一致）。
- **根拠**: [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)。UI モック: [kiosk-part-measurement-template-picker.html](../design-previews/kiosk-part-measurement-template-picker.html)。

## 実機・自動検証（Phase12）

- **一括**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh`（Pi5 到達・Tailscale/LAN 自動選択）。
- **2026-03-29 実績（Phase2 全キオスク反映後・マージ前再確認）**: **PASS 37 / WARN 0 / FAIL 0**（約 138s・Mac / Tailscale）。`deploy-status` は Pi4 キオスク 4 台分を含む。部品測定は `POST https://<Pi5>/api/part-measurement/resolve-ticket` に有効な `x-client-key` と JSON `{"productNo":"__PHASE12_SMOKE__","processGroup":"cutting"}` で応答に `"candidates"` が含まれること、**Authorization / x-client-key なし**の同一 POST が **401** であることをスクリプトが検証する。
- **2026-03-30 実績（visual template 本番反映後・`feat/part-measurement-visual-template`）**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・`--detach --follow`（**Pi3 除外**）。Pi5 上の `logs/deploy/ansible-update-*.status.json` の `runId` 例: `20260330-144026-13597`（`raspberrypi5`）→ `20260330-144741-21698`（`raspberrypi4`）→ `20260330-145303-17447`（`raspi4-robodrill01`）→ `20260330-150059-11671`（`raspi4-fjv60-80`）→ `20260330-150516-1744`（`raspi4-kensaku-stonebase01`）、いずれも **`state: success` / `exitCode: "0"`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（約 117s・Mac / Tailscale）。**知見（Mac 側ログ）**: `--detach --follow` 実行でも **`logs/ansible-history.jsonl` に当日行が追記されない**ことがある。成否の一次確認は **Pi5 の** `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.status.json` を参照する。**手動残り**: visual 付きテンプレで図面 Blob 表示・`displayMarker` 列見出しを現場で目視（Runbook 手順）。
- **2026-04-03 実績（障害修正の再デプロイ）**: `fix/kiosk-part-measurement-drawing-persistence-and-layout` に対し、まず Pi5 で **host ディレクトリ欠落**により `prisma migrate deploy` が `service "api" is not running` で失敗することを再現。Pi5 の `docker inspect docker-api-1` で `part-measurement-drawings-storage` mount error、debug log で `PLAY RECAP failed=1` にもかかわらず `summaryFailedHosts: []` を確認。修正後に **Pi5 → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・`--detach --follow`（Pi3 除外）で再デプロイし、全台 **`PLAY RECAP failed=0`** を確認。Pi5 では `api` / `web` / `db` が `Up`、CI は fix branch の最新 3 push がすべて success。
- **2026-04-04 実績（編集画面上部帯統合・`feat/kiosk-part-measurement-edit-top-strip`）**: Web のみ（`KioskPartMeasurementEditTopStrip` / `KioskPartMeasurementSheetMetaBlock`、`KioskPartMeasurementEditPage` から旧ヘッダセクション撤去）。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`--detach --follow`（Pi3 除外）。Pi5 の `logs/deploy/ansible-update-*.status.json` の `runId` 例: `20260404-082321-9627`（`raspberrypi5`）、Pi4 各台もいずれも **`PLAY RECAP failed=0`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 0 / FAIL 0**（約 106s・Mac / Tailscale・`resolve-ticket` スモーク含む）。**手動残り**: 編集画面で上部帯が窮屈すぎず、DRAFT/FINALIZED・図面ありで操作しやすいかを現場で目視。
- **2026-04-04 実績（キオスク・テンプレ候補選択・`feat/kiosk-part-measurement-template-picker`・`main` 統合後ドキュメント追補）**: API `GET /api/part-measurement/templates/candidates`・`POST /api/part-measurement/sheets` の **`allowAlternateResourceTemplate`**、Web `/kiosk/part-measurement/template/pick`・`alternateResourcePolicy`。**デプロイ**: 先行済み（Pi5 → Pi4×4・Pi3 除外・1 台ずつ）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` に **`templates/candidates`**（401 + キー付きで `"candidates"`）を追加後 → **PASS 43 / WARN 0 / FAIL 0**（約 311s・Mac / Tailscale）。**検証時のつまずき**: （1）**`deploy-status`（例: `raspi4-fjv60-80`）** がデプロイ直後だけ **`isMaintenance:true`** と誤検知しうる → 再 curl で **false** なら再実行。（2）**終盤 `verify-services-real.sh`** が ICMP だけで Pi5 未到達と言う → `verify-services-real.sh` の **health フォールバック**で緩和（ログは KB の Investigation 表参照）。**手動残り**: `/template/pick` の候補カード・図面ホバー・別資源選択からの記録表作成を現場で目視。
- **知見**: Pi4 単体 `--limit` でも Ansible は Pi5 上で実行される（`RASPI_SERVER_HOST` 設定が前提）。`--foreground` のキオスクデプロイは IME/ibus 等を含み **15〜25 分**/台かかることがある（タイムアウトに注意）。
- **トラブルシュート（デプロイ）**: **同じ `RASPI_SERVER_HOST` に対し、`update-all-clients.sh` を複数プロセスで同時起動しない**。2026-03-29 hardening 後は、2本目は Mac 側ローカルロック（`logs/.update-all-clients.local.lock`）または Pi5 ロック（`/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock`）で停止する。ロックを手動削除する前に、`runPid` が生存していないことを確認する（[deployment.md](../guides/deployment.md) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。
- **認可**: `Authorization` 付きで **403（権限不足）** のとき、書き込み系（例: `POST .../sheets`）では `x-client-key` にフォールバックしない（401 のみキー許可）。キオスクは通常キーのみで十分。

## References

- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md) / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md) / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md) / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)
- 沉浸式 allowlist: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
