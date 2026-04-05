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
| **`FHINMEI_ONLY` 候補が出ない（2026-04-05 以降）** | 日程 `fhinmei` が **正規化後**の `candidateFhinmei` を **部分文字列として含む**か（`includes`）。候補キーは **正規化後 2 文字以上**（`PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN`）。全角半角・NFKC は API 側で正規化 | キーが長すぎる／日程側に部分が無いと一致しない。誤爆は **より長い候補キーが先**になるタイブレークで緩和 |
| **同一 `FHINMEI_ONLY` が候補に2件**（2026-04-05 以降） | 管理で **新規登録を重ねた**結果、**別 lineage**（別 `resourceCd`）の有効テンプレが複数残っている | **有効版は `POST /api/part-measurement/templates/:id/revise`**（系譜固定・版上げ）か、不要行を **無効**のままにして **有効は1系譜だけ**にする。一覧は **「無効版も表示」**で旧版を確認できる |
| **管理で候補キーを直したいが編集できない**（2026-04-05 以降） | 旧仕様では `revise` が **名称・項目・図面のみ** | **`FHINMEI_ONLY` の有効版**は **編集**で `candidateFhinmei` を変更可能（`revise` ボディに `candidateFhinmei`）。**THREE_KEY / FHINCD_RESOURCE** では引き続き変更不可 |
| **有効版を消したいが物理削除したくない**（2026-04-05 以降） | 記録済みシートがあるとテンプレ項目の物理削除は **Restrict** で壊れやすい | **最新の有効版のみ** `POST /api/part-measurement/templates/:id/retire`（**`isActive: false`**・旧版は**自動で有効化しない**）。必要なら **無効版も表示**から旧版を **有効化** |
| **削除を連打して 409** | **無効版**に対して **retire** した | **有効版**だけ **削除**可。無効版は **有効化**してから再度判断 |
| 図面が出ない | 業務テンプレに `visualTemplate` が付いているか、ストレージにファイルが残っているか、`GET /api/storage/part-measurement-drawings/...` が **JWT または有効な x-client-key** で 200 になるか | キオスクは Blob 取得で `x-client-key` を付与する実装。ファイル欠損は再アップロード |
| 図面が出ない（初回は出るのに **デプロイ／API再起動のあとだけ**） | ホストの `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings/` に該当 `{uuid}.*` があるか。`infrastructure/docker/docker-compose.server.yml` で API に当該ディレクトリが **bind mount** されているか | **未マウントのままだとコンテナ再作成で図面ファイルだけ消える**（DB の `drawingImageRelativePath` は残る）。compose 修正後に初回デプロイでホスト側ディレクトリ作成有無を確認 |
| Pi5 デプロイが `success` っぽく見えるのに `prisma migrate deploy` が `service "api" is not running` で落ちる | Pi5 の `PLAY RECAP` で `failed=1` になっていないか。`/opt/RaspberryPiSystem_002/logs/deploy/*.summary.json` の `totalHosts` / `failedHosts`、`docker compose ps -a` の `api` / `web` 状態、`docker inspect docker-api-1` の mount error を確認 | **2段の罠**がある。1) `part-measurement-drawings` の bind mount 先ディレクトリ未作成で `api` が `Created` のまま。2) `update-all-clients.sh` の recap 解析不備で **`failed=1` を success 扱い**し得た。修正後は summary が `PLAY RECAP` と一致し、rerun 前に `api/web` を `up -d` して自動復旧する |
| Phase12 で **`deploy-status` が一時的に `isMaintenance:true`** と FAIL | 直後に `curl …/api/system/deploy-status -H "x-client-key: …"` で再確認。デプロイ直後・`deploy-status.json` 更新タイミングで **数秒〜数十秒** だけメンテ表示になりうる | **再実行**で `isMaintenance:false` に戻れば環境差ではなく一時状態。常時 true のときは Pi5 の `config/deploy-status.json` とクライアント解決（`statusClientId`）を確認（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)） |
| Phase12 終盤 **`verify-services-real.sh` だけ**「Pi5に到達できません」 | `verify-phase12-real.sh` 本体は API/SSH で Pi5 に届いているのに、子スクリプトが **別途 ICMP** だけで判定している | **`verify-services-real.sh`** は ping 失敗時に **`GET …/api/system/health` が 200 相当なら Pi5 IP を確定**するフォールバックを持つ（2026-04-04 追補）。それでも失敗する場合は Tailscale/LAN の経路を確認 |
| Mac で **`update-all-clients.sh` が「Another update… local lock」**で即終了 | 同一マシンから **`--detach --follow` を 2 プロセス並列**で起動した | **1 台ずつ順次**：前の `--follow` が **`Remote run finished`** になるまで待ってから次の `--limit`。ロックは `logs/.update-all-clients.local.lock`（`owner` に pid）。**同一 `RASPI_SERVER_HOST`（Pi5）ロック**とも重なるので、並列は避ける（[deployment.md](../guides/deployment.md)） |

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

## Current UI spec（2026-04-05 までの合意）

- **管理 `/admin/tools/part-measurement-templates`（2026-04-05 追補）**: 有効行の **編集** でフォームに読み込み。**登録スコープ・FIHNCD・資源CD・工程**は変更不可。**`FHINMEI_ONLY` のみ** **FHINMEI（候補キー）** を編集可能（他スコープでは従来どおり固定）。**保存**は `POST /api/part-measurement/templates/:id/revise`（名称・測定項目・図面＋**任意で `candidateFhinmei`**。DB 上は **次 `version` の新行**＋同系譜の旧版 `isActive: false`）。**削除**（最新の有効版のみ）は `POST /api/part-measurement/templates/:id/retire`（**論理削除**・旧版は**自動で有効にならない**）。一覧は既定 **有効版のみ**・**無効版も表示**で旧版の **有効化**が可能。無効版を `revise` / `retire` すると **409**。
- **ハブ `/kiosk/part-measurement`・カード「測定値入力中（新しい順）」（2026-04-05）**: 下書き（DRAFT）は **最大3列グリッド**（狭幅は1〜2列）。各行に **製造order・品番・資源・工程**、**部品名称（FHINMEI）**、**機種名**（シートの `machineName`・製番進捗の MH%/SH% 系集約由来。未解決時は `—`）、**更新**（`Asia/Tokyo`・**曜日短縮**・**分まで・秒なし**）。品名・機種名は **省略（line-clamp）なし**（折り返し）。ボタン文言は **「測定値入力中を更新」**、空状態は **「測定値入力中の記録はありません。」**。実装: `KioskPartMeasurementInProgressDraftList`・`formatKioskPartMeasurementDraftUpdatedAt`（`Intl.DateTimeFormat` はモジュール内再利用）。
- 部品測定シートのヘッダは **1 行優先 + 必要時のみ折り返し**。無意味な横余白を広く取らない（2026-04-04）。
- 測定値テーブルは **図面と表を左寄せで高密度表示**し、横方向に必要以上に広がらない。
- 測定値入力欄は **5桁程度が自然に収まる幅**を標準とする（`6ch`〜`10ch` 相当、等幅数字前提）。
- **編集画面（`/kiosk/part-measurement/edit/...`）上部帯**: `KioskPartMeasurementEditTopStrip` で **中央寄せ・`flex-wrap`**。メタ情報は `KioskPartMeasurementSheetMetaBlock`（`<dl>` + 個数・暗帯スタイル）に集約。旧 `KioskPartMeasurementSheetHeaderSection` は撤去。**静的モック**: [kiosk-part-measurement-header-strip.html](../design-previews/kiosk-part-measurement-header-strip.html)。

## キオスク・テンプレ候補選択と日程キーへの自動着地（2026-04-04 更新）

- **画面**: `/kiosk/part-measurement/template/pick`（日程・照会からテンプレ未整備時は **先に候補選択**。新規作成は同画面から `template/new` へ）。
- **API（候補）**: `GET /api/part-measurement/templates/candidates`（`fhincd`・`processGroup`・`resourceCd` 必須・任意 `fhinmei` / `q`）。テンプレは `templateScope`（`THREE_KEY` / `FHINCD_RESOURCE` / `FHINMEI_ONLY`）と、1要素用の `candidateFhinmei` を持つ。`matchKind`: `exact_resource`（3要素一致）/ `two_key_fhincd_resource`（2要素・FIHNCD+資源CD）/ `one_key_fhinmei`（1要素・**日程 `fhinmei` が正規化後の `candidateFhinmei` を含む（部分一致）**・候補キーは正規化後 **2 文字以上**・同種の並びは **正規化キー長の降順**タイブレーク）。**いずれも選択可能**。
- **API（複製）**: `POST /api/part-measurement/templates/clone-for-schedule-key`（body: `sourceTemplateId`・日程の `fhincd`・`processGroup`・`resourceCd`）。参照テンプレの項目・図面参照を **日程の FIHNCD+工程+資源CD** 用の新 active テンプレにコピーする。同一キーで既に active があれば **それを返す**（重複作成しない）。
- **記録作成**: `matchKind === exact_resource` のときはその `templateId` でそのまま `POST /api/part-measurement/sheets`。それ以外は **先に clone** して得た `templateId` で `POST` する（**`allowAlternateResourceTemplate` は付けない**）。記録の `resourceCdSnapshot` は常に日程どおり。
- **レガシー**: `POST /api/part-measurement/sheets` の **`allowAlternateResourceTemplate: true`** は **互換のため維持**（キオスク候補の主経路では不使用）。
- **根拠**: [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)。UI モック: [kiosk-part-measurement-template-picker.html](../design-previews/kiosk-part-measurement-template-picker.html)。

## 複数記録表（セッション・子シート）（2026-04-06）

- **モデル**: `PartMeasurementSession` が親キー（**`productNo` + `processGroup` + `resourceCd`**）。`PartMeasurementSheet` は **`sessionId`** で子にぶら下がる。既存行はマイグレーションで **親1・子1** にバックフィル。
- **API**: `GET` / `POST` / `PATCH` など記録表の応答は **`{ sheet, session }`**（`session.sheets` に兄弟一覧・**`completedAt`**）。同一測定へ追加するとき `POST …/sheets` に **`sessionId`**。同一セッション内で **同一 `templateId` を二重に付けようとすると 409**（`PART_MEASUREMENT_TEMPLATE_ALREADY_IN_SESSION`）。
- **キオスク編集画面**: 上部に **`KioskPartMeasurementSessionSheetCards`**（テンプレ名・状態・更新時刻）。**別テンプレを追加**は `session.completedAt` が **null** のときのみ有効 → `/template/pick`（**`usedTemplateIds`** で候補を除外、**`sessionId`** で追加作成）。
- **親の完了**: 取消・無効以外の子が **すべて確定**すると **`session.completedAt`** がセットされる。
- **CSV**: 各子シートの export に **`H,sessionId,`…** を含め、セッションとひも付け可能にする（**子1枚あたり従来どおり1本の CSV**）。

## 実機・自動検証（Phase12）

- **一括**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh`（Pi5 到達・Tailscale/LAN 自動選択）。
- **2026-03-29 実績（Phase2 全キオスク反映後・マージ前再確認）**: **PASS 37 / WARN 0 / FAIL 0**（約 138s・Mac / Tailscale）。`deploy-status` は Pi4 キオスク 4 台分を含む。部品測定は `POST https://<Pi5>/api/part-measurement/resolve-ticket` に有効な `x-client-key` と JSON `{"productNo":"__PHASE12_SMOKE__","processGroup":"cutting"}` で応答に `"candidates"` が含まれること、**Authorization / x-client-key なし**の同一 POST が **401** であることをスクリプトが検証する。
- **2026-03-30 実績（visual template 本番反映後・`feat/part-measurement-visual-template`）**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・`--detach --follow`（**Pi3 除外**）。Pi5 上の `logs/deploy/ansible-update-*.status.json` の `runId` 例: `20260330-144026-13597`（`raspberrypi5`）→ `20260330-144741-21698`（`raspberrypi4`）→ `20260330-145303-17447`（`raspi4-robodrill01`）→ `20260330-150059-11671`（`raspi4-fjv60-80`）→ `20260330-150516-1744`（`raspi4-kensaku-stonebase01`）、いずれも **`state: success` / `exitCode: "0"`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（約 117s・Mac / Tailscale）。**知見（Mac 側ログ）**: `--detach --follow` 実行でも **`logs/ansible-history.jsonl` に当日行が追記されない**ことがある。成否の一次確認は **Pi5 の** `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.status.json` を参照する。**手動残り**: visual 付きテンプレで図面 Blob 表示・`displayMarker` 列見出しを現場で目視（Runbook 手順）。
- **2026-04-03 実績（障害修正の再デプロイ）**: `fix/kiosk-part-measurement-drawing-persistence-and-layout` に対し、まず Pi5 で **host ディレクトリ欠落**により `prisma migrate deploy` が `service "api" is not running` で失敗することを再現。Pi5 の `docker inspect docker-api-1` で `part-measurement-drawings-storage` mount error、debug log で `PLAY RECAP failed=1` にもかかわらず `summaryFailedHosts: []` を確認。修正後に **Pi5 → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・`--detach --follow`（Pi3 除外）で再デプロイし、全台 **`PLAY RECAP failed=0`** を確認。Pi5 では `api` / `web` / `db` が `Up`、CI は fix branch の最新 3 push がすべて success。
- **2026-04-04 実績（編集画面上部帯統合・`feat/kiosk-part-measurement-edit-top-strip`）**: Web のみ（`KioskPartMeasurementEditTopStrip` / `KioskPartMeasurementSheetMetaBlock`、`KioskPartMeasurementEditPage` から旧ヘッダセクション撤去）。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`--detach --follow`（Pi3 除外）。Pi5 の `logs/deploy/ansible-update-*.status.json` の `runId` 例: `20260404-082321-9627`（`raspberrypi5`）、Pi4 各台もいずれも **`PLAY RECAP failed=0`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 0 / FAIL 0**（約 106s・Mac / Tailscale・`resolve-ticket` スモーク含む）。**手動残り**: 編集画面で上部帯が窮屈すぎず、DRAFT/FINALIZED・図面ありで操作しやすいかを現場で目視。
- **2026-04-04 実績（キオスク・テンプレ候補選択・`feat/kiosk-part-measurement-template-picker`・`main` 統合後ドキュメント追補）**: API `GET /api/part-measurement/templates/candidates`、当初は `POST /api/part-measurement/sheets` の **`allowAlternateResourceTemplate`** で別資源借用。**デプロイ**: 先行済み（Pi5 → Pi4×4・Pi3 除外・1 台ずつ）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` に **`templates/candidates`**（401 + キー付きで `"candidates"`）を追加後 → **PASS 43 / WARN 0 / FAIL 0**（約 311s・Mac / Tailscale）。**以降の仕様変更**: `POST /api/part-measurement/templates/clone-for-schedule-key` で日程3要素へ複製してから記録（キオスクは `allowAlternate` 非依存）。**手動残り**: `/template/pick` の候補カード・図面ホバー・2要素/1要素候補からの記録開始を現場で目視。
- **2026-04-04 実績（候補スコープ正本・`feat/part-measurement-template-scope`）**: DB に `templateScope` / `candidateFhinmei`、マイグレーション `20260404100000_part_measurement_template_scope`。1要素候補は **`FHINMEI_ONLY` + 日程 `fhinmei` 照合**（テンプレ `name` の部分一致は廃止）。2要素は **`FHINCD_RESOURCE` または `THREE_KEY` で工程のみ不一致**。`matchKind`: `two_key_fhincd_resource` / `one_key_fhinmei`。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 は対象外**）。Detach Run ID: `20260404-203433-21652`（`raspberrypi5`）→ `20260404-204705-17552`（`raspberrypi4`）→ `20260404-205224-16394`（`raspi4-robodrill01`）→ `20260404-205635-22353`（`raspi4-fjv60-80`）→ `20260404-210133-32425`（`raspi4-kensaku-stonebase01`）、各 **`PLAY RECAP failed=0` / `unreachable=0`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 94s・Mac / Tailscale）。**トラブルシュート**: スキーマ未反映時は Pi5 で `pnpm prisma migrate status`（コンテナ経由）と `api` ログ、`templateScope` 列有無を確認。**手動残り**: `/template/pick` の新ラベル・1要素候補からの複製→記録を現場で目視。
- **2026-04-04 実績（日程3要素へ自動複製してから記録・`feat/kiosk-part-measurement-template-auto-clone`）**: キオスク `/template/pick` は **`exact_resource` 以外**で **`POST …/templates/clone-for-schedule-key`** → 得た `templateId` で **`POST …/sheets`**（**`allowAlternateResourceTemplate` なし**）。API・Web・統合テスト・ADR/KB 整合済み。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（Pi3 除外）。Detach Run ID: `20260404-170059-30131`（`raspberrypi5`）→ `20260404-172020-17394`（`raspberrypi4`）→ `20260404-172537-973`（`raspi4-robodrill01`）→ `20260404-172950-14766`（`raspi4-fjv60-80`）→ `20260404-173437-7794`（`raspi4-kensaku-stonebase01`）、各 **`PLAY RECAP failed=0` / `unreachable=0`**。**Phase12（反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 91s・Mac / Tailscale）。**知見**: 手動確認なしでも自動回帰は既存 `templates/candidates` スモークで担保；複製フロー専用の curl は checklist §6.6.9 を参照。**手動残り**: 2要素/1要素候補から記録し DB の active テンプレが日程キーで増えること・誤類似コピーの有無を現場で目視。
- **2026-04-05 実績（ハブ「測定値入力中」ペイン・`feat/kiosk-part-measurement-in-progress-pane`）**: Web のみ（一覧の **FHINMEI / 機種名** 表示・3列レイアウト・日時整形・文言統一）。API 契約変更不要（`listDrafts` が既に `fhinmei` / `machineName` を返す）。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 除外**）。Detach Run ID: `20260405-132318-28009`（`raspberrypi5`）→ `20260405-132940-8795`（`raspberrypi4`）→ `20260405-133535-3351`（`raspi4-robodrill01`）→ `20260405-134028-28183`（`raspi4-fjv60-80`）→ `20260405-134837-31511`（`raspi4-kensaku-stonebase01`）、各 **`PLAY RECAP failed=0` / `unreachable=0`**。**知見**: `--follow` 未完了のまま別端末のデプロイを起動すると **Mac 側ローカルロック**で停止しうる（Investigation 表）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 99s・Mac / Tailscale・Pi3 WARN は運用上スキップ可）。**手動残り**: 実下書きがあるとき一覧の識別性・折り返し・タップ領域をキオスクで目視。
- **2026-04-05 実績（管理テンプレ「編集」・版上げ API・`feat/admin-part-measurement-template-revise`）**: API `POST /api/part-measurement/templates/:id/revise`・`PartMeasurementTemplateService.reviseActiveTemplate`（トランザクション共通化）。Web 管理画面で **編集**／`revisePartMeasurementTemplate`・`partMeasurementTemplateAdminFormModel`。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **`--limit raspberrypi5` のみ**・`RASPI_SERVER_HOST`・`--detach --follow`（Pi4/Pi3 は当該変更の**必須対象外**。**Pi3** はリソース僅少のため専用手順は未実行）。Detach Run ID: **`20260405-163655-1727`**（`PLAY RECAP` **`failed=0`**・Pi4/Pi3 は `no hosts matched`）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 129s・Mac / Tailscale・Pi3 WARN は運用上スキップ可）。**手動残り**: 管理で **編集→保存**し新 `version`・旧版が無効になること、**図面なし**で `visualTemplateId` が外れることを目視。
- **2026-04-05 実績（管理テンプレ `FHINMEI_ONLY` 候補キー編集・論理削除・`feat/admin-part-measurement-template-edit-key-and-delete`）**: `revise` に **`candidateFhinmei`（`FHINMEI_ONLY` のみ）**。`POST /api/part-measurement/templates/:id/retire` で **有効版のみ `isActive: false`**（旧版**自動復活なし**）。統合テスト 23 件に拡張。**デプロイ**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`、**`--limit raspberrypi5` のみ**・`--detach --follow`。Detach Run ID: **`20260405-190119-2287`**（**`failed=0`**・Pi4/Pi3 `no hosts matched`）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 126s・Mac / Tailscale）。**手動残り**: 管理で **1要素テンプレの候補キー変更**・**削除**後に既定一覧から消え **無効版も表示**で残ることを目視。
- **2026-04-05 実績（`FHINMEI_ONLY` 部分一致・`feat/part-measurement-fhinmei-partial-match`）**: `template-candidate-rules.ts` で **NFKC+lower+空白正規化**、`日程fhinmei.includes(候補キー)`、候補キー **最短 2 文字**（`PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN`）、`one_key_fhinmei` 同士は **正規化後キー長降順**でタイブレーク。管理／キオスクの **`candidateFhinmei` は 2 文字以上**（Zod）。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 は対象外**・サイネージ専用手順は未実行）。Detach Run ID（記録されている後段例）: `20260405-115713-13575`（`raspi4-robodrill01`）→ `20260405-120152-18819`（`raspi4-fjv60-80`）→ `20260405-120844-9596`（`raspi4-kensaku-stonebase01`）；`raspberrypi5` / `raspberrypi4` は同一作業連の先行分（各 **`PLAY RECAP failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 132s・Mac / Tailscale）。**WARN**: Pi3 `signage-lite/timer` がオフライン扱い（スクリプト注記どおり **運用上スキップ可**）。**手動残り**: 日程品名が候補キーを **含むが完全一致ではない** 行で `/template/pick` に `one_key_fhinmei` が期待どおり並ぶか現場で目視。
- **2026-04-05 実績（複数記録表・セッション親子・`feat/part-measurement-multi-sheet-parent`）**: Prisma `PartMeasurementSession`・マイグレーション `20260406120000_part_measurement_multi_sheet_session`。キオスク API 応答に **`{ sheet, session }`**。編集画面は **上部セッションカード**・**別テンプレ追加**。親 **`completedAt`** と新規下書きの整合はサービス層（統合テストで担保）。**デプロイ**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`、**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 除外**・サイネージ専用手順は未実行）。Detach Run ID: **`20260405-214901-25613`**（`raspberrypi5`）→ **`raspberrypi4` / `raspi4-robodrill01` は同一作業連で先行順次・各 `PLAY RECAP failed=0`（厳密な runId は Pi5 `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.summary.json` を時系列で突合）** → `20260405-221648-17798`（`raspi4-fjv60-80`）→ `20260405-222224-6819`（`raspi4-kensaku-stonebase01`）。**トラブルシュート**: Mac 側の `--follow` が **15 分超**でタイムアウトしても、Pi5 上のデタッチ Ansible は **継続**し **`remote exit` 0** まで完走しうる → Pi5 の `*.exit` / `*.summary.json` で確認。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 **135s**・Mac / Tailscale）。**WARN**: Pi3（**今回未デプロイ**）の SSH 系チェックはスクリプト注記どおり **運用上スキップ可**。**手動残り**: 同一日程で **複数子シート**・カード切替・**別テンプレ追加**・親完了後の状態・CSV **`sessionId`** を現場で目視。
- **知見**: Pi4 単体 `--limit` でも Ansible は Pi5 上で実行される（`RASPI_SERVER_HOST` 設定が前提）。`--foreground` のキオスクデプロイは IME/ibus 等を含み **15〜25 分**/台かかることがある（タイムアウトに注意）。
- **トラブルシュート（デプロイ）**: **同じ `RASPI_SERVER_HOST` に対し、`update-all-clients.sh` を複数プロセスで同時起動しない**。2026-03-29 hardening 後は、2本目は Mac 側ローカルロック（`logs/.update-all-clients.local.lock`）または Pi5 ロック（`/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock`）で停止する。ロックを手動削除する前に、`runPid` が生存していないことを確認する（[deployment.md](../guides/deployment.md) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。
- **認可**: `Authorization` 付きで **403（権限不足）** のとき、書き込み系（例: `POST .../sheets`）では `x-client-key` にフォールバックしない（401 のみキー許可）。キオスクは通常キーのみで十分。

## References

- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md) / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md) / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md) / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)
- 沉浸式 allowlist: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
