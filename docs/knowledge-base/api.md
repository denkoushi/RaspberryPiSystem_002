---
title: トラブルシューティングナレッジベース - API関連
tags: [トラブルシューティング, API, レート制限, 認証]
audience: [開発者]
last-verified: 2025-11-27
related: [index.md, ../guides/ci-troubleshooting.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - API関連

**カテゴリ**: API関連  
**件数**: 8件  
**索引**: [index.md](./index.md)

---

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

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: レート制限プラグインを完全に削除。実環境で最新のコードをビルド・デプロイ（`docker compose up -d --force-recreate --build api`）することで429エラーが解消された。
- **重要**: `docker compose restart`では新しいイメージが使われないため、`--force-recreate`オプションを使用してコンテナを再作成する必要がある

**学んだこと**: 
- **重要**: プラグインの重複登録は予期しない動作を引き起こす。1箇所のみで登録することを徹底する
- `docker compose restart`では新しいイメージが使われない。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成する必要がある

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `apps/api/src/plugins/rate-limit.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/app.ts`

---

### [KB-002] 404エラーが発生する

**EXEC_PLAN.md参照**: Phase 1 (行56-63), Surprises & Discoveries (行139-141, 148-153)

**事象**: 
- ダッシュボード・履歴ページで404エラーが発生
- `/api/tools/employees`や`/api/tools/items`が404を返す

**要因**: 
- **根本原因**: Caddyのリバースプロキシ設定が正しくない
- `/api/*`パスが正しくAPIサーバーに転送されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: Caddyfileの設定を修正し、`/api/*`パスが正しくAPIサーバーに転送されるようにした

**学んだこと**: 
- Caddyのリバースプロキシ設定は、パスの保持が重要
- `/api/*`パスを正しく転送するには、`reverse_proxy @api api:8080`の設定が必要

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile`
- `infrastructure/docker/docker-compose.server.yml`

---

### [KB-007] ログインが失敗する

**EXEC_PLAN.md参照**: Surprises & Discoveries

**事象**: 
- キオスクでログインできない
- APIサーバーに接続できない

**要因**: 
- `VITE_API_BASE_URL`の設定が不適切
- CORS設定の問題

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: `VITE_API_BASE_URL`を相対パス（`/api`）に設定し、Caddyのリバースプロキシ経由で接続するように変更

**学んだこと**: 
- CORSエラーを避けるには、相対パスを使用してリバースプロキシ経由で接続する
- IPアドレスが変わっても、相対パスを使用することで問題を回避できる

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`

---

### [KB-008] 履歴の精度が低い

**EXEC_PLAN.md参照**: Surprises & Discoveries (行163-164)

**事象**: 
- 履歴画面でマスタデータが編集されると、過去の履歴の値が変わる
- CSVエクスポートでも同様の問題が発生

**要因**: 
- 履歴データがマスタデータを参照しているため、マスタデータが変更されると履歴も変わる
- スナップショット機能が実装されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: BORROW/RETURN登録時にアイテム/従業員のスナップショットを`Transaction.details`に保存し、履歴表示・CSVでスナップショットを優先するように変更

**学んだこと**: 
- 履歴データは、マスタデータの変更に影響されないようにスナップショットを保存する必要がある

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `apps/api/src/routes/borrow.ts`
- `apps/api/src/routes/return.ts`
- `apps/web/src/pages/admin/HistoryPage.tsx`

---

### [KB-010] client-key未設定で401エラーが発生する

**EXEC_PLAN.md参照**: Surprises & Discoveries (行154-156)

**事象**: 
- キオスクから`/loans/active`を呼ぶと401エラーが発生
- リクエストヘッダーに`x-client-key`が無い

**要因**: 
- キオスクUIで`x-client-key`が設定されていない
- デフォルトの`client-key`が設定されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: KioskBorrow/Returnのデフォルト`client-demo-key`を設定し、`useActiveLoans`/借用・返却のMutationに確実にキーを渡すように修正

**学んだこと**: 
- クライアントキーは、キオスクUIで確実に設定する必要がある
- デフォルト値を設定することで、設定漏れを防ぐことができる

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `apps/web/src/features/kiosk/KioskBorrow.tsx`
- `apps/web/src/features/kiosk/KioskReturn.tsx`
- `apps/web/src/hooks/useActiveLoans.ts`

---

### [KB-011] 同じアイテムが未返却のまま再借用できない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行159-160)

**事象**: 
- 同じアイテムが未返却のまま再借用するとAPIが400で「貸出中」と返す

**要因**: 
- これは仕様として実装されている

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: 仕様として明示し、返却してから再借用する運用を明示

**学んだこと**: 
- 仕様として実装されている機能は、明示的にドキュメント化する必要がある

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `apps/api/src/routes/borrow.ts`

---

### [KB-012] 管理UIの履歴画面に日付フィルタ/CSVエクスポートがない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行163-164)

**事象**: 
- 管理UIの履歴画面に日付フィルタ/CSVエクスポートがなく、確認が手作業になっていた

**要因**: 
- 機能が実装されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: 履歴画面に日付フィルタとCSVエクスポートを実装

**学んだこと**: 
- 履歴画面には、日付フィルタとCSVエクスポート機能が必要

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `apps/web/src/pages/admin/HistoryPage.tsx`

---

### [KB-017] fastify-swaggerが存在しない

**EXEC_PLAN.md参照**: Surprises & Discoveries (行127-128)

**事象**: 
- `fastify-swagger@^8`が存在せず`@fastify/swagger`に名称変更されていた

**要因**: 
- パッケージ名が変更されていた

**有効だった対策**: 
- ✅ **解決済み**（2025-11-18）: `@fastify/swagger`に変更

**学んだこと**: 
- パッケージ名が変更される場合があるため、最新のドキュメントを確認する必要がある

**解決状況**: ✅ **解決済み**（2025-11-18）

**関連ファイル**: 
- `apps/api/package.json`

