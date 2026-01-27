---
title: トラブルシューティングナレッジベース - API関連
tags: [トラブルシューティング, API, レート制限, 認証]
audience: [開発者]
last-verified: 2026-01-22
related: [index.md, ../guides/ci-troubleshooting.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - API関連

**カテゴリ**: API関連  
**件数**: 34件  
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

---

### [KB-044] PDFアップロード時のmultipart処理エラー（part is not async iterable）

**EXEC_PLAN.md参照**: Progress (2025-11-28)

**事象**: 
- デジタルサイネージ機能でPDFをアップロードしようとすると、500エラーが発生
- エラーメッセージ: "part is not async iterable"
- APIログに`TypeError: part is not async iterable`が記録される

**要因**: 
- `@fastify/multipart`の`part`オブジェクトを直接イテレートしようとしていた
- `part`は`async iterable`ではなく、`part.file`が`async iterable`である
- `imports.ts`では正しく`part.file`を使用していたが、`pdfs.ts`では`part`を直接使用していた

**試行した対策**: 
- [試行1] `part`を直接イテレート → **失敗**（`part is not async iterable`エラー）
- [試行2] `imports.ts`の実装を参考に`part.file`を使用するように修正 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `MultipartFile`型をインポート
  2. `readFile`関数の引数を`MultipartFile`型に変更
  3. `for await (const chunk of part.file)`を使用してファイルを読み込む
  4. `part`を`MultipartFile`として型アサーション

**学んだこと**: 
- **既存コードの参照**: 同じライブラリを使用している既存のコード（`imports.ts`）を参考にする
- **型定義の確認**: `@fastify/multipart`の型定義を確認することで、正しい使い方を理解できる
- **エラーメッセージの解釈**: "is not async iterable"というエラーは、イテレート可能なプロパティを探すヒントになる

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/api/src/routes/signage/pdfs.ts`
- `apps/api/src/routes/imports.ts`

---

### [KB-045] サイネージが常に工具表示になる問題（タイムゾーン問題）

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- サイネージのスケジュール設定でPDFや分割表示を選択しても、常に工具管理データ（TOOLS）が表示される
- スケジュールの時間帯（09:00-23:00）に設定しても、PDFが表示されない

**要因**: 
- `SignageService.getContent()` がサーバーのタイムゾーン（UTC）で現在時刻を取得していた
- スケジュールの時間判定（`currentTime < schedule.startTime || currentTime >= schedule.endTime`）がUTC基準で行われていたため、日本時間（JST）のスケジュールと一致しなかった
- 結果として、すべてのスケジュールが時間外と判定され、デフォルトの工具表示にフォールバックしていた

**試行した対策**: 
- [試行1] スケジュールの時間判定ロジックを確認 → **問題なし**（ロジック自体は正しい）
- [試行2] `getCurrentTimeInfo()` メソッドを追加し、`SIGNAGE_TIMEZONE` 環境変数でタイムゾーンを設定可能にし、デフォルトで `Asia/Tokyo` を使用するように変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `SignageService` に `getCurrentTimeInfo()` メソッドを追加
  2. `Intl.DateTimeFormat` を使用して、指定されたタイムゾーン（デフォルト: `Asia/Tokyo`）で現在時刻を取得
  3. 環境変数 `SIGNAGE_TIMEZONE` でタイムゾーンを設定可能に（未設定時は `Asia/Tokyo` を使用）
  4. スケジュール判定時に、タイムゾーンを考慮した現在時刻を使用

**学んだこと**: 
- **タイムゾーンの重要性**: サーバーがUTCで動作している場合、時刻ベースの判定にはタイムゾーン変換が必要
- **環境変数による設定**: デフォルト値を設定しつつ、環境変数で上書き可能にすることで柔軟性を確保
- **Intl.DateTimeFormat**: JavaScript標準のAPIを使用することで、タイムゾーン変換を簡単に実装できる

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `apps/api/src/services/signage/signage.service.ts`

---

### [KB-051] サイネージのPDFスライドショーが切り替わらない

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行660付近)

**事象**: 
- 分割表示やPDF単体表示でスライドショーを設定しても、常に同じページが描画される
- 管理画面の再レンダリングを行っても1ページ目のまま変化しない

**要因**: 
- `SignageRenderer` がページ番号を「UNIX秒 ÷ slideInterval」で計算しており、レンダリング間隔（30秒）とslideInterval（10秒）が共通の倍数だった場合に常に同じ値になる
- レンダリング毎に状態を保持していなかったため、前回どのページを描画したかを判定できなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. PDFごとに `lastIndex` / `lastRenderedAt` を保持する状態マップを導入
  2. スライド間隔に応じて必ず最低1ページ進むように補正し、ページ数を超過したらループするロジックに変更
  3. デバッグ用のINFOログを追加し、`nextIndex` が周期的に変化することを可視化

**学んだこと**: 
- スライドショーのページ番号は「時間 × 周期」のみで計算すると周期が一致した際に停止する
- レンダリングジョブとは別に、表示状態を保持することで周期のズレを吸収できる

**関連ファイル**: 
- `apps/api/src/services/signage/signage.renderer.ts`

---

### [KB-052] sharpのcompositeエラー（Image to composite must have same dimensions or smaller）

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行662付近)

**事象**: 
- サイネージレンダラの分割表示で `Error: Image to composite must have same dimensions or smaller` が連続発生し、自動レンダリングが停止する
- `current.jpg` が更新されず、軽量クライアント側には古い画像のまま表示され続ける

**要因**: 
- 工具サムネイルを拡大した際、SVG→JPEG変換後のバッファが想定より大きくなり、`sharp().composite()` へ合成する前にリサイズしていなかった
- 背景キャンバスより大きい画像を合成しようとすると sharp が例外を投げる

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. SVGをJPEG化した直後に `resize(targetWidth, targetHeight, { fit: 'fill' })` を適用し、合成先と同寸に揃える
  2. メッセージ表示 (`renderMessage`) も同様にリサイズして寸法差異をなくす
  3. レンダリングログでエラー内容を監視し、検知後に即座に修正を適用

**学んだこと**: 
- `sharp().composite()` へ渡す画像は、合成先より大きくできないため、SVGベースのレンダリングでは必ず最終寸法へリサイズしてから合成する
- レンダリングジョブが失敗すると `current.jpg` が更新されず、軽量クライアントにも影響するため監視ログが重要

**関連ファイル**: 
- `apps/api/src/services/signage/signage.renderer.ts`

---

### [KB-047] 履歴画面のサムネイル拡大表示で401エラーが発生する問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- 管理画面の履歴タブで、サムネイル画像をクリックして拡大表示しようとすると401エラーが発生する
- エラーメッセージ: `Request failed with status code 401`
- 写真API (`/api/storage/photos/...`) へのリクエストが認証エラーで失敗する

**要因**: 
- 写真API (`apps/api/src/routes/storage/photos.ts`) が、`x-client-key` ヘッダーが存在する場合に即座に認証を試みていた
- 管理画面のブラウザは常に `x-client-key: client-demo-key` を送信しているが、このキーがデータベースに存在しない場合、即座に401エラーを返していた
- JWTトークンによる認証にフォールバックする前にエラーを返していた

**試行した対策**: 
- [試行1] 管理画面で再ログインしてJWTトークンを更新 → **失敗**（問題は認証ロジック側にあった）
- [試行2] 写真APIの認証ロジックを修正し、`x-client-key` が無効な場合はJWT認証にフォールバックするように変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `apps/api/src/routes/storage/photos.ts` の認証ロジックを修正
  2. `x-client-key` が提供されている場合、まずその有効性を確認
  3. `x-client-key` が無効または存在しない場合は、JWT認証 (`canView`) にフォールバック
  4. これにより、管理画面からのリクエストはJWTトークンで認証され、正常に動作するようになった

**学んだこと**: 
- **認証の優先順位**: `x-client-key` とJWTトークンの両方が存在する場合、適切なフォールバックロジックが必要
- **クライアントキーの検証**: `x-client-key` が存在しても無効な場合は、JWT認証にフォールバックすることで柔軟性を確保
- **管理画面とキオスクの違い**: 管理画面はJWT認証、キオスクはclient-key認証という使い分けを明確にする

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `apps/api/src/routes/storage/photos.ts`

---

### [KB-046] サイネージで工具管理がダミーデータのみ表示される問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- サイネージの工具管理データ表示で、NFCリーダーでスキャンしたアイテムが表示されない
- 常にダミーデータ（`Item.status === 'AVAILABLE'` のツール）のみが表示される

**要因**: 
- `SignageService.getToolsData()` が `Item.status === 'AVAILABLE'` のツールのみを取得していた
- 実際に貸出中のツール（`Loan` テーブルで `returnedAt` と `cancelledAt` が `null`）が表示されていなかった

**試行した対策**: 
- [試行1] `getToolsData()` のロジックを確認 → **問題発見**（AVAILABLEのみを取得していた）
- [試行2] `Loan` テーブルから現在貸出中のツールを取得し、それに紐付くアイテム情報を表示するように変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `getToolsData()` を修正し、まず `Loan` テーブルから現在貸出中のツール（`returnedAt` と `cancelledAt` が `null`）を取得
  2. 各貸出データに紐付くアイテム情報（`itemCode`, `name`）と最新のサムネイル（`photoUrl` から生成）を取得
  3. 貸出中のツールが1件もない場合のみ、従来通り `Item.status === 'AVAILABLE'` のツール一覧を表示

**学んだこと**: 
- **データ取得の優先順位**: 実際に使用中のデータを優先表示することで、より実用的な情報を提供できる
- **Loanテーブルの活用**: 貸出履歴から現在の状態を取得することで、リアルタイムな情報を表示できる

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `apps/api/src/services/signage/signage.service.ts`

---

### [KB-054] サイネージ工具表示で日本語が文字化けする問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行655付近)

**事象**: 
- サイネージの工具表示で、従業員名や工具名が文字化けして表示される（例: `è²¸åºä¸ã®å·¥å·`）
- APIレスポンスでは正しく日本語が返されているが、レンダリングされた画像では文字化けしている
- ハッシュ値のような文字列（例: `5c47b881`）が表示される

**要因**: 
- Dockerコンテナ内に日本語フォントがインストールされていない
- `sharp` がSVGをJPEGに変換する際、日本語フォントが存在しないため、フォールバックフォントで文字化けが発生していた
- `Dockerfile.api` に日本語フォントパッケージ（`fonts-noto-cjk`）が含まれていなかった

**試行した対策**: 
- [試行1] APIレスポンスの文字エンコーディングを確認 → **問題なし**（UTF-8で正しく返されている）
- [試行2] SVGのフォント指定を確認 → **問題なし**（`font-family="sans-serif"` は正しい）
- [試行3] Dockerコンテナ内でフォントを確認 → **問題発見**（日本語フォントがインストールされていない）
- [試行4] `Dockerfile.api` に `fonts-noto-cjk` を追加 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. `infrastructure/docker/Dockerfile.api` の `apt-get install` コマンドに `fonts-noto-cjk` を追加
  2. これにより、コンテナ内に日本語フォント（Noto CJK）がインストールされ、SVGレンダリング時に正しく日本語が表示されるようになった

**学んだこと**: 
- **Dockerコンテナでのフォント**: 日本語を表示する場合は、明示的に日本語フォントパッケージをインストールする必要がある
- **フォントの確認方法**: `docker exec` でコンテナ内に入り、`fc-list | grep -i japanese` などでフォントの存在を確認できる
- **Noto CJKフォント**: Googleが提供するオープンソースのCJK（中国語・日本語・韓国語）フォントで、Docker環境でも広く使用されている

**解決状況**: ✅ **解決済み**（2025-11-30）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.api`

---

### [KB-055] サイネージPDFがトリミングされて表示される

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行665付近)

**事象**: 
- サイネージのPDF表示で上下左右が切れてしまい、オリジナルPDFの一部が映らない
- 特に縦横比が16:9以外のPDFで顕著に発生

**要因**: 
- `renderPdfImage` および分割表示のPDF部分で `sharp().resize()` を `fit: 'cover'` にしていたため、1920x1080に収める過程でトリミングされていた
- 背景を埋める処理がなく、余白を追加できなかった

**試行した対策**: 
- [試行1] 変換時のDPI変更 → **効果なし**（縦横比は変わらない）
- [試行2] `fit: 'contain'` + 背景色を指定 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. PDF描画を `fit: 'contain'` に変更し、背景色にサイネージ背景（`#0f172a`）を指定
  2. 分割表示のPDF側も同様に修正し、縦横比を維持したままレターボックス表示にした

**学んだこと**: 
- 固定解像度に異なる縦横比の画像をはめ込む場合は `contain` を使い、背景色で余白を埋めると安全
- `cover` は一見フィットして見えるが、情報の欠落を招く

**関連ファイル**: 
- `apps/api/src/services/signage/signage.renderer.ts`

---

### [KB-094] サイネージ左ペインで計測機器と工具を視覚的に識別できない

**事象**: 
- Pi3サイネージの工具データ左ペインで、計測機器の持出アイテムと工具を視覚的に区別できない
- 計測機器の管理番号が表示されず、識別しにくい

**要因**: 
- `signage.service.ts` の `getToolsData()` で `measuringInstrument` をincludeしておらず、計測機器情報が取得できていなかった
- `signage.renderer.ts` の `buildToolCardGrid()` で計測機器と工具を区別する処理がなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-11）:
  1. **バックエンド**: `signage.service.ts` の `getToolsData()` で `measuringInstrument` をincludeし、`isInstrument` / `managementNumber` フィールドを追加
  2. **レンダラー**: `signage.renderer.ts` の `buildToolCardGrid()` で計測機器判定を追加し、藍系背景（`rgba(49,46,129,0.6)`）とストローク（`rgba(99,102,241,0.5)`）で表示
  3. **表示形式**: 計測機器は管理番号を上段（藍色・小さめ）、名称を下段（白・標準）に2行表示
  4. **フロントエンド**: `SignageDisplayPage.tsx` の `ToolCard` でも同様の識別表示を実装

**学んだこと**: 
- サイネージは「サーバー側レンダリング（静止画出力）」アーキテクチャのため、フロントエンドのReactコンポーネント変更だけでなく、レンダラー（`signage.renderer.ts`）の変更も必要
- 計測機器と工具を混在表示する場合は、色・レイアウトで視覚的に識別できるようにすることが重要

**関連ファイル**: 
- `apps/api/src/services/signage/signage.service.ts`
- `apps/api/src/services/signage/signage.renderer.ts`
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`

---

### [KB-114] CSVインポート構造改善（レジストリ・ファクトリパターン）

**日付**: 2025-01-XX

**事象**: 
- CSVインポート機能が従業員・工具のみに対応しており、計測機器・吊具のCSVインポートができなかった
- 新しいデータタイプを追加する際に、複数箇所のコード修正が必要で拡張性が低かった

**要因**: 
- CSVインポートロジックが各データタイプごとに個別に実装されており、コードの重複があった
- `importEmployees`と`importItems`関数が`routes/imports.ts`に直接実装されており、新しいデータタイプを追加する際に、ルート、スケジューラ、バリデーションなど複数箇所の修正が必要だった

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: レジストリ・ファクトリパターンを導入し、CSVインポート機能をモジュール化
  1. **インターフェース定義**: `CsvImporter`インターフェースを定義し、`parse`と`import`メソッドを定義
  2. **レジストリ実装**: `CsvImporterRegistry`でインポータを管理し、データタイプに応じて適切なインポータを取得
  3. **ファクトリ実装**: `CsvImporterFactory`でデータタイプに応じて適切なインポータを取得
  4. **インポータ実装**: 各データタイプ（従業員・工具・計測機器・吊具）のインポータを個別ファイルに実装
  5. **スケジュール設定の拡張**: `targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に
  6. **後方互換性**: 旧`employeesPath`/`itemsPath`形式もサポート（`BackupConfigLoader`で自動変換）

**学んだこと**: 
- レジストリ・ファクトリパターンにより、新しいデータタイプの追加が容易になる（新しいインポータを実装してレジストリに登録するだけ）
- コードの重複を削減し、保守性が向上する
- 各インポータを独立してテストできるため、テストが容易になる
- 後方互換性を確保することで、既存の設定ファイルを壊さずに移行できる
- `replaceExisting=true`時の安全性を確保するため、参照がある個体（貸出記録、点検記録など）は削除しない仕様を実装

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/api/src/services/imports/csv-importer.types.ts`
- `apps/api/src/services/imports/csv-importer-registry.ts`
- `apps/api/src/services/imports/csv-importer-factory.ts`
- `apps/api/src/services/imports/importers/employee.ts`
- `apps/api/src/services/imports/importers/item.ts`
- `apps/api/src/services/imports/importers/measuring-instrument.ts`
- `apps/api/src/services/imports/importers/rigging-gear.ts`
- `apps/api/src/services/imports/index.ts`
- `apps/api/src/services/backup/backup-config.loader.ts`
- `apps/api/src/routes/imports.ts`
- `apps/api/src/services/imports/csv-import-scheduler.ts`

---

### [KB-115] Gmail件名パターンの設定ファイル管理

**日付**: 2025-01-XX

**事象**: 
- Gmail経由のCSVインポートで使用する件名パターンがコードにハードコードされており、変更するにはコード修正が必要だった
- ユーザーが管理コンソールから件名パターンを編集できない

**要因**: 
- Gmail件名パターンが`GMAIL_SUBJECT_PATTERNS`定数としてコードに定義されていた
- 設定ファイル（`backup.json`）に件名パターンを保存する仕組みがなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: 設定ファイル（`backup.json`）に件名パターンを保存する仕組みを実装
  1. **スキーマ拡張**: `BackupConfig`スキーマに`csvImportSubjectPatterns`フィールドを追加
  2. **デフォルト値**: 既存の`GMAIL_SUBJECT_PATTERNS`をデフォルト値として設定
  3. **管理コンソール連携**: CSVインポートスケジュールページから件名パターンを編集できるように実装
  4. **API連携**: `PUT /api/backup/config`エンドポイントで件名パターンを更新できるように実装

**学んだこと**: 
- 設定可能な値はコードにハードコードせず、設定ファイルに保存することで柔軟性が向上する
- デフォルト値を設定することで、既存の動作を維持しながら新機能を追加できる
- 管理コンソールから設定を編集できるようにすることで、ユーザビリティが向上する

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/api/src/services/backup/backup-config.ts`
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`
- `apps/web/src/api/backup.ts`

---

### [KB-116] CSVインポート手動実行時のリトライスキップ機能

**日付**: 2025-12-30

**事象**: 
- CSVインポートスケジュールの手動実行時に、Gmailに該当メールがない場合、リトライ（最大3回、指数バックオフ）が実行され、最大約7分（60秒+120秒+240秒）待機する必要があった
- 手動実行は即座に結果を確認したいが、リトライ待機によりUIが「実行中...」のまま長時間続いていた
- ユーザーが「ずっと待機状態が続くのか？」と不安に感じていた

**要因**: 
- 手動実行と自動実行（スケジュール実行）で同じリトライロジックを使用していた
- 手動実行は即座に結果を確認したい用途であり、リトライは不要だった
- 自動実行はメールがまだ届いていない可能性があるため、リトライが必要だった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-30）: 手動実行時はリトライをスキップするように変更
  1. **`executeImport`メソッドに`skipRetry`パラメータを追加**: デフォルトは`false`（自動実行は従来通りリトライあり）
  2. **`runImport`メソッド（手動実行）で`skipRetry: true`を指定**: リトライをスキップして即座に実行
  3. **自動実行（スケジュール実行）は従来通り**: リトライあり（最大3回、指数バックオフ）

**実装のポイント**:
```typescript
/**
 * CSVインポートを実行（リトライ機能付き）
 * @param skipRetry 手動実行の場合はtrueを指定してリトライをスキップ
 */
private async executeImport(
  config: BackupConfig,
  importSchedule: NonNullable<BackupConfig['csvImports']>[0],
  skipRetry = false
): Promise<ImportSummary> {
  // プロバイダーを決定
  const provider = importSchedule.provider || config.storage.provider;
  
  // 手動実行の場合はリトライをスキップして直接実行
  if (skipRetry) {
    return await this.executeImportAttempt(config, importSchedule, provider);
  }

  // 自動実行の場合はリトライロジックで実行
  // ... リトライロジック ...
}

// 手動実行
async runImport(importId: string): Promise<void> {
  // ...
  // 手動実行の場合はリトライをスキップ
  const summary = await this.executeImport(config, importSchedule, true);
  // ...
}
```

**学んだこと**: 
- 手動実行と自動実行では要件が異なるため、適切に分岐する必要がある
- 手動実行は即座に結果を確認したい用途であり、リトライは不要
- 自動実行はメールがまだ届いていない可能性があるため、リトライが必要
- UIの待機時間を短縮することで、ユーザー体験が向上する

**解決状況**: ✅ **解決済み**（2025-12-30）

**関連ファイル**: 
- `apps/api/src/services/imports/csv-import-scheduler.ts`

---

### [KB-117] CSVインポートAPIの単一データタイプ対応エンドポイント追加

**日付**: 2025-12-31

**事象**: 
- USBメモリ経由のCSVインポート機能が、従業員・工具のみに対応しており、計測機器・吊具のCSVインポートがUIから実行できなかった
- 既存の`POST /api/imports/master`エンドポイントは複数のCSVファイル（`employeesFile`, `itemsFile`）を同時にアップロードする形式で、計測機器・吊具の個別アップロードに対応していなかった
- 検証のためには、各データタイプを個別にアップロードできるUIが必要だった

**要因**: 
- 既存の`POST /api/imports/master`エンドポイントは、複数のCSVファイルを同時にアップロードする形式（`employeesFile`, `itemsFile`）で設計されていた
- 計測機器・吊具のCSVインポートは、APIレベルでは実装済みだったが、UIから実行するエンドポイントがなかった
- 各データタイプを個別にアップロードできるエンドポイントが必要だった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-31）: 単一データタイプ対応のエンドポイントを追加
  1. **新エンドポイント追加**: `POST /api/imports/master/:type`を追加
     - `:type`パラメータでデータタイプを指定（`employees`, `items`, `measuring-instruments`, `rigging-gears`）
     - 単一のCSVファイル（`file`）をmultipart form dataでアップロード
     - `replaceExisting`パラメータで既存データのクリアを制御
  2. **既存エンドポイントとの統合**: `processCsvImportFromTargets`関数を使用して、既存のインポートロジックを再利用
  3. **バリデーション**: `:type`パラメータが有効なデータタイプかどうかを検証
  4. **URL形式の変換**: kebab-case（`measuring-instruments`）をcamelCase（`measuringInstruments`）に変換して内部処理

**実装のポイント**:
```typescript
// 新エンドポイント: POST /api/imports/master/:type
app.post('/imports/master/:type', {
  preHandler: [mustBeAdmin],
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
}, async (request, reply) => {
  const { type } = request.params;
  
  // データタイプのバリデーション
  const validTypes = ['employees', 'items', 'measuring-instruments', 'rigging-gears'];
  if (!validTypes.includes(type)) {
    return reply.code(400).send({ error: `Invalid type: ${type}` });
  }
  
  // multipart form dataからファイルを取得
  const data = await request.file();
  if (!data) {
    return reply.code(400).send({ error: 'No file provided' });
  }
  
  // kebab-caseをcamelCaseに変換
  const camelCaseType = type === 'measuring-instruments' ? 'measuringInstruments' 
    : type === 'rigging-gears' ? 'riggingGears' 
    : type;
  
  // 既存のインポートロジックを再利用
  const target: CsvImportTarget = {
    type: camelCaseType as CsvImportType,
    source: data.filename || 'uploaded.csv'
  };
  
  const result = await processCsvImportFromTargets(
    [target],
    data.buffer,
    replaceExisting
  );
  
  return reply.send(result);
});
```

**学んだこと**: 
- 既存のインポートロジックを再利用することで、コードの重複を避けられる
- URL形式（kebab-case）と内部形式（camelCase）の変換を明確にすることで、APIの一貫性を保てる
- 単一データタイプ対応のエンドポイントを追加することで、UIの柔軟性が向上する
- 既存の`processCsvImportFromTargets`関数を活用することで、実装の一貫性を保てる

**解決状況**: ✅ **解決済み**（2025-12-31）

**関連ファイル**: 
- `apps/api/src/routes/imports.ts`
- `apps/api/src/services/imports/csv-importer-factory.ts`
- `apps/api/src/services/imports/importers/measuring-instrument.ts`
- `apps/api/src/services/imports/importers/rigging-gear.ts`

---

### [KB-118] 計測機器UID編集時の複数タグ問題の修正

**日付**: 2025-01-XX

**事象**: 
- 計測機器のUIDを手動編集しても、保存後に変更が反映されないように見える
- UIでは`editingTags[0]`（先頭のタグ）を表示するため、複数のタグが紐づいている場合、古いUIDが表示され続ける

**要因**: 
- **根本原因**: 1つの計測機器に複数の`MeasuringInstrumentTag`が紐づいていた
- APIの`update`メソッドが新しいタグを追加するだけで、既存タグを削除していなかった
- UIは`editingTags[0]`を表示するため、更新後も古いUIDが表示され続ける

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: `MeasuringInstrumentService.update`メソッドで、`rfidTagUid`が提供された場合は、既存タグをすべて削除してから新しいタグを1つ作成するように修正
- これにより、1つの計測機器には常に最大1つのタグのみが紐づくようになり、UIの表示と一致する

**実装のポイント**:
```typescript
if (rfidTagUid !== undefined) {
  if (tagUid) {
    // 既存タグをすべて削除してから新しいタグを1つ作成
    await tx.measuringInstrumentTag.deleteMany({ where: { measuringInstrumentId: id } });
    await tx.measuringInstrumentTag.create({
      data: { measuringInstrumentId: id, rfidTagUid: tagUid }
    });
  } else {
    // 空文字指定ならタグを削除
    await tx.measuringInstrumentTag.deleteMany({ where: { measuringInstrumentId: id } });
  }
}
```

**学んだこと**: 
- 1対多の関係でUIが1つの値のみを表示する場合、データベース側でも1対1の関係を保つ必要がある
- 更新時に既存レコードを削除してから新しいレコードを作成することで、データの正規化を保つことができる
- デバッグモードでランタイム証拠を収集することで、根本原因を正確に特定できる

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/api/src/services/measuring-instruments/measuring-instrument.service.ts`

---

### [KB-121] 部署一覧取得エンドポイント追加とPrisma where句の重複プロパティエラー修正

**日付**: 2025-01-XX

**事象**: 
- 計測機器管理画面に`department`フィールドの表示・編集機能を追加するため、部署候補を取得するエンドポイントが必要だった
- CIでTypeScriptビルドエラーが発生: `src/routes/tools/departments.ts(21,11): error TS1117: An object literal cannot have multiple properties with the same name.`

**要因**: 
- **根本原因**: Prismaの`where`句で`department`オブジェクトに`not`プロパティが2回指定されていた
  ```typescript
  where: {
    department: {
      not: null,
      not: ''  // 重複エラー
    }
  }
  ```
- TypeScriptでは同じオブジェクトリテラル内に同じプロパティ名を複数持つことができない

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: `AND`条件を使用して`null`と空文字の両方を除外するように修正
  ```typescript
  where: {
    AND: [
      { department: { not: null } },
      { department: { not: '' } }
    ]
  }
  ```

**実装のポイント**:
- `/api/tools/departments`エンドポイントを追加
- 従業員マスターの`department`フィールドから重複を除いた部署一覧を返す
- `null`と空文字を除外し、重複を除去してソートした配列を返す

**学んだこと**: 
- Prismaの`where`句で複数の条件を指定する場合は`AND`条件を使用する
- TypeScriptのオブジェクトリテラルでは同じプロパティ名を複数持つことができない
- CIでのビルドエラーは、ローカルのlintチェックでは検出されない場合がある（TypeScriptの型チェックは`pnpm build`で実行される）

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/api/src/routes/tools/departments.ts`
- `apps/api/src/routes/tools/index.ts`

---

### [KB-123] Gmail経由CSV取り込み（手動実行）の実機検証完了

**日付**: 2026-01-03

**事象**: 
- Gmail経由でのCSVファイル自動取り込み（スケジュール実行）機能の実装は完了していたが、実機検証が未実施だった
- PowerAutomateからの自動送信設定前に、手動実行での動作確認が必要だった

**検証内容**: 
- 手動実行（`POST /api/imports/schedule/verify-run-001/run`）でGmailからのCSV取得とインポート処理を検証
- 検証対象: 吊具CSV（`rigging_tools.csv`, 363バイト）
- Gmail検索クエリ: `subject:"吊具CSVインポート" is:unread`

**検証結果**: 
- ✅ **すべて正常に動作**（2026-01-03）:
  1. **Gmail検索・取得処理**: 
     - Gmail検索クエリが正常に動作し、メッセージを検出（messageId: `19b82b531643e99d`）
     - 添付ファイルのダウンロード成功（`rigging_tools.csv`, 363バイト）
     - メールのアーカイブ処理成功（処理済みメールとしてマーク）
  2. **CSVインポート処理**: 
     - CSVインポート処理が完了（`riggingGears: processed=2, created=2, updated=0`）
     - データベースに2件の吊具データが正しく保存されていることを確認
  3. **エラーチェック**: 
     - APIログにGmail CSVインポート処理関連のエラーなし
     - 認証トークン関連のエラーは想定内（クライアントアプリからの認証エラー）

**実装のポイント**:
- `GmailStorageProvider`が仕様通りに動作:
  1. Gmail検索クエリの構築（件名パターンと未読メール条件）
  2. 添付ファイルの取得（最初のメールから添付ファイルを取得）
  3. メールのアーカイブ（処理済みメールとしてアーカイブ）
  4. CSVインポート処理（データタイプに応じたインポート処理）
  5. エラーハンドリング（認証エラー時の自動リフレッシュ機能）

**学んだこと**: 
- 手動実行ではインポート履歴（`ImportJob`テーブル）にレコードが作成されない（スケジュール実行時のみ作成される仕様）
- Gmail OAuth認証が正常に動作し、アクセストークンの自動リフレッシュも機能している
- PowerAutomate設定後、スケジュール実行でのE2E検証が必要

**解決状況**: ✅ **実機検証完了**（2026-01-03）

**関連ファイル**: 
- `apps/api/src/services/backup/storage/gmail-storage.provider.ts`
- `apps/api/src/services/backup/gmail-api-client.ts`
- `apps/api/src/services/imports/csv-importer-factory.ts`
- `docs/guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証`

---

### [KB-124] キオスクSlackサポート機能の実装と実機検証完了

**日付**: 2026-01-03

**事象**: 
- キオスクUIから管理者への問い合わせ機能が必要だった
- ユーザーがキオスク端末で問題に遭遇した際に、管理者に直接連絡できる仕組みがなかった

**実装内容**: 
- ✅ **実装完了**（2026-01-03）:
  1. **APIエンドポイント**: `POST /api/kiosk/support`を追加
     - `x-client-key`ヘッダーによる認証
     - レート制限（1分に3件まで、端末単位）
     - メッセージのバリデーション（Zodスキーマ）
     - ClientLogへの記録（`[SUPPORT]`プレフィックス付き）
  2. **Slack通知サービス**: `sendSlackNotification`関数を実装
     - Slack Incoming Webhookを使用
     - 環境変数`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`からWebhook URLを取得
     - 5秒タイムアウト処理
     - エラー時もユーザー体験を優先（エラーを再スローしない）
  3. **フロントエンドUI**: 
     - キオスクレイアウトのヘッダーに「お問い合わせ」ボタンを追加
     - `KioskSupportModal`コンポーネントを作成
     - 「よくある困りごと」の選択機能
     - 詳細メッセージの入力機能（最大500文字）
  4. **環境変数設定**: `docker-compose.server.yml`に`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`を追加

**実機検証結果**: 
- ✅ **すべて正常に動作**（2026-01-03）:
  1. **UI動作**: 
     - ヘッダーの「お問い合わせ」ボタンが表示され、クリックでモーダルが開く
     - 「よくある困りごと」の選択が機能
     - メッセージ送信後、モーダルが閉じる
  2. **Slack通知**: 
     - `#general`チャンネルに通知が正常に届く
     - 通知内容: クライアントID、端末名、場所、画面、メッセージ、Request IDが含まれる
  3. **ClientLog記録**: 
     - データベースに`[SUPPORT]`プレフィックス付きで記録される
     - `kind: 'kiosk-support'`として分類される
     - コンテキスト情報（page、userMessage、clientName、location）が保存される
  4. **APIログ**: 
     - エラーなし、正常に処理（ステータスコード200、レスポンス時間77.77ms）
     - SlackWebhookの送信成功ログが記録される

**実装のポイント**:
- **セキュリティ**: 
  - Webhook URLをログに出力しない（sanitizedUrlを使用）
  - クライアントキーによる認証
  - レート制限による不正利用防止
- **ユーザー体験**: 
  - Slack通知失敗時もAPIは200を返す（エラーはログに記録）
  - モーダルは送信後自動で閉じる
  - 「よくある困りごと」で素早く選択可能
- **エラーハンドリング**: 
  - タイムアウト処理（5秒）
  - ネットワークエラー時の適切なログ記録
  - Webhook URL未設定時は警告ログのみ（通知はスキップ）

**学んだこと**: 
- Slack Incoming Webhookはシンプルで実装が容易
- 環境変数による設定管理が重要（`.env`ファイルに保存）
- ユーザー体験を優先し、エラー時も静かに失敗する設計が適切
- レート制限は端末単位（`x-client-key`）で適用することで、複数端末からの同時送信に対応

**解決状況**: ✅ **実装・実機検証完了**（2026-01-03）

**関連ファイル**: 
- `apps/api/src/routes/kiosk.ts`
- `apps/api/src/services/notifications/slack-webhook.ts`
- `apps/web/src/components/kiosk/KioskSupportModal.tsx`
- `apps/web/src/layouts/KioskLayout.tsx`
- `infrastructure/docker/docker-compose.server.yml`
- `docs/guides/verification-checklist.md#69-キオスクサポート機能slack通知`
- `docs/guides/slack-webhook-setup.md`

---

### [KB-125] キオスク専用従業員リスト取得エンドポイント追加

**日付**: 2026-01-03

**事象**:
- キオスクUIのお問い合わせフォームで、送信者を社員名簿から選択する機能を実装する必要があった
- 既存の`/api/tools/employees`エンドポイントはJWT認証が必要で、キオスク画面から`x-client-key`のみではアクセスできない
- E2Eテストで`/api/tools/employees`へのリクエストが401エラー（認証トークンが必要）を返していた

**要因**:
- **根本原因**: `/api/tools/employees`エンドポイントは`authorizeRoles('ADMIN', 'MANAGER', 'VIEWER')`を使用しており、JWT認証が必要
- キオスク画面からは`x-client-key`のみでアクセスするため、認証エラーが発生していた

**有効だった対策**:
- ✅ **解決済み**（2026-01-03）: キオスク専用の従業員リスト取得エンドポイント`GET /api/kiosk/employees`を追加
  - `x-client-key`認証のみでアクセス可能
  - クライアントデバイスの存在確認を認証として使用
  - アクティブな従業員のみを取得（基本情報のみ: `id`, `displayName`, `department`）
  - セキュリティを考慮し、機密情報（`employeeCode`, `contact`など）は返さない

**実装のポイント**:
```typescript
// apps/api/src/routes/kiosk.ts
app.get('/kiosk/employees', { config: { rateLimit: false } }, async (request) => {
  const rawClientKey = request.headers['x-client-key'];
  const clientKey = normalizeClientKey(rawClientKey);
  
  if (!clientKey) {
    throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
  }

  // クライアントデバイスの存在確認（認証として使用）
  const clientDevice = await prisma.clientDevice.findUnique({
    where: { apiKey: clientKey }
  });

  if (!clientDevice) {
    throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
  }

  // アクティブな従業員のみを取得（基本情報のみ）
  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE'
    },
    select: {
      id: true,
      displayName: true,
      department: true
    },
    orderBy: {
      displayName: 'asc'
    }
  });

  return { employees };
});
```

**学んだこと**:
- キオスク画面からアクセスするエンドポイントは、`x-client-key`認証のみでアクセス可能にする必要がある
- セキュリティを考慮し、必要最小限の情報のみを返す（機密情報は除外）
- 既存のエンドポイントを変更するのではなく、専用のエンドポイントを追加することで、既存機能への影響を避けられる

**解決状況**: ✅ **解決済み**（2026-01-03）

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/web/src/components/kiosk/KioskSupportModal.tsx`

---

### [KB-126] キオスクUIで自端末の温度表示機能追加

**EXEC_PLAN.md参照**: 温度表示ロジックの調査と実装（2026-01-03）

**事象**: 
- Pi4のキオスクUIで管理コンソールと同じ温度（Pi5の温度）が表示されていた
- ユーザー要望: キオスクUIで自端末（Pi4）の温度を表示したい

**要因**: 
- `KioskLayout.tsx`で`useSystemInfo()`を使用しており、`GET /api/system/system-info`がPi5の温度を返していた
- `x-client-key`と`status-agent`の`clientId`が紐づいていなかった

**有効だった対策**: 
- ✅ **解決済み**（2026-01-03）:
  1. `ClientDevice.statusClientId`フィールドを追加し、`x-client-key`と`status-agent`の`clientId`を紐づけ
  2. `POST /api/clients/status`で`status-agent`が送信する際に`ClientDevice.statusClientId`を更新
  3. `GET /api/kiosk/config`エンドポイントを拡張し、`ClientDevice.statusClientId`から`ClientStatus`を取得して`clientStatus`を返却
  4. `KioskLayout.tsx`で`kioskConfig?.clientStatus`を使用して自端末の温度を表示
  5. 実機検証完了（Pi4のキオスクUIで自端末の温度が正しく表示されることを確認）

**学んだこと**:
- `x-client-key`と`status-agent`の`clientId`を紐づけることで、キオスクUIから自端末の`ClientStatus`を取得できる
- `ClientDevice.statusClientId`フィールドを追加することで、`x-client-key`から該当端末の`ClientStatus`を特定できる
- 既存の`GET /api/kiosk/config`エンドポイントを拡張することで、新規エンドポイントを追加せずに機能を実装できる

**解決状況**: ✅ **解決済み**（2026-01-03）

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`
- `apps/api/src/routes/clients.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/layouts/KioskLayout.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `docs/investigation/temperature-display-investigation.md`

---

### [KB-131] APIコンテナがSLACK_KIOSK_SUPPORT_WEBHOOK_URL環境変数の空文字で再起動ループする問題

**日付**: 2026-01-04

**事象**:
- APIコンテナ（`docker-api-1`）が再起動を繰り返し、正常に起動しない
- `docker logs docker-api-1`で確認すると、Zodバリデーションエラーが発生している
- エラーメッセージ: `ZodError: [{"validation":"url","code":"invalid_string","message":"Invalid url","path":["SLACK_KIOSK_SUPPORT_WEBHOOK_URL"]}]`

**要因**:
- **根本原因**: `docker-compose.server.yml`で`SLACK_KIOSK_SUPPORT_WEBHOOK_URL: ${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}`と設定されており、環境変数が未設定の場合でも**空文字が環境変数として注入**される
- `apps/api/src/config/env.ts`で`SLACK_KIOSK_SUPPORT_WEBHOOK_URL: z.string().url().optional()`と定義されているが、Zodの`optional()`は`undefined`を許可するが**空文字は許可しない**ため、バリデーションエラーが発生していた
- 環境変数が空文字の場合、`z.string().url()`が空文字をURLとして検証しようとして失敗し、プロセスが起動時にクラッシュして再起動ループに陥っていた

**有効だった対策**:
- ✅ **解決済み**（2026-01-04）: `apps/api/src/config/env.ts`で`z.preprocess`を使用して、空文字を`undefined`に変換してからURL検証するように修正
  ```typescript
  // NOTE:
  // docker-compose.server.yml では `${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}` により
  // 未設定時でも空文字が注入されるため、空文字は undefined として扱う。
  SLACK_KIOSK_SUPPORT_WEBHOOK_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  )
  ```
- これにより、環境変数が未設定または空文字の場合、`undefined`として扱われ、`optional()`により検証がスキップされる

**実機検証結果**:
- ✅ **すべて正常に動作**（2026-01-04）:
  1. **APIコンテナ**: `docker-api-1`が正常に起動し、再起動ループが停止
  2. **ヘルスチェック**: `https://100.106.158.2/api/system/health`がHTTP 200を返す
  3. **サイネージ画像**: `https://100.106.158.2/api/signage/current-image`が正常に取得できる（約419KB）
  4. **ストレージメンテナンス**: `storage-maintenance.timer`が有効化され、次回実行予定が設定されている

**学んだこと**:
- Docker Composeの`${VAR:-}`構文は、環境変数が未設定の場合でも**空文字を注入**するため、Zodの`optional()`だけでは対応できない
- `z.preprocess`を使用して、空文字を`undefined`に変換してから検証することで、環境変数の未設定と空文字を区別できる
- 環境変数のバリデーションでは、空文字と`undefined`の違いを考慮する必要がある
- APIコンテナの再起動ループは、起動時のバリデーションエラーが原因であることが多い
- `docker-compose.server.yml`で`${VAR:-}`構文を使用する場合、空文字が注入されることを考慮してバリデーションロジックを設計する必要がある

**解決状況**: ✅ **解決済み**（2026-01-04）

**関連ファイル**:
- `apps/api/src/config/env.ts`（環境変数のバリデーション）
- `infrastructure/docker/docker-compose.server.yml`（環境変数の設定）

**推奨対策**:
- 環境変数が`optional`の場合、`z.preprocess`で空文字を`undefined`に変換してから検証する
- Docker Composeの`${VAR:-}`構文を使用する場合、空文字が注入されることを考慮する
- 起動時のバリデーションエラーは、コンテナの再起動ループを引き起こすため、早期に発見・修正する
- 環境変数のバリデーションでは、`z.string().url().optional()`ではなく、`z.preprocess`で空文字を`undefined`に変換してから検証するパターンを推奨

---

### [KB-132] WebRTCシグナリングルートのダブルプレフィックス問題

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- WebRTCシグナリングエンドポイント`/api/webrtc/signaling`にアクセスすると`Route GET:/api/webrtc/webrtc/signaling not found`エラーが発生
- クライアント側で即座に「WebSocket connection error」ダイアログが表示

**要因**: 
- `apps/api/src/routes/webrtc/index.ts`で`prefix: '/webrtc'`を設定
- `apps/api/src/routes/webrtc/signaling.ts`で`/webrtc/signaling`と定義
- 結果として`/webrtc/webrtc/signaling`のダブルプレフィックスが発生

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: `signaling.ts`のルート定義を`/webrtc/signaling`から`/signaling`に変更
- プレフィックスが親ルーターで設定されている場合、子ルートではプレフィックスを含めない

**学んだこと**:
- Fastifyのサブルーター（`fastify.register`）でprefixを設定する場合、子ルートはプレフィックスを重複して含めない
- APIログの`Route GET:/xxx not found`メッセージから、実際にルーティングされたパスを確認できる
- `curl`でエンドポイントを直接テストしてルーティングを確認することが有効

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/api/src/routes/webrtc/index.ts`
- `apps/api/src/routes/webrtc/signaling.ts`

---

### [KB-133] @fastify/websocketのconnection.socketがundefinedになる問題

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- WebSocket接続時に`TypeError: Cannot read properties of undefined (reading 'on')`が発生
- APIログで接続試行は確認できるが、即座にエラーで切断
- クライアント側で連続的に「WebSocket connection error」アラートが表示

**要因**: 
- `@fastify/websocket`のバージョンや環境によって、コールバック引数の形状が異なる
- 一部の環境では`connection.socket`が存在せず、`connection`自体がWebSocketオブジェクト
- 型定義と実際の動作が一致しない場合がある

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: WebSocketオブジェクト取得を堅牢化
```typescript
const maybeSocket = (connection as unknown as { socket?: unknown }).socket ?? connection;
const socket = maybeSocket as unknown as WebSocketLike;
```
- `socket.on`、`socket.send`、`socket.close`メソッドの存在確認を追加
- 存在しない場合は早期リターン

**学んだこと**:
- `@fastify/websocket`の`connection`引数は環境によって形状が異なる可能性がある
- 型定義に頼らず、実際のオブジェクト形状をログで確認することが重要
- 防御的コーディング（メソッド存在確認）でライブラリの動作差分を吸収する

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/api/src/routes/webrtc/types.ts`（`WebSocketLike`インターフェース）

---

### [KB-134] WebSocket接続の5分タイムアウト問題とkeepalive対策

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- WebRTC通話が約5分（319〜331秒）で自動的に切断される
- WebSocket `onclose`イベントで`code: 1006`（異常終了）が記録される
- RTCPeerConnection自体は正常に接続・維持されている

**要因**: 
- ネットワーク機器（ルーター、プロキシ、ロードバランサー等）がアイドル状態のWebSocket接続をタイムアウトで切断
- 一般的なネットワーク機器のアイドルタイムアウトは5分程度

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: WebSocket keepalive機能を実装
- **クライアント側**（`useWebRTCSignaling.ts`）: 30秒ごとに`{ type: 'ping', timestamp: Date.now() }`を送信
- **サーバー側**（`signaling.ts`）: `ping`受信時に`{ type: 'pong', timestamp: ... }`を返送
- `SignalingMessage`型に`ping`と`pong`を追加

**実装詳細**:
```typescript
// クライアント側: 30秒間隔でping送信
keepaliveIntervalRef.current = window.setInterval(() => {
  if (socketRef.current?.readyState === WebSocket.OPEN) {
    socketRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
  }
}, 30000);

// サーバー側: pingを受信したらpongを返送
if (data.type === 'ping') {
  socket.send(JSON.stringify({ type: 'pong', timestamp: data.payload?.timestamp || Date.now() }));
  return;
}
```

**学んだこと**:
- WebSocket接続はネットワーク機器によってアイドルタイムアウトで切断される可能性がある
- 30秒間隔のkeepaliveで5分タイムアウトを回避できる
- `code: 1006`はネットワークレベルの異常終了を示す（アプリケーションエラーではない）
- keepaliveはPing Pong両方向で実装し、通信パスの健全性を確認する

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/web/src/features/webrtc/types.ts`
- `apps/api/src/routes/webrtc/types.ts`

---

### [KB-185] CSVダッシュボードのgmailSubjectPattern設定UI改善

**実装日時**: 2026-01-XX

**事象**: 
- CSVダッシュボードのGmail件名パターン（`gmailSubjectPattern`）を管理コンソールから設定できない
- CSVインポートスケジュールでCSVダッシュボードを選択する際、Gmail件名パターンを個別に設定する必要がある

**要因**: 
- `CsvDashboard`モデルに`gmailSubjectPattern`フィールドは追加されていたが、管理コンソールUIに設定フィールドがなかった
- `CsvDashboardsPage.tsx`に`gmailSubjectPattern`の入力フィールドが実装されていなかった

**実施した対策**: 
- ✅ **管理コンソールUIに設定フィールド追加**: `CsvDashboardsPage.tsx`に「Gmail件名パターン」入力フィールドを追加
- ✅ **APIスキーマ更新**: `csvDashboardCreateSchema`と`csvDashboardUpdateSchema`に`gmailSubjectPattern`を追加
- ✅ **型定義更新**: `CsvDashboardCreateInput`と`CsvDashboardUpdateInput`に`gmailSubjectPattern`を追加
- ✅ **CSVインポートスケジューラー修正**: `CsvImportScheduler`でCSVダッシュボードの`gmailSubjectPattern`を取得するように修正
- ✅ **取り込み責務の集約**: CSVダッシュボードの取得・取り込みは`CsvDashboardImportService`に集約し、スケジューラーの責務を薄く維持

**実装の詳細**:
1. **管理コンソールUI**: `apps/web/src/pages/admin/CsvDashboardsPage.tsx`を修正
   - `gmailSubjectPattern`状態変数を追加
   - 「Gmail件名パターン」入力フィールドを追加
   - `updateCsvDashboard`のペイロードに`gmailSubjectPattern`を含める
2. **APIスキーマ**: `apps/api/src/routes/csv-dashboards/schemas.ts`を修正
   - `csvDashboardCreateSchema`と`csvDashboardUpdateSchema`に`gmailSubjectPattern: z.string().optional().nullable()`を追加
3. **型定義**: `apps/api/src/services/csv-dashboard/csv-dashboard.types.ts`を修正
   - `CsvDashboardCreateInput`と`CsvDashboardUpdateInput`に`gmailSubjectPattern?: string | null;`を追加
4. **CSVインポートスケジューラー**: `apps/api/src/services/imports/csv-import-scheduler.ts`を修正
   - CSVダッシュボードの`gmailSubjectPattern`を`dashboard.gmailSubjectPattern`から取得
5. **CSVダッシュボード取り込み**: `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`に取得〜保存〜取り込みを集約

**学んだこと**:
1. **設定の一元管理**: CSVダッシュボードごとにGmail件名パターンを設定することで、スケジュール設定を簡素化
2. **UIとAPIの整合性**: フロントエンドの型定義（`client.ts`）とバックエンドの型定義（`csv-dashboard.types.ts`）を同期する必要がある
3. **スキーマバリデーション**: Zodスキーマで`optional().nullable()`を使用することで、`null`と`undefined`の両方に対応可能
4. **責務の分離**: CSVダッシュボード取り込みは専用サービスに集約し、スケジューラーの責務を薄く保つ

**解決状況**: ✅ **実装完了・CI成功・実機検証完了**（2026-01-XX）

**実機検証結果**: ✅ **正常動作**（2026-01-XX）
- 管理コンソールでCSVダッシュボードの「Gmail件名パターン」を設定できることを確認
- 設定した`gmailSubjectPattern`がCSVインポートスケジューラーで使用されることを確認

**関連ファイル**:
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx`（UI修正）
- `apps/api/src/routes/csv-dashboards/schemas.ts`（スキーマ更新）
- `apps/api/src/services/csv-dashboard/csv-dashboard.types.ts`（型定義更新）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（スケジューラー修正）
- `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`（取り込み集約）
- `apps/web/src/api/client.ts`（型定義更新）

---

### [KB-186] CsvImportSubjectPatternモデル追加による設計統一（マスターデータインポートの件名パターンDB化）

**作成日時**: 2026-01-XX

**事象**: 
- マスターデータ（従業員・工具・計測機器・吊具）のGmail件名パターンが`backup.json`に保存されており、DBと設定ファイルの二重管理になっている
- CSVダッシュボードの`gmailSubjectPattern`はDBに保存されているが、マスターデータの件名パターンは`backup.json`に保存されている

**要因**: 
- マスターデータのGmail件名パターンが`backup.json`の`csvImportSubjectPatterns`に保存されていた
- CSVダッシュボードの`gmailSubjectPattern`はDBに保存されているため、設計が統一されていない

**実施した対策（完了）**: 
- ✅ **CsvImportSubjectPatternモデル追加**: Prismaスキーマに`CsvImportSubjectPattern`モデルを追加（`schema.prisma:578-591`）
- ✅ **seed.tsにデフォルトデータ追加**: `backup.json`からDBへ移行するためのデフォルトデータを`seed.ts`に追加
- ✅ **件名候補の分離**: `CsvImportSourceService` + `CsvImportSubjectPatternProvider` を導入し、件名候補生成を専用サービスへ分離
- ✅ **スケジューラー統合**: `CsvImportExecutionService` 経由でDBパターンを解決し、`target.source`はフォールバックとして追加
- ✅ **キャッシュでスケール対応**: 1回の実行内で`importType`単位に候補パターンをキャッシュしてDB往復を削減
- ✅ **取得元の詳細隔離**: Gmail特有のエラー処理は`CsvImportSourceService`内に閉じ込め、スケジューラーは取得元非依存に

**実装の詳細**:
1. **Prismaスキーマ**: `apps/api/prisma/schema.prisma`に`CsvImportSubjectPattern`モデルを追加
   ```prisma
   model CsvImportSubjectPattern {
     id          String   @id @default(uuid())
     importType  String   // インポートタイプ（employees, items, measuringInstruments, riggingGears）
     pattern     String   // Gmail件名パターン
     priority    Int      @default(0) // 優先順位（数値が小さいほど優先）
     enabled     Boolean  @default(true)
     createdAt   DateTime @default(now())
     updatedAt   DateTime @updatedAt

     @@unique([importType, pattern])
     @@index([importType])
     @@index([importType, enabled])
     @@index([priority])
   }
   ```
2. **seed.ts更新**: `apps/api/prisma/seed.ts`にデフォルトデータを追加
   - `backup.json`の`csvImportSubjectPatterns`からDBへ移行するためのデフォルトデータ
3. **取得サービスの導入**: `apps/api/src/services/imports/csv-import-source.service.ts`
   - DBの候補 + 旧`target.source`を候補に統合し、順に取得
4. **スケジューラー統合**: `apps/api/src/services/imports/csv-import-execution.service.ts`
   - `CsvImportSourceService`を使用して取得、`CsvImportScheduler`は薄いオーケストレーターへ
5. **互換性維持**: `backup-config.ts`の`csvImportSubjectPatterns`はdeprecateとして残置

**トラブルシューティング**:
- **Gmailで一致しない**: `CsvImportSubjectPattern`が`enabled: true`で登録されているか、件名が候補と一致しているかを確認
- **旧設定の影響**: `target.source`はフォールバックとして候補に追加されるため、意図しない一致があればスケジュールの`target.source`を見直す
- **候補が空になる**: DB側の`CsvImportSubjectPattern`が空の場合でも、`target.source`が空文字だと候補が生成されない

**解決状況**: ✅ **実装完了（DB化・スケジューラー統合・互換性維持）**

**関連ファイル**:
- ✅ `apps/api/prisma/schema.prisma`（`CsvImportSubjectPattern`モデル追加済み）
- ✅ `apps/api/prisma/seed.ts`（デフォルトデータ追加済み）
- ✅ `apps/api/src/services/imports/csv-import-source.service.ts`（候補生成と取得の分離）
- ✅ `apps/api/src/services/imports/csv-import-subject-pattern.provider.ts`（DBアクセス抽象化）
- ✅ `apps/api/src/services/imports/csv-import-execution.service.ts`（スケジューラー統合）
- ✅ `apps/api/src/services/imports/csv-import-scheduler.ts`（オーケストレーター化）
- ✅ `apps/api/src/services/backup/backup-config.ts`（`csvImportSubjectPatterns`は互換性のため残置）

**参照**: `docs/plans/production-schedule-kiosk-execplan.md`の「実装順序4: 設計統一（残タスク）」を参照

---

### [KB-187] CSVインポートスケジュール作成時のID自動生成とNoMatchingMessageErrorハンドリング改善

**実装日時**: 2026-01-20

**事象**: 
- CSVインポートスケジュール作成時に、`csvDashboards`タイプを選択してもIDが自動入力されず、手動入力が必要だった
- Gmailに該当する未読メールがない場合、`NoMatchingMessageError`が発生し、500エラーになっていた
- アラート生成スクリプト（`generate-alert.sh`）が括弧を含むメッセージでシェル実行エラーを起こしていた

**要因**: 
- CSVダッシュボード選択時にスケジュールIDと名前の自動生成ロジックが実装されていなかった
- `CsvDashboardImportService.ingestTargets`で`NoMatchingMessageError`を捕捉せず、上位に伝播していた
- `ImportAlertService`が`exec(string)`でシェル実行しており、括弧や改行を含む文字列でエスケープが破綻していた

**実施した対策**: 
- ✅ **ID自動生成機能追加**: `CsvImportSchedulePage.tsx`でCSVダッシュボード選択時にスケジュールIDと名前を自動生成（形式: `csv-import-${dashboardName.toLowerCase().replace(/\s+/g, '-')}`）
- ✅ **NoMatchingMessageErrorハンドリング**: `CsvDashboardImportService.ingestTargets`で`NoMatchingMessageError`を捕捉し、該当ダッシュボードをスキップして処理を継続
- ✅ **アラート生成の改善**: `ImportAlertService`を`execFile`に変更し、引数配列として渡すことでシェルエスケープ問題を回避

**実装の詳細**:
1. **フロントエンド（ID自動生成）**: `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`
   - CSVダッシュボード選択時の`onChange`で、選択されたダッシュボード名からIDと名前を自動生成
   - 編集時は既存IDを変更しない（新規作成時のみ自動生成）
   - IDフィールドにプレースホルダーを追加し、自動生成であることを明示

2. **バックエンド（NoMatchingMessageErrorハンドリング）**: `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`
   - `downloadCsv`呼び出しを`try-catch`で囲み、`NoMatchingMessageError`を捕捉
   - エラー時はログに記録し、該当ダッシュボードをスキップして次のダッシュボード処理を継続
   - 空の結果（`{}`）を返すことで、スケジューラー側でエラーにならないようにする

3. **アラート生成の改善**: `apps/api/src/services/imports/import-alert.service.ts`
   - `exec(string)`から`execFile`に変更し、引数配列として渡すことでシェルエスケープ問題を回避
   - 括弧や改行を含むメッセージでも安全に実行可能

**トラブルシューティング**:
- **Gmailで一致しない**: メールがない場合は正常にスキップされ、エラーにならない。メール送信後に再実行すれば取り込まれる
- **IDが自動生成されない**: ブラウザのキャッシュをクリアし、ページを再読み込みする
- **アラート生成エラー**: `execFile`への変更により、括弧や改行を含むメッセージでも正常に動作する

**運用メモ**:
- CSVダッシュボードの列定義（`columnDefinitions`）は管理コンソール（`/admin/csv-dashboards`）で確認・編集可能
- 変更可能なのは表示名/CSVヘッダー候補/必須フラグ/表示順のみ（`internalName`と`dataType`は表示のみ）
- CSVプレビュー解析でヘッダー照合を行い、必須列不足や未知ヘッダーを事前確認する

**学んだこと**:
1. **UIの自動化**: ユーザー入力の手間を減らすため、選択に基づく自動生成は有効
2. **エラーハンドリングの粒度**: メールがないことは「エラー」ではなく「スキップ可能な状態」として扱うことで、UXが向上
3. **シェル実行の安全性**: `exec(string)`はシェルエスケープが複雑になるため、`execFile`で引数配列を渡す方が安全

**解決状況**: ✅ **実装完了・CI成功・実機検証完了**（2026-01-20）

**実機検証結果**: ✅ **正常動作**（2026-01-20）
- CSVダッシュボード選択時にIDと名前が自動生成されることを確認
- Gmailに該当メールがない場合でも、エラーではなく正常に完了することを確認
- アラート生成が正常に動作することを確認

**関連ファイル**:
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`（ID自動生成）
- `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`（NoMatchingMessageErrorハンドリング）
- `apps/api/src/services/imports/import-alert.service.ts`（アラート生成改善）

---

### [KB-188] CSVインポート実行エンドポイントでのApiError statusCode尊重

**EXEC_PLAN.md参照**: production-schedule-kiosk-execplan.md (2026-01-21)

**事象**: 
- CSVインポート実行時に列不一致エラーが発生すると、ブラウザコンソールに500 Internal Server Errorが記録される
- UIには適切なエラーメッセージが表示されるが、HTTPステータスコードが500（サーバー側の問題）になっている
- 列不一致はクライアント側の問題（CSVファイルの列構成が設定と一致しない）なので、400 Bad Requestが適切

**要因**: 
- `apps/api/src/routes/imports.ts`の`POST /imports/schedule/:id/run`エンドポイントで、`ApiError`の`statusCode`を無視して常に500に変換していた
- `error instanceof ApiError`のチェックがなく、`ApiError`の`statusCode`（例: 400）が無視されていた

**有効だった対策**: 
- ✅ **解決済み**（2026-01-21）: `ApiError`の場合は`statusCode`を尊重して再スローするように修正
- `error instanceof ApiError`のチェックを最初に行い、`ApiError`の場合はその`statusCode`を尊重して再スロー
- それ以外の`Error`の場合のみ、500に変換

**実装詳細**:
```typescript
// apps/api/src/routes/imports.ts
} catch (error) {
  request.log.error({ err: error, scheduleId: id }, '[CSV Import Schedule] Manual import failed');
  
  // ApiErrorの場合はstatusCodeを尊重して再スロー
  if (error instanceof ApiError) {
    throw error;
  }
  
  if (error instanceof Error) {
    // スケジュールが見つからないエラーの場合のみ404
    if (
      error.message.includes('スケジュールが見つかりません') ||
      error.message.toLowerCase().includes('schedule not found')
    ) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }
    throw new ApiError(500, `インポート実行に失敗しました: ${error.message}`);
  }
  throw new ApiError(500, 'インポート実行に失敗しました');
}
```

**トラブルシューティング**:
- **500エラーが続く**: ブラウザのキャッシュをクリアし、ページを再読み込みする。デプロイが完了しているか確認する
- **400エラーが表示される**: これは正常な動作。CSVファイルの列構成を確認し、管理コンソールで列定義の候補を追加する

**学んだこと**:
1. **エラーハンドリングの階層**: `ApiError`の`statusCode`を尊重することで、適切なHTTPステータスコードを返せる
2. **エラーの分類**: クライアント側の問題（400）とサーバー側の問題（500）を適切に区別することで、デバッグが容易になる
3. **ブラウザコンソールのエラー**: 400エラーは正常なエラーハンドリングの結果。UIに適切なメッセージが表示されていれば問題ない

**解決状況**: ✅ **実装完了・CI成功・実機検証完了**（2026-01-21）

**実機検証結果**: ✅ **正常動作**（2026-01-21）
- CSVインポート実行時に列不一致エラーが発生すると、ブラウザコンソールに400 Bad Requestが記録されることを確認
- UIには適切なエラーメッセージ（「見つからなかった列: 管理番号」「候補: managementNumber, 管理番号」「対応: CSVヘッダー行を確認し...」）が表示されることを確認

**関連ファイル**:
- `apps/api/src/routes/imports.ts`（エラーハンドリング修正）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（CSV_HEADER_MISMATCHエラー生成）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（アラートメッセージ改善）

---

### [KB-189] Gmailに同件名メールが溜まる場合のCSVダッシュボード取り込み仕様（どの添付を取るか）

**EXEC_PLAN.md参照**: production-schedule-kiosk-execplan.md（実装順序3 / MeasuringInstrumentLoans）

**事象**:
- PowerAutomateが「アイテム追加/変更のたびにメール送信」すると、Gmailに同件名のメールが短時間に多数たまる
- CSVインポートの手動実行/スケジュール実行で、期待したCSV（最新/特定の添付）ではなく別のメール添付が取り込まれるように見える
- 取り込みが「列構成不一致」になったり、逆に「一部しか更新されない」ように見える

**要因（現行仕様）**:
- CSVダッシュボード（`csvDashboards`）のGmail取得は「未読」検索でヒットした中から、**先頭1通の最初の添付**のみを取得する実装になっている
  - 検索クエリ: `subject:"<CsvDashboard.gmailSubjectPattern>" is:unread`（送信元制限 `from:` は設定がある場合のみ）
  - 取得件数: Gmail API `users.messages.list` で最大10件（`maxResults: 10`）
  - 対象メール: 検索結果の先頭（`messageIds[0]`）
  - 対象添付: multipartを再帰探索して最初に見つかった添付（`attachmentId`）
- 処理後は「アーカイブ（INBOXラベル削除）」のみで、未読フラグは維持される

**実装箇所（根拠）**:
- `apps/api/src/services/backup/storage/gmail-storage.provider.ts`
  - `buildSearchQuery()` が `is:unread` を付与
  - `downloadWithMetadata()` が `messageIds[0]` の添付を取得し、`archiveMessage()` を呼ぶ
- `apps/api/src/services/backup/gmail-api-client.ts`
  - `searchMessages()` が `maxResults: 10` で一覧を取得
  - `getFirstAttachment()` が最初に見つかった添付を採用

**対策（運用）**:
1. **PowerAutomateを“イベント毎”ではなく“スナップショット定期送信”に変更**（例: 5分/15分ごとに最新CSVを1通送る）
2. **本システム側のスケジュール頻度を上げる**（送信頻度と整合させる）
   - ✅ **実装完了**（2026-01-23）: 管理コンソール「CSVインポートスケジュール」で **「間隔（N分ごと）」** を選択可能（最小5分）
   - 例: 10分ごと → `*/10 * * * *` が保存される
   - 詳細は [KB-191](#kb-191-csvインポートスケジュールの間隔設定機能実装10分ごと等の細かい頻度設定) を参照
3. **同件名の未読を溜めない運用**（取り込ませたいメールを未読1通に揃える）
4. **列定義の不一致を避ける**: 取り込み前に管理コンソールの「CSVプレビュー（ヘッダー照合）」で確認し、必要なら列定義の候補を追加/調整する

**学んだこと**:
- 本システムのCSVダッシュボード取り込みは「メール（CSVスナップショット）単位」であり、借用/返却の全イベントを逐次追跡する設計ではない
- 高頻度更新が必要なら、上流（PowerAutomate）で集約し、下流（本システム）は一定間隔で最新状態を取り込むのが安全

**解決状況**: ✅ **仕様把握・運用指針を整理・実装完了**（2026-01-23）

---

### [KB-190] Gmail OAuthのinvalid_grantでCSV取り込みが500になる

**日付**: 2026-01-22

**事象**:
- 管理コンソール「Gmail設定 > トークン更新」で500が返る
- CSVインポート手動実行で `Failed to search messages: invalid_grant` が出て500になる

**要因**:
- Gmail OAuthのrefresh tokenが無効化されていた（`invalid_grant`）
- 失効時の例外が500に変換され、再認可が必要な状態であることがUIから分からなかった
- Gmailのrefresh失敗時にlocalへフォールバックする挙動があり、正常に見えるが取り込みが無反映になる可能性があった

**有効だった対策**:
- ✅ `invalid_grant` を **再認可必須**として分類し、`401`で明示的に返す
- ✅ Gmail経由の取り込みは **silent fallback を抑止**し、運用に再認可が必要であることを通知
- ✅ 管理コンソールのエラーメッセージを「再認可が必要」へ寄せる

**学んだこと**:
- 個人Gmailでは `invalid_grant` は自動復旧できないため、再認可導線が必須
- エラーは500ではなく運用判断できるHTTPステータス（401/400）で返すべき

**解決状況**: ✅ **実装完了・運用導線整理**（2026-01-22）

**関連ファイル**:
- `apps/api/src/services/backup/gmail-oauth.service.ts`
- `apps/api/src/routes/gmail/oauth.ts`
- `apps/api/src/routes/imports.ts`
- `apps/api/src/services/backup/storage-provider-factory.ts`
- `apps/web/src/pages/admin/GmailConfigPage.tsx`
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`

---

### [KB-191] CSVインポートスケジュールの間隔設定機能実装（10分ごと等の細かい頻度設定）

**日付**: 2026-01-23

**事象**:
- CSVインポートスケジュールが1日1回（曜日+時刻）のみで、10分ごとなどの細かい頻度設定ができなかった
- PowerAutomateからGmail経由でCSVが送信されるタイミングが不定なため、Raspberry Pi側で頻度を上げて取得したいが、UIから設定できなかった
- バックエンドは`node-cron`を使用し、cron形式（例: `"*/10 * * * *"` = 10分ごと）に対応済みだったが、UIが対応していなかった

**要因**:
- UIが「時刻指定」モード（`"0 2 * * 1"` = 毎週月曜2時）のみで、間隔指定（`"*/10 * * * *"` = 10分ごと）に対応していなかった
- cron形式の解析・生成ロジックがUIに実装されていなかった
- 既存のcronスケジュールをUIで編集する際に、複雑な形式（編集不可）とシンプルな形式（編集可能）を区別する仕組みがなかった

**有効だった対策**:
- ✅ **UIに「間隔（N分ごと）」モードを追加**（2026-01-23）:
  1. **スケジュールモードの追加**: `ScheduleMode`型（`'timeOfDay' | 'intervalMinutes' | 'custom'`）を追加
  2. **UIモード選択**: 「時刻指定」と「間隔指定」のボタンで切り替え可能に
  3. **間隔プリセット**: 5分、10分、15分、30分、60分のプリセットを提供
  4. **cron解析機能**: 既存のcronスケジュールを解析し、UIで編集可能かどうかを判定
  5. **cron生成機能**: UIの入力（時刻+曜日、または間隔+曜日）からcron文字列を生成

- ✅ **最小5分間隔の制限を多層防御で実装**:
  1. **UI側**: `MIN_INTERVAL_MINUTES = 5`を定数化し、間隔入力時にバリデーション
  2. **API側**: Zodスキーマの`.superRefine`でcron形式と最小間隔を検証（`node-cron`の`validate`を使用）
  3. **スケジューラー側**: `CsvImportScheduler.start()`で間隔を抽出し、5分未満の場合は警告ログを出力してスキップ（`backup.json`を手動編集した場合の防御）

- ✅ **既存cronの解析・表示機能を実装**:
  1. **cron解析ユーティリティ**: `csv-import-schedule-utils.ts`に`parseCronSchedule`関数を実装
  2. **編集可能性の判定**: シンプルな形式（時刻指定、間隔指定）は編集可能、それ以外は`custom`として表示
  3. **人間可読形式の表示**: `formatScheduleForDisplay`関数でcron文字列を日本語で表示（例: `"*/10 * * * 1,3"` → `"毎週月、水の10分ごと"`）

**実装の詳細**:
1. **UI実装**: `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`
   - `scheduleMode`、`intervalMinutes`、`scheduleEditable`状態を追加
   - モード選択ボタン、間隔入力（プリセット+手動入力）、編集不可警告を実装

2. **cron解析ユーティリティ**: `apps/web/src/pages/admin/csv-import-schedule-utils.ts`（新規作成）
   - `parseCronSchedule`: cron文字列を解析し、モード・時刻・間隔・曜日・編集可能性を返す
   - `formatIntervalCronSchedule`: 間隔+曜日からcron文字列を生成
   - `formatScheduleForDisplay`: cron文字列を人間可読形式に変換

3. **API実装**: `apps/api/src/routes/imports.ts`
   - `MIN_CSV_IMPORT_INTERVAL_MINUTES = 5`を定義
   - `extractIntervalMinutes`関数でcron文字列から間隔を抽出
   - Zodスキーマの`.superRefine`でcron形式と最小間隔を検証

4. **スケジューラー実装**: `apps/api/src/services/imports/csv-import-scheduler.ts`
   - `minIntervalMinutes = 5`を定義
   - `extractIntervalMinutes`関数で間隔を抽出
   - 5分未満の場合は警告ログを出力してスキップ

5. **テスト実装**:
   - UIユニットテスト: `apps/web/src/pages/admin/__tests__/csv-import-schedule-utils.test.ts`（新規作成）
   - API統合テスト: `apps/api/src/routes/__tests__/imports-schedule.integration.test.ts`に最小間隔検証を追加

**トラブルシューティング**:
1. **JSDocコメントの`*/`がesbuildで誤解釈される問題**:
   - 症状: `ERROR: Unexpected "*"`が発生
   - 原因: JSDocコメント内の`*/5`が`*/`として解釈され、コメント終了と誤認
   - 対策: `*/5`を`* /5`（スペース追加）に変更

2. **テストの期待値タイポ**:
   - 症状: `expected '毎週月、水の10分ごと' to be '毎週月、火の10分ごと'`
   - 原因: テストケースの期待値が誤り（`1,3`は月・水だが、期待値が月・火）
   - 対策: 期待値を正しい値に修正

3. **ESLint import/orderエラー**:
   - 症状: `git commit`時にESLintエラーが発生
   - 原因: import文のグループ間に空行がなかった
   - 対策: import文のグループ間に空行を追加

**学んだこと**:
- cron形式の解析・生成ロジックは複雑だが、ユーティリティ関数として分離することで保守性が向上する
- 制約（最小間隔5分）はUI/API/スケジューラーの3層で実装することで、手動編集やバグによる回避を防げる（多層防御）
- 既存のcronスケジュールを編集可能かどうかを判定するロジックは、ユーザー体験を大きく改善する
- JSDocコメント内の`*/`はesbuildで誤解釈される可能性があるため、スペースを追加するか、別の表現を使用する

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-23）

**関連ファイル**:
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`（UI実装）
- `apps/web/src/pages/admin/csv-import-schedule-utils.ts`（cron解析ユーティリティ）
- `apps/web/src/pages/admin/__tests__/csv-import-schedule-utils.test.ts`（UIユニットテスト）
- `apps/api/src/routes/imports.ts`（API実装）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（スケジューラー実装）
- `apps/api/src/routes/__tests__/imports-schedule.integration.test.ts`（API統合テスト）
- `docs/guides/csv-import-export.md`（ドキュメント更新）
- `docs/knowledge-base/api.md`（KB-189更新）

---

### [KB-201] 生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加

**実装日時**: 2026-01-26

**事象**: 
- 生産スケジュールCSVダッシュボードの差分ロジックが、完了状態のレコードをスキップしていた
- PowerAppsと管理コンソールの両方で完了/未完了の切り替えが可能なため、タイミングによっては完了済みレコードが未完了に戻される可能性がある
- CSV取り込み時に`ProductNo`と`FSEIBAN`のバリデーションがなく、不正なデータが取り込まれる可能性がある
- CSVインポートスケジュール作成時に409エラーが発生するが、スケジュール一覧に表示されない

**要因**: 
- **差分ロジック**: `computeCsvDashboardDedupDiff`関数で、完了状態（`progress='完了'`）のレコードをスキップしていた
- **バリデーション**: CSV取り込み時に`ProductNo`と`FSEIBAN`の形式チェックが実装されていなかった
- **UI改善**: 409エラー発生時にスケジュール一覧を更新していなかった

**有効だった対策**: 
- ✅ **差分ロジック改善（2026-01-26）**:
  1. `computeCsvDashboardDedupDiff`関数で`updatedAt`を優先的に使用（`occurredAt`はフォールバック）
  2. 完了状態のスキップロジックを削除し、`updatedAt`の新旧のみで判定
  3. `parseJstDate`関数を追加し、JST形式（`YYYY/MM/DD HH:mm`）の日付文字列をUTC `Date`オブジェクトに変換
  4. テストを更新し、新しいロジックの動作を確認
- ✅ **バリデーション追加（2026-01-26）**:
  1. `CsvDashboardIngestor`に`validateProductionScheduleRow`メソッドを追加
  2. `ProductNo`: 10桁の数字のみ（正規表現: `^[0-9]{10}$`）
  3. `FSEIBAN`: 8文字の英数字（正規表現: `^[A-Za-z0-9]{8}$`）
  4. バリデーション失敗時は`ApiError`（400 Bad Request）をスロー
- ✅ **UI改善（2026-01-26）**:
  1. `CsvImportSchedulePage.tsx`で409エラー発生時に`refetch()`を呼び出し、スケジュール一覧を更新
  2. `validationError`メッセージを表示してユーザーに既存スケジュールの存在を通知

**実装の詳細**:
```typescript
// csv-dashboard-diff.ts
function parseJstDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  // JST形式: "YYYY/MM/DD HH:mm"
  const match = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  // JST (UTC+9) として解釈し、UTCに変換
  return new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10) - 9, // JSTからUTCへ
    parseInt(minute, 10)
  ));
}

function resolveUpdatedAt(rowData: Record<string, unknown>): Date {
  const updatedAt = parseJstDate(rowData.updatedAt as string | undefined);
  if (updatedAt) return updatedAt;
  // フォールバック: occurredAt
  return new Date(rowData.occurredAt as string);
}

// 差分判定: updatedAtが新しい方を優先
const incomingUpdatedAt = resolveUpdatedAt(incomingRow.rowData);
const existingUpdatedAt = resolveUpdatedAt(existingRow.rowData);
if (incomingUpdatedAt.getTime() <= existingUpdatedAt.getTime()) {
  // 既存レコードの方が新しいか同じ → スキップ
  return { skip: true };
}
```

```typescript
// csv-dashboard-ingestor.ts
const PRODUCTION_SCHEDULE_DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';

private validateProductionScheduleRow(rowData: Record<string, unknown>): void {
  if (this.dashboardId !== PRODUCTION_SCHEDULE_DASHBOARD_ID) return;
  
  const productNo = rowData.ProductNo as string | undefined;
  if (productNo && !/^[0-9]{10}$/.test(productNo)) {
    throw new ApiError(400, `ProductNoは10桁の数字である必要があります: ${productNo}`);
  }
  
  const fseiban = rowData.FSEIBAN as string | undefined;
  if (fseiban && !/^[A-Za-z0-9]{8}$/.test(fseiban)) {
    throw new ApiError(400, `FSEIBANは8文字の英数字である必要があります: ${fseiban}`);
  }
}
```

**学んだこと**:
- **差分ロジック**: 完了状態でも最新の`updatedAt`を持つレコードを優先することで、PowerAppsと管理コンソールの両方での編集に対応できる
- **バリデーション**: CSV取り込み時にデータ形式をチェックすることで、不正なデータの取り込みを防止できる
- **UI改善**: 409エラー発生時にスケジュール一覧を更新することで、ユーザーに既存スケジュールの存在を通知できる
- **日付パース**: JST形式の日付文字列をUTC `Date`オブジェクトに変換する際は、タイムゾーンオフセット（+9時間）を考慮する必要がある

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-26）

**実機検証結果**: ✅ **すべて正常動作**（2026-01-26）
- 差分ロジックが`updatedAt`を優先的に使用し、完了状態でも最新レコードを採用することを確認
- バリデーションが正常に動作し、不正なデータの取り込みを防止することを確認
- CSVインポートスケジュール作成時の409エラーで、スケジュール一覧が更新されることを確認

**関連ファイル**:
- `apps/api/src/services/csv-dashboard/diff/csv-dashboard-diff.ts`（差分ロジック改善）
- `apps/api/src/services/csv-dashboard/diff/__tests__/csv-dashboard-diff.test.ts`（テスト更新）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（バリデーション追加）
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`（UI改善）

---

### [KB-135] キオスク通話候補取得用APIエンドポイント追加

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- キオスク画面で通話可能な端末一覧を表示しようとすると401 Unauthorizedエラー
- 既存の`/api/clients`と`/api/clients/status`は管理者認証が必要

**要因**: 
- キオスクからはJWT認証ではなく`x-client-key`認証のみでアクセス
- 管理者向けAPIエンドポイントをキオスクから直接呼び出そうとしていた

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: キオスク専用の通話候補取得エンドポイントを追加
- `GET /api/kiosk/call/targets`: `x-client-key`認証で通話可能なクライアント一覧を返す
- 自分自身を除外、staleなクライアントを除外
- `ClientDevice`情報（`location`等）を付加して返却

**実装詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
app.get('/kiosk/call/targets', async (request, reply) => {
  const clientKey = await allowClientKey(request);
  const selfClient = await prisma.clientDevice.findUnique({ where: { apiKey: clientKey } });
  const statuses = await prisma.clientStatus.findMany({
    where: { stale: false, clientId: { not: selfClient?.statusClientId } }
  });
  // ...
});
```

**学んだこと**:
- キオスク向けAPIは`x-client-key`認証で設計する
- 既存の管理者向けAPIを流用せず、キオスク専用のエンドポイントを作成する
- 自端末を除外するロジックを含めることで、不正な自己発信を防止
- `stale`フラグでオフライン端末を除外し、発信可能な端末のみを返す

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`
- `apps/web/src/api/client.ts`（`getKioskCallTargets`関数）
- `apps/web/src/api/hooks.ts`（`useKioskCallTargets`フック）

---

