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
| Mac で **`https://100.106.158.2/admin` がタイムアウト**（Tailscale アプリは Connected） | Mac: `tailscale status` に **`raspberrypi` / `100.106.158.2` が無い** · `tailscale ping 100.106.158.2` → **`no matching peer`** · Mac の `Self.Tags` が **空**（Pi5 は **`tag:server`**） | **Tailscale ACL**（`tag:admin` → `tag:server` の `tcp:443`）が効くため、Mac に **`tag:admin` を再付与**（[KB-278](./infrastructure/security.md#kb-278-tailscale経由で-https-admin-にアクセスできないtagadmin-欠落)）· 暫定は LAN `https://192.168.10.230/admin` |

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

## 検査図面 MVP（2026-05-30）

正本 ExecPlan: [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)。Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)「検査図面 MVP」節。

### 仕様サマリ（後続エージェント向け）

| 区分 | 内容 |
|------|------|
| **一覧/作成/編集** | キオスクヘッダー **「検査図面」**（アンバー・部品測定タブとは別アクティブ）。URL: `/kiosk/part-measurement/inspection`（一覧ハブ）。一覧から **新規** / **編集** / **履歴**。**新規**は `POST /api/part-measurement/templates`（図面必須・`THREE_KEY`）。**編集保存**は専用 `POST /api/part-measurement/inspection-drawing/templates/:id/revise`（有効版のみ）。**読込**は専用 `GET …/inspection-drawing/templates` / `GET …/:id`（汎用 `GET /templates/:id` はキオスク検査図面編集から使わない）。資源は **表示名付きドロップダウン**（`listResourceOptions`）。品番・資源・工程は編集画面で **表示専用**（改版でキーは変えない）。 |
| **一覧 API 契約** | `GET /api/part-measurement/inspection-drawing/templates` — クエリ `fhincd`（**部分一致・case-insensitive**）、`processGroup`（`cutting`/`grinding`）、`resourceCd`、`includeInactive`。応答は **要約 DTO**（`itemCount` のみ・全 `items` は載せない）。対象は **本番** `THREE_KEY` + 切削/研削 + `visualTemplateId` あり + `templateSupportsInspectionDrawing`（全項目に図面座標と上下限）。 |
| **取得 API 契約** | `GET …/inspection-drawing/templates/:id` — 上記条件を満たす本番テンプレのみ。**無効版（履歴）も閲覧可**。条件外は **409**「検査図面編集の対象外」。 |
| **改版 API 契約** | `POST …/inspection-drawing/templates/:id/revise` — **有効版（`isActive: true`）のみ**。無効版は **409**「無効なテンプレートは編集できません」。内部は既存 `reviseActiveTemplate`（新 `version` 行・旧版 inactive）。 |
| **一覧 UI** | `KioskInspectionDrawingLibraryPage.tsx` — 品番フィルタは API の部分一致と一致。カードは **有効版を優先表示**（同キーで active があればそれを先頭）。**履歴**は `InspectionDrawingTemplateHistoryDialog`（同系譜の版一覧・閲覧/有効化導線）。 |
| **編集 UI** | `KioskInspectionDrawingCreatePage.tsx` — 新規/編集兼用。旧版は **readOnly**（保存・改版不可）。**有効化**後は専用 GET で再取得し readOnly 解除（同一 URL のまま）。 |
| **本番記録編集** | 図面付き本番テンプレ + 記録表 **`quantity === 1`** → **`/kiosk/part-measurement/inspection/edit/:sheetId`**。保存・確定は **通常** `PATCH/POST …/sheets/*`。`quantity > 1`・図面なし・座標/上下限未設定 → **表形式** `/edit/:sheetId`。 |
| **評価用** | `evaluation-templates` / `evaluation-sheets/*` は **互換残置**。キオスク UI 主導線からは未使用。本番 sheet ↔ 評価 API は **409** 相互ブロック。 |
| **図面対象判定** | `part-measurement-inspection-drawing-policy.ts` — `templateSupportsInspectionDrawing`: visual に `drawingImageRelativePath`、全 item で `markerXRatio`/`markerYRatio`/`lowerLimit`/`upperLimit` が非 null。 |
| **画像** | PNG/JPEG/WebP に加え **PDF（1ページ目のみ→JPEG化して保存）**。TIFF は後続。PDF 入力上限 **30MB**、保存画像上限 **12MB**、変換 **DPI 144 / quality 85 / timeout 30s**。 |
| **ヘッダー・ルート** | `kioskInspectionDrawingRoutes.ts` — 既定 `inspection`、作成 `inspection/create`、テンプレ編集 `inspection/templates/:id/edit`、記録図面 `inspection/edit/:sheetId`。`isKioskInspectionDrawingPath` で部品測定タブを非アクティブ。 |

## 自主検査 MVP（2026-06-01） {#自主検査-mvp-2026-06-01}

### 仕様サマリ

| 区分 | 内容 |
|------|------|
| **タブ** | キオスクヘッダーに **`自主検査`** を追加。`/kiosk/part-measurement/self-inspection/*` 全体をアクティブ扱い。 |
| **一覧 UI** | `KioskSelfInspectionPage.tsx`。生産スケジュールを leaderboard profile で取得し、**図面付き `THREE_KEY` テンプレ**に一致する行だけを表示。 |
| **入力 UI** | `KioskSelfInspectionSessionPage.tsx`。既存 `InspectionDrawingCanvas` / `InspectionDrawingValuePanel` / `useInspectionDrawingZoom` を再利用。図面画像は **`usePartMeasurementDrawingBlobUrl`** を通して認可付き取得。 |
| **管理 UI** | 管理テンプレ・キオスク検査図面作成/改版に `selfInspectionMode`（`full` / `single` / `first_last` / `fixed_count`）と `selfInspectionFixedCount`（`fixed_count` 時のみ必須）。API は `sample` を `fixed_count` のエイリアスとして受理。 |
| **保存モデル** | `SelfInspectionSession -> SelfInspectionLotEntry -> SelfInspectionMeasurementValue` の3層。`SelfInspectionLotEntry.entrySlotKind` で「最初/最終」等の意味を保持。 |
| **完了条件** | 必須 **slot 集合**がすべて測定値保存済みかで判定（件数だけにしない）。`full` は `plannedQuantity`（**2,000 件超は開始不可**）。`single` は 1 件。`first_last` は `plannedQuantity >= 2` のみ、index `0` と `plannedQuantity-1` の 2 slot。`fixed_count` は `1 <= selfInspectionFixedCount <= plannedQuantity`。 |
| **順位ボード連携** | decoration に `hasSelfInspectionDrawing` / `selfInspectionStatus` / `selfInspectionEntryPath` を追加。図面あり行だけ **検** ボタンを表示。 |

### API 契約

- `POST /api/part-measurement/self-inspection/sessions/resolve-or-create`
- `GET /api/part-measurement/self-inspection/sessions`
- `GET /api/part-measurement/self-inspection/sessions/:id`
- `POST /api/part-measurement/self-inspection/sessions/:id/entries`
- `PATCH /api/part-measurement/self-inspection/sessions/:id/entries/:entryId`
- `POST /api/part-measurement/self-inspection/sessions/:id/complete`

補足:

- `sessionBusinessKey` は `productNo + processGroup + resourceCd + scheduleRowId`（**日程行単位・templateId は含めない**）。改版後も同一セッションに戻る。`resolve-or-create` は **`scheduleRowId` と `fseiban` 必須**（生産日程行の存在・整合を検証）。
- **業務キー移行（`20260601120000_self_inspection_session_business_key_v2`）**: templateId 違いの重複セッションは自動で勝者 1 件に寄せる。空セッションは削除、エントリは `entryIndex` がぶつからない分だけ移す。**両方に同一 index のエントリがある**場合は migration が止まる → Runbook「業務キー移行の事前確認」の SQL で検出し、手動統合後に再デプロイ。
- **公差・完了**: 保存/完了は `lowerLimit`/`upperLimit` 内のみ許可（公差外は 400/409）。`fixed_count` は `fixedCount <= plannedQuantity`。`first_last` は `plannedQuantity === 1` でテンプレ保存・開始不可（1 件への自動縮退なし）。小数桁は数値 JSON も `Decimal` 量子化で検証。セッション行は `FOR UPDATE` で完了競合を防止。
- **正本契約（コード）**: `apps/api/src/services/part-measurement/self-inspection-config.ts`（`validateSelfInspectionConfig` / `listRequiredEntrySlots`）。Migration: `20260602120000_self_inspection_four_modes`（enum/カラム）→ `20260602120100_self_inspection_sample_to_fixed_count`（`SAMPLE`→`FIXED_COUNT`。**Postgres は新 enum 値を別マイグレーションで使う**）。
- **入力更新**: `PATCH …/entries/:id` は `ifUnmodifiedSince`（entry `updatedAt` の ISO）必須。不一致・同時更新は **409**（再読込案内）。
- **旧形式セッション**: 全数で `expectedEntryCount < plannedQuantity` のとき、API は `requiredEntryCount` と `entryCountBlockedReason` を返す。指示数が 2,000 超の不整合は **保存・完了不可**（再作成導線）。2,000 以下の不整合は初回 mutation で `expectedEntryCount` を `plannedQuantity` に修復。
- **キオスク入力 UI**: ドラフトは選択中の入力件のみ生成。入力件ボタンは 48 件ずつページング。
- **一覧装飾**: 抜取数 > 指示数のテンプレ、または **全数で指示数 > 2,000** の行は `hasSelfInspectionDrawing: false`（一覧全体は落とさない）。**既存セッション**はテンプレ退役後も `scheduleRowId` で再開導線を出す。
- **詳細 API**: `GET …/sessions/:id?entryIndex=N` で `focusedEntry` のみ測定値を返す。一覧 `entries` はメタデータのみ。保存後は React Query を該当 entry だけ `setQueryData` 更新。
- **キオスク一覧**: `GET /kiosk/production-schedule?selfInspectionEligibleOnly=true` で開始可能行のみをサーバー側抽出（生産日程をチャンク走査、`page` / `pageSize` / `hasMore`）。
- 順位ボードの `selfInspectionEntryPath` は `/start?...` を返し、UI 側で resolve-or-create して **既存セッションへ再入場**できる。
- 検査図面一覧 API `GET /inspection-drawing/templates` も `selfInspectionMode` / `selfInspectionFixedCount`（互換で `selfInspectionSampleSize`）を返す。キオスク改版 `POST …/inspection-drawing/templates/:id/revise` も自主検査設定を受け付ける。
- **検査図面編集（丸数字・公差）**: 測定点は `markerNo` 独立採番（削除で他番号は変えない・追加は最小欠番）。UI は基準値＋上側/下側公差（正の幅）→ 保存時に絶対 `lowerLimit`/`upperLimit`（`apps/web/.../toleranceFields.ts`）。**基準値は符号付き可**（幅のみ非負）。`nominalValue=null` で下限/上限だけある既存行は **`legacyAbsoluteBounds`** を編集するまで絶対値を維持（`markerNumbering.ts` / `mergeInspectionDrawingPointPatch`）。

## 自主検査・検査図面 仕様拡張 本番（2026-06-03） {#自主検査-検査図面-仕様拡張-本番-2026-06-03}

### 進捗・デプロイ

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/inspection-drawing-count-and-tolerance`** → **`main` マージ（2026-06-03）** |
| 代表コミット | **`2f3979ce`** — `feat(part-measurement): expand self-inspection count modes and drawing tolerance editing` |
| 変更種別 | **API + Web + Prisma**（Pi5: `api`/`web` 再ビルド + `prisma migrate deploy`）· Pi4: **`kiosk-browser` 再起動** + Pi5 SPA 反映 |
| Pi5 Detach | **`20260603-074547-17661`** · `failed=0` · HEAD **`2f3979ce`** · migrations **103 件・up to date** |
| Pi4 代表 Detach | **`raspi4-kensaku-stonebase01`**: **`20260603-075813-27911`** · `failed=0` |
| Pi4 研削メイン再同期 | **`raspberrypi4`**: **`20260603-115435-29435`** · HEAD **`b787c273`** · TS 障害復旧後（[KB-384](./infrastructure/security.md#kb-384-pi4-キオスク非表示tailscale-再認証後の-netmap-未同期)） |
| 本番実機 | **Pi5 + Pi4×4 全台 OK**（管理テンプレ 4 モード · キオスク検査図面 公差/採番 · 自主検査 入力 slot ラベル） |
| 参照デプロイ手順 | [deployment.md §2026-06-03](../guides/deployment.md#kiosk-self-inspection-four-modes-and-tolerance-2026-06-03) |

### 運用障害・復旧（2026-06-03 午後 · `raspberrypi4`）

| 時系列 | 事象 | 対処 |
|--------|------|------|
| 1 | Mac `https://100.106.158.2/admin` 不通 | **`tag:admin` 再付与**（[KB-278](./infrastructure/security.md#kb-278-tailscale経由で-https-admin-にアクセスできないtagadmin-欠落)） |
| 2 | 続けて Pi5 **`NeedsLogin` / node key expired** | Pi5: `sudo tailscale up --advertise-tags=tag:server` + 承認（[KB-385](./infrastructure/security.md#kb-385-pi5-tailscale-needslogin-と-node-key-失効)） |
| 3 | 研削メイン Pi4 **キオスク非表示** · TS `curl` **000** · LAN **200** | Pi4 TS 再ログイン承認後も **netmap 未同期** → `tailscaled` 再起動 + **`tag:kiosk --reset`** · 暫定 **LAN URL** → TS URL へ戻し（[KB-384](./infrastructure/security.md#kb-384-pi4-キオスク非表示tailscale-再認証後の-netmap-未同期)） |
| 4 | Pi4 リポジトリ **`_appRef=cd503aa4`（古い）** | **`update-all-clients.sh main --limit raspberrypi4`** → **`b787c273`** · 現場 **正常化 OK** |

**知見**: Tailscale **ブラウザ承認だけ**では Pi4 の `InMagicSock` / Pi5 peer 表示が揃わないことがある。**`--reset` 付き `tailscale up`** が必要。Pi5 に **`tag:kiosk` で up する誤操作**は避ける（正は **`tag:server`**）。

### 実装レビューで入れた契約（後続エージェント向け）

| 論点 | 決定 |
|------|------|
| Postgres enum | 新値 `FIXED_COUNT` の **UPDATE は別 migration**（同一ファイル内で commit 前に使わない） |
| 改版 `fixed_count` → 他モード | body の `selfInspectionFixedCount`: **`undefined`=継承** · **`null`=クリア**（`??` だけにしない） |
| キオスク改版 `selfInspectionMode` 省略 | **既存テンプレ設定を継承**（未指定を `full` に落とさない） |
| 旧 `full` セッション UI | Web slot 数は **`requiredEntryCount` 優先**（`expectedEntryCount` のみだとボタン不足） |
| `first_last` ページ表示 | slot 配列上の index でページ計算（raw `entryIndex/plannedQuantity` 禁止） |
| `entrySlotLabel`（API） | `FIXED` は **`entryIndex+1`** · `FIRST`/`LAST` は日本語ラベル |
| 公差 UI 既存データ | `nominalValue=null` + 絶対上下限あり → **未編集なら絶対値維持** |

### 代表ファイル（追加分）

| 領域 | パス |
|------|------|
| 契約・検証 | `apps/api/src/services/part-measurement/self-inspection-config.ts` |
| migration 1 | `apps/api/prisma/migrations/20260602120000_self_inspection_four_modes/migration.sql` |
| migration 2 | `apps/api/prisma/migrations/20260602120100_self_inspection_sample_to_fixed_count/migration.sql` |
| 公差 adapter | `apps/web/src/features/part-measurement/inspection-drawing/toleranceFields.ts` |
| 採番 | `apps/web/src/features/part-measurement/inspection-drawing/markerNumbering.ts` |
| キオスク slot | `apps/web/src/features/part-measurement/selfInspectionEntrySlots.ts` |
| 単体テスト | `apps/api/.../self-inspection-config.test.ts` · `apps/web/.../selfInspectionEntrySlots.test.ts` · `toleranceFields.test.ts` · `markerNumbering.test.ts` |

## 順位ボード「検」→ 自主検査で図面が空白（2026-06-03） {#self-inspection-session-drawing-blank-2026-06-03}

### 症状

- 順位ボードの **検** から自主検査入力を開くと、**測定値パネルは表示**されるが **図面エリアだけ空白**（または「図面がありません。」）。
- API・ストレージは正常なケースあり（`GET …/self-inspection/sessions/:id` に `drawingImageRelativePath` あり、`GET /api/storage/part-measurement-drawings/…` が **200**）。

### 根本原因（Web）

- `KioskSelfInspectionSessionPage` の図面列だけ、検査図面 Create/Edit が使う **`inspectionDrawingCanvasColumnClassName`**（`flex` + `min-h-[min(72dvh,760px)]`）を適用していなかった。
- その結果 `InspectionDrawingCanvas` の viewport の **`clientHeight` が 0** のまま `zoomedLayout` が組めず、図面が描画されない。
- 副次: `blobUrl` 未取得中を「図面がありません」と表示していた（読込中と区別なし）。

### 修正内容

| 項目 | 内容 |
|------|------|
| レイアウト | 左カラムへ **既存** `inspectionDrawingCanvasColumnClassName` をそのまま適用（共有クラス本体は変更しない） |
| 表示分岐 | `hasDrawingPath` / 読込中 / エラー / 図面なしを `selfInspectionSessionDrawingPanelState.ts` で明示。図面取得失敗メッセージは **図面パネル内のみ**（ヘッダー重複なし） |
| 関連 Web | `KioskSelfInspectionSessionPage.tsx` · `selfInspectionSessionDrawingPanelState.ts` · `inspectionDrawingKioskUi.ts` |

### 確認方法

| 種別 | 手順 |
|------|------|
| 単体 | `pnpm --filter web test selfInspectionSessionDrawingPanelState`（表示フェーズ） |
| 手動 | キオスク **検** → 自主検査入力。図面パスありで **読込中 → キャンバス表示**。DevTools で viewport **`clientHeight > 0`** |
| 任意 E2E | `e2e/self-inspection-session-drawing-layout.spec.ts` — **`E2E_SELF_INSPECTION_SESSION_ID` 未設定時は skip**（Pi5 実セッション fixture 前提の手動検証用） |

### 代表ファイル

| 領域 | パス |
|------|------|
| Prisma | `apps/api/prisma/schema.prisma` |
| Migration | `apps/api/prisma/migrations/20260601090000_add_self_inspection_mvp/migration.sql` |
| Service | `apps/api/src/services/part-measurement/self-inspection.service.ts` |
| 契約 | `apps/api/src/services/part-measurement/self-inspection-config.ts` |
| API route | `apps/api/src/routes/part-measurement/index.ts` |
| Admin UI | `apps/web/src/pages/admin/PartMeasurementTemplatesPage.tsx` |
| Kiosk 一覧 | `apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx` |
| Kiosk 入力 | `apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx` |
| キオスク検査図面編集 | `apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx` |
| Leaderboard row | `apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx` |

### 知見

- **図面 URL 直渡し禁止**: 自主検査入力画面でも `<img src="/api/storage/...">` を直に使うと kiosk 認可で 401 になりうる。既存検査図面と同じく **Blob 読込フック**へ寄せる。
- **セッション突合せは `scheduleRowId` 優先**: 一覧画面で `productNo/resourceCd/fhincd` だけだと同一品番の別 order が混ざる余地がある。`scheduleRowId` がある場合は最優先キーにする。
- **テスト DB 手順**: ローカルでは `start-postgres -> prisma migrate deploy -> prisma generate -> test -> stop-postgres` の順が安全。起動待ち前に migrate/test を並列で走らせると `P1001` になりうる。

### 既知制約

- 一覧 API/入力 UI は **図面付き `THREE_KEY` テンプレ**前提。`FHINMEI_ONLY` / `FHINCD_RESOURCE` は自主検査対象にしていない。
- 入力画面は現時点で **社員タグ/NFC** をまだ統合していない。
- ローカル API 統合テストは、本件追加分の契約テストは通る想定だが、既存 `part-measurement.integration.test.ts` 全体は DB 初期条件依存のため、既存スクリプト順守が必要。

### 代表 Web/API ファイル（一覧ハブ `ef78f4dd`）

| 領域 | パス |
|------|------|
| 一覧ページ | `apps/web/src/pages/kiosk/KioskInspectionDrawingLibraryPage.tsx` |
| 作成/編集 | `apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx` |
| 履歴ダイアログ | `apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingTemplateHistoryDialog.tsx` |
| クライアント | `apps/web/src/api/client.ts`（`listKioskInspectionDrawingTemplates` 等） |
| ルート登録 | `apps/web/src/App.tsx` |
| API ルート | `apps/api/src/routes/part-measurement/index.ts`（`inspection-drawing/templates*`） |
| サービス | `apps/api/src/services/part-measurement/part-measurement-template.service.ts` |
| 統合テスト | `apps/api/src/routes/__tests__/part-measurement.integration.test.ts`（専用 API・409・部分一致） |

### 知見（実装・デプロイ・レビュー）

- **デプロイ前 push 必須**: `update-all-clients.sh` はローカルブランチが `origin/<branch>` より ahead だと **即終了**（未 push コミットがあると Pi5 だけ古い SHA を取る事故を防ぐ）。
- **専用 API の理由**: 汎用 `GET/POST /templates/:id` だと `FHINMEI_ONLY` や図面未設定テンプレを編集でき、**改版で本番キーを壊す**リスクがある。一覧も汎用 `GET /templates` の完全一致 `fhincd` では現場の部分検索と合わない。
- **要約 DTO**: 一覧で全 `items` を返すとキオスクが重い。`itemCount` のみに限定。
- **有効化後の readOnly 残留**: クライアント state だけ更新すると編集不可のまま残る → **専用 GET で `applyLoadedTemplate`** してから編集モードへ。
- **Phase12**: `verify-phase12-real.sh` は **検査図面専用 API を個別 grep しない**（`resolve-ticket` / `templates/candidates` の部品測定スモークのみ）。専用 API は **統合テスト** + 手動／下記 curl で担保。

### 検査図面 · PDF 取込（2026-06-02）

| 区分 | 内容 |
|------|------|
| **保存入口** | `POST …/visual-templates` · `POST …/inspection-drawing/evaluation-templates`（multipart `file`） |
| **preview 入口** | `POST …/drawings/preview`（multipart `file` · **DB/storage なし** · rate limit 有効） |
| **変換** | `importDrawingAndSave` / `convertDrawingUploadToPreviewBuffer` → 1 ページ目 JPEG（同一 `pdftoppm` 契約） |
| **Web プレビュー** | 画像はローカル `blob:` · PDF は preview API → JPEG `blob:` + 保存時 **同一 JPEG File** |
| **上限** | 画像 12MB / PDF 30MB / 保存 12MB |
| **負荷** | PDF 変換はプロセス内 **同時 1 件**・待ち **最大 4**（超過時 **503**）— preview / save 共通 |
| **検証順** | evaluation multipart は **items/body 検証後**に `importDrawingAndSave`（孤立ファイル防止） |
| **表示** | Canvas は **画像 URL のみ**（PDF Blob 直 `<img>` なし） |
| **保存制御** | PDF 変換中・preview JPEG 未確定は保存不可 |
| **編集時失敗** | 新 PDF preview 失敗時は **既存図面維持** + エラー表示 |

**代表ファイル（`8307c995`）**:

| 領域 | パス |
|------|------|
| preview 変換（副作用なし） | `apps/api/src/lib/part-measurement-drawing-preview.ts` |
| save 取込（preview 関数再利用） | `apps/api/src/lib/part-measurement-drawing-import.ts` |
| preview エンドポイント | `apps/api/src/routes/part-measurement/index.ts`（`POST …/drawings/preview`） |
| Web ローカル preview | `apps/web/src/features/part-measurement/usePartMeasurementDrawingLocalPreview.ts` |
| preview 契約・MIME 判定 | `apps/web/src/features/part-measurement/partMeasurementDrawingLocalPreview.ts` |
| Canvas 表示統合 | `inspectionDrawingTemplateImageDisplay.ts` · `KioskInspectionDrawingCreatePage.tsx` |
| クライアント API | `apps/web/src/api/client.ts`（`previewPartMeasurementDrawing`） |
| 単体/統合テスト | `part-measurement-drawing-preview.test.ts` · `part-measurement-drawing-preview.integration.test.ts` · Web `*LocalPreview*.test.ts` |

**本番デプロイ実績（PDF プレビュー整合 · 2026-06-02）**:

| 段階 | ブランチ | ホスト | Detach Run ID | HEAD | PLAY RECAP | Phase12 | 備考 |
|------|----------|--------|---------------|------|------------|---------|------|
| Pi5 先行 | `feat/inspection-drawing-pdf-import` → **`main` `a3ce2284`**（PR #382） | `raspberrypi5` | **`20260602-190538-1780`** | **`8307c995`**（デプロイ時） | **`failed=0`** | **41/1/1** | **キオスク目視 OK** · `pdftoppm` 22.12.0 |
| **未** | `main` マージ後 | Pi4×4 | — | — | — | — | 1 台ずつ `--limit` |

**CI**: **`26812045529`** success（`8307c995`）。

**preview curl（Tailscale）**:

```bash
BASE="https://100.106.158.2/api"
KEY="client-key-raspberrypi4-kiosk1"

curl -sk -o /dev/null -w "%{http_code}\n" -X POST "${BASE}/part-measurement/drawings/preview"
curl -sk -D - -o /tmp/preview-out.jpg \
  -H "x-client-key: ${KEY}" \
  -F "file=@/tmp/test-drawing.pdf;type=application/pdf" \
  "${BASE}/part-measurement/drawings/preview"
```

**知見（実装・レビュー · 2026-06-02）**:

- **PDF Blob を `<img>` に渡さない**: ブラウザは PDF を img で描画できない。必ず API preview → JPEG `blob:`。
- **save と preview は同一ラスタ**: `convertDrawingUploadToPreviewBuffer` を save 側 `importDrawingAndSave` からも共有し、座標ずれを防ぐ。
- **AbortController**: ファイル差し替え時は前リクエストを abort。成功コールバックでも `signal.aborted` を再確認（レース防止）。
- **preview 失敗時の pending**: 失敗で `hasPendingLocalSelection` を残すと保存が永久ブロック → 失敗パスで解除。
- **Pi5 実機 curl**: SSH 先 `127.0.0.1:3000` は Caddy 構成では **000** になりうる。**Tailscale HTTPS** で `/api/...` を叩く（[deployment §PDF プレビュー](../guides/deployment.md#kiosk-inspection-drawing-pdf-preview-parity-2026-06-02)）。
- **Phase12**: `verify-phase12-real.sh` は **`drawings/preview` を個別 grep しない**。上記 curl + キオスク目視で担保。

### トラブルシュート（検査図面）

| 症状 | 確認 | 対処 |
|------|------|------|
| **「検査図面」タブがない** | Git HEAD ≥ `ef78f4dd`（一覧ハブ）か。Pi4 未デプロイか | Pi5: 強制リロード（§6.6.4）。Pi4: `--limit` 各台で `main` 反映後に同確認 |
| タブ表記が **「検査図面作成」** のまま | HEAD &lt; `ef78f4dd` | 一覧ハブブランチをデプロイ |
| 部品測定タブと検査図面が同時ハイライト | `kioskInspectionDrawingRoutes` 未反映 | `583aecad` 以降を確認 |
| 一覧にテンプレが出ない | `THREE_KEY`・図面・全マーカー/上下限・本番（評価バケット除外） | 管理画面で visual + 座標・上下限を揃える。`templateSupportsInspectionDrawing` を満たすか |
| 編集で **409 対象外** | 汎用 API で取得していないか。スコープ/工程/図面条件 | **専用** `GET …/inspection-drawing/templates/:id` を使う |
| 旧版で保存できない | `isActive: false` | 想定どおり閲覧専用。履歴から **有効化** または有効版を開く |
| 有効化しても編集できない | 再取得していない | `ef78f4dd` 以降の「有効化→専用 GET 再読込」を確認 |
| 品番検索でヒットしない | 完全一致フィルタになっていないか | 一覧は API **部分一致**。クライアント側で追加絞り込みしない |
| デプロイが始まらない | `git status` で ahead | **push** してから `update-all-clients.sh` |
| **一覧から編集で図面が出ない**（測定点は見える） | テンプレ編集画面が `drawingImageRelativePath` を `<img src>` 直指定している | 下記 [§テンプレ編集・認可付き図面読込](#検査図面-テンプレ編集-認可付き図面読込-2026-05-31) · **`main` `e12a5a9c` 以降** |
| 編集で図面は出るが **拡大2回目（倍率1.5付近）だけ震える** | `ResizeObserver` + スクロールバーで `clientWidth`/`Height` が揺れ再レイアウトループ | 下記 [§キャンバスズーム痙攣](#検査図面-キャンバスズーム痙攣修正-2026-05-31) · **`main` `f6a9544a` 以降** · 強制リロード |
| テンプレ切替直後に **旧図面＋新測定点** が一瞬重なる | `usePartMeasurementDrawingBlobUrl` が path 変更時に旧 `blobUrl` を残す | **`main` `e12a5a9c` 以降**（path 変更で即 `null` + revoke） |
| PDF を選んでも取込できない | 12MB 上限で変換前 reject していないか · `pdftoppm` 有無 | **30MB** PDF 入力契約・API ログ · poppler-utils |
| PDF 選択後プレビューが空白 | PDF Blob を `<img>` に直接渡している旧実装 | preview API 経由 JPEG · `usePartMeasurementDrawingLocalPreview` |
| PDF 変換中に保存できて座標がずれる | 保存前 preview JPEG と save ラスタが不一致 | preview で得た JPEG File を save に再利用 |
| PDF 取込が **503** | 変換待ちが上限超過 | しばらく待って再送。同時 PDF アップロードを減らす |
| PDF 変換後に文字欠け | Arial 等のフォント | 本番コンテナのフォント追加を検討 |
| PDF 変換失敗後 **保存できない** | preview 失敗時に pending が残る | **`8307c995` 以降** — 失敗時 pending 解除 · 強制リロード |
| ファイル差し替えで **古い図面が一瞬表示** | abort レース | **`8307c995` 以降** — 成功パスでも `signal.aborted` 確認 |
| Pi5 SSH で API health **000** | localhost:3000 直叩き | **HTTPS Tailscale IP** 経由で確認 |
| 図面UIに行かず表形式 | `quantity !== 1` または図面条件不足 | `45c02e0a` 参照。数量・テンプレを確認 |
| 評価保存で本番テンプレが消える | 誤 API | **evaluation-templates** のみ |
| 空入力で旧測定値が残る | PATCH null 未送信 | サービス層 `deleteMany`（`45c02e0a`） |

### 検証コマンド例（専用 API・Tailscale）

```bash
BASE="https://100.106.158.2/api"
KEY="client-key-raspi4-kensaku-stonebase01-kiosk1"   # キオスク x-client-key の例

# 未認証 → 401
curl -sk -o /dev/null -w "%{http_code}\n" "${BASE}/part-measurement/inspection-drawing/templates"

# 一覧（要約 DTO）
curl -sk "${BASE}/part-measurement/inspection-drawing/templates?limit=5" -H "x-client-key: ${KEY}"
```

### 本番デプロイ実績（2026-05-30）

| 段階 | ブランチ / マージ | ホスト | Detach Run ID | HEAD | PLAY RECAP | Phase12 | 備考 |
|------|-------------------|--------|---------------|------|------------|---------|------|
| 本番導線 | `feat/kiosk-inspection-drawing-mvp` → `main` `44f91ab5` | `raspberrypi5` | `20260530-145930-18923` | `dd27791a` | `failed=0` | 43/0/0 | quantity=1 図面 edit |
| ヘッダータブ | 同上 | `raspberrypi5` | `20260530-153416-23422` | `583aecad` | `failed=0` | 42/1/0 | タブ「検査図面作成」→後に「検査図面」へ改名 |
| **一覧ハブ** | PR [#374](https://github.com/denkoushi/RaspberryPiSystem_002/pull/374) → **`main` `f0a2725c`**（squash） | `raspberrypi5` | `20260530-180728-7767` | `ef78f4dd`（デプロイ時） | `failed=0` | 42/1/0 | 専用 API・履歴 UI・約12min・Pi3 WARN スキップ可 |
| **未** | `main` で Pi4 順次 | Pi4×4 | — | — | — | — | キオスク実機でタブ・一覧を確認 |

**標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**1 台ずつ**）。

**CI**: MVP `26676840821` · 一覧ハブ `26679994903` **success**（push `ef78f4dd`）。

## 検査図面 · DEV プレビュー本番パリティ（2026-05-30） {#検査図面-preview-parity-2026-05-30}

正本 ADR: [ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md)。ExecPlan / Runbook / [deployment §プレビュー](../guides/deployment.md#kiosk-inspection-drawing-preview-parity-2026-05-30) と併読。

### 背景（なぜズレたか）

| 仮説 | 結果 |
|------|------|
| `transform: scale` で縮小している | **REJECTED** — 本番でも scale は使っていない |
| DEV が `KioskLayout` 外・`h-dvh` 全画面 | **CONFIRMED** — ヘッダー・パディング・スクロール領域が本番と不一致 |
| プレビュー専用 JSX の複製 | **CONFIRMED** — フィルタ grid・測定点 `grid-cols-3` などが本番だけ更新されず残った |

### レンダリング契約（後続エージェント向け）

| 区分 | 内容 |
|------|------|
| **原則** | レイアウト調整は **本番ページと同じコンポーネント**を描画する。静的モックや scale は最終手段にしない |
| **DEV シェル** | `App.tsx` で DEV ルートを **`KioskLayout` 子**に配置。`KioskInspectionDrawingDevPreviewChrome` が `min-w-[1280px]` + fixed DEV バーのみ追加 |
| **DEV URL** | `/dev/kiosk-inspection-drawing-library` · `/dev/kiosk-inspection-drawing-create`（fixture: `inspectionDrawingPreviewFixtures.ts`） |
| **本番 URL** | `/kiosk/part-measurement/inspection`（一覧）· `/inspection/create` · `/inspection/templates/:id/edit` |
| **共有コンポーネント** | `InspectionDrawingLibraryFilterBar` · `InspectionDrawingPointSettingsPanel` · `InspectionDrawingCreateToolbar`（本番ページ + DEV プレビューページ双方から import） |
| **一覧フィルタ UI** | **`flex-wrap`**。資源 `<select>` は **`overflow-hidden` シェル**（`InspectionDrawingResourceCdSelect`）で隣列と重ならない。旧 `lg:grid-cols-[13rem_15rem_auto_auto_auto]` は廃止 |
| **測定点パネル** | 基準値・下限・上限は **縦並び**（1 列）。横 3 列 grid は廃止 |
| **作成ツールバー** | 保存の右に **「一覧へ戻る」**（`libraryTo` / `Link` + `buttonClassName` — `<Link><button>` は HTML 非妥当のため不可） |
| **作成画面下部** | 「図面をタップして測定点を追加」「一覧プレビューへ」等のリンクは **削除**（本番・DEV 共通） |
| **沉浸式** | `kioskImmersiveLayoutPolicy.ts` — `/kiosk/part-measurement` 子パスと整合。変更時は `kioskImmersiveLayoutPolicy.test.ts` を更新 |

### 代表ファイル（`ccacef85`）

| 領域 | パス |
|------|------|
| DEV chrome | `apps/web/src/pages/dev/KioskInspectionDrawingDevPreviewChrome.tsx` |
| DEV 一覧/作成プレビュー | `KioskInspectionDrawingLibraryPreviewPage.tsx` · `KioskInspectionDrawingCreatePreviewPage.tsx` |
| 共有フィルタ | `features/part-measurement/inspection-drawing/InspectionDrawingLibraryFilterBar.tsx` |
| 共有測定点 | `features/part-measurement/inspection-drawing/InspectionDrawingPointSettingsPanel.tsx` |
| 本番一覧/作成 | `pages/kiosk/KioskInspectionDrawingLibraryPage.tsx` · `KioskInspectionDrawingCreatePage.tsx` |
| ルート | `apps/web/src/App.tsx` |
| 契約テスト | `features/kiosk/kioskImmersiveLayoutPolicy.test.ts` |

### 本番デプロイ実績（プレビュー parity）

| ブランチ | ホスト | Detach Run ID | HEAD | PLAY RECAP | 備考 |
|----------|--------|---------------|------|------------|------|
| `feat/kiosk-inspection-drawing-preview-parity` | `raspberrypi5` | `20260530-192609-10677` | `ccacef85` | **failed=0** | Web rebuild · 約 **353s** · Pi4×4 **未** |

**CI**: **`26681207121`** success。

**標準コマンド（Pi5・ブランチ時）**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/kiosk-inspection-drawing-preview-parity \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

### トラブルシュート（プレビュー / レイアウト）

| 症状 | 確認 | 対処 |
|------|------|------|
| Mac DEV と Pi5 でレイアウトが違う | DEV が `KioskLayout` 外か · プレビュー専用 JSX か · `scale` か | ADR-20260530 契約どおり **共有コンポーネント + KioskLayout** · HEAD ≥ `ccacef85` |
| 一覧フィルタで列が重なる | 旧 grid レイアウト · または select overflow | `flex-wrap`（`ccacef85`）· それでも重なる場合は [§overflow](#検査図面-library-filter-overflow-2026-05-30)（`e19f9b07`） |
| 測定点が横3列 | プレビューだけ古い markup | `InspectionDrawingPointSettingsPanel` を本番・DEV 双方で使用しているか |
| 「一覧へ戻る」がない | ツールバー未更新 | `InspectionDrawingCreateToolbar` の `libraryTo` |
| DEV `/dev/...` が 404 | 本番ビルドのみデプロイ | DEV ルートは **開発サーバー**用。Pi5 本番は `/kiosk/part-measurement/inspection*` を確認 |
| Pi4 だけ旧 UI | Pi5 未デプロイ or Pi4 未反映 | **Pi5 先行** → `main` で Pi4 を `--limit` 順次 |

### エージェント向けプロンプト（レイアウト修正依頼時）

依頼文に最低限含めること:

1. **本番と同じレンダリング契約**（`KioskLayout` · 共有コンポーネント · scale 禁止）
2. 対象 URL（本番 `/kiosk/part-measurement/inspection/...` または DEV `/dev/kiosk-inspection-drawing-*`）
3. 期待スクリーンショット or 要素（フィルタ折り返し・測定点縦並び等）
4. 変更後は **本番ページと DEV プレビューの両方**で同じコンポーネントが変わること

## 検査図面 · 一覧フィルタ overflow 修正（2026-05-30） {#検査図面-library-filter-overflow-2026-05-30}

正本 ExecPlan: [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)。Runbook: [kiosk-part-measurement.md §フィルタ overflow](../runbooks/kiosk-part-measurement.md#検査図面-一覧フィルタ-overflow-2026-05-30)。deployment: [deployment.md §2026-05-30](../guides/deployment.md#kiosk-inspection-drawing-library-filter-overflow-2026-05-30)。

### 仕様・スコープ（後続エージェント向け）

| 区分 | 内容 |
|------|------|
| **変更種別** | **Web のみ**（`apps/web`）。API / Prisma / マイグレーション **なし** |
| **対象画面** | キオスク **検査図面** 一覧フィルタ（`InspectionDrawingLibraryFilterBar`）· 作成画面 **新規時**の資源 select（`KioskInspectionDrawingCreatePage`） |
| **非対象** | 記録図面 edit（`KioskInspectionDrawingEditPage`）· 専用 API 契約 · フィルタのクエリ意味（`fhincd` 部分一致等は不変） |
| **新規共有コンポーネント** | `InspectionDrawingResourceCdSelect` — 資源 CD の境界付きネイティブ `<select>` |
| **レイアウトトークン** | `inspectionDrawingKioskUi.ts` — `inspectionDrawingBoundedSelectShellClassName`（`overflow-hidden`）· `inspectionDrawingBoundedSelectClassName` · 一覧/作成の幅クラス |
| **一覧フィルタ** | 外枠は従来どおり `flex-wrap` + `gap-3` + `min-w-0`。資源欄のみ **クリップシェル**で隣列と重ならない |
| **作成 metadata 幅** | **`inspectionDrawingMetadataControlWidthClass`（`w-[10.5rem]`）を再利用** — `w-fit` への拡大は **しない**（コードレビュー [P2] 対応） |
| **履歴チェック** | `whitespace-nowrap` — 「履歴を含む」が「含む」だけに潰れない |

### 根本原因（調査結果）

```text
flex gap-3 は「flex アイテムの箱」間にしか効かない
  ↓
資源 <select> の描画幅が 15rem を超える（truncate はネイティブ select で実質無効）
  ↓
overflow: visible のまま右へはみ出し
  ↓
工程の緑ボタン・select の ▼・「履歴を含む」チェックが 1 本の白バーのように見える
```

| 仮説 | 結果 |
|------|------|
| CSS `gap` / `padding` が欠落 | **REJECTED** — `gap-3` は指定済み。見えないのは **はみ出し描画** |
| 旧 `lg:grid-cols-[13rem_15rem_auto…]` が残存 | **REJECTED**（Pi5 未デプロイ時のみ）— `ccacef85` 以降は flex-wrap。本件は **select overflow** が残課題 |
| `transform: scale` | **REJECTED** — 未使用 |
| 作成画面だけ列幅が広がる | **CONFIRMED（初版実装）** — `w-fit` 化で品番と不一致 → **`10.5rem` に修正** |

### 代表ファイル

| 領域 | パス |
|------|------|
| 共有 select | `apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingResourceCdSelect.tsx` |
| 一覧フィルタ | `InspectionDrawingLibraryFilterBar.tsx` |
| 作成 | `apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx` |
| トークン | `inspectionDrawingKioskUi.ts` |
| 回帰テスト | `inspectionDrawingBoundedSelectClasses.test.ts`（クラス定数に `overflow-hidden` 等が含まれること） |

### 本番デプロイ実績

| 段階 | ブランチ / マージ | ホスト | Detach Run ID | HEAD | PLAY RECAP | 備考 |
|------|-------------------|--------|---------------|------|------------|------|
| 実装 + CI | `fix/kiosk-inspection-drawing-library-filter-overflow` | — | — | `e19f9b07` | — | CI **`26683408296`** success |
| **Pi5 先行** | 同上（未マージ時） | `raspberrypi5` | `20260530-212035-5804` | `e19f9b07` | **failed=0** | Phase12 **42/1/0** · **実機目視 OK** |
| **Pi4×4** | **`main` `46ec0621`**（PR #376） | 4 台 | — | — | **未** |

**標準コマンド（Pi5・ブランチ時）**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/kiosk-inspection-drawing-library-filter-overflow \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

### トラブルシュート（一覧フィルタ）

| 症状 | 確認 | 対処 |
|------|------|------|
| 資源・工程・履歴が重なる | Pi5 HEAD &lt; `e19f9b07` · ブラウザキャッシュ | `main` 反映 + [強制リロード](../guides/verification-checklist.md) §6.6.4 |
| 工程下に select の ▼ だけ見える | 上記と同型（資源 select の矢印が隣列に重なっている） | `InspectionDrawingResourceCdSelect` + シェル `overflow-hidden` |
| 「含む」だけ表示 | 履歴ラベルが横潰れ | `whitespace-nowrap` on 履歴 checkbox ラベル |
| 作成画面だけ資源が幅いっぱい | `widthVariant=metadata` が `w-fit` のまま | HEAD ≥ 修正後 `e19f9b07`（`inspectionDrawingMetadataResourceFieldWidthClass` = 10.5rem） |
| flex-wrap なのに直らない | **overflow** 問題（grid ではない） | bounded select を確認。`truncate` だけでは不十分 |
| デプロイ拒否 | `git status` ahead | **push** してから `update-all-clients.sh` |

### テストの限界

- `inspectionDrawingBoundedSelectClasses.test.ts` は **Tailwind クラス文字列**の回帰のみ。**実際の描画崩れ**は Mac DEV（`/dev/kiosk-inspection-drawing-library`）または Pi5 キオスク目視で確認する。

## 検査図面 · キャンバスズーム UI（2026-05-30） {#検査図面-canvas-zoom-2026-05-30}

正本 ExecPlan: [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)。Runbook: [kiosk-part-measurement.md §キャンバスズーム](../runbooks/kiosk-part-measurement.md#検査図面-キャンバスズーム-2026-05-30)。deployment: [deployment.md §2026-05-30](../guides/deployment.md#kiosk-inspection-drawing-canvas-zoom-2026-05-30)。

### 仕様・スコープ（後続エージェント向け）

| 区分 | 内容 |
|------|------|
| **変更種別** | **Web のみ**（`apps/web`）。API / Prisma / マイグレーション **なし** |
| **対象画面** | テンプレ **作成/編集**（`KioskInspectionDrawingCreatePage`）· 記録 **図面 edit**（`KioskInspectionDrawingEditPage`）· DEV **`/dev/kiosk-inspection-drawing-create`** |
| **非対象** | 一覧ハブ（図面ビューアなし）· 専用 API 契約 |
| **UI 配置** | `InspectionDrawingCreateHeaderBand` の **`centerSlot`**（メタデータ列と右ツールバーの **横余白**）。**キャンバス列の上に行を足さない** |
| **操作** | **`−`** 縮小 · **`＋`** 拡大 · **`□`** 全面表示（zoom=1 + スクロール先頭）。**倍率％表示なし** |
| **倍率** | 既定 **1.0**（ビューポートにフィット）· 範囲 **0.5〜2.5** · 刻み **0.25**（`inspectionDrawingZoom.ts`） |
| **座標契約** | 保存は従来どおり **xRatio / yRatio**。ズームは **表示専用**（`computeZoomedCanvasLayout` + `overflow-auto`） |
| **ADR** | ページ全体の **`transform: scale` は使わない**（DEV プレビュー parity 契約）。図面内は **レイアウト寸法スケール** |

### 配置モードのポインタ契約（重要）

| イベント | 挙動 |
|----------|------|
| `pointerdown`（place） | 開始位置記録のみ（即 `onAddPoint` **しない**） |
| `pointermove` | 最大移動量を追跡 |
| `pointerup` | 移動 **&lt; 10px** なら `onAddPoint`（`inspectionDrawingCanvasPointer.ts`） |
| `pointercancel` | **pending 解除のみ**（パンでブラウザが cancel したとき誤追加しない） |

```text
初版: pointerdown で即追加 + touch-pan → パン開始位置に測定点が増える（タブレット）
  ↓
pointerup + 10px しきい値 + pointercancel は中止
```

### 代表ファイル

| 領域 | パス |
|------|------|
| ズーム state | `useInspectionDrawingZoom.ts` |
| ズーム UI | `InspectionDrawingCanvasZoomControls.tsx`（ボタン群のみ。中央スロット flex は HeaderBand） |
| ヘッダー | `InspectionDrawingCreateHeaderBand.tsx`（`centerSlot`） |
| キャンバス | `InspectionDrawingCanvas.tsx` |
| レイアウト計測フック | `useZoomedCanvasLayout.ts`（2026-05-31 痙攣対策） |
| レイアウト等価比較 | `inspectionDrawingCanvasLayoutCompare.ts` |
| レイアウト純関数 | `inspectionDrawingCanvasLayout.ts` · `inspectionDrawingCanvasPointer.ts` |
| 単体テスト | 上記 + `inspectionDrawingZoom.test.ts` |

### 本番デプロイ実績

| 段階 | ブランチ / マージ | ホスト | Detach Run ID | HEAD | PLAY RECAP | 備考 |
|------|-------------------|--------|---------------|------|------------|------|
| 実装 + CI | `feat/kiosk-inspection-drawing-canvas-zoom` | — | — | `364aa184` | — | CI **`26684356891`** success |
| **`main` マージ** | PR [#377](https://github.com/denkoushi/RaspberryPiSystem_002/pull/377) | — | — | **`e42aff35`** | — | squash |
| **Pi5 先行** | 同上（未マージ時） | `raspberrypi5` | `20260530-221723-1575` | `364aa184` | **failed=0** | Phase12 **42/1/0** · **実機目視 OK** |
| **Pi4×4** | **`main` マージ後** | 4 台 | — | — | **未** |

**標準コマンド（Pi5・ブランチ時）**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/kiosk-inspection-drawing-canvas-zoom \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

### トラブルシュート（キャンバスズーム）

| 症状 | 確認 | 対処 |
|------|------|------|
| ズームボタンがない | 図面未選択 · HEAD &lt; `364aa184` | 図面読込後に `centerSlot` 表示 · `main` 反映 + 強制リロード |
| 図面が矮くなった | キャンバス上にツールバー行を足していないか | `centerSlot` は HeaderBand のみ（`inspectionDrawingCanvasColumnClassName` 維持） |
| 拡大後ドラッグで点が増える | `pointercancel` が `onAddPoint` まで届いていないか | `handlePlacePointerCancel` のみ clear（`364aa184` 以降） |
| タップしても点が付かない | place モードか · 移動が 10px 超か | 短いタップで `pointerup` 確定 |
| 中央スロットが二重 flex | ZoomControls と HeaderBand 両方に `flex-1` | Controls は `inspectionDrawingCanvasZoomControlsClassName`（ボタン群のみ） |
| 拡大2回付近で図面が震える | `ResizeObserver` + スクロールバーで `clientWidth`/`Height` が揺れ再レイアウトループ | [§キャンバスズーム痙攣修正](#検査図面-キャンバスズーム痙攣修正-2026-05-31) · 強制リロード |

### テストの限界

- レイアウト・しきい値は **純関数の単体テスト**。**タブレットでのパン誤追加**は Pi5/DEV 目視で確認する（`/dev/kiosk-inspection-drawing-create` 推奨）。
- **ResizeObserver ループ**は `areZoomedCanvasLayoutsEqual` でユニット固定。**実機の「2回目だけ震える」**は Pi5 目視で確認（2026-05-31 修正後 OK）。

## 検査図面 · テンプレ編集・認可付き図面読込（2026-05-31） {#検査図面-テンプレ編集-認可付き図面読込-2026-05-31}

正本 Runbook: [kiosk-part-measurement.md §テンプレ編集図面](../runbooks/kiosk-part-measurement.md#検査図面-テンプレ編集-認可付き図面読込-2026-05-31) · deployment: [deployment.md §2026-05-31](../guides/deployment.md#kiosk-inspection-drawing-edit-image-and-zoom-jitter-2026-05-31) · ExecPlan: [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)。

### 背景・症状

| 項目 | 内容 |
|------|------|
| **報告** | 1枚図面を保存 → 一覧に表示 → **編集**で図面が出ず測定点だけ見える（編集不可に近い） |
| **再現** | 一覧ハブ導入（`f0a2725c` / `ef78f4dd`）以降の `KioskInspectionDrawingCreatePage` |
| **非原因** | キャンバスズーム PR #377 · 専用 GET 409 · API 上の `visualTemplate` 欠落 |

### 根本原因（CONFIRMED）

- ストレージ `GET /api/storage/part-measurement-drawings/*` は **`x-client-key` または JWT** 必須（[part-measurement-drawings.ts](../../apps/api/src/routes/storage/part-measurement-drawings.ts)）。
- **記録編集**（`KioskInspectionDrawingEditPage`）は `usePartMeasurementDrawingBlobUrl` で axios 取得 → `blob:` URL をキャンバスへ渡している。
- **テンプレ作成/編集**（同一 `KioskInspectionDrawingCreatePage`）だけ、`applyLoadedTemplate` が `drawingImageRelativePath` を **そのまま `<img src>`** にしていた → 401/空応答で `onLoad` しない → キャンバス枠は `hasDrawingImage` で出るが **画像は空白**。

### 仕様（修正後の表示契約）

| 状態 | 入力 | 表示 URL |
|------|------|----------|
| 新規ファイル選択中（画像） | `File` + ローカル `blob:` | **ローカルプレビュー優先**（サーバー fetch 抑止） |
| 新規ファイル選択中（PDF） | preview API → JPEG `blob:` | **preview JPEG**（save も同一 File） |
| 編集読込・保存後 | `visualTemplate.drawingImageRelativePath` | `usePartMeasurementDrawingBlobUrl` → `blob:` |
| キャンバスへ渡す値 | — | `inspectionDrawingCanvasImageUrl(local, serverBlob)` — **PDF Blob は渡さない** |

**純関数（ページから分離）**: `inspectionDrawingTemplateImageDisplay.ts`

- `inspectionDrawingBlobFetchPath` — ローカル選択中は `null`（不要な storage GET を止める）
- `inspectionDrawingCanvasImageUrl` — `local ?? serverBlob`
- `inspectionDrawingHasImageSource` — 読込中も枠を出す（path または local あり）

**フック拡張**（`usePartMeasurementDrawingBlobUrl.ts`）:

- **パス変更時**に即 `setBlobUrl(null)` + 旧 URL `revoke`（同一 edit ルートで `:templateId` が変わったとき **旧図面＋新測定点** の誤表示を防ぐ）
- 単体: `usePartMeasurementDrawingBlobUrl.test.ts`

**UI**:

- `drawingLoadError` を赤文字表示（サイレント失敗を減らす）
- Blob 未解決時は「図面を読み込み中…」
- 保存後 `applyLoadedTemplate(saved)` でサーバー path を再設定

### 代表ファイル

| 領域 | パス |
|------|------|
| ページ | `apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx` |
| Blob フック | `apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.ts` |
| URL 解決 | `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingTemplateImageDisplay.ts` |
| 対照（正しい既存実装） | `apps/web/src/pages/kiosk/KioskInspectionDrawingEditPage.tsx` |

### 本番デプロイ・検証（2026-05-31）

| 段階 | ブランチ / マージ | ホスト | Detach Run ID | HEAD | 備考 |
|------|-------------------|--------|---------------|------|------|
| 実装 + CI | `fix/kiosk-inspection-drawing-edit-image-load` | — | — | `e12a5a9c` | CI **`26698822834`** success |
| **Pi5 先行** | 同上（画像読込のみ時点） | `raspberrypi5` | `20260531-092334-26185` | `e12a5a9c` | **failed=0** · 強制リロード後 **編集で図面表示 OK** |
| **Pi5 再検証** | 同上（ズーム痙攣修正込み） | — | — | `f6a9544a` | **実機: 拡大2回目の震え解消 OK**（ユーザー確認 2026-05-31） |
| **Pi4×4** | **`main` マージ後** | 4 台 | — | — | **未**（Web のみ · 1 台ずつ） |

**CI（ブランチ先端）**: **`26700061664`** success（`f6a9544a` push）。

## 検査図面 · キャンバスズーム痙攣修正（2026-05-31） {#検査図面-キャンバスズーム痙攣修正-2026-05-31}

[§キャンバスズーム](#検査図面-canvas-zoom-2026-05-30) の表示契約は維持。本節は **編集画面で図面が表示できるようになった後**に表面化した **拡大 `＋` 2回目（倍率 1.5）付近の震え**の修正。

### 症状と調査

| 押下 | 倍率（0.25 刻み） | 報告 |
|------|-------------------|------|
| 1回 | 1.25 | 正常 |
| **2回** | **1.50** | **痙攣** |
| 3回 | 1.75 | 正常 |

**最有力原因**: `InspectionDrawingCanvas` の `ResizeObserver` → `clientWidth`/`clientHeight` 再計算 → スクロールバー出現で寸法が揺れる → **再レイアウトループ**。毎回 `setState` すると震えが増幅。

**Blob 読込修正との関係**: ズーム実装（#377）自体は未変更。テンプレ編集で図面が見えるようになったことで **初めて実機でズームが使われた**。

### 修正内容（Web のみ）

| 対策 | 実装 |
|------|------|
| スクロールバー用ガター | `inspectionDrawingCanvasViewportBaseClassName` に **`[scrollbar-gutter:stable]`**（`inspectionDrawingKioskUi.ts`） |
| 等価 layout で setState 抑制 | `areZoomedCanvasLayoutsEqual`（ε=0.5px）· `inspectionDrawingCanvasLayoutCompare.ts` |
| RO 責務の分離 | `useZoomedCanvasLayout.ts` — 計測 + RO · `layoutRef` と比較でスキップ |
| 内側ラッパー | `minWidth/minHeight: 100%` **削除**（`contentWidth/Height` で十分） |
| プレースホルダ img | **`naturalSize` 未確定時のみ**（`hasNaturalSize`）。計測済みで layout 未計算の瞬間に二重 img へ落とさない |

**単体テスト**: `inspectionDrawingCanvasLayoutCompare.test.ts` · layout zoom **1.5** 回帰 · inspection-drawing 配下 **44 passed**（2026-05-31 ローカル）。

### 代表ファイル（追加分）

| 領域 | パス |
|------|------|
| フック | `useZoomedCanvasLayout.ts` |
| 比較 | `inspectionDrawingCanvasLayoutCompare.ts` |
| キャンバス | `InspectionDrawingCanvas.tsx`（RO 削除・フック利用） |

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
- **2026-06-02 実績（検査図面 PDF プレビュー整合・`feat/inspection-drawing-pdf-import` → `main` `a3ce2284` PR #382）**: `POST /api/part-measurement/drawings/preview`（副作用なし JPEG）+ Web `usePartMeasurementDrawingLocalPreview` で **表示と保存の同一ラスタ**契約。**デプロイ**: [deployment.md §PDF プレビュー](../guides/deployment.md#kiosk-inspection-drawing-pdf-preview-parity-2026-06-02) に従い **`--limit raspberrypi5` のみ**・`RASPI_SERVER_HOST`・`--detach --follow`。Detach Run ID: **`20260602-190538-1780`**（HEAD **`8307c995`** · **`PLAY RECAP failed=0`** · Docker `api`/`web` 再起動）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 1 / FAIL 1**（約 **84s** · FAIL は `raspberrypi4` SSH タイムアウトの既知到達性）。**自動**: preview API **401/200** · `pdftoppm` 22.12.0。**Pi5 キオスク目視 OK**（PDF プレビュー · 保存 · 再読込座標一致）。**CI**: **`26812045529`** success。**手動残り**: **`main` マージ後** Pi4×4 順次 · PDF 連打 503 の現場確認（任意）。
- **2026-04-05 実績（`FHINMEI_ONLY` 部分一致・`feat/part-measurement-fhinmei-partial-match`）**: `template-candidate-rules.ts` で **NFKC+lower+空白正規化**、`日程fhinmei.includes(候補キー)`、候補キー **最短 2 文字**（`PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN`）、`one_key_fhinmei` 同士は **正規化後キー長降順**でタイブレーク。管理／キオスクの **`candidateFhinmei` は 2 文字以上**（Zod）。**デプロイ**: [deployment.md](../guides/deployment.md) に従い **Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 は対象外**・サイネージ専用手順は未実行）。Detach Run ID（記録されている後段例）: `20260405-115713-13575`（`raspi4-robodrill01`）→ `20260405-120152-18819`（`raspi4-fjv60-80`）→ `20260405-120844-9596`（`raspi4-kensaku-stonebase01`）；`raspberrypi5` / `raspberrypi4` は同一作業連の先行分（各 **`PLAY RECAP failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 132s・Mac / Tailscale）。**WARN**: Pi3 `signage-lite/timer` がオフライン扱い（スクリプト注記どおり **運用上スキップ可**）。**手動残り**: 日程品名が候補キーを **含むが完全一致ではない** 行で `/template/pick` に `one_key_fhinmei` が期待どおり並ぶか現場で目視。
- **2026-04-05 実績（複数記録表・セッション親子・`feat/part-measurement-multi-sheet-parent`）**: Prisma `PartMeasurementSession`・マイグレーション `20260406120000_part_measurement_multi_sheet_session`。キオスク API 応答に **`{ sheet, session }`**。編集画面は **上部セッションカード**・**別テンプレ追加**。親 **`completedAt`** と新規下書きの整合はサービス層（統合テストで担保）。**デプロイ**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`、**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・`RASPI_SERVER_HOST`・`--detach --follow`（**Pi3 除外**・サイネージ専用手順は未実行）。Detach Run ID: **`20260405-214901-25613`**（`raspberrypi5`）→ **`raspberrypi4` / `raspi4-robodrill01` は同一作業連で先行順次・各 `PLAY RECAP failed=0`（厳密な runId は Pi5 `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-*.summary.json` を時系列で突合）** → `20260405-221648-17798`（`raspi4-fjv60-80`）→ `20260405-222224-6819`（`raspi4-kensaku-stonebase01`）。**トラブルシュート**: Mac 側の `--follow` が **15 分超**でタイムアウトしても、Pi5 上のデタッチ Ansible は **継続**し **`remote exit` 0** まで完走しうる → Pi5 の `*.exit` / `*.summary.json` で確認。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 **135s**・Mac / Tailscale）。**WARN**: Pi3（**今回未デプロイ**）の SSH 系チェックはスクリプト注記どおり **運用上スキップ可**。**手動残り**: 同一日程で **複数子シート**・カード切替・**別テンプレ追加**・親完了後の状態・CSV **`sessionId`** を現場で目視。
- **知見**: Pi4 単体 `--limit` でも Ansible は Pi5 上で実行される（`RASPI_SERVER_HOST` 設定が前提）。`--foreground` のキオスクデプロイは IME/ibus 等を含み **15〜25 分**/台かかることがある（タイムアウトに注意）。
- **トラブルシュート（デプロイ）**: **同じ `RASPI_SERVER_HOST` に対し、`update-all-clients.sh` を複数プロセスで同時起動しない**。2026-03-29 hardening 後は、2本目は Mac 側ローカルロック（`logs/.update-all-clients.local.lock`）または Pi5 ロック（`/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock`）で停止する。ロックを手動削除する前に、`runPid` が生存していないことを確認する（[deployment.md](../guides/deployment.md) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。
- **認可**: `Authorization` 付きで **403（権限不足）** のとき、書き込み系（例: `POST .../sheets`）では `x-client-key` にフォールバックしない（401 のみキー許可）。キオスクは通常キーのみで十分。

## References

- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md) / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md) / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md) / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)
- 沉浸式 allowlist: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
