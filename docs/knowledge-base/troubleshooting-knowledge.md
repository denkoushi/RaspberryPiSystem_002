# トラブルシューティングナレッジベース

このドキュメントは、これまでの課題解決の経験をナレッジとして蓄積し、同じ問題を繰り返さないようにするためのものです。

**EXEC_PLAN.mdとの連携**: 各課題はEXEC_PLAN.mdの「課題」セクションまたは「Surprises & Discoveries」セクションと対応しています。課題ID（KB-XXX）で参照してください。

## 記録フォーマット

各課題は以下のフォーマットで記録します：

```markdown
### [課題ID] 課題名

**EXEC_PLAN.md参照**: Phase X / Surprises & Discoveries (行番号)
**事象**: 
- 何が起きたか（エラーメッセージ、症状など）

**要因**: 
- なぜ起きたか（根本原因）

**試行した対策**: 
- [試行1] 対策内容 → 結果（成功/失敗）
- [試行2] 対策内容 → 結果（成功/失敗）
- ...

**有効だった対策**: 
- 最終的に有効だった対策

**学んだこと**: 
- この経験から学んだこと、今後同じ問題を避けるための知見

**関連ファイル**: 
- 関連するファイルのパス
```

---

## 課題一覧

### [KB-001] 429エラー（レート制限エラー）が発生する

**EXEC_PLAN.md参照**: Phase 1 (行56-63), Surprises & Discoveries (行126-132, 136-138)

**事象**: 
- ダッシュボード・履歴ページで429エラーが発生
- レート制限を無効化（max=100000）しても解決しない
- `config: { rateLimit: false }`が機能していない

**要因**: 
- **根本原因**: レート制限プラグインが3箇所で重複登録されていた
  1. `apps/api/src/app.ts` (22行目)
  2. `apps/api/src/routes/index.ts` (20行目) - `/api`サブルーター
  3. `apps/api/src/routes/tools/index.ts` (19行目) - `/tools`サブルーター
- この重複登録により、レート制限の設定が競合し、429エラーが発生していた
- Fastifyの`@fastify/rate-limit`プラグインは、サブルーターの`config: { rateLimit: false }`を認識しない可能性がある
- `skip`関数を使おうとしたが、型エラーで実装できなかった

**試行した対策**: 
- [試行1] `max: 100000`に設定して実質的に無効化 → **失敗**（429エラーが継続）
- [試行2] `config: { rateLimit: false }`を各ルートに設定 → **失敗**（サブルーターで認識されない）
- [試行3] `skip`関数を実装しようとした → **失敗**（型エラー: `'skip' does not exist in type 'FastifyRegisterOptions<RateLimitPluginOptions>'`）
- [試行4] サブルーター内でレート制限プラグインを登録 → **失敗**（429エラーが継続）
- [試行5] レート制限プラグインを3箇所で登録（`app.ts`, `routes/index.ts`, `routes/tools/index.ts`） → **失敗**（重複登録により429エラーが継続）
- [試行6] レート制限プラグインの重複登録を解消（`app.ts`と`routes/tools/index.ts`から削除、`routes/index.ts`のみで登録） → **失敗**（429エラーが継続）
- [試行7] `allowList`関数を使って、特定のパスをレート制限から除外 → **失敗**（429エラーが継続）
- [試行8] `max: 100000`に設定して実質的に無効化（`allowList`関数を削除） → **失敗**（429エラーが継続）
- [試行9] レート制限プラグインを完全に削除（`routes/index.ts`から） → **失敗**（429エラーが継続）
- [試行10] 認証ルートのレート制限プラグインも無効化 → **失敗**（429エラーが継続）
- [試行11] 詳細ログ機能とデバッグエンドポイントを追加 → **部分的成功**（ログ機能は実装完了、デバッグエンドポイントが404を返している）
- [試行12] APIログを直接確認するスクリプト（`check_api_logs.sh`）を作成 → **成功**（ログから`@fastify/rate-limit`プラグインが実環境で動作していることが判明）
- [試行13] **重要発見**: ログから`@fastify/rate-limit`プラグインが実環境で動作していることが判明。コード上は削除されているが、実環境で古いコードが実行されている可能性が高い。`rate-limit.ts`と`auth.ts`から不要なインポートを削除。→ **実装完了・検証待ち**（実環境で最新のコードをビルド・デプロイする必要がある）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: レート制限プラグインを完全に削除（`routes/index.ts`と`auth.ts`から）。実環境で最新のコードをビルド・デプロイ（`docker compose up -d --force-recreate --build api`）することで429エラーが解消された。
- **重要**: `docker compose restart`では新しいイメージが使われないため、`--force-recreate`オプションを使用してコンテナを再作成する必要がある

**学んだこと**: 
- Fastifyのプラグインは、ルート登録前に登録する必要がある
- サブルーターの`config`は親アプリのプラグインで認識されない可能性がある
- `@fastify/rate-limit`のv9では、`skip`関数の型定義が正しくない可能性がある
- **重要**: プラグインの重複登録は予期しない動作を引き起こす。1箇所のみで登録することを徹底する
- **重要**: `docker compose restart`では新しいイメージが使われない。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成する必要がある
- 実環境で古いコードが実行されている場合、ログから`@fastify/rate-limit`プラグインが動作していることが判明する

**解決状況**: ✅ **解決済み**（2025-11-25）
- キオスクのすべてのタブでコンソールエラーが発生しなくなったことを確認
- ダッシュボード・履歴ページ・Item・従業員タブで429エラーが発生しなくなったことを確認

**関連ファイル**: 
- `apps/api/src/plugins/rate-limit.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/routes/tools/index.ts`
- `apps/api/src/app.ts`

---

### [KB-002] 404エラーが発生する

**EXEC_PLAN.md参照**: Phase 1 (行56-63), Surprises & Discoveries (行139-141, 148-153)

**事象**: 
- ダッシュボード・履歴ページで404エラーが発生
- API ルートが `/auth/login` に直下で公開されており、Web UI から呼び出す `/api/auth/login` が 404 になる
- Caddy の `@spa` マッチャーが `/api/*` や `/ws/*` にも適用され、`POST /api/auth/login` が `Allow: GET, HEAD` の 405 になる

**要因**: 
- API ルートが `/api` プレフィックスなしで登録されていた
- Caddyfile の SPA フォールバック設定が `/api/*` と `/ws/*` を除外していなかった

**試行した対策**: 
- [試行1] フロントエンドとバックエンドのエンドポイントを確認 → **確認済み**（一致している）
- [試行2] API ルートを `/api` プレフィックス付きで登録 → **成功**（`apps/api/src/routes/index.ts` を `{ prefix: '/api' }` 付きでサブルータ登録）
- [試行3] Caddyfile の `@spa` マッチャーに `not path /api/*` と `not path /ws/*` を追加 → **成功**

**有効だった対策**: 
- [試行2] API ルートを `/api` プレフィックス付きで登録
- [試行3] Caddyfile の `@spa` マッチャーに `not path /api/*` と `not path /ws/*` を追加
- ✅ **解決済み**（2025-11-25）: 実環境で最新のコードをビルド・デプロイ（`docker compose up -d --force-recreate --build api`）することで404エラーが解消された

**学んだこと**: 
- ルーティングが一致していても404エラーが発生する可能性がある
- Caddyのリバースプロキシ設定を確認する必要がある
- SPA フォールバック設定は API パスを除外する必要がある
- **重要**: `docker compose restart`では新しいイメージが使われない。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成する必要がある

**解決状況**: ✅ **解決済み**（2025-11-25）
- 履歴タブで404エラーが発生しなくなったことを確認

**関連ファイル**: 
- `apps/web/src/api/client.ts`
- `apps/api/src/routes/tools/transactions/list.ts`
- `apps/api/src/routes/index.ts`
- `infrastructure/docker/Caddyfile`

---

### [KB-003] P2002エラー（nfcTagUidの重複）が発生する

**EXEC_PLAN.md参照**: Phase 3 (行85-92), Surprises & Discoveries (行145-147)

**事象**: 
- CSVインポート時にP2002エラーが発生
- nfcTagUidの重複チェックが正しく動作していない
- エラーメッセージは改善されたが、根本原因は解決していない
- P2003エラー（外部キー制約違反）が発生する場合もある
- 「トークンが無効です」エラー（401）が発生する場合もある
- 400エラー（Bad Request）が発生する場合もある
- `employeeCode`や`itemCode`の形式が既存データと異なる場合にエラーが発生する（例: `"EMP-001"` vs `"0001"`）

**要因**: 
- CSV内の重複チェックと既存データとの重複チェックのロジックに問題がある可能性
- クロスエンティティ（従業員とアイテム間）の重複チェックが正しく動作していない可能性
- APIサーバーが最新のコードに更新されていない
- Loanレコードが存在する従業員/アイテムを削除しようとしている（P2003エラーの場合）
- 認証トークンの有効期限が切れている（401エラーの場合）
- CSVファイルの形式が正しくない（400エラーの場合）
- **重要**: `employeeCode`や`itemCode`の形式が統一されていない（2025-11-25に仕様を明確化）

**試行した対策**: 
- [試行1] CSV内の重複チェックを追加 → **部分的成功**（エラーメッセージは改善されたが、根本原因は解決していない）
- [試行2] ラズパイ5で最新のコードを取得してAPIサーバーを再起動 → **暫定対応**
- [試行3] ブラウザをハードリロード（`Ctrl+Shift+R` または `Cmd+Shift+R`） → **暫定対応**
- [試行4] `replaceExisting: false`（チェックボックスを外す）で再度試す → **推奨**
- [試行5] CSVインポート仕様を明確化（2025-11-25） → **成功**
  - `employeeCode`を数字4桁（`/^\d{4}$/`）に制限
  - `itemCode`をTO+数字4桁（`/^TO\d{4}$/`）に制限
  - バリデーションを追加し、CSVインポート・エクスポート仕様書を作成

**有効だった対策**: 
- 未解決（継続中）
- `replaceExisting: false`（チェックボックスを外す）で通常のインポートを実行することを推奨

**推奨される使用方法**:
- **通常のインポート（推奨）**: チェックボックスを外す（`replaceExisting: false`）
  - 既存データは削除されない
  - 新しいデータが追加される
  - 既存データは更新される（employeeCode/itemCodeが一致する場合）
- **全削除してからインポート（注意が必要）**: チェックボックスを入れる（`replaceExisting: true`）
  - Loanレコードが存在しない従業員/アイテムのみ削除される
  - Loanレコードが存在する従業員/アイテムは削除されない（外部キー制約のため）

**確認手順**:
1. APIサーバーが最新のコードに更新されているか確認：
   ```bash
   cd /opt/RaspberryPiSystem_002
   git log --oneline -5
   ```
2. APIサーバーのログを確認：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```
3. ブラウザのコンソールを確認（F12で開発者ツールを開く）

**学んだこと**: 
- PrismaのP2002エラーは、ユニーク制約違反を示す
- エラーメッセージを改善しても、根本原因が解決されない場合は、ロジックを見直す必要がある
- CSVファイルはUTF-8エンコーディングで保存する必要がある
- ヘッダー行が必須で、列名が正しい必要がある
- **重要**: `employeeCode`や`itemCode`の形式を統一することで、データの整合性を保つことができる
- CSVインポート仕様を明確にドキュメント化することで、ユーザーが正しい形式でデータを準備できるようになる

**関連ファイル**: 
- `apps/api/src/routes/imports.ts`
- `apps/api/src/routes/tools/employees/schemas.ts`
- `apps/api/src/routes/tools/items/schemas.ts`
- `docs/guides/csv-import-export.md`

---

### [KB-004] 削除機能が動作しない

**EXEC_PLAN.md参照**: Phase 2 (行64-69), Surprises & Discoveries (行142-144)

**事象**: 
- 返却済みの貸出記録があっても削除できない
- 1件だけ削除できたが、他の従業員・アイテムは削除できない

**要因**: 
- データベースの外部キー制約が正しく適用されていない可能性
- 削除ロジックのバグ

**試行した対策**: 
- [試行1] データベーススキーマを変更して`ON DELETE SET NULL`を設定 → **部分的成功**（1件だけ削除できた）
- [試行2] 実環境で最新のコードをビルド・デプロイ（`docker compose up -d --force-recreate --build api`） → **成功**（従業員とItemの削除機能が正常に動作することを確認）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: データベーススキーマを変更して`ON DELETE SET NULL`を設定し、実環境で最新のコードをビルド・デプロイすることで削除機能が正常に動作するようになった
- 返却済みの貸出記録があっても削除できることを確認

**学んだこと**: 
- データベースの外部キー制約は、マイグレーションが正しく適用されていない可能性がある
- `ON DELETE SET NULL`を設定することで、返却済みの貸出記録があっても削除できるようになる
- **重要**: `docker compose restart`では新しいイメージが使われない。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成する必要がある

**解決状況**: ✅ **解決済み**（2025-11-25）
- 従業員とItemの削除機能が正常に動作することを確認

**関連ファイル**: 
- `apps/api/src/routes/tools/employees/delete.ts`
- `apps/api/src/routes/tools/items/delete.ts`
- `apps/api/prisma/schema.prisma`

---

### [KB-005] CIテストが失敗する

**EXEC_PLAN.md参照**: Phase 4 (行75-79), Surprises & Discoveries (行133-135, 162-170)

**事象**: 
- GitHub Actions CIテストが直近50件くらい全て失敗している
- ローカルでは84テストが成功するが、CI環境では失敗している
- pnpmバージョンの不一致エラーが発生
- Prisma Clientが生成されていないため、TypeScriptビルドが失敗
- `health.test.ts`が古いエンドポイント（`/api/health`）を参照している

**要因**: 
- CI環境とローカル環境の差異
- pnpmバージョンの不一致（`package.json`で`engines.pnpm >=9.0.0`が指定されているが、CIワークフローで`version: 8`を指定していた）
- Prisma Client生成ステップがCIワークフローに含まれていない
- テストが古いエンドポイントを参照している

**試行した対策**: 
- [試行1] CIワークフローで`pnpm`のバージョンを9に変更 → **成功**
- [試行2] CIワークフローに`Generate Prisma Client`ステップを追加 → **成功**
- [試行3] `health.test.ts`を`/api/system/health`エンドポイントに更新 → **成功**

**有効だった対策**: 
- [試行1] CIワークフローで`pnpm`のバージョンを9に変更
- [試行2] CIワークフローに`Generate Prisma Client`ステップを追加
- [試行3] `health.test.ts`を`/api/system/health`エンドポイントに更新

**学んだこと**: 
- CI環境とローカル環境の差異を常に確認する必要がある
- 依存関係のバージョンは、`package.json`とCIワークフローで一致させる必要がある
- Prisma Clientは、ビルド前に生成する必要がある

**関連ファイル**: 
- `.github/workflows/ci.yml`
- `apps/api/src/routes/__tests__/health.test.ts`

---

### [KB-006] Webサーバーの設定不整合で404エラーが発生する

**EXEC_PLAN.md参照**: Surprises & Discoveries (行103-105)

**事象**: 
- Web サーバーの設定が三点（ポート公開、Caddy リッスン/SPA フォールバック、Dockerfile の CMD）で不整合を起こし、`/admin/*` や `/login` に直接アクセスすると常に 404 になっていた
- `http://<pi5>:4173/admin/employees` が Caddy の 404 を返す

**要因**: 
- Caddyfile が `:8080` + `file_server` のみで、SPA rewrite が無かった
- Dockerfile.web が `caddy file-server` を起動していた
- docker-compose.server.yml のポート設定が不一致

**試行した対策**: 
- [試行1] `docker-compose.server.yml` を `4173:80` に修正 → **成功**
- [試行2] Caddyfile を `:80` + SPA rewrite 付きに更新 → **成功**
- [試行3] Dockerfile.web の CMD を `caddy run --config /srv/Caddyfile` に変更 → **成功**

**有効だった対策**: 
- [試行1-3] すべての設定を統一（ポート、Caddyfile、Dockerfile）

**学んだこと**: 
- Webサーバーの設定は複数のファイルで管理されるため、一貫性を保つ必要がある
- SPA アプリケーションでは、フォールバック設定が重要

**関連ファイル**: 
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/docker/Caddyfile`
- `infrastructure/docker/Dockerfile.web`

---

### [KB-007] XState v5のassign誤用でTypeScriptエラーが発生する

**EXEC_PLAN.md参照**: Surprises & Discoveries (行106-108)

**事象**: 
- キオスクの状態機械 `borrowMachine.ts` で XState v5 の `assign` を誤用し、`pnpm run build` が TypeScript エラーで停止した
- `event is possibly undefined` / `property 'type' does not exist on type never` エラー

**要因**: 
- XState v5 では `assign` の書き方が変更された
- イベントの存在確認が不十分だった

**試行した対策**: 
- [試行1] `assign(({ event }) => ({ ... }))` 形式で context 差分を返すよう修正 → **成功**
- [試行2] イベント存在を `event?.type` で確認したうえで UID を設定 → **成功**

**有効だった対策**: 
- [試行1-2] XState v5 の新しい API に合わせて修正

**学んだこと**: 
- XState v5 では `assign` の書き方が変更された
- イベントの存在確認を必ず行う必要がある

**関連ファイル**: 
- `apps/web/src/features/kiosk/borrowMachine.ts`

---

### [KB-008] Dockerコンテナが再起動時に復帰しない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行100-102)

**事象**: 
- Pi5 をシャットダウンすると Docker コンテナ（api/web）が Exited のまま復帰しない
- `docker-api-1` (Exited 137) / `docker-web-1` (Exited 0) が `docker compose ps` で確認された

**要因**: 
- `restart: always` ポリシーが設定されていなかった

**試行した対策**: 
- [試行1] `docker compose up -d` で手動再起動 → **暫定対応**
- [試行2] `restart: always` ポリシーを追加 → **成功**

**有効だった対策**: 
- [試行2] `restart: always` ポリシーを追加

**学んだこと**: 
- Docker Compose では、`restart: always` を設定することで、コンテナが自動的に再起動される

**関連ファイル**: 
- `infrastructure/docker/docker-compose.server.yml`

---

### [KB-009] 実機UIDとseedデータが不一致で404/400エラーが発生する

**EXEC_PLAN.md参照**: Surprises & Discoveries (行109-111)

**事象**: 
- 実機 UID と seed データが不一致で `/borrow` が 404/400（従業員/アイテム未登録）になる
- `curl /api/borrow` が「対象従業員/アイテムが登録されていません」を返した

**要因**: 
- seed データの UID が実機の UID と一致していなかった

**試行した対策**: 
- [試行1] `apps/api/prisma/seed.ts` を実機タグ（アイテム: 04DE8366BC2A81、社員: 04C362E1330289）に合わせ、再シード → **成功**

**有効だった対策**: 
- [試行1] seed データを実機 UID に合わせて更新

**学んだこと**: 
- seed データは実機の UID と一致させる必要がある
- 実機検証前に seed データを確認する

**関連ファイル**: 
- `apps/api/prisma/seed.ts`

---

### [KB-010] client-key未設定で401エラーが発生する

**EXEC_PLAN.md参照**: Surprises & Discoveries (行112-114, 119-120)

**事象**: 
- client-key が未設定のキオスクから `/loans/active` を呼ぶと 401
- 返却一覧で 401、リクエストヘッダーに `x-client-key` が無い
- 返却一覧に表示されない

**要因**: 
- キオスク UI のデフォルト clientKey が設定されていなかった

**試行した対策**: 
- [試行1] KioskBorrow/Return のデフォルト `client-demo-key` を設定 → **成功**
- [試行2] `useActiveLoans`/借用・返却の Mutation に確実にキーを渡す → **成功**

**有効だった対策**: 
- [試行1-2] デフォルト clientKey を設定し、すべての API 呼び出しにキーを付与

**学んだこと**: 
- キオスク UI では、デフォルト clientKey を設定する必要がある
- すべての API 呼び出しに clientKey を付与する必要がある

**関連ファイル**: 
- `apps/web/src/features/kiosk/KioskBorrow.tsx`
- `apps/web/src/features/kiosk/KioskReturn.tsx`
- `apps/web/src/api/hooks.ts`

---

### [KB-011] Caddyのリバースプロキシ設定でパスが保持されない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行115-116)

**事象**: 
- `/borrow` が 404 の場合は Caddy 側で `/api/*` が素の `/borrow` になっていた

**要因**: 
- Caddyfile のリバースプロキシ設定がパスを保持していなかった

**試行した対策**: 
- [試行1] Caddyfile を `@api /api/* /ws/*` → `reverse_proxy @api api:8080` に固定し、パスを保持して転送 → **成功**

**有効だった対策**: 
- [試行1] リバースプロキシ設定でパスを保持

**学んだこと**: 
- Caddy のリバースプロキシ設定では、パスを保持する必要がある

**関連ファイル**: 
- `infrastructure/docker/Caddyfile`

---

### [KB-012] マスタの名称変更が履歴表示に反映される

**EXEC_PLAN.md参照**: Surprises & Discoveries (行154-155)

**事象**: 
- マスタの名称変更が履歴表示に反映され、過去の記録が「最新名」に書き換わってしまう

**要因**: 
- 履歴表示でマスタデータを直接参照していたため

**試行した対策**: 
- [試行1] BORROW/RETURN 登録時にアイテム/従業員のスナップショット（id/code/name/uid）を Transaction.details に保存 → **成功**
- [試行2] 履歴表示・CSV はスナップショットを優先するように更新 → **成功**

**有効だった対策**: 
- [試行1-2] スナップショット機能を実装

**学んだこと**: 
- 履歴データは、マスタデータの変更に影響されないようにスナップショットを保存する必要がある

**関連ファイル**: 
- `apps/api/src/services/tools/loan.service.ts`
- `apps/web/src/pages/tools/HistoryPage.tsx`

---

### [KB-013] Dockerfileでpackages/shared-typesがコピーされていない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行156-158)

**事象**: 
- Dockerfile.apiとDockerfile.webで`packages/shared-types`をコピーしていなかったため、ビルド時に`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`エラーが発生した
- `pnpm install`実行時に`@raspi-system/shared-types@workspace:*`が見つからないエラー

**要因**: 
- Dockerfile のビルドステージで `packages` ディレクトリをコピーしていなかった

**試行した対策**: 
- [試行1] Dockerfile.apiとDockerfile.webのビルドステージで`COPY packages ./packages`を追加 → **成功**
- [試行2] `packages/shared-types`を先にビルドするように修正 → **成功**
- [試行3] ランタイムステージでは`apps/api`と`packages/shared-types`を丸ごとコピーし、`pnpm install --prod --recursive --frozen-lockfile`でワークスペース依存を解決 → **成功**

**有効だった対策**: 
- [試行1-3] ワークスペース依存を正しく解決するように修正

**学んだこと**: 
- pnpm ワークスペースを使用する場合、Dockerfile でワークスペース全体の構造をコピーする必要がある
- ワークスペース依存を解決するには、`pnpm install --recursive` を使用する

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.api`
- `infrastructure/docker/Dockerfile.web`

---

### [KB-014] import typeでインポートした型を値として使用している

**EXEC_PLAN.md参照**: Surprises & Discoveries (行159-161)

**事象**: 
- Phase 2でサービス層を導入する際、`loan.service.ts`で`ItemStatus`と`TransactionAction`を`import type`でインポートしていたが、値として使用していたためTypeScriptエラーが発生した
- `'ItemStatus' cannot be used as a value because it was imported using 'import type'`エラー

**要因**: 
- `import type` でインポートした型は、値として使用できない

**試行した対策**: 
- [試行1] `ItemStatus`と`TransactionAction`を通常のインポート（`import { ItemStatus, TransactionAction }`）に変更 → **成功**
- [試行2] 型のみのインポート（`import type { Loan }`）と分離 → **成功**

**有効だった対策**: 
- [試行1-2] 型と値を分離してインポート

**学んだこと**: 
- `import type` でインポートした型は、値として使用できない
- 型と値は分離してインポートする必要がある

**関連ファイル**: 
- `apps/api/src/services/tools/loan.service.ts`

---

### [KB-015] fastify-swaggerパッケージ名が変更されている

**EXEC_PLAN.md参照**: Surprises & Discoveries (行85-87)

**事象**: 
- `fastify-swagger@^8` が存在せず `@fastify/swagger` に名称変更されていた
- `pnpm install` で `ERR_PNPM_NO_MATCHING_VERSION fastify-swagger@^8.13.0` エラー

**要因**: 
- パッケージ名が変更された

**試行した対策**: 
- [試行1] 依存を `@fastify/swagger` に切り替え → **成功**

**有効だった対策**: 
- [試行1] パッケージ名を更新

**学んだこと**: 
- Fastify のパッケージは、`@fastify/` プレフィックスに統一された

**関連ファイル**: 
- `apps/api/package.json`

---

### [KB-016] Node.jsバージョンの不一致

**EXEC_PLAN.md参照**: Surprises & Discoveries (行88-89)

**事象**: 
- 現在の開発環境 Node.js が v18.20.8 のため `engines.node >=20` で警告

**要因**: 
- 開発環境と本番環境の Node.js バージョンが不一致

**試行した対策**: 
- [試行1] 一旦 `>=18.18.0` まで許容し、Pi5 では Node20 を推奨する方針 → **成功**

**有効だった対策**: 
- [試行1] バージョン要件を緩和

**学んだこと**: 
- 開発環境と本番環境のバージョン差異を考慮する必要がある

**関連ファイル**: 
- `package.json`

---

### [KB-017] jsonwebtokenの型定義が厳格

**EXEC_PLAN.md参照**: Surprises & Discoveries (行90-91)

**事象**: 
- `jsonwebtoken` の型定義が厳格で、`expiresIn` を文字列で渡す場合に `SignOptions` キャストが必要だった

**要因**: 
- TypeScript の型定義が厳格になった

**試行した対策**: 
- [試行1] `SignOptions['expiresIn']` へキャストしたオプションを用意し型エラーを解消 → **成功**

**有効だった対策**: 
- [試行1] 型キャストを使用

**学んだこと**: 
- TypeScript の型定義が厳格になった場合、型キャストが必要になることがある

**関連ファイル**: 
- `apps/api/src/lib/auth.ts`

---

### [KB-018] React Query v5のAPI変更

**EXEC_PLAN.md参照**: Surprises & Discoveries (行92-93)

**事象**: 
- React Query v5 では mutation の状態フラグが `isLoading` ではなく `isPending` に変更され、`keepPreviousData` も `placeholderData` へ置き換えが必要だった

**要因**: 
- React Query v5 の API が変更された

**試行した対策**: 
- [試行1] フラグ名とオプションを v5 API に合わせて更新 → **成功**

**有効だった対策**: 
- [試行1] API を v5 に合わせて更新

**学んだこと**: 
- React Query v5 では API が変更されたため、移行が必要

**関連ファイル**: 
- `apps/web/src/api/hooks.ts`

---

### [KB-019] XState v5のAPI変更

**EXEC_PLAN.md参照**: Surprises & Discoveries (行94-95)

**事象**: 
- XState v5 では typed machine の generics指定が非推奨になり `types` セクションで文脈/イベントを定義する必要があった

**要因**: 
- XState v5 の API が変更された

**試行した対策**: 
- [試行1] `createBorrowMachine` を純粋な状態遷移マシンにし、API呼び出しは React 側で制御（`SUCCESS`/`FAIL` イベントを送る）するよう変更 → **成功**

**有効だった対策**: 
- [試行1] API を v5 に合わせて更新

**学んだこと**: 
- XState v5 では API が変更されたため、移行が必要

**関連ファイル**: 
- `apps/web/src/features/kiosk/borrowMachine.ts`

---

### [KB-020] pyscardがRC-S300/S1を認識しない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行96-97)

**事象**: 
- 一部の Pi4 では `pyscard` が RC-S300/S1 を認識せず、PC/SC デーモンの再起動や libpcsclite の再インストールが必要だった

**要因**: 
- PC/SC デーモンの設定やドライバの問題

**試行した対策**: 
- [試行1] NFC エージェントのステータス API に詳細メッセージを表示 → **成功**
- [試行2] `AGENT_MODE=mock` で代替動作へ切り替えられるようにした → **成功**
- [試行3] README に `pcsc_scan` を使った診断手順を追記 → **成功**

**有効だった対策**: 
- [試行1-3] 診断機能とフォールバック機能を実装

**学んだこと**: 
- ハードウェア依存の問題は、診断機能とフォールバック機能を実装することで対処できる

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/main.py`
- `README.md`

---

### [KB-021] pyscard 2.3.1でNoReadersAvailable例外が提供されない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行98-99)

**事象**: 
- pyscard 2.3.1 (Python 3.13) では `smartcard.Exceptions.NoReadersAvailable` が提供されず ImportError となる個体があった

**要因**: 
- pyscard のバージョンや Python バージョンによる差異

**試行した対策**: 
- [試行1] 該当例外の import を任意化し、reader.py で警告ログを出しつつ `Exception` へフォールバックして実行を継続するよう変更 → **成功**

**有効だった対策**: 
- [試行1] 例外処理をフォールバック対応

**学んだこと**: 
- ライブラリのバージョン差異に対応するため、フォールバック処理を実装する必要がある

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/reader.py`

---

### [KB-022] ラズパイ4のキオスクがラズパイ5に接続できない

**EXEC_PLAN.md参照**: Phase 1 検証フェーズ

**事象**: 
- ラズパイ4のキオスクがラズパイ5のAPIサーバーに接続できない
- 両ラズパイを再起動した後に発生
- キオスク画面でAPIリクエストが失敗する

**要因**: 
- `Dockerfile.web`に`VITE_API_BASE_URL`が設定されていないため、デフォルトの`'/api'`（相対パス）が使用されている
- 相対パスでは、ラズパイ4のキオスクが自分自身（ラズパイ4）のAPIに接続しようとする
- 再起動でラズパイ5のIPアドレスが変わった可能性もある

**試行した対策**: 
- [試行1] `Dockerfile.web`に`VITE_API_BASE_URL`のARGとENVを追加 → **成功**
- [試行2] `docker-compose.server.yml`の`web`サービスの`args`に`VITE_API_BASE_URL`を追加（絶対URLでラズパイ5のIPアドレスを指定） → **失敗**（CORSエラーが発生）
- [試行3] `VITE_API_BASE_URL`を相対パス（`/api`）に変更 → **成功**

**有効だった対策**: 
- [試行1, 試行3] `VITE_API_BASE_URL`を相対パス（`/api`）に設定することで、Caddyのリバースプロキシ経由でAPIサーバーに接続

**学んだこと**: 
- ラズパイ4のキオスクWebアプリは、ビルド時に`VITE_API_BASE_URL`を設定する必要がある
- 絶対URL（`http://192.168.10.230:8080/api`）を使用すると、ブラウザが直接APIサーバーに接続しようとし、Caddyのリバースプロキシをバイパスしてしまう
- 相対パス（`/api`）を使用することで、Caddyのリバースプロキシ経由でAPIサーバーに接続でき、CORSの問題を回避できる
- Caddyがリバースプロキシとして動作している場合、相対パスを使用することが推奨される
- 環境変数ファイル（`.env`）を使用することで、再起動後もコードを変更せずにIPアドレスを更新できる
- `VITE_API_BASE_URL`を相対パスに設定することで、再起動後もIPアドレスが変わっても更新不要になる

**解決状況**: ✅ **解決済み**（2025-11-25）
- キオスク接続が正常に動作することを確認
- キオスクのすべてのタブでコンソールエラーが発生しなくなったことを確認

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`
- `apps/web/src/api/client.ts`

---

## ナレッジベースの使い方

1. **新しい課題が発生したら**: このドキュメントに追加する
2. **対策を試行したら**: 「試行した対策」セクションに記録する
3. **解決したら**: 「有効だった対策」と「学んだこと」を記録する
4. **同じ問題が発生したら**: このドキュメントを参照して、過去の試行を確認する
5. **EXEC_PLAN.mdと連携**: 課題項目にナレッジベースの課題IDをリンクする

## EXEC_PLAN.mdとの連携

- **Phase 1**: KB-001, KB-002, KB-022
- **Phase 2**: KB-004
- **Phase 3**: KB-003
- **Phase 4**: KB-005

各Phaseの進捗は、EXEC_PLAN.mdの「Progress」セクションで管理し、ナレッジベースの課題IDを参照してください。

## ログ取得方法

### デバッグエンドポイントを使用（管理者権限が必要）

429エラーや404エラーの原因を特定するために、デバッグエンドポイントを使用してログを取得できます。

#### 1. 管理者トークンを取得

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' \
  | jq -r '.accessToken')
```

#### 2. デバッグログを取得

```bash
# 429エラーのログを取得
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/logs?level=warn&limit=20" | jq

# 404エラーのリクエストログを取得
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/requests?statusCode=404&limit=20" | jq

# 429エラーのリクエストログを取得
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/requests?statusCode=429&limit=20" | jq
```

**注意**: デバッグエンドポイントが404を返す場合、実環境で最新のコードがビルドされていない可能性があります。

### APIログを直接確認

デバッグエンドポイントが動作しない場合、APIログを直接確認します：

```bash
# 429エラーと404エラーを検索
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 100 | grep -E "429|404|HTTP.*error" | tail -30
```

スクリプトを使用する場合：

```bash
# check_api_logs.shを実行
./check_api_logs.sh
```

## 更新履歴

- 2025-11-25: 初版作成（KB-001, KB-002, KB-003, KB-004を追加）
- 2025-11-25: EXEC_PLAN.mdのSurprises & Discoveriesから解決済み課題を追加（KB-005〜KB-021）
- 2025-11-25: EXEC_PLAN.mdとの連携を追加
- 2025-11-25: ログ取得方法セクションを追加（debug-logs.mdから統合）
- 2025-11-25: KB-022（ラズパイ4のキオスクがラズパイ5に接続できない問題）を追加
