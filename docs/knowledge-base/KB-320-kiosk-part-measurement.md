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
| **画像** | PNG/JPEG/WebP に加え **PDF（1ページ目のみ→JPEG）** と **TIFF/TIF（→JPEG）**。PDF/TIFF 入力上限 **30MB**、保存画像上限 **12MB**。PDF: DPI 144 / quality 85。TIFF: sharp 変換・magic bytes 検証・最大 16384px・変換キュー制御。 |
| **ヘッダー・ルート** | `kioskInspectionDrawingRoutes.ts` — 既定 `inspection`、作成 `inspection/create`、テンプレ編集 `inspection/templates/:id/edit`、記録図面 `inspection/edit/:sheetId`。`isKioskInspectionDrawingPath` で部品測定タブを非アクティブ。 |
| **流用導線（2026-06-05）** | 詳細は [§流用導線強化](#検査図面-流用導線-2026-06-05)。一覧 **雛形として新規** · 図面 **既存 visual 選択** · `failIfActiveExists` + lineage lock · FIHNCD **case-insensitive** 統一 · visual 一覧 **サーバー検索** |

### 検査図面・流用導線強化（2026-06-05） {#検査図面-流用導線-2026-06-05}

同一図面・測定点を **別品番×工程×資源CD** へ展開する導線と、保存競合・orphan visual 回収・FIHNCD 正規化を一体で強化した変更。

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-inspection-drawing-reuse-flow`** |
| 代表コミット | **`6c7da8c7`**（`feat(kiosk): harden inspection drawing reuse flow`） |
| 変更種別 | **API + Web**（**Prisma migration 追加なし**） |
| CI | GitHub Actions **`27008474510`** **success**（`6c7da8c7` push 後 · 全ジョブ） |

#### UI 導線

| 導線 | 操作 | 正本 state / ルート |
|------|------|---------------------|
| **雛形から新規** | 一覧有効版カード → **雛形として新規** | `?sourceTemplateId=` → 専用 `GET …/inspection-drawing/templates/:id` で再取得 → `templateToCreateDraft`（**point id は新規採番**） |
| **既存図面再利用** | 新規作成 → **図面** ボタン → **既存から選択** | `visualSource='pickExisting'` · `visualTemplateId` のみで保存可（upload 不要） |
| **新規アップロード** | 同上ダイアログ → ファイル選択 | `visualSource='upload'` · `createPartMeasurementVisualTemplate` → `cleanupToken` 保持 |
| **改版（既存キー）** | 一覧 → **編集** → 保存 | `POST …/inspection-drawing/templates/:id/revise`（新規作成ではない） |

**`visualSource`（`unselected` / `upload` / `pickExisting`）** が保存時の単一真実源。図面切替時は測定点があると confirm でクリア。

#### キー衝突ガード（二段）

| 段 | 内容 |
|----|------|
| **UI 事前** | `resolveInspectionDrawingCreateKeyCollision` — `same_as_source`（雛形元と同一キー）· `active_exists`（`GET …/templates/active-exists` を 400ms debounce）→ 保存ボタン無効 + 案内 |
| **API 409** | 新規 `POST /api/part-measurement/templates` に **`failIfActiveExists: true`** — 本番 THREE_KEY で active があれば 409 |

**FIHNCD 照合は UI・API・lock で統一**（`normalizeFhincd` = trim + `toUpperCase`、DB 照合は `mode: 'insensitive'`）:

- 作成・改版・`failIfActiveExists` · `active-exists` · 版採番 · **`setActiveVersion` の旧 active 落とし**
- advisory lock キー: `buildThreeKeyLineageLockKey`（`part-measurement-template-lineage-lock.ts`）
- legacy で `ABC` / `abc` が別 active として残っていても、活性版切替で **case-insensitive に片系譜へ収束**

#### API 契約（追加分）

| エンドポイント | 用途 |
|----------------|------|
| `GET /api/part-measurement/templates/active-exists` | 軽量存在確認（`{ exists: boolean }`）· kiosk `x-client-key` 可 |
| `GET /api/part-measurement/visual-templates?q=&limit=` | 図面名 **部分一致（case-insensitive）** · `limit` 1–200（未指定時は管理画面互換で全件） |
| `PATCH /api/part-measurement/visual-templates/:id` | **`name` のみ**更新（1–200 文字）· inactive / 不存在は **404** · 共有 visual 名は参照テンプレ表示にも反映 |
| `POST /api/part-measurement/visual-templates` | 応答に **`cleanupToken`**（作成直後の未参照回収用） |
| `DELETE /api/part-measurement/visual-templates/:id` | ヘッダ **`X-Visual-Cleanup-Token` 必須**（トークン不一致は 403） |
| `GET /api/part-measurement/inspection-drawing/templates?visualName=` | テンプレ一覧を **図面名**（`visualTemplate.name`）で部分一致絞り込み（`fhincd` 等と AND） |

**同時作成直列化（本番 THREE_KEY）**:

1. `pg_advisory_xact_lock`（lineage: `normalizeFhincd|processGroup|resourceCd`）
2. visual 行 `FOR UPDATE`（紐付けと `deleteIfUnused` の直列化）
3. `failIfActiveExists` 時は同一 tx 内で lineage lock 取得済みフラグ（`lineageLockHeld`）により二重 lock 回避

**orphan visual 回収**: テンプレ保存失敗時、作成レスポンスの `cleanupToken` のみで `DELETE` 可能（一覧の ID だけでは不可）。

#### Web 実装メモ

| モジュール | 役割 |
|-----------|------|
| `inspectionDrawingCreateDraft.ts` | `normalizeFhincdForTemplateKey` · `templateBusinessKeysEqual` · `resolveInspectionDrawingCreateKeyCollision` |
| `InspectionDrawingVisualSourceControl.tsx` | 図面ピッカー · 検索 **400ms debounce** → API `q` + `limit: 80` |
| `KioskInspectionDrawingCreatePage.tsx` | `visualSearchRequestSeqRef` で **古い検索レスポンスの上書きを防止** |
| `KioskInspectionDrawingVisualLibrarySection.tsx` | カード下 **新規作成 / 名称変更** · `KioskInspectionDrawingVisualRenameModal` |
| `InspectionDrawingLibraryFilterBar.tsx` | テンプレ一覧に **図面名** フィルタ（**更新** ボタンで API 反映） |
| `kioskInspectionDrawingRoutes.ts` | `kioskInspectionDrawingCreatePathWithSource` · `parseInspectionDrawingSourceTemplateIdFromSearch` |

キオスク初回は **先頭 80 件**（`q` なし）。それ以外は検索必須。管理画面は `includeInactive` 時 **limit 未指定で全件**（従来互換）。

#### 本番デプロイ（実績·2026-06-05 · Pi5 先行）

| ホスト | Detach Run ID | Git HEAD | PLAY RECAP | Phase12 | 備考 |
|--------|---------------|----------|------------|---------|------|
| `raspberrypi5` | **`20260605-191525-16964`** | **`6c7da8c7`** | **`ok=134` `changed=4` `failed=0`** | **43/0/0**（約 58s） | `Git: changed` · Docker **`api`/`web`** 再ビルド |
| Pi4×5（後続収束） | 2026-07-08 現行ロールアウト | **`04bb49fe`** | `failed=0` | **45/0/0** | 丸数字設定改善ロールアウトで現行 UI へ収束 |

**Pi5 自動スモーク（Tailscale）**:

- `GET …/visual-templates?q=test&limit=5` → **200**
- `GET …/templates/active-exists` → **200** `{"exists":false}`
- `docker-web-1` バンドル `index-BAzZiLdt.js` に `雛形として新規` · `sourceTemplateId` · `failIfActiveExists` · `active-exists` を確認

**ローカル検証**: integration `part-measurement.integration.test.ts` **51 passed | 2 skipped**（一時 Postgres `pgvector/pgvector:pg15`）· unit（lineage lock / cleanup token / visual list / draft helper）PASS

Runbook: [§流用導線](../runbooks/kiosk-part-measurement.md#検査図面-流用導線-2026-06-05) · deployment: [§2026-06-05](../guides/deployment.md#kiosk-inspection-drawing-reuse-flow-2026-06-05)

##### トラブルシュート（流用導線）

| 事象 | 対処 |
|------|------|
| **雛形から保存できない（同一キー）** | 意図どおり。工程または資源CDを変える · UI `same_as_source` 案内を確認 |
| **`abc` で保存できたが `ABC` と重複 active** | HEAD &lt; `6c7da8c7` or migration 前データ。現行は作成・active-exists・setActiveVersion が case-insensitive |
| **図面ピッカーが遅い / 全件取得** | キオスクは `q`+`limit=80` API 検索。旧 bundle はクライアント `filter` 全件 |
| **検索入力が戻る** | `visualSearchRequestSeqRef` 未反映の旧 bundle。強制リロード or Pi5 `web` 再デプロイ |
| **保存失敗後に orphan visual** | `cleanupToken` で `DELETE`（403 → トークン不一致 or 既に参照） |
| **integration が DB 接続失敗** | テスト中に Postgres コンテナを先に `stop` しない。CI 手順どおり migrate 後に vitest |
| **デプロイ拒否（ahead）** | `origin/feat/kiosk-inspection-drawing-reuse-flow` へ push 後に再実行 |

### 検査図面・複数資源兄弟グループ（2026-07-01） {#検査図面-複数資源兄弟グループ-2026-07-01}

複数資源CDへ同じ図面・測定点を登録する導線を追加した。正本判断は [ADR-20260701](../decisions/ADR-20260701-part-measurement-template-sibling-groups.md)。1テンプレに複数資源CDを持たせず、従来どおり `fhincd + processGroup + resourceCd + version` のテンプレ実体を資源CDごとに作り、`PartMeasurementTemplateSiblingGroup` で同時作成した兄弟テンプレを束ねる。

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/inspection-drawing-sibling-groups`** |
| 変更種別 | **API + Web + Prisma migration** |
| DB | `PartMeasurementTemplateSiblingGroup` 追加、`PartMeasurementTemplate.siblingGroupId` nullable FK 追加。既存テンプレは `null` のまま。 |
| 互換 | 記録表・自主検査のテンプレ解決は引き続き **資源CD単位**。既存の単一資源テンプレ導線も維持。 |

#### API 契約

| エンドポイント | 用途 |
|----------------|------|
| `POST /api/part-measurement/inspection-drawing/template-groups` | 複数資源CDへ同一内容テンプレを一括作成。1資源でも既存 active と衝突したら **409** で全体ロールバック。 |
| `POST /api/part-measurement/inspection-drawing/template-groups/:id/revise` | グループ内の現在 active な兄弟テンプレを同内容でまとめて版上げ。 |
| `POST /api/part-measurement/inspection-drawing/template-groups/:id/resources` | 保存済み最新版をコピーして資源CDを追加。グループ内既存資源は no-op、外部 active 衝突は **409**。 |
| `POST /api/part-measurement/inspection-drawing/templates/:id/revise` | `detachFromSiblingGroup: true` 指定時、新バージョンは `siblingGroupId = null`。個別改版として以後のまとめて改版対象外。 |

一覧・詳細 DTO は `siblingGroupId` と `siblingGroup` 要約を返す。要約には表示名と有効メンバーの資源CD一覧を含める。

#### UI 契約

| 画面 | 内容 |
|------|------|
| 新規作成 | 資源CDは複数選択。チップ + 検索付きチェックリストで、選択済みは省略表示する。 |
| テンプレ名 | 図面ライブラリ表示名 `visualTemplate.name` + 品番を自動提案する。例: `7161テーブル ABC-123`。手編集後は上書きせず、空欄に戻すと自動提案へ戻る。 |
| 保存ボタン | 品番・資源CD・図面・測定点・測定点名・公差・検査数設定・衝突なし・プレビュー完了が揃い、かつ保存済み内容から変更があるときだけ enabled。保存ボタン右〜一覧へ戻る左に `保存済み` / `未保存あり` / `入力不足` / `保存中` / `閲覧のみ` を表示。未保存入力がある内部リンク遷移・ブラウザ更新/終了は確認を出す。 |
| 改版 | グループ所属テンプレの既定は **兄弟テンプレをまとめて改版**。切替で **この資源だけ個別改版**を選ぶと保存後にグループから外れる。 |
| 資源追加 | グループ編集画面から追加。未保存変更は含まず、保存済み最新版をコピーする。 |
| 一覧 | 兄弟グループを1カードに集約し、資源CDをチップ表示。1件でも横幅いっぱいに伸ばさず、ボタンは文字量に合う幅を基本にする。 |

#### 検証（ローカル一時 Postgres）

- `pnpm --filter @raspi-system/api prisma:generate` — PASS
- `pnpm --filter @raspi-system/api build` — PASS
- `pnpm --filter @raspi-system/web build` — PASS
- `pnpm --filter @raspi-system/web test -- src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCreateDraft.test.ts` — **8 PASS**
- 一時 Postgres `pgvector/pgvector:pg15` に migration 適用後、`pnpm --filter @raspi-system/api test -- src/routes/__tests__/part-measurement.integration.test.ts` — **63 PASS**
- `EXPLAIN` で `PartMeasurementTemplate_idx_sibling_active` と既存3キー lookup の index scan を確認。

#### トラブルシュート

| 事象 | 対処 |
|------|------|
| 一括作成が 409 | 選択資源のどれかに同一 `fhincd + processGroup + resourceCd` の active がある。衝突資源を外すか、既存テンプレを改版する。 |
| 個別改版後にまとめて改版されない | 仕様どおり。`detachFromSiblingGroup: true` の新バージョンはグループから外れる。 |
| 資源追加に未保存変更が反映されない | 仕様どおり。資源追加は保存済み最新版をコピーするため、必要なら先にまとめて改版で保存する。 |
| 一覧でカードが増えすぎる | `siblingGroupId` が返っているか、DTO の `siblingGroup.activeResourceCds` が空でないかを確認する。 |

### 検査図面・OCRキャッシュ候補提示（2026-07-02） {#検査図面-ocrキャッシュ候補提示-2026-07-02}

正本判断は [ADR-20260702](../decisions/ADR-20260702-part-measurement-drawing-ocr-cache.md)。v1 は **インポート済み図面のOCRキャッシュ**と、丸数字配置位置からの **基準値候補提示**に限定する。図面画像は複製せず、`PartMeasurementVisualTemplate.drawingImageRelativePath` の保存済み画像を唯一の画像ソースとし、OCR由来の数値トークン・正規化bbox・confidenceだけを `PartMeasurementDrawingOcrCache` に `gzip+json` で保持する。

| 項目 | 内容 |
|------|------|
| API | `GET /api/part-measurement/visual-templates/:id/ocr`、`POST .../:id/ocr/candidates`、`POST .../:id/ocr/retry` |
| UI | 検査図面作成/改版で既存 visual を使って点を追加した直後だけ候補APIを呼ぶ。候補選択は対象点の `nominalRaw` だけ更新する。 |
| OCR | `tesseract.js` の座標付き単語OCRを使い、全体 + タイルOCRで数値候補を作る。LLMによる自動確定はしない。 |
| 既存図面 | migrationではOCRしない。deploy後に `pnpm --filter @raspi-system/api backfill:part-measurement-drawing-ocr -- --dry-run` で対象確認し、必要件数だけ実行する。 |
| 失敗時 | retry最大3回。失敗理由はcache行に保存し、手動retry APIまたはbackfill再実行で復帰させる。 |

#### 局所再OCR・深さROI（2026-07-09） {#検査図面-ocr局所候補-2026-07-09}

正本: [Plan](../plans/inspection-drawing-ocr-local-candidates.md) · [ADR-20260709](../decisions/ADR-20260709-inspection-drawing-ocr-local-candidates.md)。フル図面キャッシュ契約 `pm-drawing-ocr-v3` は維持し、候補取得時だけマーカー局所クロップOCRをマージする。

| 項目 | 内容 |
|------|------|
| candidates body | 既存 `xRatio`/`yRatio`/`markerNo`/`limit` に加え optional `measurementLabel`・`depthMode`（`measured` \| `through`） |
| 局所OCR | `DrawingLocalOcrPort`（既定: sharp crop + `ImageOcrLayoutPort`）。失敗時はキャッシュのみへフォールバック |
| 深さ | 名称が深さ系かつ `depthMode !== through` のとき ROI 拡大・深さ注記（`深サN` 等）を優先 |
| ランキング | 連結分割（5–6桁等）・小数正規化（`0.030`≡`0.03`）。汎用1桁削除はしない |
| UI | 名称/`depthMode` 変更後および位置の実質変更後に候補を再取得。候補行に「OCR待ち」は出さない。自動確定なし |
| flag | `PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED`（既定 ON）· timeout `PART_MEASUREMENT_DRAWING_OCR_LOCAL_TIMEOUT_MS` |
| 本番 | HEAD **`09a1fe66`** · Detach Pi5/StoneBase **`20260709-223044-17975`** · Pi4×4 **`20260709-224140-20418`** · Phase12 **45/0/0** · [deployment](../guides/deployment.md#inspection-drawing-ocr-local-candidates-2026-07-09) |
| 残課題 | ROI外の深さ注記、候補POSTのPi5レイテンシ計測（実測 ~6–8s）。RapidOCR 二次エンジンは [§2026-07-10](#検査図面-ocr-rapidocr局所-2026-07-10) |

#### RapidOCR 局所第2エンジン（2026-07-10） {#検査図面-ocr-rapidocr局所-2026-07-10}

正本: [Plan](../plans/inspection-drawing-ocr-rapidocr-local.md) · [ADR-20260710](../decisions/ADR-20260710-inspection-drawing-ocr-rapidocr-local.md)。一次は既存局所 tesseract。候補が弱いときだけ RapidOCR を追加マージする。

| 項目 | 内容 |
|------|------|
| 起動条件 | `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED`（**Pi5 本番 ON** · timeout **20000ms** · weakScore **0.12**）かつ弱さ判定 true |
| 弱さ判定 | 候補0件 / top1 score > 閾値（既定 0.12） / 深さ検索なのに深さ注記根拠なし |
| 実行形態 | API 内常駐 Python worker（JSON Lines）· `scripts/part-measurement/drawing-local-rapidocr-worker.py` |
| 失敗時 | warn + 一次候補のまま（HTTP 500 にしない） |
| イメージ | `Dockerfile.api` に `libgomp1`/`libgl1`/`libglib2.0-0` + `rapidocr==3.8.4` + `onnxruntime==1.20.1` |
| 本番 | 実装 HEAD **`9811d39a`** / enable HEAD **`ba1d781a`** · Detach enable **`20260710-101808-6154`** · timeout20 **`20260710-102238-19166`** · RapidOCR flag **ON** · [deployment enable](../guides/deployment.md#inspection-drawing-ocr-rapidocr-enabled-2026-07-10) |
| 残課題 | offline top5/深さ再計測、初回暖機レイテンシの運用観察、DGX は対象外 |

### 検査図面 trio（名称変更・図面名検索・自主検査遷移）（2026-06-09） {#kiosk-inspection-drawing-trio-2026-06-09}

| 項目 | 内容 |
|------|------|
| **status** | `active`（本番 5 台反映済み） |
| **branch / HEAD** | **`feat/kiosk-inspection-drawing-trio`** · **`4a7f8493`** |
| **変更種別** | **API + Web**（Prisma / migration **なし**） |
| **Plan** | [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)（Progress 参照） |
| **Runbook 手動確認** | [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md) §自主検査ボタン活性 · 検査図面一覧 |

#### 仕様（3 件）

1. **図面ライブラリ名称変更** — `PATCH /api/part-measurement/visual-templates/:id`（`name` のみ）· UI **新規作成 / 名称変更** · 共有 visual 名は参照テンプレ表示にも反映。
2. **テンプレ一覧図面名検索** — `GET …/inspection-drawing/templates?visualName=`（部分一致）· FilterBar **図面名** + **更新** ボタン。名称変更成功時は **現在フィルタで再取得**（ローカル patch のみは不可）。
3. **自主検査遷移** — 保存後 **次未保存 required slot へ自動切替 + guided 再開** · entry 切替 **黒画面回避**（`placeholderData` は **同一 `sessionId` のみ**）· `draftBoundKey` / dirty 再訪時は **boundKey のみ同期**（上書きしない）· 保存直後の次 slot は **`applySelfInspectionEntrySaveToSessionCache` 後の snapshot** で判定。

#### 本番デプロイ（実績·2026-06-09）

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | **`20260609-174538-15678`** | **`ok=134` `changed=4` `failed=0`** | Docker **`api`/`web`** 再ビルド · HEAD **`4a7f8493`** |
| `raspi4-kensaku-stonebase01` | **`20260609-180605-16020`** | **`ok=129` `changed=11` `failed=0`** | `kiosk-browser` 再起動 |
| `raspberrypi4` | **`20260609-181043-13094`** | **`ok=122` `changed=10` `failed=0`** | 同上 |
| `raspi4-robodrill01` | **`20260609-181550-5432`** | **`ok=122` `changed=10` `failed=0`** | 同上 |
| `raspi4-fjv60-80` | **`20260609-181935-17768`** | **`ok=122` `changed=10` `failed=0`** | 同上 |

**Phase12**（`./scripts/deploy/verify-phase12-real.sh`）: **PASS 43 / WARN 0 / FAIL 0**（Pi5 後 **約 52s** · 全台後 **約 50s**）。

#### 実機検証（自動）

| 確認 | 結果 |
|------|------|
| Pi5 `docker-api-1` / `docker-web-1` | **Up (healthy)** |
| Web バンドル | `/srv/site/assets/index-CvjjZZRg.js` に **`名称変更`** · **`visualName`** |
| `GET …/visual-templates?limit=1` | **200** |
| `GET …/inspection-drawing/templates?visualName=test` | **200**（部分一致応答） |
| `PATCH …/visual-templates/{missing-id}` | **404**（ルート存在） |

**手動（キオスク）**: Pi4 現場での図面名変更・`visualName` フィルタ・自主検査 **保存後自動切替 / guided 再開** は [Runbook §ボタン活性](../runbooks/kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04) 手順 5–8 を運用時に実施。

#### 知見（レビュー反映）

- **`useSelfInspectionSession` の `placeholderData`** は `previousData.id === sessionId` のときだけ返す（別セッション遷移中に旧セッションの保存/完了を防ぐ）。
- **保存後の次 slot** は React Query 再レンダー前の ref ではなく、**`persistEntry` が返した `savedEntry` を cache merge した snapshot** で解決する。
- **dirty 再訪 entry** は `canRebind` を拒否しても **`draftBoundKey` だけ同期**すれば guided 自動再開可能（draft 本文は保持）。

#### Open items

- Pi4 **stonebase 先行実機**でのキオスク目視記録（上記 Runbook 5–8 · 名称変更/図面名検索）は **未記録**。
- `visualName` の `contains insensitive` は件数増加時に **trigram / pagination** 検討（Plan 記載どおり）。

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
| **順位ボード連携** | decoration に `hasSelfInspectionDrawing` / `selfInspectionTemplateId` / `selfInspectionStatus` / `selfInspectionEntryPath` を追加。図面あり行は **検** ボタンから **デジタル入力** / **帳票紙印刷** を選択。 |

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
- **公差・完了**: 公差内は従来どおり保存可能。公差外は `outOfToleranceAcknowledged=true` の確認済み値だけ `reviewStatus=PENDING` で保存し、未確認は 400。未承認の公差外があるセッションは `review_pending` となり、`complete` は 409。ADMIN/MANAGER のレビュー承認後に完了化する。`fixed_count` は `fixedCount <= plannedQuantity`。`first_last` は `plannedQuantity === 1` でテンプレ保存・開始不可（1 件への自動縮退なし）。小数桁は数値 JSON も `Decimal` 量子化で検証。セッション行は `FOR UPDATE` で完了競合を防止。
- **正本契約（コード）**: `apps/api/src/services/part-measurement/self-inspection-config.ts`（`validateSelfInspectionConfig` / `listRequiredEntrySlots`）。Migration: `20260602120000_self_inspection_four_modes`（enum/カラム）→ `20260602120100_self_inspection_sample_to_fixed_count`（`SAMPLE`→`FIXED_COUNT`。**Postgres は新 enum 値を別マイグレーションで使う**）。
- **入力更新**: `PATCH …/entries/:id` は `ifUnmodifiedSince`（entry `updatedAt` の ISO）必須。不一致・同時更新は **409**（再読込案内）。
- **旧形式セッション**: 全数で `expectedEntryCount < plannedQuantity` のとき、API は `requiredEntryCount` と `entryCountBlockedReason` を返す。指示数が 2,000 超の不整合は **保存・完了不可**（再作成導線）。2,000 以下の不整合は初回 mutation で `expectedEntryCount` を `plannedQuantity` に修復。
- **キオスク入力 UI**: ドラフトは選択中の入力件のみ生成。入力件ボタンは 48 件ずつページング。
- **一覧装飾**: 抜取数 > 指示数のテンプレ、または **全数で指示数 > 2,000** の行は `hasSelfInspectionDrawing: false`（一覧全体は落とさない）。**既存セッション**はテンプレ退役後も `scheduleRowId` で再開導線を出す。
- **詳細 API**: `GET …/sessions/:id?entryIndex=N` で `focusedEntry` のみ測定値を返す。一覧 `entries` はメタデータのみ。保存後は React Query を該当 entry だけ `setQueryData` 更新。
- **キオスク一覧**: `GET /kiosk/production-schedule?selfInspectionEligibleOnly=true` で開始可能行のみをサーバー側抽出（生産日程をチャンク走査、`page` / `pageSize` / `hasMore`）。
- 順位ボードの `selfInspectionEntryPath` は `/start?...` を返し、UI 側で resolve-or-create して **既存セッションへ再入場**できる。`selfInspectionTemplateId` があれば、同じ **検** 導線から保存済み検査図面の帳票プレビューを開く。
- 検査図面一覧 API `GET /inspection-drawing/templates` も `selfInspectionMode` / `selfInspectionFixedCount`（互換で `selfInspectionSampleSize`）を返す。キオスク改版 `POST …/inspection-drawing/templates/:id/revise` も自主検査設定を受け付ける。
- **検査図面編集（丸数字・公差）**: 測定点は `markerNo` 独立採番（削除で他番号は変えない・追加は最小欠番）。寸法公差 UI は **基準値＋下限/上限公差（基準値への符号付きオフセット）** → 保存時に絶対 `lowerLimit`/`upperLimit`（`lowerLimit = nominal + lowerOffset`, `upperLimit = nominal + upperOffset` · `apps/web/.../toleranceFields.ts`）。幾何公差 UI は **入力値 = 上限値**、合格範囲は **0〜上限値** として表示し、保存 payload は `nominalValue=上限値` / `lowerLimit=0` / `upperLimit=上限値`。`nominalValue=null` で下限/上限だけある既存行は **`legacyAbsoluteBounds`**（未編集なら絶対値維持。片側公差入力で符号付きモードへ移行し両側 offset を seed · `markerNumbering.ts` / `mergeInspectionDrawingPointPatch`）。名称は固定候補 select（`inspectionDrawingMeasurementLabelOptions.ts`、候補外既存値は一時 option）。右ペインは名称と値を1行ずつ、位置調整は `↑ ↓ ← →` の1行、削除は「この点を削除」+「全削除」。自主検査セッションのみ測定値 **候補 dropdown + 手入力**（標準は `selfInspectionMeasurementValueOptions.ts`、最大 200 件・超過は手入力のみ。寸法ラベルは 0.1 刻み候補 + 百分台ボタン）。本番記録画面の測定値入力は **自由入力のまま**。

### 自主検査セッション・ガイド付きフォーカス（2026-06-04） {#自主検査-セッション-ガイド付きフォーカス-2026-06-04}

順位ボード **検** → 自主検査入力画面で、**現在の入力件**内の測定点を `markerNo` 昇順にガイドする。**永続化なし**（セッション API とは独立した UI 状態機械）。

| 項目 | 内容 |
|------|------|
| **ガイド対象** | `selectedEntryIndex` のみ。測定点の件内ガイドは従来どおり |
| **初期** | 図面 ready 後、未入力の最小 `markerNo`（なければ先頭）へ。ズームは fit 基準 **+4 step**（内訳: 旧ガイド +2 + 追加 +2 → `SELF_INSPECTION_GUIDED_ZOOM_STEPS=4` → **2.0**、`resolveInspectionDrawingZoomFromDefaultSteps`） |
| **確定して次へ** | dropdown 即時 / 手入力は **Enter** または単独 **blur**。公差内 OK はそのまま次へ、確認済み公差外は `review_pending` 値として次へ |
| **留まる** | 未確認の公差外・公差不備・不正値。未確認の公差外は再入力/公差外のまま進むの確認ダイアログで止める |
| **手動化** | 全体表示・±ズーム・パン・他マーカー・**他入力件タップ**（manual 維持）。`fitToView` は未消化 `focusRequest` を破棄 |
| **再開** | 手動後に **再開** で当該件の未入力最小 `markerNo` からガイド再開（同じ **2.0** 倍率） |
| **保存後の入力件** | **入力を保存** 成功後、未保存の次 required slot へ **自動切替 + guided 再開**（全件保存済みなら manual のまま完了導線） |
| **入力対象の見た目** | 値入力パネルが向いている測定点（`selectedPoint`）の丸数字外周を **青系 outline**（状態 ring とは独立） |
| **全点 OK** | ガイド停止。「入力を保存」導線（保存成功後に次入力件へ自動切替） |
| **センタリング** | `focusRequest: { pointId, requestId, zoom }` を **1 回だけ**適用（`selectedPointId` 連動再スクロールなし）。**2.0** でも震えないことは Runbook 手動確認で回帰（[§キャンバスズーム痙攣](#検査図面-キャンバスズーム痙攣修正-2026-05-31) の 1.5 履歴は変更しない） |
| **ガイド試行（検査図面作成）** | 今回の倍率変更は **対象外**（`GUIDED_TRIAL_ZOOM=1.5` 固定のまま） |
| **並び** | `markerNo` → 配列 index → `id`（`sortGuidedTrialPointsStable` と同型） |

#### ガイド polish（倍率 2.0・保存 blur）（2026-06-04） {#自主検査-ガイド-polish-倍率2-0-2026-06-04}

`feat/kiosk-self-inspection-guided-focus` 初回デプロイ（1.5 倍）後の **UX 仕上げ**。永続化・API 契約は変更なし。

| 項目 | 内容 |
|------|------|
| **倍率** | `SELF_INSPECTION_GUIDED_ZOOM_STEPS = BASE(2) + EXTRA(2) = 4` → **2.0**（`resolveInspectionDrawingZoomFromDefaultSteps`）。旧ガイド 1.5 から UI「＋」2 段相当 |
| **保存後** | 次未保存 slot あり → 自動切替 + guided。なし → `enterManualAfterPersist()` |
| **入力対象の見た目** | `inspectionDrawingMarkerStyles.ts` — `selectedPoint` に青 outline（状態 ring と分離） |
| **保存 blur 抑止** | `SELF_INSPECTION_SESSION_ACTIONS_SELECTOR` · 保存/完了 `onPointerDownCapture` · `InspectionDrawingValuePanel` の `blur_without_guide`（`fb10f0e0`） |
| **件切替** | 初回 priming は entry 0 のみ自動 guided。他入力件タップ後は **manual**（再開で guided 復帰）。保存後自動切替は guided 再開 |
| **黒画面回避** | `useSelfInspectionSession` に `placeholderData` + entry 単位 `draftBoundKey`。placeholder 中は baseline 再束縛しない |
| **ガイド試行** | **対象外**（`GUIDED_TRIAL_ZOOM=1.5` 固定） |

#### セッション操作ボタン活性（2026-06-04） {#自主検査-セッション操作ボタン活性-2026-06-04}

判定は [`selfInspectionSessionActionState.ts`](../../apps/web/src/features/part-measurement/selfInspectionSessionActionState.ts)（理由コード）と [`selfInspectionEntrySlots.ts`](../../apps/web/src/features/part-measurement/selfInspectionEntrySlots.ts) の `areRequiredSelfInspectionSlotsFilled()`。表示 `disabled` と `onClick` ガードは同一判定。

| ボタン | 有効条件（UI） | 補足 |
|--------|----------------|------|
| **入力を保存** | 現在入力件が **dirty** かつ全測定点が保存可能（公差内 OK、またはオペレータ確認済み公差外。空欄・不正値・未確認公差外・公差未設定は不可）· readOnly でない · 保存/完了処理中でない | 他入力件の dirty は見ない。完了処理中は値入力パネルも readOnly |
| **自主検査を完了** | **required slot** がすべて DB 保存済み（`listSelfInspectionEntrySlots` と `session.entries` の index 一致）· **未保存ドラフトなし**（`hasDirtySelfInspectionDrafts`）· **未承認公差外なし**（`pendingReviewCount === 0`）· readOnly でない · 保存/完了処理中でない | 保存済み全件の公差・レビュー最終判定は **API 正本**（409 時はエラー表示を維持） |
| **再開** | **manual** · 図面 ready · `guideActionsEnabled` · 当該入力件に **未完了測定点**（`findFirstPendingPointId`） | `guided` 中は無効。全点 OK で dirty あり → 保存促し、dirty なし →「未完了の測定点はありません」 |

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-self-inspection-button-actions`** → **`main` マージ**（予定） |
| 代表コミット | **`4f44dbb9`**（`selfInspectionSessionActionState` · required slot 完了 · ヘッダー再開分離） |
| 変更種別 | **Web のみ** |
| CI | **`26949777126`** success（`4f44dbb9`） |
| Pi5 デプロイ | **`20260604-205746-21197`** · HEAD **`4f44dbb9`** · `failed=0` · **web** 再ビルド |
| Pi4×4 | **`20260604-210423-13676`** / **`210915-5507`** / **`211304-30742`** / **`211651-9374`** · 各 `failed=0` · **強制リロード**後に手動 11–13 |
| Phase12 | **43/0/0**（Pi5 デプロイ直後 **約 61s** · 全台後 **約 53s**） |
| バンドル確認 | `docker-web-1` `/srv/site/assets/index-Dmzem2DM.js` に **`自主検査を完了`** |

代表ファイル: `selfInspectionSessionActionState.ts` · `selfInspectionEntrySlots.ts` · `KioskSelfInspectionSessionPage.tsx` · `SelfInspectionSessionHeader.tsx` · `__tests__/selfInspectionSessionActionState.test.ts`

Runbook: [§ボタン活性](../runbooks/kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04) · [deployment §ボタン活性](../guides/deployment.md#kiosk-self-inspection-session-button-actions-2026-06-04)

##### トラブルシュート（ボタン活性）

| 症状 | 確認 | 対処 |
|------|------|------|
| **入力を保存** が常にグレー | 現入力件が dirty か · 全測定点が保存可能か（空欄・未確認公差外・未設定は不可） | 値を修正する、または公差外確認ダイアログで **公差外のまま進む** を選ぶ · 他件の未保存は保存ボタンには影響しない |
| **完了** がグレーだが全点入力済み | **他入力件**が未保存ドラフトか · required slot が DB 保存済みか · `pendingReviewCount` が 0 か | 件ごとに **入力を保存** · 未承認公差外は管理レビューで承認 · `listSelfInspectionEntrySlots` と `entries` index のずれがないか API ログ |
| **完了** API が 409 | 未承認の公差外が残っている（API 正本） | 管理 `/admin/part-measurement/self-inspection-reviews` で ADMIN/MANAGER が承認、または該当点を修正して再保存 |
| **再開** がグレー（手動のはず） | `guided` 表示か · 当該件で未完了点があるか · 図面 `ready` か | **再開** は manual のみ · 全点 OK なら「未完了の測定点はありません」 |
| Pi4 だけ旧挙動 | Pi5 HEAD **`4f44dbb9`** か · 強制リロードしたか | Pi4 は `update-all-clients` + §6.6.4 リロード |

##### 調査メモ（拡大が変わらない）

| 仮説 | 結果 |
|------|------|
| Pi5 未デプロイ | **REJECTED** — `c90647ac` 反映済み |
| 配線不具合 | **REJECTED** — `onZoomLevel` → `focusRequest.zoom` は有効 |
| **`STEPS=2` が fit+2 で 1.5 のまま** | **CONFIRMED** — `c90647ac` は helper 化のみ。実倍率変更は **`fb10f0e0`（STEPS=4）** |

#### セッション ボタンUI統一 + 操作誘導（2026-06-05） {#自主検査-セッション-ボタンui統一-2026-06-05}

**見た目のみ**（活性判定は §セッション操作ボタン活性 のまま）。**カラーテーマによる操作誘導**は **`入力を保存`** と **`自主検査を完了`** のみ — `saveActionState.enabled` / `completeActionState.enabled` を `highlighted` に直結（専用誘導 hook なし）。

##### 視覚ルール（正本）

| 状態 | スタイル |
|------|----------|
| 押せる（全ボタン共通） | `bg-slate-700` · **`border-0`**（白枠なし）· 白文字 semibold |
| 押せない（全ボタン共通） | 同形状 · 背景・文字を弱める · **`opacity-60` / `grayscale` / `saturate` 禁止** |
| 操作誘導（保存・完了のみ） | `ring-2 ring-sky-400` + 青系軽い `box-shadow`（**`border` 幅は変えない** · レイアウト不変） |
| 入力件チップ | 選択も **色変更なし**（`aria-pressed` + 見出し `入力件（…）` + 測定値パネル） |
| 再開・ズーム等 | 青外枠 **なし** |

##### 実装境界

- テーマ: [`selfInspectionKioskTheme.ts`](../../apps/web/src/features/part-measurement/selfInspectionKioskTheme.ts) — `selfInspectionKioskButtonClass({ disabled?, size?, wide?, pressed?, highlighted? })`
- コンポーネント: [`SelfInspectionKioskButton.tsx`](../../apps/web/src/features/part-measurement/SelfInspectionKioskButton.tsx) — 共通 `Button` 不使用 · 外部 `className` 禁止
- ページ配線: `KioskSelfInspectionSessionPage.tsx` — `highlighted={saveActionState.enabled}` / `highlighted={completeActionState.enabled}`
- ズーム: `InspectionDrawingCanvasZoomControls` — 親から `getButtonClassName` 注入時のみネイティブ `<button>`
- 削除した常時表示: `saveActionHint` / `completeActionHint` / `resumeGuideActionHint`
- **却下・削除した未依頼差分**: `selfInspectionGuidedButtonTarget.ts` · `useSelfInspectionGuidedButtonHighlight.ts` · `resumeGuideHighlighted` · 押下消灯の `dismiss...` — **guided 優先誘導は採用しない**
- **維持**: `useSelfInspectionGuidedFocus` · `resolveSelfInspectionResumeGuideActionState` · `consumeNextBlurGuideAdvance` · `selfInspectionActionReasonMessage`（保存ガード・`actionError` のみ）

##### 進捗・デプロイ

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-self-inspection-button-ui`** → **`main` マージ** |
| 代表コミット | **`f2b374f5`**（`fix(kiosk): unify self-inspection session button styles`）· **`ffdaebda`**（`fix(kiosk): highlight self-inspection save and complete actions`） |
| 変更種別 | **Web のみ** |
| CI | **`26990244892`** success（lint-build-unit / security-docker / api-db-and-infra / e2e-smoke / e2e-tests） |
| Pi5 デプロイ | Detach **`20260605-105452-27065`** · HEAD **`ffdaebda`** · **`ok=134` `changed=4` `failed=0`** · **web** 再ビルド |
| Pi4×5（現行） | 2026-07-08 丸数字設定改善ロールアウトで全台 HEAD **`04bb49fe`** へ収束。Phase12 **45/0/0** |
| Phase12 | **43/0/0**（約 28s · Mac / Tailscale） |
| バンドル | `docker-web-1` `/srv/site/assets/index-D2jVY8TP.js` — `ring-2 ring-sky-400` · `border-0` · `入力を保存` · `自主検査を完了` |
| 実機 | **Pi5 キオスク目視 OK**（白枠なし · 保存/完了のみ青外枠 · 再開に強調なし） |

代表テスト: `__tests__/selfInspectionKioskTheme.test.ts` · `__tests__/SelfInspectionKioskButton.test.tsx`（ページ配線ミラー）

要件: [kiosk-self-inspection-session-buttons-requirements.md](../design-previews/kiosk-self-inspection-session-buttons-requirements.md) · プレビュー: [kiosk-self-inspection-session-buttons-preview.html](../design-previews/kiosk-self-inspection-session-buttons-preview.html)

Runbook: [§ボタンUI](../runbooks/kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05) · [deployment §ボタンUI](../guides/deployment.md#kiosk-self-inspection-session-button-ui-2026-06-05)

**将来**: 本パターン（`highlighted` = 既存 `enabled`）の他画面横展開は別タスク（ADR 未作成 · 要件ドキュメント §8 参照）。

#### セッション右ペイン入力改善（2026-06-09） {#自主検査-セッション右ペイン入力改善-2026-06-09}

順位ボード **検** → 自主検査セッション（`KioskSelfInspectionSessionPage`）の右ペイン密度改善。2026-06-09 時点では **API/保存/完了/ガイド活性は不変**。2026-06-26 以降の寸法百分台入力・公差外レビューは [§寸法百分台入力・公差外レビュー](#自主検査-寸法百分台入力-公差外レビュー-2026-06-26) を正とする。

| 項目 | 内容 |
|------|------|
| **値入力** | `self_inspection_options` 時のみ候補 dropdown と手入力を **横一列（各半分幅）**。公差表示は **約2倍フォント**（`text-2xl` 相当） |
| **保存/完了** | `SelfInspectionKioskButton` **`size="actionCompact"`**（`min-h-8` · `text-[15px]` 維持 · `wide`/青外枠契約維持） |
| **測定点一覧** | 保存/完了ボタン下に **常時表示**。`activeDraft.points` の測定値と状態（`resolveMeasurementPointInputStatus`）を即時反映。タップで選択（インライン直接入力なし） |
| **blur 競合** | 一覧タップ時 `consumeNextBlurGuideAdvance` + `data-self-inspection-point-summary-list` を chrome focus 判定に追加 |
| **選択表示** | 一覧の `selectedPointId` は **`selectedPoint?.id`**（値入力パネルの先頭フォールバックと整合） |
| **状態正本** | [`measurementPointInputStatus.ts`](../../apps/web/src/features/part-measurement/inspection-drawing/measurementPointInputStatus.ts) — ガイド `resolvePointInputStatus` も同 helper を利用 |

代表ファイル: `KioskSelfInspectionSessionPage.tsx` · `InspectionDrawingValuePanel.tsx` · `InspectionDrawingPointSummaryList.tsx` · `selfInspectionKioskTheme.ts` · `inspectionDrawingKioskUi.ts`

Runbook: [§右ペイン入力改善](../runbooks/kiosk-part-measurement.md#自主検査-セッション右ペイン入力改善-2026-06-09)

#### セッション右ペインレイアウト改善（2026-06-10） {#自主検査-セッション右ペインレイアウト改善-2026-06-10}

| 項目 | 内容 |
|------|------|
| **status** | `active`（本番 5 台反映済み · 2026-06-10） |
| **branch / HEAD** | **`feat/self-inspection-right-pane-polish`** · **`146c2438`** |
| **変更種別** | **Web のみ**（Prisma / migration / API 本番契約 **なし**） |
| **CI** | **`27244381856`** success |

順位ボード **検** → 自主検査セッション右ペインの密度・視認性改善。**API/保存/完了/ガイド活性/NFC解決は不変**。

| 項目 | 内容 |
|------|------|
| **使用前点検表示** | 計測機器/測定者を **1行2列**（各 `min-w-0 truncate`）。`nextActionLabel`（スキャン案内）は **非表示**。計測機器は `未点検` / `使用前点検済` で表示 |
| **測定点一覧** | **自主検査セッション右ペインのみ** `layout="twoColumn"`。作成/改版（`InspectionDrawingPointSidebar`）は **1列維持** |
| **選択強調** | 2列カード選択中は `ring-2 ring-cyan-300` + 高彩度 cyan 背景 |
| **保存/完了** | `actionCompact` を **`min-h-6 py-0 text-[15px] leading-none`** に更新。親 container の `p-1` + `gap-1` で境目 |
| **手元カメラ** | OFF は `tone="inactive"`（グレーアウト・**disabled ではない**）。ON は通常見た目。`aria-pressed` 維持 |

代表ファイル: `SelfInspectionNfcRegistrationPanel.tsx` · `InspectionDrawingPointSummaryList.tsx` · `selfInspectionKioskTheme.ts` · `SelfInspectionSessionHeader.tsx` · `KioskSelfInspectionSessionPage.tsx`

Runbook: [§右ペインレイアウト改善](../runbooks/kiosk-part-measurement.md#自主検査-セッション右ペインレイアウト改善-2026-06-10)

#### NFC 登録と手元カメラ実験（2026-06-09） {#自主検査-nfc-登録-手元カメラ実験-2026-06-09}

| 項目 | 内容 |
|------|------|
| **使用前点検単位** | `SelfInspectionLotEntry`（入力件）ごと。複数計測機器は `SelfInspectionLotEntryInstrumentUsage`、互換用に最初の1台を entry snapshot に保持 |
| **API 必須** | 測定者タグは常に必須。計測機器の使用前点検は `SelfInspectionRegistrationPolicyConfig.requireMeasuringInstrumentTag` で必須/任意を切替（初期値は任意） |
| **UID 解決** | `POST /api/part-measurement/self-inspection/nfc-tags/resolve` body `{ uid }` → employee / instrument / unknown / duplicate（UID を query に載せない） |
| **Web ガード** | `selfInspectionSessionActionState` — `missing_registration` / `incomplete_registration`（カメラ責務は分離） |
| **手元カメラ** | `useSelfInspectionWorkbenchCameraExperiment` — 10s · open/stop · 計測のみ（保存なし） |
| **DB** | migration `20260609120000_self_inspection_lot_entry_instrument_snapshot` |

代表ファイル: `self-inspection-nfc-tag-resolve.ts` · `useSelfInspectionNfcRegistration.ts` · `SelfInspectionNfcRegistrationPanel.tsx` · `useSelfInspectionWorkbenchCameraExperiment.ts` · `SelfInspectionSessionHeader.tsx`

Runbook: [§NFC・手元カメラ](../runbooks/kiosk-part-measurement.md#自主検査-nfc-登録-手元カメラ実験-2026-06-09)

#### 寸法百分台入力・公差外レビュー（2026-06-26） {#自主検査-寸法百分台入力-公差外レビュー-2026-06-26}

順位ボード **検** → 自主検査セッションの入力 UI と、公差外値の保存・承認ワークフローを拡張した。

| 区分 | 内容 |
|------|------|
| **寸法入力対象** | 測定点名称が `外径` / `内径` / `全長` / `全幅` / `幅` / `高さ` / `穴径` / `ピッチ` / `深さ` のもの |
| **寸法 dropdown** | 公差範囲と交差する **0.1 刻み**候補だけを出す。選択直後は `100.1※` のように百分未確定表示にし、ドラフト値にはまだ確定しない |
| **百分台ボタン** | `0`-`9`。押下で **小数第2位だけを置換**し、`100.12` のように確定する。押し直しも第2位の置換 |
| **幾何公差系** | 寸法ラベル以外は既存の `selfInspectionMeasurementValueOptions.ts` による候補生成を維持する。`0.005` などの細かい候補は従来どおり |
| **手入力** | 従来どおり直接入力可。寸法 dropdown の未確定 `※` 表示とは独立し、入力値がドラフトになる |
| **ガイド進行** | 公差内 OK は従来どおり次丸数字へ。公差外は確認ダイアログで **公差外のまま進む** を選んだ場合だけドラフトに入り、次丸数字へ進む |

公差外値は「NG を OK に変える」ものではなく、現場リーダーが後で確認・承認する対象として保存する。2026-06-26 追補以降、新規の自主検査セッションは **値単位の公差外承認ではなく、session 単位の検査記録承認**で完了させる。

| 状態 | 保存・表示 |
|------|------------|
| **未確認公差外** | UI は再入力/公差外のまま進むの二択を表示。API は `outOfToleranceAcknowledged` なしなら 400 |
| **確認済み公差外** | 値 payload に `outOfToleranceAcknowledged: true` を付けて保存。DB は `reviewStatus=PENDING`、`outOfToleranceAcknowledgedAt` を保持 |
| **承認待ちセッション** | required slot が埋まり、未承認公差外がある場合は `review_pending`。順位ボード・自主検査一覧・機種別ボードで承認待ち表示 |
| **完了 API** | 新方式セッションは測定値保存後に `recordApprovalRequiredAt != null` となり、記録承認前の `complete` を 409 で拒否。旧方式は `pendingReviewCount > 0` の間だけ 409 |
| **旧方式の公差外承認** | `recordApprovalWorkflowStartedAt=null` の既存セッションのみ、ADMIN/MANAGER が管理画面で承認。`reviewStatus=APPROVED`、承認者 ID/ユーザー名/日時/コメントを保存し、条件が揃えば完了化 |
| **新方式の検査記録承認** | キオスク「検査記録確認」で ACTIVE 社員 NFC を承認者証跡として保存。同一 transaction で pending 公差外値を `APPROVED` にし、必要 slot 入力・測定者登録・ポリシー上必要な計測機器の使用前点検が揃っていれば `completedAt` を設定 |

##### 検査記録承認（2026-06-26 追補） {#自主検査-検査記録承認-2026-06-26}

| 区分 | 内容 |
|------|------|
| **対象データ** | `SelfInspectionSession.recordApprovalWorkflowStartedAt` が入った新方式セッション。検査記録確認の一覧には、測定値保存後に `recordApprovalRequiredAt` が入った session のみ表示 |
| **承認単位** | session 単位。公差内/公差外の保存済み検査記録をまとめて確認する |
| **一覧状態** | `input_incomplete`（required slot 未入力/値不足）· `registration_incomplete`（測定者不足、または設定 ON 時の点検不足）· `approvable` · `approved` |
| **入口ゲート** | 自主検査トップの「検査記録確認」。納期管理と同じ `2520` 初期パスワードを `x-client-key` 付きで検証し、通過状態は検査記録確認画面の表示中だけ保持。別画面へ移動すると再入力 |
| **本人証跡** | 最終承認者は NFC。初期導入は `Employee.status=ACTIVE` かつ NFC 登録済みなら可。社員コード・表示名・NFC UID・端末 ID/端末名・承認日時を snapshot 保存 |
| **コメント** | DB/API は任意コメントを持つが、初期 UI では入力不要 |
| **旧 UI/API 境界** | 管理画面 `/admin/part-measurement/self-inspection-reviews` と旧承認 API は `recordApprovalWorkflowStartedAt=null` の legacy 用。新方式セッションの旧承認 API は 409 |

追加 API:

- legacy:
  - `GET /api/part-measurement/self-inspection/out-of-tolerance-reviews` — 旧方式の未承認公差外をセッション単位で取得。ADMIN/MANAGER JWT 必須。
  - `POST /api/part-measurement/self-inspection/sessions/:id/out-of-tolerance-review/approve` — 旧方式コメント付き承認。ADMIN/MANAGER JWT 必須。`x-client-key` 単独・VIEWER は不可。
- record approval:
  - `POST /api/kiosk/part-measurement/self-inspection/record-approvals/verify-access-password`
  - `GET /api/part-measurement/self-inspection/record-approvals`
  - `GET /api/part-measurement/self-inspection/record-approvals/sessions/:id`
  - `POST /api/part-measurement/self-inspection/record-approvals/approver/resolve`
  - `POST /api/part-measurement/self-inspection/sessions/:id/record-approval/approve`

代表ファイル:

- API: `self-inspection.service.ts`、`routes/part-measurement/index.ts`、`routes/kiosk/part-measurement-self-inspection-record-approval-auth.ts`、migration `20260626120000_self_inspection_out_of_tolerance_review` / `20260626143000_self_inspection_record_approval` / `20260630170000_self_inspection_record_approval_saved_gate`
- Web: `InspectionDrawingValuePanel.tsx`、`selfInspectionDimensionValueInput.ts`、`selfInspectionGuidedFocus.ts`、`KioskSelfInspectionSessionPage.tsx`、`KioskSelfInspectionRecordApprovalPage.tsx`、`SelfInspectionOutOfToleranceReviewsPage.tsx`

##### 検査記録承認の実装・本番反映（2026-06-26）

| 区分 | 内容 |
|------|------|
| **PR / merge** | PR #624 を `main` へ squash merge。merge commit は `b3763fba`（`feat(kiosk): add self-inspection record approval`） |
| **実装到達点** | 新規セッションのみ `recordApprovalRequiredAt` でキオスク検査記録承認対象にする。承認は session 単位、最終承認者は ACTIVE 社員 NFC snapshot。旧管理画面承認は `recordApprovalRequiredAt=null` の legacy 用に限定 |
| **CI** | `b3763fba` の GitHub Actions は `CI` / `Secret scan` / `CodeQL` success。`pages build and deployment` failure は前 main から継続する GitHub Pages 側の別件 |
| **バックアップ** | デプロイ前に Pi5 で local backup 成功。DB `/opt/backups/db_backup_20260626_134049.sql.gz`（283M）、photos `/opt/backups/photos_backup_20260626_134049.tar.gz`（22M）。Gmail provider は upload 非対応のため外部退避は別件として未対応 |
| **Pi5 deploy** | run `20260626-134514-2272`。HEAD `b3763fba`、`PLAY RECAP failed=0`、Prisma `Database schema is up to date!`、API health `status=ok` |
| **Pi4 deploy** | run `20260626-135158-30476`。`raspberrypi4` / `raspi4-robodrill01` / `raspi4-fjv60-80` / `raspi4-kensaku-stonebase01` は全台 `failed=0` / `unreachable=0` |
| **Phase12** | `./scripts/deploy/verify-phase12-real.sh` は `PASS 43 / WARN 0 / FAIL 0` |

知見:

- 新方式セッションでは operator の `complete` は記録承認前に 409 で止まるため、完了化の正規導線はキオスク「検査記録確認」画面になる。
- 2026-06-30 追補以降、開いただけ/リセット直後/使用前点検のみのセッションは検査記録確認に出さない。測定値保存後だけ一覧に出し、`input_incomplete` / `registration_incomplete` / `approvable` で進捗と漏れを見せる。承認操作は `approvable` のみ有効。
- 2520 パスワードは画面入場ゲートであり、本人証跡ではない。承認証跡は ACTIVE 社員 NFC の snapshot を正とする。
- API health は `ok` だが、デプロイ直後に heap allocated usage warning が 94.9% 前後で出た。即時障害ではないが、次回運用確認時に継続監視する。

次回再開メモ:

- 現場実データで「検査記録確認」→ 2520 → 入力途中/点検不足/承認可能の一覧 → ACTIVE 社員 NFC → `completedAt` 設定までを目視記録する。
- バックアップの外部退避先は別件で再検討する。現状の Gmail provider は読み取り専用で upload できないため、local backup のみが成功している。
- GitHub Pages workflow failure は今回機能の deploy blocker ではないが、docs/site 運用として別途切り分ける。

##### 寸法百分台入力・公差外レビューの実装・検証状況（2026-06-26）

- **到達点**: PR #622 を `main` へマージ済み。merge commit は `3f4f1b50`。デプロイ run `20260626-110153-11620` で Pi5 と Pi4×4 へ反映済み（Pi3 は `--limit '!raspberrypi3'` で除外）。
- **CI/ローカル検証**: PR #622 の GitHub Actions は merge 前に全 pass。ローカルは Web build/tsc/test、API build/integration、Docker 一時 Postgres で migration・SQL・`EXPLAIN` を確認済み。
- **本番確認**: Pi5 は Prisma migration `20260626120000_self_inspection_out_of_tolerance_review` 適用済み、DB enum/列/index 作成済み、`reviewStatus='PENDING'` 検索は index scan。API health OK、phase12 実機検証は `PASS 43 / WARN 0 / FAIL 0`。
- **権限確認**: レビュー API は unauth と `x-client-key` 単独を 401 で拒否。承認は ADMIN/MANAGER の管理ログインのみ。
- **実機 UI 確認**: 現場実機で寸法の百分台ボタン選択は確認済み。
- **テスト知見**: 測定点名称が寸法対象（例: `外径`）だと寸法入力モードになる。従来候補生成をテストしたい fixture は `幾何公差` など寸法対象外の名称を使う。完了判定 mock では `selfInspectionMeasurementValue.findMany` が pending review 数取得に必要。

##### 未完了・次回再開メモ

- 現場リーダー専用ロール名は未実装。初期導入は ACTIVE 社員 NFC を承認者として許可する。
- 新方式の現場通し確認は、測定値保存後に「検査記録確認」→ 2520 → 入力途中/点検不足/承認可能の一覧 → ACTIVE 社員 NFC → 完了化までを優先する。旧管理画面は `recordApprovalWorkflowStartedAt=null` の legacy 用。
- 通知・エスカレーションは未実装。現仕様は順位ボード、自主検査一覧、機種別ボード、検査記録確認画面で未完了/承認待ちを見せる範囲に留める。

#### 自主検査・計測機器タグ任意化（2026-06-30） {#自主検査-計測機器タグ任意化-2026-06-30}

| 項目 | 内容 |
|------|------|
| **登録ポリシー** | 測定者タグは常に必須。計測機器の使用前点検は共有設定で必須/任意を切替。初期値は **任意** |
| **DB** | `SelfInspectionRegistrationPolicyConfig`。共有 row は `key='shared'`。row 未作成時も `requireMeasuringInstrumentTag=false` として扱う |
| **API** | `GET/PUT /api/part-measurement/self-inspection/registration-policy`。GET は `allowView`、PUT は `allowWriteKiosk` |
| **Web** | キオスク **自主検査 > 検査記録確認** の上辺メニューに **計測機器の使用前点検必須 ON/OFF** を表示。切替後は一覧・詳細・セッション系 query を再取得 |
| **保存/承認** | OFF のときは社員タグだけで entry 保存・検査記録承認・完了が可能。ON に戻すと使用前点検なし entry は再び `registration_incomplete` 扱い |
| **範囲外** | 計測機器の返却は自主検査画面では扱わず、既存の持出一覧/返却フローで行う |

#### 自主検査・計測機器使用前点検/持出統合（2026-06-30） {#自主検査-計測機器使用前点検-持出統合-2026-06-30}

詳細正本: [Plan: 自主検査の計測機器使用前点検・持出統合](../plans/self-inspection-instrument-usage-loans.md)

| 項目 | 内容 |
|------|------|
| **正本データ** | 自主検査からの使用前点検も、既存の `Loan` / `InspectionRecord` / `MeasuringInstrumentLoanEvent` を正本にする |
| **紐づけ単位** | `SelfInspectionLotEntryInstrumentUsage` で入力件ごとに複数計測機器を記録。既存 `SelfInspectionLotEntry.measuringInstrumentId` は互換用に最初の1台を保持 |
| **貸出中の扱い** | 未貸出なら `Loan` 作成。同じ社員が貸出中なら既存 `Loan` 再利用。別社員が貸出中なら拒否 |
| **画面表現** | `登録` ではなく `使用前点検済` / `未点検` / `点検不足` を使う |

##### 実装・検証結果（2026-06-30）

| 項目 | 結果 |
|------|------|
| **ブランチ / コミット** | `feat/self-inspection-instrument-registration-policy` · `38d4153e` |
| **CI** | GitHub Actions `28420404387` success（lint/build/API integration/Docker/E2E まで全ジョブ成功） |
| **本番デプロイ** | `RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 ./scripts/update-all-clients.sh feat/self-inspection-instrument-registration-policy infrastructure/ansible/inventory.yml --limit '!raspberrypi3' --detach --follow`。Run ID `20260630-134607-14585`、Pi5 + Pi4 キオスク 5 台すべて `failed=0`。Pi3 は対象外 |
| **DB / API スモーク** | Pi5 本番で `SelfInspectionRegistrationPolicyConfig` テーブル存在確認 OK。`GET /api/part-measurement/self-inspection/registration-policy` は `requireMeasuringInstrumentTag:false` を返す |
| **実機自動検証** | `./scripts/deploy/verify-phase12-real.sh` → `PASS 45 / WARN 0 / FAIL 0` |
| **現場実機確認** | ユーザー実機検証 OK（2026-06-30） |

次回再開時は、現仕様を「測定者タグは必須、計測機器の使用前点検は共有トグルで必須/任意。初期値は任意」と扱う。トグル OFF のままなら社員タグ + 測定値入力で保存・承認でき、使用前点検した計測機器は複数台でも記録される。

##### 未完了・次回候補

- 計測機器の使用前点検必須トグルの変更履歴・監査ログは未実装。現行は共有 row の `updatedBy` / `updatedAt` のみ。
- デプロイ中に同一ホストへ別 Ansible/SSH 診断を並行実行すると、SSH ControlPath/SFTP 待ちで本体の進行確認が遅れることがある。進行中の `update-all-clients.sh --follow` がある間は、同じ Pi4 への追加 Ansible 診断を避ける。

##### トラブルシュート（NFC・カメラ）

| 症状 | 確認 | 対処 |
|------|------|------|
| 保存が **400 測定者/使用前点検必要** | 右ペイン使用前点検パネルが未完了か · 検査記録確認の **計測機器の使用前点検必須** が ON か | 測定者タグを必ずスキャン。ON 時だけ計測機器の使用前点検も実施 · 未登録タグは管理画面で社員/計測機器を確認 |
| **duplicate** 表示 | 同一 UID が社員と計測機器の両方に登録 | マスタデータ修正 |
| 保存済み entry の NFC を差し替えたい | 仕様上 **自動差し替え不可** | 将来の明示操作まで再スキャンは無視 |
| 完了が **409 未登録** | 旧 entry（migration 前）に機器 snapshot なし | 該当 entry を再保存（タグ付き） |
| カメラ ON で Pi4 が重い | 常時 stream 保持していないか · 10s 間隔か | OFF に戻す · Runbook 実測項目を記録 |

##### トラブルシュート（ボタンUI・操作誘導）

| 症状 | 確認 | 対処 |
|------|------|------|
| 保存/完了に **白枠** が残る | HEAD **`f2b374f5` 以降**か · バンドルに `border-0` があるか | Pi5 再デプロイ · キオスク強制リロード |
| 保存可能なのに **青外枠なし** | `saveActionState.enabled` が false か（dirty/全点 OK） | §ボタン活性の表で照合 · HEAD **`ffdaebda` 以降** |
| **再開** に青外枠 | 誤って `highlighted` を渡していないか（本番は未配線） | コード差分確認 · 再ビルド |
| Pi4 だけ旧 UI（緑保存・シアン選択等） | Pi5 HEAD · Pi4 **強制リロード** | `update-all-clients.sh` + §6.6.4 |
| 青外枠で **レイアウトがずれる** | `ring` が `border` 幅を増やしていないか | テーマは `ring` + shadow のみ（要件どおり） |
| CI `security-docker` Trivy 失敗 | ランナー **ディスク不足**（Pi5 SSD とは無関係） | 再実行 or インフラ確認 · 本 UI 変更とは独立 |

##### 実装レビュー知見

- **境界の分離**: 操作誘導は **見た目責務**（`highlighted` prop）に閉じ、活性は `selfInspectionSessionActionState` のまま — 業務順序の「次に何を押すか」判定を UI に持ち込まない。
- **用語**: 画面文言は **「入力を保存」**（「保存ボタン」と略さない — 会話とコードの混同防止）。
- **未依頼実装の撤回**: エージェントが先行して入れた guided 優先ハイライトはユーザー指摘で削除。以後は要件ドキュメント合意後に実装。

#### 進捗・デプロイ（2026-06-04 · 初回ガイドフォーカス）

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-self-inspection-guided-focus`** → **`main` マージ** |
| 代表コミット | **`5d7dd6f6`**（純関数・hook）· **`32c4858f`**（`KioskSelfInspectionSessionPage` 配線）· 同ブランチで reset/試行は **`f16cb7ca`** |
| 変更種別 | **Web のみ**（ガイド単体）/ reset は **API+Web+migration** |
| CI | **`26925365886`** success（`32c4858f`）· リセット同梱 push は **`26935485926`** success（`f16cb7ca`） |
| Pi5 デプロイ | **`20260604-155553-5452`** · HEAD **`f16cb7ca`** · `failed=0` · Docker **`web`/`api` 再ビルド**（reset 同梱デプロイ） |
| Pi4×5（現行） | 2026-07-08 丸数字設定改善ロールアウトで全台 HEAD **`04bb49fe`** へ収束。Phase12 **45/0/0** |
| Phase12 | **43 PASS / 0 WARN / 0 FAIL**（デプロイ直後） |

代表ファイル: `selfInspectionGuidedFocus.ts` · `useSelfInspectionGuidedFocus.ts` · `SelfInspectionSessionHeader.tsx` · `InspectionDrawingCanvas.tsx`（`focusRequest`）· `inspectionDrawingCanvasLayout.ts`（`computeScrollToCenterMarker`）

Runbook: [§ガイドフォーカス](../runbooks/kiosk-part-measurement.md#自主検査-ガイド付きフォーカス-2026-06-04) · [deployment §2026-06-04](../guides/deployment.md#kiosk-self-inspection-guided-focus-reset-trial-2026-06-04)

#### トラブルシュート（ガイドフォーカス）

| 症状 | 確認 | 対処 |
|------|------|------|
| 図面は出るがガイドが動かない | Pi5 `web` が **`32c4858f` 以降**か · バンドルに `selfInspectionGuidedFocus` があるか | Pi5 再デプロイ · キオスク強制リロード |
| **拡大が 1.5 のまま（2.0 に見えない）** | HEAD が **`fb10f0e0` 以降**か · `SELF_INSPECTION_GUIDED_ZOOM_STEPS=4` 相当か | **`20260604-191118-31485`** 再デプロイ · 強制リロード |
| **保存押下で次点へ進む** | 保存前 blur が通常 `blur` か · バンドルに `data-self-inspection-session-actions` があるか | **`fb10f0e0`** 以降 · 保存ボタン `onPointerDownCapture` |
| OK 後も同一点に留まる | 未確認の公差外か · 確認ダイアログで再入力を選んだか · DevTools で PATCH 400/409 | 値を公差内に修正、または **公差外のまま進む** を選んでレビュー待ちとして保存 |
| 手動選択後に勝手に戻る | `focusRequest` が未消化で再適用されていないか | **再開** を使う · `fitToView` 後は手動モードが正 |
| 2件目以降ガイドが動かない | 保存/件切替後 **manual** か · **再開** したか | 仕様どおり **再開** で guided 復帰 |
| 拡大 2 回目で震える | ズーム痙攣修正（`f6a9544a`）の回帰 | [§ズーム痙攣](#検査図面-キャンバスズーム痙攣修正-2026-05-31) を参照（**1.5 履歴は改変しない**）。**2.0** は Runbook 手動確認 |

### 自主検査フルリセット + 検査図面ガイド試行（2026-06-04） {#自主検査-フルリセット-ガイド試行-2026-06-04}

| 機能 | 要点 |
|------|------|
| **フルリセット** | 入口は **セッション画面のみ**（一覧・順位ボードからは不可）。`POST /api/part-measurement/self-inspection/sessions/:id/reset` が **行ロック後**に preflight → 旧セッション削除 → **最新 active `THREE_KEY` 検査図面テンプレ**で新 UUID セッション作成まで **1 トランザクション**で完了 |
| **確認フラグ** | `confirmDestructiveReset: true` 必須。`completedAt` ありは **`confirmCompletedSessionReset: true` も必須**（ロック後の `lockedSession.completedAt` で再検証） |
| **監査** | `SelfInspectionSessionResetAuditLog`（migration **`20260604120000_self_inspection_session_reset_audit`**）+ pino 構造化ログ。**削除済み session への強 FK は付けない**（監査行が連鎖削除されないため） |
| **クライアント** | ヘッダー **初期化** → 2 段階 `ConfirmDialog` → 成功後 `navigate(..., { replace: true })` で新 `/sessions/:id`。`useResetSelfInspectionSession` が React Query 無効化 + **`purgeLeaderboardBoardCacheForScheduleRow`**（該当 `scheduleRowId` を含む board cache のみ・全 DB 消去はしない） |
| **ガイド試行** | **検査図面 作成/改版**（`KioskInspectionDrawingCreatePage`）+ DEV **`KioskInspectionDrawingCreatePreviewPage`**（parity）。`inspectionDrawingGuidedTrial.ts` / `useInspectionDrawingGuidedTrial.ts`。並びは `markerNo` → 配列 index → `id`。**永続化・API 呼び出しなし** |
| **試行の進行** | テスト値コミットが **OK** のときのみ次点。点削除・図面差し替えで `resetTrialState()` |

#### API 契約（reset）

| 項目 | 内容 |
|------|------|
| Body | `confirmDestructiveReset`, `confirmCompletedSessionReset?`, `requestId`（監査相関・必須）, `reason?`, `clientDeviceId?`, `clientDeviceName?` |
| 成功 | `{ newSession: SelfInspectionSessionDto }` — 新 UUID・同一 `sessionBusinessKey` 系の業務キー・**現時点の active テンプレ** |
| preflight 失敗例 | テンプレなし / 図面・座標未設定 / `expectedEntryCount` 不整合 / 確認フラグ不足 → **400** |
| 実装境界 | 純関数 **`self-inspection-reset-preflight.ts`**（確認・snapshot・restart payload）· サービス **`resetSession`**（`lockSessionRow` 後に active テンプレ再取得・`buildRestartPayloadFromSessionSnapshot` は **locked 行**から生成） |

#### 進捗・デプロイ（2026-06-04）

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-self-inspection-guided-focus`** → **`main` マージ** |
| 代表コミット | **`f16cb7ca`** — `feat(kiosk): add self-inspection reset and guided trial flow` |
| 変更種別 | **API + Web + Prisma**（Pi5: `api`/`web` 再ビルド + **`prisma migrate deploy`**） |
| Migration | **`20260604120000_self_inspection_session_reset_audit`** — インデックス名は schema `@@index(..., map: "...")` と SQL を一致（`SelfInspectionSessionResetAuditLog_idx_*`） |
| CI | **`26935485926`** success |
| Pi5 デプロイ | **`20260604-155553-5452`** · HEAD **`f16cb7ca`** · `failed=0` · migrate **104 件・up to date** |
| Pi4×5（現行） | 2026-07-08 丸数字設定改善ロールアウトで全台 HEAD **`04bb49fe`** へ収束。Phase12 **45/0/0** |
| Phase12 | **43/0/0** |

代表ファイル: `self-inspection-reset-preflight.ts` · `self-inspection.service.ts`（`resetSession`）· `SelfInspectionSessionResetAuditLog` · `purgeLeaderboardBoardCacheForScheduleRow.ts` · `KioskSelfInspectionSessionPage.tsx` · `inspectionDrawingGuidedTrial.ts` · `useInspectionDrawingGuidedTrial.ts`

Runbook: [§フルリセット・ガイド試行](../runbooks/kiosk-part-measurement.md#自主検査-フルリセット-ガイド試行-2026-06-04) · [deployment §2026-06-04](../guides/deployment.md#kiosk-self-inspection-guided-focus-reset-trial-2026-06-04)

#### 実装レビュー知見（後続エージェント向け）

| 論点 | 決定 |
|------|------|
| 完了確認の TOCTOU | `completedAt`・`confirmCompletedSessionReset`・snapshot・restart payload は **すべて `lockSessionRow` 後**の `lockedSession` で判定・生成（ロック前 read のみでは不可） |
| active テンプレの鮮度 | `activeTemplate` / `plannedQuantity` / `expectedEntryCount` も **トランザクション内・ロック後**に再取得（改版・有効化のレースを避ける） |
| 監査 FK | 削除された `sessionId` を参照する監査行は残すため **強 FK なし** |
| Prisma インデックス | migration SQL の `CREATE INDEX` 名は schema の `map:` と一致させる（不一致は `migrate diff` drift の原因） |
| DEV プレビュー | `guidedTrial` は `useInspectionDrawingGuidedTrial` + `focusRequest` + `onCommitTestValue` まで配線（ボタンのみ出すと Enter/blur 進行が動かない） |
| ローカル integration test | 一時 Postgres は **`pgvector/pgvector:pg16`**（`vector` extension 必須）· `cleanPartMeasurementTables` に **`selfInspectionSessionResetAuditLog.deleteMany`** を含める |
| `machineName` | `KioskSelfInspectionSessionPage` の start/resolve payload に **`machineName` を含める**（reset 再作成 payload と整合） |

#### トラブルシュート（reset・ガイド試行）

| 症状 | 確認 | 対処 |
|------|------|------|
| **初期化** が出ない | セッション画面か · 保存中/完了処理中で `resetDisabled` か | 操作完了後に再表示 |
| reset 400（確認不足） | body の `confirmDestructiveReset` / 完了済みの `confirmCompletedSessionReset` | UI の 2 段階確認どおりに送信 |
| reset 後も順位ボード色が古い | IndexedDB board cache が残っていないか | `purgeLeaderboardBoardCacheForScheduleRow` 配線確認 · 強制リロード |
| migrate drift（インデックス名） | `prisma migrate diff` が rename を提案していないか | [§実装レビュー](#自主検査-フルリセット-ガイド試行-2026-06-04) のインデックス名表 |
| ガイド試行で次に進まない | OK 判定か · DEV プレビューで hook 未接続か | 公差内 OK のみ進行 · 本番/プレビュー両方で `useInspectionDrawingGuidedTrial` 確認 |
| Pi5 のみ新 UI・Pi4 は旧 | Pi4 は SPA キャッシュ | Pi5 HEAD 一致 · **強制リロード**（Pi4 本体の git pull は不要） |

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
| 公差 UI（2026-06-03 追補） | **符号付き offset** · legacy 片側入力で移行 + 両側 seed · 候補外名称は一時 option |
| 自主検査測定値 UI | **セッション画面のみ** dropdown+手入力 · 刻み=offset 最小桁 · **>200 件は手入力のみ** |

### キオスク検査図面 UI/UX（符号付き公差・一覧・候補入力）（2026-06-03） {#検査図面-uiux-符号付き公差-2026-06-03}

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/inspection-drawing-signed-tolerance-uiux`** → **`main` マージ（2026-06-03）** |
| 代表コミット | **`6e436cfc`** — `feat(part-measurement): improve inspection drawing kiosk UI` |
| CI | GitHub Actions **`26867660917`** · **success** |
| 変更種別 | **Web のみ**（Prisma/API 変更なし） |
| ExecPlan | [inspection-drawing-signed-tolerance-uiux.md](../plans/inspection-drawing-signed-tolerance-uiux.md) |

#### 仕様（保存契約は不変）

- **公差 UI**: 基準値 + **符号付き**下限/上限公差 → 保存時 `lowerLimit = nominal + lowerOffset`, `upperLimit = nominal + upperOffset`（`toleranceFields.ts`）。
- **公差表示（2026-07-01 追補）**: デジタル入力・HTML 帳票は通常行を `基準 10 / -0.05〜+0.05` と表示する。正の公差 raw は `+` を付け、legacy（`nominalValue=null`）は `合格範囲 lower〜upper` 表示を維持する。**Web のみ**（API / Prisma / migration なし）。
- **legacy**（`nominalValue=null` + 絶対上下限のみ）: 名称のみ・基準値のみ入力は絶対値維持。片側公差入力で符号付きモードへ移行し、legacy から両側 offset を seed（`mergeInspectionDrawingPointPatch`）。
- **名称**: 固定候補 `inspectionDrawingMeasurementLabelOptions.ts`。候補外既存値は `（既存）` option。新規点は名称未選択から select。
- **上辺一覧（〜2026-06-03 旧 UI）**: `pointListSlot` + `InspectionDrawingPointSummaryStrip` — **作成/改版では廃止**（[§作成レイアウト](#検査図面-作成改版レイアウト-2026-06-03)）。
- **自主検査のみ**: `valueInputMode="self_inspection_options"` — **測定値選択** dropdown + 手入力。select 内ヒントは表示しない。刻みは offset 最小桁・最大 **200** 件・格子は **ceil/floor**（`selfInspectionMeasurementValueOptions.ts`）。
- **本番記録**（`KioskInspectionDrawingEditPage`）: 測定値は **自由入力のまま**。

#### 2026-07-01 公差オフセット表示・測定値選択 UI 変更

- **作業ブランチ / 代表コミット**: `feat/inspection-drawing-tolerance-offset-display` / `091bc4ce`（`feat(web): update inspection tolerance display`）。
- **契約**: API / Prisma / migration / wire shape は変更しない。DB と API は従来どおり絶対値 `nominalValue` / `lowerLimit` / `upperLimit` を保持し、Web 表示だけを公差オフセット表記にする。
- **表示 helper**: `inspectionDrawingToleranceDisplay.ts` が UI と HTML 帳票の共通 presentation utility。保存・判定責務の `toleranceFields.ts` へ表示責務を混ぜない。
- **通常行**: `lowerToleranceRaw` / `upperToleranceRaw` を使い、`基準 10 / -0.05〜+0.05` の形式で表示する。正の raw は `0.05` でも `+0.05` と表示し、区切りは `〜`。
- **legacy 行**: `nominalValue=null` は推定基準値を作らず、絶対範囲の `合格範囲 9.95〜10.05（基準値未設定）` 系を維持する。
- **入力 parser**: `parseToleranceRawFields` は現行維持。検査図面作成時の上限公差 raw は `0.05` と `+0.05` を同じ正の offset として扱う。
- **測定値選択**: 自主検査候補 select のラベルは `測定値選択`。select 内の `候補（刻み ...）` ヒント option は空欄 option にし、`value=""` によるリセット挙動と `測定値（直接入力）` は維持する。
- **検証**: targeted Vitest 5 files / 41 tests、`pnpm --filter @raspi-system/web test` 239 files / 1149 tests、web lint、web build は pass。CI `28493255636` は success（Node.js 20 deprecation と `pnpm audit` high severity は非ブロッキング注記）。
- **デプロイ / 実機**: Pi5 + Pi4 キオスク 5 台へ順次 deploy 済み。Detach Run ID は `raspberrypi5=20260701-133452-21002`、`raspberrypi4=20260701-134131-2281`、`raspi4-robodrill01=20260701-134606-22779`、`raspi4-fjv60-80=20260701-134932-194`、`raspi4-kensaku-stonebase01=20260701-135305-6496`、`raspi4-sessaku-01=20260701-135926-3791`。Phase12 再検証は **PASS 45 / WARN 0 / FAIL 0**。現場実機目視は 2026-07-01 に OK 確認済み。
- **未完了**: この変更範囲の未完了はなし。CI の Node.js 20 deprecation / audit 注記は別タスクで扱う。

#### 2026-07-06 名称・公差種別設定と上下限公差候補 {#検査図面-名称-公差種別設定-2026-07-06}

- **作業ブランチ / 代表コミット**: `feat/inspection-drawing-tolerance-kind-settings` / **`20e90160`**（`feat(part-measurement): add inspection drawing tolerance kind settings`）。
- **目的**: 基準値は OCR 候補で入力しやすくなったため、上限公差・下限公差も名称に応じた候補で入力補助する。
- **保存契約**: 既存どおり `PartMeasurementTemplateItem.nominalValue/lowerLimit/upperLimit` は絶対値を保持する。既存テンプレの公差値移行・補正・自動変換はしない。
- **DB/API**: `PartMeasurementToleranceKind` enum と `PartMeasurementInspectionLabelSetting` を追加。`GET /api/part-measurement/inspection-drawing/measurement-label-settings` は管理者系 JWT またはキオスク `x-client-key` で読める。`PATCH` は `ADMIN` / `MANAGER` JWT のみ。
- **既定ルール**: 名称に **`度`** を含む場合は **幾何公差**、それ以外は **寸法公差**。このため初期状態では `直角度` と `面粗度` は幾何公差、`幅` / `厚み` は寸法公差。
- **管理設定**: 管理コンソール `/admin/tools/part-measurement-templates` の **検査図面 名称・公差種別** セクションで、名称ごとに `寸法公差 / 幾何公差` を一覧編集・追加・削除・保存できる。
- **候補値**: 幾何公差は `0` / `0.001`〜`0.009` / `0.01` / `0.015` / `0.020` / `0.030` / `0.050`。寸法公差は `-0.9`〜`+0.9` を `0.1` 刻み、表示は `-0.1` / `0` / `+0.1` 形式。
- **UI契約**: 上限公差・下限公差は同じ `datalist` 候補を出す。候補外の手入力は維持し、名称変更時も入力済み上下限公差は自動変更しない。API 取得失敗時は既定ルールへフォールバックする。
- **主な実装**: `packages/shared-types/src/part-measurement/inspection-drawing-tolerance-kind.ts`、`InspectionDrawingPointSettingsPanel.tsx`、`InspectionDrawingMeasurementLabelSettingsSection.tsx`、`inspection-drawing-measurement-label-settings.service.ts`。
- **ローカル検証**: 一時 Postgres で migration / integration test **70 tests passed** / `EXPLAIN`、Web focused test **41 files / 211 tests passed**、Web build pass。既存 DB/既存コンテナは変更しない。
- **CI / デプロイ**: GitHub Actions **`28758193791` success**。本番デプロイ **`20260706-082903-1300`** は summary success true / exitCode 0 / totalHosts 7 / failedHosts・unreachableHosts なし。Pi5 は Docker rebuild + Prisma migrate/status + API health recover、Pi4×5 は kiosk-browser/status-agent restart OK、Pi3 は lightdm 復旧後 `signage-lite.service is active`。
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。

#### 2026-07-06 公差入力 実機フィードバック対応 {#検査図面-公差入力-実機フィードバック-2026-07-06}

- **作業ブランチ / 代表コミット**: `feat/inspection-drawing-tolerance-input-usability-fixes` / **`becb6e7c`**（`fix(web): improve inspection tolerance input usability`）。
- **目的**: 実機検証で出た「幾何公差に `0` が必要」「候補選択後に別候補を選び直せない」「公差入力文字が背景と同化する」「名称 placeholder が長い」を解消する。
- **変更内容**: 幾何公差候補は `0` / `0.001`〜`0.009` / `0.01` / `0.015` / `0.020` / `0.030` / `0.050`。幾何公差は上下限公差2入力ではなく `上限値` 入力 + `合格範囲 0〜上限値` 表示。候補入力は選択済み候補の再フォーカス時に一時クリアし、別候補を選び直せる。候補を選ばず blur した場合は元値へ復元する。基準値・上限値・上限公差・下限公差は白背景 + 黒文字で固定し、名称未選択表示は `選択`。
- **契約**: Web/shared のみ。API / DB / Prisma migration / 既存テンプレ / 保存契約（絶対 `lowerLimit` / `upperLimit`）は変更しない。候補外の手入力値は引き続き保持・保存できる。
- **主な実装**: `inspection-drawing-tolerance-kind.ts`、`InspectionDrawingPointSettingsPanel.tsx`、`inspectionDrawingKioskUi.ts`、`inspectionDrawingMeasurementLabelOptions.ts`。
- **ローカル検証**: `shared-types build`、Web focused test **41 files / 213 tests passed**、Web build、monorepo lint、`git diff --check` success。
- **CI / デプロイ**: GitHub Actions **`28760895857` success**。本番デプロイ **`20260706-100018-28681`** は summary success true / exitCode 0 / totalHosts 7 / failedHosts・unreachableHosts なし。
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。

#### 2026-07-08 丸数字設定改善（保存状態・右ペイン・幾何公差上限値） {#検査図面-丸数字設定改善-2026-07-08}

- **作業ブランチ / 代表コミット**: `feature/assembly-lot-serial-workflow` / **`04bb49fe`**（`feat: improve inspection drawing marker settings`）。
- **変更種別**: Web + shared-types のみ。API / DB / Prisma migration / 保存 API の wire shape は変更しない。
- **保存状態**: 保存ボタンは **変更あり + 入力有効 + 保存中でない + 閲覧版でない** ときだけ enabled。状態表示は既存1行ツールバー内の **保存ボタン右、一覧へ戻る左** に置き、`保存済み` / `未保存あり` / `入力不足` / `保存中` / `閲覧のみ` を表示する。未保存変更がある内部リンク遷移とブラウザ更新/終了は警告する。一時保存は追加せず、既存の改版保存を確定保存として維持する。
- **dirty 判定**: `inspectionDrawingCreateDraft.ts` に保存可否理由・dirty snapshot・状態表示の純粋関数を置く。比較対象から `testValue`、OCR状態、選択点、zoom、メッセージは除外する。新規作成は未保存データとして扱い、編集時だけ読込済みテンプレートを baseline にする。保存成功後は再読込内容で baseline を更新して `保存済み` に戻す。
- **右ペイン**: 外枠 `lg:w-[17rem]` は維持。名称と基準値/上限値を1行ずつに分け、名称 select は見切れないよう全幅化する。位置調整はタイトル「位置」を出さず、`↑ ↓ ← →` の1行配列。`この点を削除` と `全削除` は横2分割で、`全削除` は確認後に全点・選択・OCR候補・ガイド状態をクリアする。アクティブカードは背景色を維持し、枠線/ring を強くする。
- **名称候補**: `厚み` を追加。初期種別は寸法公差。
- **幾何公差**: 入力値を **上限値** とし、合格範囲は **0〜上限値**。保存 payload は `nominalValue=上限値` / `lowerLimit=0` / `upperLimit=上限値`。候補は `0` / `0.001`〜`0.009` / `0.01` / `0.015` / `0.020` / `0.030` / `0.050`。UI変更・OCR反映・保存ペイロード変換は `markerNumbering.ts` の `buildGeometricTolerancePointPatch` / `drawingPointToTemplateItemInput` を通す。
- **ローカル検証**: Web targeted tests **9 files / 65 tests passed**、`pnpm --filter @raspi-system/web lint`、`pnpm --filter @raspi-system/web build`、`pnpm --filter @raspi-system/shared-types build`、`git diff --check` success。
- **CI**: GitHub Actions **`28910499400` success**（`lint-build-unit` · `api-db-and-infra` · `security-docker` · `e2e-smoke` · `e2e-tests`）。
- **本番デプロイ**: Pi5 + Pi4×5 へ順次反映済み。全6ホストの HEAD は **`04bb49fe`**。

| ホスト | Detach Run ID | RECAP / 備考 |
|--------|---------------|--------------|
| `raspberrypi5` | **`20260708-103842-32504`** | `ok=135` `changed=4` `failed=0` · Docker rebuild/restart · Prisma migrate/status · API health OK |
| `raspi4-kensaku-stonebase01` | **`20260708-104449-7203`** | `ok=130` `changed=10` `failed=0` · kiosk/status-agent OK · NFC ready · barcode ready after 1 retry |
| `raspberrypi4` | **`20260708-110444-28905`** | `ok=123` `changed=10` `failed=0` · kiosk/status-agent OK · NFC ready · kiosk UI reachable |
| `raspi4-robodrill01` | **`20260708-110943-19113`** | `ok=123` `changed=9` `failed=0` · kiosk/status-agent OK · NFC ready · kiosk UI reachable |
| `raspi4-fjv60-80` | **`20260708-111331-2379`** | `ok=123` `changed=9` `failed=0` · kiosk/status-agent OK · NFC ready · kiosk UI reachable |
| `raspi4-sessaku-01` | **`20260708-111719-728`** | `ok=123` `changed=9` `failed=0` · kiosk/status-agent OK · NFC ready · kiosk UI reachable |

- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。deployed Web smoke は保存なしで、初期 `入力不足` + 保存 disabled、測定点追加後 `未保存あり` + 保存 enabled、`全削除` / `厚み` / `↑ ↓ ← →`、幾何 `平行度 0.005` の `合格範囲 0〜0.005` を確認。2026-07-08 ユーザー実機検証OK。

#### 2026-07-10 指差し記号 + 右ペイン縦圧縮 + 同一キー新規UI封鎖 {#検査図面-指差し-密度-新規封鎖-2026-07-10}

- **正本**: [Plan](../plans/self-inspection-autosave-callout-template-lock.md) · [ADR callout](../decisions/ADR-20260710-inspection-drawing-callout-tip.md) · [Preview](../design-previews/kiosk-inspection-drawing-callout-pointer-preview.html)
- **データ**: `PartMeasurementTemplateItem.calloutTipXRatio/YRatio`（nullable）。既存行は null＝指差しなし。
- **UI**: 右ペイン「丸数字／矢視」モードで先端配置。Canvas SVG 引出線＋同番号バッジ。状態は「矢視 あり/なし」。ナッジ半高・名称ラベル+select 1行。
- **新規封鎖**: 図面に既存資源テンプレがあるとき図面ライブラリ「新規」を無効化（注記なし・title のみ）。テンプレ行は「編集」。Create の同一 THREE_KEY 衝突メッセージを強化（API 409 は既存）。
- **一覧日時**: 図面ライブラリ列「登録」=`visual.createdAt`。テンプレ列「更新」=`template.updatedAt`（保存時更新）。矢視のみ変更でも dirty になるよう tip を snapshot に含む。
- **検証**: Web unit · 一時 Postgres migrate + EXPLAIN（tip 列）。本番デプロイは未。

#### 2026-07-10 自主検査 NFCゲート + 下書き自動保存 + 確定 {#自主検査-nfcゲート-下書き自動保存-2026-07-10}

- **正本**: [Plan](../plans/self-inspection-autosave-callout-template-lock.md) · [ADR draft/confirmed](../decisions/ADR-20260710-self-inspection-draft-confirmed.md) · [Preview](../design-previews/kiosk-self-inspection-autosave-callout-preview.html)
- **データ**: `SelfInspectionLotEntry.persistenceStatus` = `DRAFT` | `CONFIRMED`（既存 backfill CONFIRMED）。
- **API**: `POST .../entries/draft`（部分値可）。既存 create/update は CONFIRMED（全点必須）。完了・WIP・記録承認は CONFIRMED のみ。
- **UI**: 氏名NFCまで測定ロック。debounce 下書き自動保存。「入力を保存」=確定。
- **検証**: API/Web unit · 一時 Postgres migrate + EXPLAIN（persistenceStatus index）。本番デプロイは未。

#### 先行デプロイ（2026-06-03）

| ホスト | Detach Run ID | 実機 |
|--------|---------------|------|
| `raspberrypi5` | **`20260603-154307-28721`** | `6e436cfc` · web 再ビルド · 管理/キオスク確認用 |
| `raspi4-kensaku-stonebase01` | **`20260603-154818-15503`** | `kiosk-browser` 再起動 · 強制リロード後に検証 |

2026-07-08 の丸数字設定改善ロールアウトで、旧先行分の未展開 Pi4×3 も現行 **`04bb49fe`** へ収束済み。

#### トラブルシュート（実装・レビュー）

| 症状 | 原因 | 対処 |
|------|------|------|
| legacy 片側公差 seed で上限が `101.05` 等になる | seed 前に `legacyAbsoluteBounds` を削除して nominal を 0 扱い | `resolveNominalForLegacySeed` に legacy を渡す（`markerNumbering.ts`） |
| 自主検査候補に範囲外（例 10.1） | `Math.round` で格子端がはみ出す | 下限 **ceil**・上限 **floor**（`selfInspectionMeasurementValueOptions.ts`） |
| 「基準値未設定」が出ない | 表示が合成 `bounds.nominal` 依存 | `isLegacyAbsoluteOnlyPoint` + `legacyAbsoluteBounds` 表示（`InspectionDrawingValuePanel.tsx`） |
| 公差入力の枠・タップ領域が小さい | 素の `<input>` に変更した際 | 共有 **`Input`** コンポーネントに戻す |
| **図面が小さく見える** | 旧 UI: ヘッダー2行グリッド + `pointListSlot` 横一覧 + 右ペイン 20rem | **作成/改版は 2026-06-03 改善済**（[§作成レイアウト](#検査図面-作成改版レイアウト-2026-06-03)）· 本番記録 edit は従来 20rem |

#### 代表ファイル

| 領域 | パス |
|------|------|
| 公差 | `apps/web/src/features/part-measurement/inspection-drawing/toleranceFields.ts` |
| legacy・採番 | `apps/web/src/features/part-measurement/inspection-drawing/markerNumbering.ts` |
| 名称候補 | `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingMeasurementLabelOptions.ts` |
| 自主検査候補値 | `apps/web/src/features/part-measurement/inspection-drawing/selfInspectionMeasurementValueOptions.ts` |
| 測定点一覧（旧・上辺） | ~~`InspectionDrawingPointSummaryStrip.tsx`~~（作成/改版から削除） |
| レイアウト共有 | `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.ts` |

### キオスク検査図面 測定点位置微調整（十字ボタン · 2026-06-05） {#検査図面-測定点位置微調整-十字ボタン-2026-06-05}

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/inspection-drawing-point-nudge`** · PR [**#391**](https://github.com/denkoushi/RaspberryPiSystem_002/pull/391) · **`main` マージ（`791f1074`）** |
| 代表コミット | **`da9d2675`**（`feat(web): add inspection drawing point nudge controls`） |
| CI | **`26996602603`** · **success**（全ジョブ） |
| 変更種別 | **Web のみ**（Prisma / API / migration **なし**） |
| ExecPlan | [inspection-drawing-point-nudge-execplan.md](../plans/inspection-drawing-point-nudge-execplan.md) |
| デプロイ | [deployment §2026-06-05](../guides/deployment.md#kiosk-inspection-drawing-point-nudge-2026-06-05) |
| レイアウト参照 | [kiosk-inspection-drawing-layout-preview.html](../plans/kiosk-inspection-drawing-layout-preview.html) |

#### 仕様（作成/改版のみ）

- **UI**: 右ペイン `InspectionDrawingPointSettingsPanel` 上部に **1行方向ボタン**（`↑ ↓ ← →`）。タイトル「測定点の設定（No.N）」の **上**。`role="group"` · `aria-label="測定点の位置調整"` · 各方向 `aria-label`（例: 上へ移動）。
- **レイアウト**: 名称・基準値を **1 行 2 列**（`inspectionDrawingPointSettingDualRowClassName` · 各列 `min-w-0` · select は `inspectionDrawingBoundedSelectShellClassName`）。削除ボタン上の説明文「合格範囲は…」は **削除**（公差 2 欄は維持）。
- **ステップ**: `INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = 0.0025`（800×600 DEV 図面で約横 2px / 縦 1.5px 相当）。ズーム倍率に依存しない固定 ratio（`computeZoomedCanvasLayout` 非依存）。
- **座標正本**: `xRatio` / `yRatio`（0–1）。`clampInspectionDrawingRatio` — 有限 number は 0..1 clamp · `NaN` / `Infinity` / 非 number は **0**。
- **更新経路**: 十字押下 → `inspectionDrawingPointPositionPatch` → 既存 `onChange(patch)` → ページ側 `updatePoint`（契約変更なし）。
- **表示条件**: `InspectionDrawingPointSidebar` の **`mode === 'place' && selectedPoint`** のみ（test / guidedTrial では設定パネルごと非表示）。`SettingsPanel` に `mode` prop は **増やさない**（モード責務の集約）。`contentReadOnly` 時は disabled。
- **保存**: `drawingPointToTemplateItemInput` → `markerXRatio` / `markerYRatio`。route schema も 0..1。フロントで **必ず clamp 済み patch**（API `clampRatio` に依存しない）。

#### 代表ファイル

| 領域 | パス |
|------|------|
| 座標演算 | `apps/web/.../inspectionDrawingPointPosition.ts` |
| 十字 UI | `apps/web/.../InspectionDrawingPointPositionNudge.tsx` |
| 設定パネル | `apps/web/.../InspectionDrawingPointSettingsPanel.tsx` |
| 表示責務 | `apps/web/.../InspectionDrawingPointSidebar.tsx`（**変更なし**） |
| スタイル | `apps/web/.../inspectionDrawingKioskUi.ts`（`inspectionDrawingPointNudgeButtonClassName` 等） |
| テスト | `__tests__/inspectionDrawingPointPosition.test.ts` 他 3 ファイル · **14 passed** |

#### 本番反映（2026-06-05 · 先行 2 台）

| ホスト | Detach Run ID | HEAD | 実機 |
|--------|---------------|------|------|
| `raspberrypi5` | **`20260605-141538-27072`** | **`da9d2675`** | web 再ビルド · バンドル `index-IJxgQ0ZH.js` |
| `raspi4-kensaku-stonebase01` | **`20260605-142229-22757`** | **`da9d2675`** | **実機 OK**（十字ボタン · 微動 · 保存後位置維持） |
| `raspberrypi4` | **`20260708-110444-28905`** | **`04bb49fe`** | 2026-07-08 丸数字設定改善ロールアウトで現行 UI へ収束 |
| `raspi4-robodrill01` | **`20260708-110943-19113`** | **`04bb49fe`** | 同上 |
| `raspi4-fjv60-80` | **`20260708-111331-2379`** | **`04bb49fe`** | 同上 |
| `raspi4-sessaku-01` | **`20260708-111719-728`** | **`04bb49fe`** | 同上 |

Phase12: **43/0/0**（デプロイ後）。

#### 知見・レビュー指摘（再発防止）

- **ESLint `import/order`**: `alphabetize: asc` + `caseInsensitive: true` のため、**`../inspectionDrawingPointPosition` は `../InspectionDrawingPointPositionNudge` より前**。本番 `InspectionDrawingPointSettingsPanel.tsx` とテスト 3 ファイルで修正済み。
- **ExecPlan 検証コマンド**: `pnpm --filter @raspi-system/web exec vitest run` の cwd は `apps/web` のためパスは **`src/features/...`**（`apps/web/src/...` は失敗）。
- **責務分離**: 座標演算・十字 UI・Sidebar 表示条件を分離したことで、ズーム/place モード/保存契約への回帰リスクを局所化できた。

#### トラブルシュート

| 症状 | 確認 |
|------|------|
| 十字ボタンが出ない | **点を配置** + 測定点選択か · test/ガイド試行では **非表示が正** |
| ボタンはあるが動かない | `contentReadOnly`（履歴版）では disabled |
| Pi4 だけ旧 UI | Pi5 `web` HEAD · Pi4 **強制リロード**（§6.6.4）· `git pull` 禁止 |
| 端でそれ以上動かない | clamp 正常（0/1 で停止） |
| CI lint 失敗 | sibling import のアルファベット順 |

Runbook: [§十字ボタン](../runbooks/kiosk-part-measurement.md#検査図面-測定点位置微調整-十字ボタン-2026-06-05)

### キオスク検査図面 作成/改版レイアウト（2026-06-03） {#検査図面-作成改版レイアウト-2026-06-03}

> **2026-07-09 レイアウトリグレッション（ツールバー縦積み・測定点一覧見切れ）**: 詳細正本は [KB-399](./KB-399-inspection-drawing-create-layout-regression.md)。**本番反映済**（2026-07-09 · 実機OK）。

| 項目 | 内容 |
|------|------|
| ブランチ（初版） | **`fix/inspection-drawing-return-navigation-review`**（レイアウト + 戻り先を同一ブランチで積み上げ） |
| ブランチ（フラット band） | **`fix/inspection-drawing-create-header-flat-layout`** → **`main` マージ（2026-06-04）** |
| 代表コミット | **`dcc82226`**（右ペイン）· **`5274f1ee`**（コンパクト meta-chip 3スロット）· **`d96da485`**（**フラット band** · 孤児 chip 修正） |
| CI | **`26883229358`**（`5274f1ee`）· **`26917349311`**（`d96da485`）· **success** |
| 変更種別 | **Web のみ** |
| ExecPlan | [inspection-drawing-create-layout-and-return-nav.md](../plans/inspection-drawing-create-layout-and-return-nav.md) |
| 正本 HTML | [kiosk-inspection-drawing-layout-preview.html](../plans/kiosk-inspection-drawing-layout-preview.html) |

#### 仕様（作成/改版のみ）

- **上辺バンド**: `InspectionDrawingCreateCompactHeader` — **meta-chip 1バンド（狭幅時は最大2物理行 wrap 可）**（品番・資源・工程・テンプレ・検査数·指定数）· 版バッジ **`dl` 外** · インライン図面ファイル · ズーム · ツールバー。**band 直下フラット DOM**（旧 `metadataSlot` 3スロット廃止）。
- **測定点一覧**: `InspectionDrawingPointSidebar` 内 `InspectionDrawingPointSummaryList`（`variant="sidebar"`）— **2行カード**・縦スクロール。**`pointListSlot` / `InspectionDrawingPointSummaryStrip` は廃止**。
- **ワークスペース**: `inspectionDrawingCreateWorkspaceClassName` — 狭幅 `flex-col` · `lg:flex-row`（図面 + 右ペイン）。
- **右ペイン幅**: `inspectionDrawingCreateSideAsideClassName` — **`lg:w-[17rem]`**（本番記録 `inspectionDrawingSideAsideClassName` **20rem** は不変）。
- **テスト入力**: 右一覧で点選択しても **`mode` は維持**（`handleSelectPointFromList` は `selectedPointId` のみ更新）。
- **a11y**: `InspectionDrawingCreateMetaChip` の `controlId` + `label htmlFor`（品番・資源・テンプレ・検査数・指定数）。

#### 本番反映

| 段階 | ホスト | Detach Run ID | Git HEAD | 実機 |
|------|--------|---------------|----------|------|
| 2026-06-03 初版 | `raspberrypi5` | **`20260603-211122-29648`** | **`5274f1ee`** | 右ペイン + 3スロット chip ヘッダー |
| **2026-06-04 フラット band** | `raspberrypi5` | **`20260604-074525-7036`** | **`d96da485`** | web 再ビルド · バンドル testid 確認 |
| **2026-06-04 フラット band** | Pi4×4 全台 | 下表 | **`d96da485`** | stonebase **実機 OK** · 他3台 deploy 済 |

| Pi4 ホスト | Detach Run ID | 備考 |
|------------|---------------|------|
| `raspi4-kensaku-stonebase01` | **`20260604-075147-21404`** | **実機検証 OK** |
| `raspberrypi4` | **`20260604-080658-2223`** | `kiosk-browser` 再起動 |
| `raspi4-robodrill01` | **`20260604-081126-19736`** | 同上 |
| `raspi4-fjv60-80` | **`20260604-081502-25798`** | 同上 |

中間デプロイ: **`20260603-202513-13104`** · **`dcc82226`**（右ペインまで。ヘッダー chip は **`5274f1ee`** まで未反映だった）。

### キオスク検査図面 作成/改版ヘッダー フラット band（2026-06-04） {#検査図面-作成改版ヘッダー-フラット-band-2026-06-04}

**正本 Runbook**: [kiosk-part-measurement §フラット band](../runbooks/kiosk-part-measurement.md#検査図面-作成改版ヘッダー-フラット-band-2026-06-04) · **デプロイ**: [deployment.md §2026-06-04](../guides/deployment.md#kiosk-inspection-drawing-create-header-flat-layout-2026-06-04)

#### 背景・症状（`5274f1ee` 以降も残存）

| 症状 | 条件 |
|------|------|
| 上辺が **3物理行** になる | 改版（`lineageLocked=true`）で chip **5個** + **長い資源名** + 1280px 実効幅 |
| **検査数 chip だけ3行目**に孤立 | 旧 `InspectionDrawingCreateHeaderBand` + `metadataLayout="createCompact"` が **metadataSlot 内で二重 flex-wrap**（slot 全体 vs `dl` 内）し、折り返し順序が正本 HTML と非等価 |
| DEV プレビューでは再現しにくい | fixture 資源名が短い · `min-w-[1280px]` のみで KioskLayout `px-4` 相当幅を再現していなかった |

#### 採用方針（flat_wrap）

- **`InspectionDrawingCreateCompactHeader`**（作成/改版専用）— band 直下に **dl / version-badge / drawing-file / zoom-slot / toolbar-slot** を兄弟配置（[正本 HTML](../plans/kiosk-inspection-drawing-layout-preview.html) と同型）。
- **meta-row（dl）**: `flex-nowrap` + `shrink min-w-0` — chip 列内では折り返さない。
- **band**: `flex-wrap` — 狭幅時 **最大2物理行** を許容。版バッジ・図面ファイル・zoom・toolbar は **`shrink-0`**。
- **公開 export**: `InspectionDrawingCreateCompactHeader` のみ。`MetaChipList` / `VersionBadge` / `DrawingFileControl` は内部。
- **本番記録 edit**（`KioskInspectionDrawingEditPage`）: **非変更** — 引き続き `InspectionDrawingCreateHeaderBand`（`metadataLayout` 既定 `grid`）。

#### DOM 契約（E2E / Vitest）

```
data-testid=inspection-drawing-create-header-band
  ├─ inspection-drawing-create-meta-row (dl, flex-nowrap)
  ├─ inspection-drawing-create-version-badge (任意)
  ├─ inspection-drawing-create-drawing-file
  ├─ inspection-drawing-create-zoom-slot
  └─ inspection-drawing-create-toolbar-slot
```

- meta-chip: `data-testid=inspection-drawing-create-meta-chip` · `data-chip-term`（例: `検査数`）
- 読取専用 chip 値: `inline-block max-w overflow-hidden`（長い資源名）

#### DEV プレビュー

- ルート: `/dev/kiosk-inspection-drawing-create?scenario=revise|fixed_count|create_new`
- fixture: [inspectionDrawingCreatePreviewScenarios.ts](../../apps/web/src/pages/dev/inspectionDrawingCreatePreviewScenarios.ts) — 長い資源名 `033 (三井HS3A(25号機) / 横型)`
- `KioskInspectionDrawingDevPreviewChrome` の **`simulateKioskContentWidth`** — KioskLayout `px-4` 相当の有効幅再現（作成プレビューのみ）

#### 代表ファイル

| 領域 | パス |
|------|------|
| コンポーザ | `InspectionDrawingCreateCompactHeader.tsx` |
| 内部部品 | `InspectionDrawingCreateMetaChipList.tsx` · `InspectionDrawingCreateVersionBadge.tsx` · `InspectionDrawingCreateDrawingFileControl.tsx` |
| トークン | `inspectionDrawingKioskUi.ts`（`inspectionDrawingCreateFlatBandClassName` 等） |
| 旧 API（記録 edit 用） | `InspectionDrawingCreateHeaderBand.tsx`（`metadataLayout` 維持） |
| Vitest | `__tests__/inspectionDrawingCreateCompactHeader.test.tsx` |
| Playwright | `e2e/inspection-drawing-create-header-layout.spec.ts` · `e2e/helpers/inspectionDrawingCreateHeaderLayout.ts` |

#### トラブルシュート（フラット band）

| 症状 | 原因 | 対処 |
|------|------|------|
| **検査数だけ3行目**に孤立 | 旧 CompactHeader 未反映 · または `dl flex-wrap` 回帰 | Pi5 HEAD ≥ **`d96da485`** · `InspectionDrawingCreateCompactHeader` 使用確認 |
| Playwright E2E **白画面** | `page.route('**/api/**')` が Vite ソース **`/src/api/client.ts`** を JSON で fulfill | ヘルパーで `/src/api/` は **`route.continue()`** · 未知 API も continue（[helpers](../../e2e/helpers/inspectionDrawingCreateHeaderLayout.ts)） |
| E2E で **3行目に badge/file だけ**落ちても pass | 行数集計対象に version-badge / drawing-file が漏れていた | `collectHeaderLayoutBoxes` に両 testid を含める（修正済 **`d96da485`**） |
| DEV で1行に見える | 短い fixture · 有効幅未シミュレート | `?scenario=revise` + `simulateKioskContentWidth` |
| キオスクだけ旧ヘッダー | Pi4 `_appRef` 古い · SPA キャッシュ | **`update-all-clients.sh`** + **強制リロード**（§6.6.4）· Pi5 SPA 配信元 HEAD 確認 |

#### トラブルシュート（レイアウト全般）

| 症状 | 原因 | 対処 |
|------|------|------|
| 上辺が依然 **2行の大きい Input** | Pi5 が **`dcc82226` のみ**（`5274f1ee` 未デプロイ） | Pi5 ref ≥ **`5274f1ee`** · 強制リロード |
| 上辺に **横スクロール測定点一覧** | 旧 `pointListSlot` SPA | 同上 |
| テスト入力中に一覧クリックで **配置モードに戻る** | 旧 `setMode('place')` | **`5274f1ee` 以降** |
| ヘッダーが再び **grid 2行** | `metadataLayout` 未指定 + `bandClassName` だけ create | ページで **`InspectionDrawingCreateCompactHeader`** を確認 |
| **検査数だけ3行目**に孤立 | 旧3スロット + `dl flex-wrap` + 長い資源名 | **`InspectionDrawingCreateCompactHeader`** + Playwright `e2e/inspection-drawing-create-header-layout.spec.ts` |
| 版バッジで HTML 警告 | `span` が `dl` 直下 | **`5274f1ee` 以降** は `dl` 外 |

### キオスク検査図面 戻り先ナビ（2026-06-03） {#検査図面-戻り先ナビ-2026-06-03}

| 項目 | 内容 |
|------|------|
| 代表コミット | **`01a059dd`** — `fix: harden inspection drawing return navigation` |
| 変更種別 | **Web のみ** |

#### 契約

- **入力**: React Router `location.state` の `inspectionDrawingReturnTo`（内部 pathname のみ）。
- **出力**: ツールバー `Link` の `to` + 表示文言。**ラベルは `returnPresets` から決定**（state の任意 `inspectionDrawingReturnLabel` は **無視**）。
- **安全**: `normalizeInternalInspectionDrawingReturnPath`（`..` 解決・`://` 拒否）+ **allowlist 完全一致**。
- **一覧導線**: `INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE` を `Link`/`navigate` に付与（生 `location.state` を navigate に渡さない）。
- **本番 preset**: `kioskInspectionDrawingReturnNavigation.ts` — 現状は検査図面一覧のみ（「一覧へ戻る」）。

#### 代表ファイル

| 領域 | パス |
|------|------|
| 純関数 | `inspectionDrawingReturnNavigation.ts` |
| 本番 preset | `kioskInspectionDrawingReturnNavigation.ts` |
| DEV preset | `kioskInspectionDrawingDevReturnNavigation.ts` |
| テスト | `inspectionDrawingReturnNavigation.test.ts` |

#### トラブルシュート（戻り先）

| 症状 | 確認 |
|------|------|
| 戻る先が想定外 URL | state の pathname が allowlist 外 → **fallback（一覧）** |
| ラベルが state と違う | **仕様**（preset 正本）— 偽装防止 |
| 順位ボードからの戻りが欲しい | `KIOSK_INSPECTION_DRAWING_PRODUCTION_RETURN_PRESETS` に preset 追加が必要 |

### 代表ファイル（追加分）

| 領域 | パス |
|------|------|
| 契約・検証 | `apps/api/src/services/part-measurement/self-inspection-config.ts` |
| migration 1 | `apps/api/prisma/migrations/20260602120000_self_inspection_four_modes/migration.sql` |
| migration 2 | `apps/api/prisma/migrations/20260602120100_self_inspection_sample_to_fixed_count/migration.sql` |
| 公差 adapter | `apps/web/src/features/part-measurement/inspection-drawing/toleranceFields.ts` |
| 採番 | `apps/web/src/features/part-measurement/inspection-drawing/markerNumbering.ts` |
| 名称候補 | `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingMeasurementLabelOptions.ts` |
| 自主検査候補値 | `apps/web/src/features/part-measurement/inspection-drawing/selfInspectionMeasurementValueOptions.ts` |
| 測定点一覧 | `apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPointSummaryStrip.tsx` |
| キオスク slot | `apps/web/src/features/part-measurement/selfInspectionEntrySlots.ts` |
| 単体テスト | `apps/api/.../self-inspection-config.test.ts` · `apps/web/.../selfInspectionEntrySlots.test.ts` · `toleranceFields.test.ts` · `markerNumbering.test.ts` |

## 順位ボード「検」→ 自主検査で図面が空白（2026-06-03） {#self-inspection-session-drawing-blank-2026-06-03}

**正本 Runbook**: [kiosk-part-measurement §図面空白](../runbooks/kiosk-part-measurement.md#自主検査セッション図面空白-2026-06-03) · **デプロイ**: [deployment.md §図面空白](../guides/deployment.md#kiosk-self-inspection-session-drawing-blank-2026-06-03) · コミット **`9f3f0bac`** · **`main` マージ**

### 症状

- 順位ボードの **検** から自主検査入力を開くと、**測定値パネルは表示**されるが **図面エリアだけ空白**（または「図面がありません。」）。
- API・ストレージは正常なケースあり（`GET …/self-inspection/sessions/:id` に `drawingImageRelativePath` あり、`GET /api/storage/part-measurement-drawings/…` が **200**）。

### 根本原因（Web · CONFIRMED）

| 層 | 内容 |
|----|------|
| **主因** | 図面列に **`inspectionDrawingCanvasColumnClassName`** 未適用 → viewport **`clientHeight === 0`** → `useZoomedCanvasLayout` 不成立 |
| **副因** | `blobUrl` 未取得を **「図面がありません」** と誤表示（**loading** 未分岐） |
| **除外** | API / DB / decoration DTO / ストレージは正常でも再現（Web 表示責務のみ） |

### 修正内容

| 項目 | 内容 |
|------|------|
| **変更種別** | **Web のみ**（`inspectionDrawingCanvasColumnClassName` は**再利用のみ**・本体変更なし） |
| **レイアウト** | `KioskSelfInspectionSessionPage` 左カラムに共有クラス + `xl:flex-row` |
| **表示分岐** | `selfInspectionSessionDrawingPanelState.ts` — `missing` / `loading` / `error` / `canvas` |
| **UX** | 図面エラーは **パネル内のみ**（ヘッダー重複廃止） |

### 表示フェーズ仕様

`resolveSelfInspectionDrawingPanelPhase`: (1) path 空 → `missing` (2) `loadError` → `error` (3) `blobUrl` → `canvas` (4) それ以外 → `loading`。図面取得は **`usePartMeasurementDrawingBlobUrl`**（storage 直 `<img>` 禁止）。

### 本番反映・実機検証（2026-06-03）

| 項目 | 内容 |
|------|------|
| **CI** | **`26863128347`** · **success** |
| **Pi5** | Detach **`20260603-131923-13993`** · `failed=0` · **`9f3f0bac`** |
| **Pi4 stonebase** | Detach **`20260603-132523-31144`** · `failed=0` · **実機 OK**（強制リロード後） |
| **Pi4×5（現行）** | 2026-07-08 丸数字設定改善ロールアウトで全台 HEAD **`04bb49fe`** へ収束。Phase12 **45/0/0** |

### 確認方法

| 種別 | 手順 |
|------|------|
| 単体 | `pnpm --filter @raspi-system/web exec vitest run src/features/part-measurement/__tests__/selfInspectionSessionDrawingPanelState.test.ts` |
| 手動 | **検** → 自主検査 · 読込中→キャンバス · viewport **`clientHeight > 0`** |
| 任意 E2E | `e2e/self-inspection-session-drawing-layout.spec.ts`（**`E2E_SELF_INSPECTION_SESSION_ID` 未設定時 skip**） |

### トラブルシュート（本件） {#トラブルシュート本件}

| 症状 | 対処 |
|------|------|
| storage 200 なのに空白 | Pi5 `web` **`9f3f0bac` 以降** · `inspectionDrawingCanvasColumnClassName` |
| Pi4 のみ旧 UI | `git pull` 禁止 · `update-all-clients.sh` · **強制リロード** |

### 関連ファイル（本件）

| 領域 | パス |
|------|------|
| 画面 | `apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx` |
| 表示フェーズ | `apps/web/src/features/part-measurement/selfInspectionSessionDrawingPanelState.ts` |
| テスト | `apps/web/src/features/part-measurement/__tests__/selfInspectionSessionDrawingPanelState.test.ts` |
| レイアウト | `apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.ts` |
| 順位ボード | `apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx` |

### 代表ファイル（自主検査 MVP 全体）

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
- 自主検査入力画面は **測定者 NFC 読み取り必須**。計測機器の使用前点検は [§計測機器タグ任意化](#自主検査-計測機器タグ任意化-2026-06-30) の共有設定で必須/任意を切り替える（初期値は任意）。
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

### 検査図面 · PDF / TIFF 取込（2026-06-02 更新 · TIFF 2026-06-10） {#検査図面--pdf-取込2026-06-02}

| 区分 | 内容 |
|------|------|
| **保存入口** | `POST …/visual-templates` · `POST …/inspection-drawing/evaluation-templates`（multipart `file`） |
| **preview 入口** | `POST …/drawings/preview`（multipart `file` · **DB/storage なし** · rate limit 有効） |
| **変換** | `importDrawingAndSave` / `convertDrawingUploadToPreviewBuffer` → JPEG 保存契約。PDF: 1 ページ目（`pdftoppm`）。TIFF/TIF: `sharp`（magic bytes 検証・最大 16384px） |
| **Web プレビュー** | 画像はローカル `blob:` · PDF/TIFF は preview API → JPEG `blob:` + 保存時 **同一 JPEG File** |
| **上限** | 画像 12MB / PDF・TIFF 30MB / 保存 12MB。TIFF は `limitInputPixels=150_000_000`、最大幅/高さ 16384px |
| **負荷** | PDF/TIFF ラスタ変換はプロセス内 **同時 1 件**・待ち **最大 4**（超過時 **503**）— preview / save 共通 |
| **検証順** | evaluation multipart は **items/body 検証後**に `importDrawingAndSave`（孤立ファイル防止） |
| **表示** | Canvas は **画像 URL のみ**（PDF/TIFF Blob 直 `<img>` なし） |
| **保存制御** | PDF/TIFF 変換中・preview JPEG 未確定は保存不可 |
| **編集時失敗** | 新 PDF/TIFF preview 失敗時は **既存図面維持** + エラー表示 |

**代表ファイル（PDF プレビュー整合 `8307c995` / TIFF 取込追加を含む現行実装）**:

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
| 後続収束 | 2026-07-08 現行ロールアウト | Pi4×5 | 各端末 Run ID は [§丸数字設定改善](#検査図面-丸数字設定改善-2026-07-08) | **`04bb49fe`** | `failed=0` | **45/0/0** | 現行 bundle に PDF preview 経路を含む |

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

### 検査図面 TIFF 1件だけ「図面を登録」が失敗（2026-07-01） {#検査図面-tiff-limitinputpixels-2026-07-01}

| 区分 | 内容 |
|------|------|
| **症状** | キオスク **検査図面** → **図面を登録** で、`7161テーブル.tif` のみ preview/save 変換が 400 失敗 |
| **対象ファイル** | TIFF little-endian / 1bit Group4 / WhiteIsZero / 138KB / `13248 x 9355 = 123,935,040px` |
| **原因** | ファイルサイズは小さいが展開後ピクセル数が旧 `PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS=100_000_000` を超え、`sharp` が `limitInputPixels` で reject。API エラーは `TIFF 画像の解像度が大きすぎます` |
| **修正** | `apps/api/src/lib/part-measurement-drawing-import.constants.ts` の TIFF pixel 上限を **150,000,000px** に拡張。30MB 入力上限、保存 JPEG 12MB 上限、最大幅/高さ 16384px、PDF/TIFF 変換キュー契約は維持 |
| **回帰防止** | `apps/api/src/lib/__tests__/convert-tiff-to-jpeg.test.ts` に、大きな圧縮 TIFF 図面を許容する上限テストを追加 |
| **検証** | `pnpm --dir apps/api exec vitest run src/lib/__tests__/convert-tiff-to-jpeg.test.ts src/lib/__tests__/part-measurement-drawing-preview.test.ts` → 9 tests pass。直接変換 → JPEG `2,255,678 bytes`。CI / CodeQL / secret scan success。Pi5 deploy `20260701-162204-28434` → `failed=0`。Phase12 → **PASS 45 / WARN 0 / FAIL 0**。実機 preview curl → **`200 image/jpeg`**、JPEG `13248x9355` |
| **代表 commit** | `67537ab3` `fix(api): allow larger tiff inspection drawings` |
| **未完了** | なし。API サーバ側の上限修正のため Pi4 個別デプロイは不要 |

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
| TIFF が 1件だけ **解像度が大きすぎます** で失敗 | 展開後ピクセル数が 100M 超か | [§TIFF pixel 上限](#検査図面-tiff-limitinputpixels-2026-07-01) · **`67537ab3` 以降** |
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
| 後続収束 | 2026-07-08 現行ロールアウト | Pi4×5 | 各端末 Run ID は [§丸数字設定改善](#検査図面-丸数字設定改善-2026-07-08) | **`04bb49fe`** | `failed=0` | **45/0/0** | 現行 bundle に一覧ハブ・検査図面タブを含む |

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
| Pi4×5（後続収束） | 2026-07-08 現行ロールアウト | 5 台 | 各端末 Run ID は [§丸数字設定改善](#検査図面-丸数字設定改善-2026-07-08) | **`04bb49fe`** | `failed=0` · 現行 bundle に overflow 修正を含む |

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
| Pi4×5（後続収束） | 2026-07-08 現行ロールアウト | 5 台 | 各端末 Run ID は [§丸数字設定改善](#検査図面-丸数字設定改善-2026-07-08) | **`04bb49fe`** | `failed=0` · 現行 bundle にキャンバスズームを含む |

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

## 自主検査 · 工程内検査員再測定（2026-07-02）

### 状態と対象

| 項目 | 内容 |
|------|------|
| 状態 | 実装済み、push済み、本番デプロイ済み。`main` マージ前の作業ブランチは `feat/self-inspection-inspector-remeasurement`、代表 HEAD は `e3ee2e21`。 |
| 変更範囲 | Prisma migration + API + Web kiosk + 既存ドキュメント更新。 |
| migration | `20260702170000_self_inspection_inspector_remeasurement`。 |
| 既存データ | 既存の承認待ちセッションには `inspectorRemeasurementRequiredAt` をバックフィルしない。新規ワークフローだけが検査員再測定必須になる。 |

### 仕様サマリ

- オペレータが自主検査を保存して `recordApprovalRequiredAt` が立つ新規ワークフローでは、同時に `inspectorRemeasurementRequiredAt` を立てる。
- 自主検査トップのカードは、オペレータ未完了なら従来入力画面へ、検査員再測定待ちなら **検査員測定** として `/kiosk/part-measurement/self-inspection/sessions/:sessionId/inspector` へ遷移する。
- 検査員画面は既存の図面・測定値入力 UI を `mode="inspector"` で再利用する。検査員もオペレータと同じ required slot、同じ測定点、同じ入力順で保存する。
- 検査員の保存先は `SelfInspectionInspectorEntry` / `SelfInspectionInspectorMeasurementValue` / `SelfInspectionInspectorEntryInstrumentUsage`。オペレータ値は上書きしない。
- 検査員値には `operatorValueSnapshot`、`inspectorValue`、`differenceValue`、`judgementStatus=NOT_EVALUATED` を保存する。差異異常の判定基準は今回未実装で、承認可否には使わない。
- 検査員は、該当入力件のオペレータ本人と同じ社員タグでは保存できない。
- 検査員測定開始後は差分基準値を固定するため、オペレータ入力とオペレータ側使用前点検の更新を 409 で拒否する。
- 検査記録確認の `recordApprovalState` は、検査員再測定が未完了なら `inspector_measurement_pending`。全 required slot の検査員値がそろい、既存の測定者/使用前点検ポリシーも満たすと `approvable` になる。
- 計測器使用前点検は既存の共有 ON/OFF 設定に従う。ON の場合は検査員側も使用前点検または計測器登録が必要。

### API 契約（追加分）

| エンドポイント | 用途 |
|----------------|------|
| `GET /api/part-measurement/self-inspection/sessions/:id/inspector-measurements` | 検査員再測定画面の取得。オペレータ値 snapshot、検査員値、差分、使用前点検状態を返す。 |
| `POST /api/part-measurement/self-inspection/sessions/:id/inspector-entries` | 検査員 entry 新規保存。 |
| `PATCH /api/part-measurement/self-inspection/sessions/:id/inspector-entries/:entryId` | 検査員 entry 更新。 |
| `POST /api/part-measurement/self-inspection/sessions/:id/inspector-entries/:entryIndex/instrument-usages/pre-use-inspection` | 検査員側の計測器使用前点検保存。 |

### 検証結果

| 区分 | 結果 |
|------|------|
| ローカル API | 一時 Postgres `rps002-self-inspection-test` で migration deploy、Prisma generate、関連 integration test、SQL/EXPLAIN 確認まで実施。一時コンテナは削除済み。 |
| ローカル Web | 関連 Web tests と Web `tsc --noEmit` は PASS。API 全体 `tsc` は既存の対象外エラーが残るため、今回触った経路はテストと CI で担保。 |
| CI | GitHub Actions run `28580694564` は `lint-build-unit`、`api-db-and-infra`、`e2e-smoke`、`security-docker`、`e2e-tests` すべて success。 |
| CI 知見 | 初回 run `28579766159` は `self-inspection.service.cache-reset.test.ts` の mock template が `items` を持たず失敗。mock に `items: []` を追加し、対象 vitest PASS 後に amend/push した。 |
| デプロイ | `update-all-clients.sh feat/self-inspection-inspector-remeasurement infrastructure/ansible/inventory.yml --detach --follow`、remote run `20260702-185848-16375`、exit code 0。Pi5 + Pi4 kiosk 5台 + Pi3 signage の 7 hosts で `failed=0` / `unreachable=0`、summary `success:true`。 |
| 実機自動検証 | `./scripts/deploy/verify-phase12-real.sh` → `PASS: 45` / `WARN: 0` / `FAIL: 0`。 |
| 本番 DB | `SelfInspectionInspectorEntry`、`SelfInspectionInspectorMeasurementValue`、`SelfInspectionInspectorEntryInstrumentUsage` と `SelfInspectionSession.inspectorRemeasurementRequiredAt` の存在を確認。`_prisma_migrations` で migration applied を確認。 |
| 本番 API | `api` / `db` / `web` が running。`GET /api/system/health` は DB 含め `status:"ok"`。追加 GET route は未認証 probe で期待どおり `401 CLIENT_KEY_REQUIRED` まで到達。 |

### 未完了・次回注意

- 差異異常の判定基準は未実装。将来は保存済みの `operatorValueSnapshot` / `inspectorValue` / `differenceValue` / `judgementStatus` を使って判定ルールを追加する。
- 遠隔で可能な実機自動検証と API/DB/サービス確認は完了。現場で実際に NFC タグを使い、オペレータ測定 → 検査員再測定 → 検査記録確認 → 承認完了までの物理操作は未実施。
- 検査員再測定開始後はオペレータ値を編集できない仕様のため、現場で入力ミスが見つかった場合は既存のセッションリセット/再開始運用を使う前提。

## References

- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md) / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md) / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md) / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)
- 沉浸式 allowlist: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
