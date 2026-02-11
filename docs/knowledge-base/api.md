---
title: トラブルシューティングナレッジベース - API関連
tags: [トラブルシューティング, API, レート制限, 認証]
audience: [開発者]
last-verified: 2026-02-06
related: [index.md, ../guides/ci-troubleshooting.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - API関連

**カテゴリ**: API関連  
**件数**: 44件  
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
- ✅ **FSEIBANバリデーション修正（2026-01-27）**:
  1. `FSEIBAN`バリデーションを修正し、割当がない場合の`********`（8個のアスタリスク）を明示的に許可
  2. 正規表現を3つのパターンに分離:
     - `^[A-Za-z0-9]{8}$`: 英数字8桁
     - `^\*{8}$`: アスタリスク8個（`********`）
     - `^[A-Za-z0-9*]{8}$`: 英数字とアスタリスクの混合8桁
  3. エラーメッセージに`value`と`length`を追加し、デバッグを容易に
- ✅ **UI改善（2026-01-26）**:
  1. `CsvImportSchedulePage.tsx`で409エラー発生時に`refetch()`を呼び出し、スケジュール一覧を更新
  2. `validationError`メッセージを表示してユーザーに既存スケジュールの存在を通知
- ✅ **製造order番号繰り上がりルール追加（2026-02-10）**:
  1. 重複単位を`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`に定義
  2. 同一キーで`ProductNo`が複数ある場合は、数値が大きい行のみを有効とする
  3. 取り込み時（`CsvDashboardIngestor`）と表示時（`/kiosk/production-schedule`、`SeibanProgressService`）の両方で適用

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
  if (productNo && !/^\d{10}$/.test(productNo)) {
    throw new ApiError(400, `ProductNoは10桁の数字である必要があります（行: ${rowIndex}）`);
  }
  
  const seiban = String(rowData.FSEIBAN ?? '').trim();
  // 割当がない場合は*のみの8桁も許可（例: ********）
  // 英数字8桁、または*のみの8桁を許可
  const isValidSeiban = /^[A-Za-z0-9]{8}$/.test(seiban) || /^\*{8}$/.test(seiban) || /^[A-Za-z0-9*]{8}$/.test(seiban);
  if (!isValidSeiban || seiban.length !== 8) {
    throw new ApiError(
      400,
      `FSEIBANは英数字8桁である必要があります（割当がない場合は*のみの8桁も可）（行: ${rowIndex} / value: ${seiban} / length: ${seiban.length}）`
    );
  }
}
```

**学んだこと**:
- **差分ロジック**: 完了状態でも最新の`updatedAt`を持つレコードを優先することで、PowerAppsと管理コンソールの両方での編集に対応できる
- **バリデーション**: CSV取り込み時にデータ形式をチェックすることで、不正なデータの取り込みを防止できる
- **UI改善**: 409エラー発生時にスケジュール一覧を更新することで、ユーザーに既存スケジュールの存在を通知できる
- **日付パース**: JST形式の日付文字列をUTC `Date`オブジェクトに変換する際は、タイムゾーンオフセット（+9時間）を考慮する必要がある
- **FSEIBANバリデーション**: 割当がない場合の`********`（8個のアスタリスク）を明示的に許可することで、実際の運用ケースに対応できる。エラーメッセージに`value`と`length`を含めることで、デバッグが容易になる
- **製造order番号繰り上がり対応**: 表示時だけでなく取り込み時にも同ルールを適用することで、DB保存データと表示結果の整合性を維持できる
- **ProductNoの数値比較**: 文字列比較ではなく数値比較を使用することで、`'0003'`と`'0009'`のようなゼロパディングされた文字列でも正しく比較できる（`compareProductNo`関数で`parseInt`を使用）
- **SQL正規表現パターン**: PostgreSQLの正規表現では`\d`ではなく`[0-9]`を使用することで、エスケープの問題を回避できる（`'^\\\\d+$'`ではなく`'^[0-9]+$'`）
- **型定義の明示**: TypeScriptの型推論が不十分な場合、明示的な型定義を追加することでコンパイルエラーを回避できる（`ingestRows`の型定義）

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-26、2026-01-27 FSEIBANバリデーション修正、2026-02-10 製造order番号繰り上がりルール追加）

**実機検証結果**: ✅ **すべて正常動作**（2026-01-26、2026-01-27 FSEIBANバリデーション修正後も正常動作、2026-02-10 製造order番号繰り上がりルール実装後も正常動作）
- 差分ロジックが`updatedAt`を優先的に使用し、完了状態でも最新レコードを採用することを確認
- バリデーションが正常に動作し、不正なデータの取り込みを防止することを確認
- CSVインポートスケジュール作成時の409エラーで、スケジュール一覧が更新されることを確認
- **FSEIBANバリデーション修正後（2026-01-27）**: `********`（8個のアスタリスク）が正常に取り込まれることを確認（Gmail経由CSV取り込み成功）
- **製造order番号繰り上がりルール実装後（2026-02-10）**: 同一キー（`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`）で`ProductNo`が複数ある場合、数字が大きい方のみが表示されることを確認（実機検証完了、重複除去機能が正常動作）

**トラブルシューティング**:
- **テスト失敗（ProductNo比較）**: 統合テストで`ProductNo: '0003'`と`ProductNo: '0009'`を比較した際、`'0009'`が返されるべきなのに`'0003'`が返された
  - **原因**: `max-product-no-resolver.ts`で文字列比較（`>`）を使用していたため、数値として正しく比較されていなかった
  - **対策**: `compareProductNo`関数を追加し、`parseInt`で数値に変換してから比較するように修正
- **SQL正規表現エラー**: `buildMaxProductNoWinnerCondition`のSQLで正規表現パターン`'^\\\\d+$'`が正しく動作しなかった
  - **原因**: PostgreSQLの正規表現エスケープの問題
  - **対策**: `'^[0-9]+$'`に変更し、エスケープの問題を回避
- **TypeScriptビルドエラー**: `csv-dashboard-ingestor.ts`で`ingestRows`の`hash`プロパティにアクセスしようとするとコンパイルエラーが発生
  - **原因**: TypeScriptの型推論が不十分で、`dashboard.ingestMode === 'DEDUP'`の分岐で`hash`プロパティが存在することが推論されなかった
  - **対策**: `ingestRows`に明示的な型定義を追加（`Array<{ data: NormalizedRowData; occurredAt: Date; hash?: string }>`）

**関連ファイル**:
- `apps/api/src/services/csv-dashboard/diff/csv-dashboard-diff.ts`（差分ロジック改善）
- `apps/api/src/services/csv-dashboard/diff/__tests__/csv-dashboard-diff.test.ts`（テスト更新）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（バリデーション追加）
- `apps/api/src/services/production-schedule/row-resolver/`（製造order番号繰り上がり対応ロジック）
- `apps/api/src/routes/kiosk.ts`（有効行フィルタ適用）
- `apps/api/src/services/production-schedule/seiban-progress.service.ts`（集計時の有効行フィルタ適用）
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
- **通話IDは`ClientDevice.id`（UUID）に統一**
- `ClientStatus`は補助情報（hostname/IP）として利用

**実装詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
app.get('/kiosk/call/targets', async (request, reply) => {
  const clientKey = await allowClientKey(request);
  const selfDevice = await prisma.clientDevice.findUnique({ where: { apiKey: clientKey } });
  const devices = await prisma.clientDevice.findMany({ orderBy: { name: 'asc' } });
  // 通話IDは ClientDevice.id を返す
  // stale 判定は ClientDevice.lastSeenAt を優先
  // ClientStatus は補助情報として付与
});
```

**学んだこと**:
- キオスク向けAPIは`x-client-key`認証で設計する
- 既存の管理者向けAPIを流用せず、キオスク専用のエンドポイントを作成する
- 自端末を除外するロジックを含めることで、不正な自己発信を防止
- `stale`フラグは`ClientDevice.lastSeenAt`を基準にし、ブラウザ起動時の疎通も反映できる

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`
- `apps/web/src/api/client.ts`（`getKioskCallTargets`関数）
- `apps/web/src/api/hooks.ts`（`useKioskCallTargets`フック）

---

### [KB-206] クライアント表示名を status-agent が上書きする問題

**日付**: 2026-02-09

**事象**:
- 管理コンソールでクライアント端末名を変更しても、しばらくすると元に戻る
- ビデオ通話の着信名（`callerName`）や発信先一覧で表示名が安定しない

**要因**:
- `POST /api/clients/status` が `ClientDevice.name = metrics.hostname` で毎回更新していた
- `POST /api/clients/heartbeat` も `name` を更新可能で、手動編集と競合していた
- 一方で機械名は `ClientStatus.hostname` にすでに保持されており、`ClientDevice.name` と役割が混在していた

**有効だった対策**:
- ✅ **解決済み**（2026-02-09）:
  1. `ClientDevice.name` を「表示名（手動編集）」として定義
  2. `POST /api/clients/status` は `update` で `name` を更新せず、`statusClientId` と `lastSeenAt` のみ更新
  3. `POST /api/clients/heartbeat` は `update` で `name` を更新せず、`location` と `lastSeenAt` のみ更新
  4. `PUT /api/clients/:id` で `name` を更新可能に拡張
  5. 機械名は `ClientStatus.hostname` を参照する運用に統一
- ✅ **実機検証完了**（2026-02-10）:
  - 管理画面で名前フィールドを編集可能であることを確認
  - 名前変更後、他の端末（Pi4/Pi3）でも反映されることを確認
  - ビデオ通話画面、履歴画面、Slack通知など、すべての機能が正常に動作することを確認

**学んだこと**:
- 表示名（運用者が編集）と機械名（端末が自己申告）は同一フィールドに載せない方が安全
- `ClientDevice`（台帳）と `ClientStatus`（テレメトリ）の責務分離により、通話UIや履歴表示の安定性が上がる
- 既存データ互換を守るには、`create` 時だけ初期値として hostname を使い、`update` では上書きしない方針が有効
- 名前変更は即座に反映されなくても問題ない（最大60秒の遅延は許容範囲）。システム全体の正常動作が最優先
- Transactionはリレーションで取得するため、名前変更後も正しく参照される（スナップショットではない）

**関連ファイル**:
- `apps/api/src/routes/clients.ts`
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/api/src/routes/kiosk.ts`
- `apps/web/src/pages/admin/ClientsPage.tsx`
- `apps/api/src/routes/__tests__/clients.integration.test.ts`

---

### [KB-205] 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）

**実装日時**: 2026-01-26

**事象**: 
- 生産スケジュール画面で3000件のデータを表示する際、Pi4で初期表示に8秒、アイテム完了操作に23秒かかる問題が発生
- 検索機能が「動作していない」と報告された
- ユーザーの使い方は「検索窓で製番を入力→検索→履歴から選択」であり、最初は何も表示せず、検索したものだけ表示すれば事足りる

**要因**: 
- **API側**: クライアント側で全データを取得してからフィルタリング・ソート・ページングを行っていたため、3000件すべてを取得する必要があった
- **検索機能**: `productNo`パラメータのみで、`FSEIBAN`（製番）での検索ができなかった
- **初期表示**: 検索条件がない場合でも全データを取得していた

**有効だった対策**: 
- ✅ **API最適化（2026-01-26）**:
  1. **`q`パラメータ追加**: `ProductNo`と`FSEIBAN`の統合検索パラメータを追加
  2. **検索ロジックの改善**: 
     - 数値のみの場合: `ProductNo`の部分一致検索（`ILIKE`）
     - 8文字の英数字（`*`含む）の場合: `FSEIBAN`の完全一致検索
     - その他: `ProductNo`または`FSEIBAN`の`ILIKE` OR検索
  3. **SQLクエリの最適化**: 
     - `$queryRaw`を使用してDB側でフィルタリング・ソート・ページングを実行
     - `rowData`から必要なフィールドのみを選択（`jsonb_build_object`で最小限のデータのみ返却）
     - ソート順の最適化（FSEIBAN → ProductNo → FKOJUN（数値） → FHINCD）
  4. **デフォルト`pageSize`変更**: 2000から400に変更（初期表示の負荷軽減）
  5. **インデックス活用**: 既存の`pg_trgm`インデックスとJSONBインデックスを活用
- ✅ **カンマ区切りOR検索対応（2026-01-27）**:
  1. **`q`パラメータの拡張**: カンマ区切りで複数の検索条件を受け取れるように拡張（最大長100→200）
  2. **トークン解析**: `q`をカンマ区切りで分割し、各トークンをtrim・空除去・重複除去・最大8件に制限
  3. **OR検索実装**: 各トークンに対して既存ヒューリスティック（数値→ProductNo ILIKE / 8桁→FSEIBAN = / その他→OR ILIKE）を適用し、トークン間はOR条件で結合
  4. **統合テスト追加**: `q=A,B`のOR検索で両方ヒットすること、トークンのtrim/空要素除去が効くことを確認

**実装の詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
const productionScheduleQuerySchema = z.object({
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(), // 新規追加（2026-01-27: カンマ区切りOR検索対応で200に拡張）
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
});

// カンマ区切りOR検索対応（2026-01-27）
const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
const rawTokens = rawQueryText
  .split(',')
  .map((token) => token.trim())
  .filter((token) => token.length > 0);
const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 8);

const queryConditions: Prisma.Sql[] = [];
for (const token of uniqueTokens) {
  const isNumeric = /^\d+$/.test(token);
  const isFseiban = /^[A-Za-z0-9*]{8}$/.test(token);
  const likeValue = `%${token}%`;
  if (isNumeric) {
    queryConditions.push(Prisma.sql`("rowData"->>'ProductNo') ILIKE ${likeValue}`);
  } else if (isFseiban) {
    queryConditions.push(Prisma.sql`("rowData"->>'FSEIBAN') = ${token}`);
  } else {
    queryConditions.push(
      Prisma.sql`(("rowData"->>'ProductNo') ILIKE ${likeValue} OR ("rowData"->>'FSEIBAN') ILIKE ${likeValue})`
    );
  }
}

// OR条件で結合
const queryWhere =
  queryConditions.length > 0
    ? Prisma.sql`AND (${Prisma.join(queryConditions, ' OR ')})`
    : Prisma.empty;

// 必要なフィールドのみを選択
const rows = await prisma.$queryRaw<Array<{ id: string; occurredAt: Date; rowData: Prisma.JsonValue }>>`
  SELECT
    id,
    "occurredAt",
    jsonb_build_object(
      'ProductNo', "rowData"->>'ProductNo',
      'FSEIBAN', "rowData"->>'FSEIBAN',
      'FHINCD', "rowData"->>'FHINCD',
      'FHINMEI', "rowData"->>'FHINMEI',
      'FSIGENCD', "rowData"->>'FSIGENCD',
      'FSIGENSHOYORYO', "rowData"->>'FSIGENSHOYORYO',
      'FKOJUN', "rowData"->>'FKOJUN',
      'progress', "rowData"->>'progress'
    ) AS "rowData"
  FROM "CsvDashboardRow"
  WHERE ${baseWhere} ${queryWhere}
  ORDER BY
    ("rowData"->>'FSEIBAN') ASC,
    ("rowData"->>'ProductNo') ASC,
    (CASE
      WHEN ("rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("rowData"->>'FKOJUN'))::int
      ELSE NULL
    END) ASC,
    ("rowData"->>'FHINCD') ASC
  LIMIT ${pageSize} OFFSET ${offset}
`;
```

**トラブルシューティング**:
1. **CIエラー**: `Prisma.join`で`Prisma.sql`OR``を使用していたが、型エラーが発生
   - 原因: `Prisma.join`のセパレータは文字列リテラルである必要がある
   - 対策: `Prisma.sql`OR``を`' OR '`（文字列リテラル）に変更

**学んだこと**:
- **DB側での処理**: フィルタリング・ソート・ページングをDB側で実行することで、ネットワーク転送量とクライアント側の処理負荷を大幅に削減できる
- **検索ロジックの最適化**: 入力形式（数値/8文字英数字/その他）に応じて適切な検索方法を選択することで、検索精度とパフォーマンスを両立できる
- **レスポンスサイズの最適化**: `rowData`から必要なフィールドのみを選択することで、ネットワーク転送量を削減できる
- **インデックスの活用**: 既存の`pg_trgm`インデックスとJSONBインデックスを活用することで、検索パフォーマンスを向上できる

**解決状況**: ✅ **実装完了・CI成功・デプロイ成功・実機検証完了**（2026-01-27）
- 2026-01-26: 基本実装完了・CI成功・Mac実機検証完了
- 2026-01-27: カンマ区切りOR検索対応追加・CI成功・デプロイ成功・実機検証完了（Mac・Pi4）

**実機検証結果**: ✅ **Mac・Pi4で正常動作**（2026-01-27）
- 検索機能が正常に動作することを確認（ProductNo部分一致、FSEIBAN完全一致、その他OR検索）
- カンマ区切りOR検索が正常に動作することを確認（`q=A,B`で両方ヒット）
- 初期表示が即座に「検索してください。」と表示されることを確認（API呼び出しなし）
- 検索結果が正しく表示されることを確認

**課題解決（2026-01-28）**:
- **全部表示→登録製番のみ表示**: 初期表示で全データを表示するロジックを削除し、登録製番（検索条件）がある場合のみ表示するように変更したところ、Pi4での動作が軽快になった
- **資源CD単独検索の無効化**: 資源CD単独では検索されないように変更（登録製番単独・AND検索は維持）。資源CD単独だと対象アイテムが多すぎてPi4で動作が緩慢になる問題を解決

**実機検証結果（2026-01-28）**: ✅ **Pi4で正常動作確認**
- 資源CD単独では検索されないことを実機で確認（検索結果が空になる）
- 登録製番単独での検索が正常に動作することを確認
- 登録製番と資源CDのAND検索が正常に動作することを確認
- Pi4での動作速度が改善され、軽快に動作することを確認

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`（`q`パラメータ追加、検索ロジック改善、SQLクエリ最適化、カンマ区切りOR検索対応、資源CD単独検索の無効化）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（`q`パラメータのテスト追加、OR検索のテスト追加、資源CD単独検索の無効化テスト追加）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（初期表示の改善、資源CD単独検索の無効化）

---

### [KB-208] 生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）

**実装日時**: 2026-01-27

**事象**: 
- 実機検証で、検索登録製番と資源CDを併用する検索機能がOR条件になっていたが、AND条件にしたい要望
- 資源CDごとに加工順序番号（1-10）を割当し、完了時に自動で詰め替える機能が必要
- 複数のPi4端末で同じ検索条件を同期したい要望

**要因**: 
- 検索条件の結合ロジックがOR条件（`queryConditions`を`OR`で結合）になっていた
- 加工順序番号の管理が`rowData`に埋め込まれていなかった（正規化されていなかった）
- 検索状態の同期機能が実装されていなかった

**有効だった対策**: 
- ✅ **検索条件のAND結合（2026-01-27）**:
  1. **条件の分離**: テキスト検索条件（`textConditions`）と資源CD条件（`resourceConditions`）を分離
  2. **AND結合**: 両方が存在する場合は`AND`で結合（`textConditions AND resourceConditions`）
  3. **資源CD条件内はOR**: `resourceCds`と`resourceAssignedOnlyCds`は資源CD条件内でOR結合
  4. **統合テスト更新**: テストケースをAND条件に合わせて更新（`q=A&resourceAssignedOnlyCds=1`で`['0000']`のみヒット）
- ✅ **加工順序割当機能（2026-01-27）**:
  1. **新規テーブル追加**: `ProductionScheduleOrderAssignment`テーブルを追加（`csvDashboardRowId` + `location` + `resourceCd` + `orderNumber`）
  2. **一意制約**: `@@unique([csvDashboardId, location, resourceCd, orderNumber])`で同一資源CD内での重複を防止
  3. **完了時の自動詰め替え**: 完了時に割当を削除し、同一資源CD内の後続番号を`orderNumber - 1`で更新（単一SQL update）
  4. **APIエンドポイント追加**: `PUT /kiosk/production-schedule/:rowId/order`で割当/解除、`GET /kiosk/production-schedule/order-usage`で使用中番号取得
- ✅ **検索状態同期機能（2026-01-27）**:
  1. **新規テーブル追加**: `KioskProductionScheduleSearchState`テーブルを追加（`csvDashboardId` + `location` + `state`（JSON））
  2. **location単位の同期**: `ClientDevice.location`をキーとして、同一locationの端末間で検索条件を共有
  3. **APIエンドポイント追加**: `GET /kiosk/production-schedule/search-state`、`PUT /kiosk/production-schedule/search-state`
  4. **フロントエンド同期**: 起動時に取得、debounce（400ms）で更新、poll（2-5秒）で他端末更新を反映

**実装の詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
// 検索条件のAND結合
const textConditions: Prisma.Sql[] = [];
// ... テキスト検索条件を構築

const resourceConditions: Prisma.Sql[] = [];
if (resourceCds.length > 0) {
  resourceConditions.push(Prisma.sql`("rowData"->>'FSIGENCD') IN (...)`);
}
if (assignedOnlyCds.length > 0) {
  resourceConditions.push(Prisma.sql`id IN (SELECT ...)`);
}

const textWhere = textConditions.length > 0 ? Prisma.sql`(${Prisma.join(textConditions, ' OR ')})` : Prisma.empty;
const resourceWhere = resourceConditions.length > 0 ? Prisma.sql`(${Prisma.join(resourceConditions, ' OR ')})` : Prisma.empty;
const queryWhere =
  textConditions.length > 0 && resourceConditions.length > 0
    ? Prisma.sql`AND ${textWhere} AND ${resourceWhere}`
    : textConditions.length > 0
      ? Prisma.sql`AND ${textWhere}`
      : resourceConditions.length > 0
        ? Prisma.sql`AND ${resourceWhere}`
        : Prisma.empty;

// 加工順序の取得（サブクエリ）
SELECT
  ...,
  (
    SELECT "orderNumber"
    FROM "ProductionScheduleOrderAssignment"
    WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "location" = ${locationKey}
    LIMIT 1
  ) AS "processingOrder"
FROM "CsvDashboardRow"
WHERE ...

// 完了時の自動詰め替え（トランザクション）
await prisma.$transaction(async (tx) => {
  await tx.csvDashboardRow.update({ ... });
  if (currentAssignment) {
    await tx.productionScheduleOrderAssignment.delete({ ... });
    await tx.productionScheduleOrderAssignment.updateMany({
      where: {
        csvDashboardId: DASHBOARD_ID,
        location: locationKey,
        resourceCd: currentAssignment.resourceCd,
        orderNumber: { gt: currentAssignment.orderNumber },
      },
      data: { orderNumber: { decrement: 1 } },
    });
  }
});
```

**学んだこと**:
- **検索条件の結合ロジック**: テキスト検索と資源CDフィルタはAND結合、資源CD条件内はOR結合という2層構造を明確に分離することで、意図通りの動作を実現できる
- **正規化の重要性**: 加工順序番号を`rowData`に埋め込まず、独立したテーブルで管理することで、競合を防ぎ、スケーラビリティを向上できる
- **自動詰め替えの実装**: 単一SQL update（`orderNumber - 1`）で後続番号を一括更新することで、トランザクション内で効率的に処理できる
- **location単位の同期**: `ClientDevice.location`をキーとして、同一locationの端末間で検索条件を共有することで、現場での運用を支援できる

**解決状況**: ✅ **解決済み**（2026-01-27）

**実機検証**:
- ✅ Macで動作確認完了
- ✅ Pi4で動作確認完了
- ✅ 検索登録製番と資源CDのAND検索が正常に動作することを確認
- ✅ 加工順序番号の割当・解除・自動詰め替えが正常に動作することを確認
- ✅ 検索状態の同期が正常に動作することを確認（複数端末間での同期）

**関連ファイル**:
- `apps/api/prisma/schema.prisma`（`ProductionScheduleOrderAssignment`、`KioskProductionScheduleSearchState`モデル追加）
- `apps/api/prisma/migrations/20260127122147_add_production_schedule_ordering/migration.sql`（マイグレーション）
- `apps/api/src/routes/kiosk.ts`（資源CDフィルタ、加工順序割当、検索状態同期、AND検索実装）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（統合テスト追加）
- `apps/web/src/features/kiosk/productionSchedule/resourceColors.ts`（新規: 資源CD色管理ユーティリティ）

---

### [KB-209] 生産スケジュール検索状態の全キオスク間共有化

**実装日時**: 2026-01-28

**事象**: 
- 複数のキオスク端末で、検索登録した製番を各キオスク間で共有したい要望
- 現在はlocation単位で検索状態が同期されているが、全キオスク間で共有したい

**要因**: 
- KB-208で実装した検索状態同期機能は`ClientDevice.location`をキーとしており、location単位での同期に限定されていた
- 全キオスク間で共有するには、locationに依存しない共有キーが必要

**有効だった対策**: 
- ✅ **検索状態の共有化（2026-01-28）**:
  1. **共有キーの導入**: `SHARED_SEARCH_STATE_LOCATION = 'shared'`定数を追加し、検索状態の保存先を共有キーに統一
  2. **フォールバック機能**: 初回取得時は共有状態を優先し、存在しない場合は端末別状態（`locationKey`）をフォールバックで読み込む（後方互換性維持）
  3. **APIエンドポイントの変更**: 
     - `GET /kiosk/production-schedule/search-state`: 共有状態を優先取得、存在しない場合は端末別状態をフォールバック
     - `PUT /kiosk/production-schedule/search-state`: 共有キー（`'shared'`）で保存
  4. **統合テスト更新**: 2台のクライアント（異なるlocation）間で検索状態が共有されることを検証

**実装の詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
const SHARED_SEARCH_STATE_LOCATION = 'shared';

// GET: 共有状態を優先、フォールバックで端末別状態
app.get('/kiosk/production-schedule/search-state', async (request) => {
  const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
  const locationKey = resolveLocationKey(clientDevice);
  
  // 共有状態を優先取得
  const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION,
      },
    },
  });
  if (sharedState) {
    return { state: sharedState.state ?? null, updatedAt: sharedState.updatedAt ?? null };
  }

  // フォールバック: 端末別状態
  const fallbackState = await prisma.kioskProductionScheduleSearchState.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
      },
    },
  });
  return { state: fallbackState?.state ?? null, updatedAt: fallbackState?.updatedAt ?? null };
});

// PUT: 共有キーで保存
app.put('/kiosk/production-schedule/search-state', async (request) => {
  const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
  const body = productionScheduleSearchStateBodySchema.parse(request.body);
  
  const state = await prisma.kioskProductionScheduleSearchState.upsert({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: SHARED_SEARCH_STATE_LOCATION, // 共有キーで保存
      },
    },
    update: { state: body.state as Prisma.InputJsonValue },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: SHARED_SEARCH_STATE_LOCATION, // 共有キーで作成
      state: body.state as Prisma.InputJsonValue,
    },
  });
  return { state: state.state, updatedAt: state.updatedAt };
});
```

**学んだこと**:
- **後方互換性の維持**: 既存の端末別状態をフォールバックで読み込むことで、既存データを失うことなく移行できる
- **共有キーの設計**: locationに依存しない共有キー（`'shared'`）を使用することで、全キオスク間で検索状態を共有できる
- **API側の変更のみ**: フロントエンドの同期ロジック（poll/debounce）は変更不要で、API側の変更のみで機能拡張できる

**追加変更（2026-01-28）**:
- **資源CD単独検索の無効化**: 資源CD単独では検索されないように変更（登録製番単独・AND検索は維持）。資源CD単独だと対象アイテムが多すぎてPi4で動作が緩慢になる問題を解決
- **検索条件の必須化**: 登録製番（`q`パラメータ）が必須となり、資源CDのみでは検索されない

**解決状況**: ✅ **解決済み**（2026-01-28）

**実機検証**:
- ✅ ローカルテスト完了（統合テスト成功）
- ✅ GitHub Actions CI成功
- ✅ デプロイ成功（Pi5/Pi4/Pi3）
- ✅ 実機検証完了（2026-01-28）:
  - 複数キオスク間での検索状態共有が正常に動作することを確認
  - 資源CD単独検索の無効化が正常に動作することを確認（検索結果が空になる）
  - 登録製番単独・AND検索が正常に動作することを確認
  - Pi4での動作速度が改善され、軽快に動作することを確認

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`（共有キー導入、フォールバック機能実装）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（共有動作の検証テスト追加）
- `docs/plans/production-schedule-kiosk-execplan.md`（進捗追記）

**関連KB**:
- [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索): 検索状態同期機能の初期実装（location単位）
- [KB-210](./api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正): 検索状態共有機能の回帰修正

---

### [KB-210] 生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正

**実装日時**: 2026-01-28

**事象**: 
- 検索登録された製番が端末間で共有できなくなっていた
- 以前のフェーズでは端末間で共有されていたが、現在は共有されない状態になっていた

**要因**: 
- KB-209で実装された検索状態共有機能（`search-state`エンドポイント使用）が、その後`search-history`エンドポイント + ローカル状態管理に変更されていた
- フロントエンド（`ProductionSchedulePage.tsx`）が`useKioskProductionScheduleSearchHistory`を使用し、コメントに「検索実行は端末ローカルで管理」と記載されていた
- `search-history`エンドポイントは端末別（`locationKey`）で保存するため、端末間で共有されない
- `activeQueries`（登録製番）が共有対象に含まれていなかった

**調査結果**:
- git履歴を確認: `6f44e48 fix: share search history only by location` などで変更が行われていた
- 以前のフェーズでは`search-state`エンドポイント（共有キー`'shared'`）を使用していた
- ドキュメント（`docs/plans/production-schedule-kiosk-execplan.md`）に以前の共有実装の記録が残っていた

**有効だった対策**: 
- ✅ **仕様確定（2026-01-28）**: 共有対象を**history（登録製番リスト）のみ**に限定。押下状態・資源フィルタは端末ローカルで管理。ローカルでの履歴削除は`hiddenHistory`（localStorage）で管理し、共有される`history`には影響しない。
- ✅ **API側の修正（2026-01-28）**:
  1. `search-state`のGET/PUTで**historyのみ**を保存・返却（`state: { history }`に統一）
  2. 「割当済み資源CD」は製番未入力でも単独検索可とするよう検索ロジックを調整（資源CD単独は従来どおり不可、割当済み資源CD単独は許可）
  3. デバッグログコード・未使用変数の削除
- ✅ **フロントエンドの修正（2026-01-28）**:
  1. `useKioskProductionScheduleSearchHistory` → `useKioskProductionScheduleSearchState` に変更し、`search-state`でhistoryを端末間同期
  2. ローカルでの履歴削除は`hiddenHistory`（`useLocalStorage(SEARCH_HISTORY_HIDDEN_KEY)`）で管理し、表示時は`history`から`hiddenHistory`に含まれるものを除外
  3. デバッグログコードを削除

**実装の詳細**:
- **API** (`apps/api/src/routes/kiosk.ts`): GET `/kiosk/production-schedule/search-state` は `{ state: { history }, updatedAt }` のみ返却。PUT は `body.state.history` のみ受け取り、既存stateの`history`とマージして保存。検索APIは製番なしで`resourceAssignedOnlyCds`のみ指定された場合は単独検索を許可（`textConditions.length === 0`かつ`assignedOnlyCds.length > 0`の場合は早期returnしない）。
- **フロント** (`apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`): `useKioskProductionScheduleSearchState`で共有historyを取得・更新。表示用の履歴は`history`のうち`hiddenHistory`に含まれないもの。ローカル削除時は`setHiddenHistory`で当該製番を`hiddenHistory`に追加するのみで、`search-state`のPUTは呼ばない。

**学んだこと**:
- **git履歴の重要性**: 以前の実装を確認することで、回帰の原因を特定できる
- **ドキュメントの重要性**: ExecPlanに以前の実装記録が残っていたため、原因特定が容易だった
- **エンドポイントの使い分け**: `search-history`は端末別、`search-state`は共有用（history専用）として設計
- **共有範囲の限定**: 登録製番（history）のみ端末間共有し、押下状態・資源フィルタ・ローカル削除は端末ローカルにすることで、意図しない上書きを防ぐ
- **最小変更の原則**: 既存の`search-state`エンドポイント（共有キー`'shared'`）をそのまま使用し、保存・返却をhistoryのみに統一することで最小変更で対応

**解決状況**: ✅ **解決済み**（2026-01-28）

**実機検証**:
- ✅ ローカルテスト完了（統合テスト成功）
- ✅ GitHub Actions CI成功（全ジョブ成功）
- ✅ デプロイ成功（Pi5）
- ✅ 実機検証完了（2026-01-28）:
  - 端末Aで製番を検索登録 → 数秒以内に端末Bに反映されることを確認
  - `GET /api/kiosk/production-schedule/search-state`で`state.history`のみが返り端末間で共有されることを確認
  - 割当済み資源CDのみで検索可能であることを確認
  - ローカルでの履歴削除が他端末の表示に影響しないことを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（`search-state`でhistory同期、`hiddenHistory`でローカル削除管理）
- `apps/api/src/routes/kiosk.ts`（search-stateはhistory専用、割当済み資源CD単独検索許可）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（統合テストで共有動作を検証）

**関連KB**:
- [KB-209](./api.md#kb-209-生産スケジュール検索状態の全キオスク間共有化): 検索状態共有機能の初期実装（共有キー導入）
- [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索): 検索状態同期機能の初期実装（location単位）

---

### [KB-211] 生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入）

**実装日時**: 2026-02-03

**事象**:
- 登録製番の削除がすぐ復活する
- 追加が反映されない、または揺れる

**要因**:
- `search-state` が **全量PUT** で保存され、**競合制御がない**ため、複数端末/複数タブの更新が **last-write-wins** で巻き戻る
- サイネージは shared state を読んで描画するため、shared が揺れると表示も安定しない

**対策**:
- ✅ **ETag/If-Match（楽観ロック）必須化**:
  - `GET /kiosk/production-schedule/search-state` の `ETag` を **If-Match** として `PUT` に必須で送る
  - 一致しない更新は **409 Conflict** で拒否し、最新state/updatedAt/etagを返却
- ✅ **フロントは自動再試行**:
  - 409時に最新stateへ操作（add/remove）を再適用して再PUT

**実装の詳細**:
- **API** (`apps/api/src/routes/kiosk.ts`)
  - `GET /kiosk/production-schedule/search-state` が `ETag` を返却
  - `PUT /kiosk/production-schedule/search-state` は `If-Match` 必須化、CAS更新、409で最新stateを返却
- **フロント** (`apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`)
  - 追加/削除を操作単位でCAS更新
  - 409時は最新を取得して再適用
- **APIテスト** (`apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`)
  - If-Match必須・409競合の再現テスト

**実機検証の注意**:
- デプロイ後は **Pi4の `kiosk-browser.service` を再起動**して旧JSを排除
- Macブラウザは **古いタブを閉じて再読込**

**実機検証結果（2026-02-03）**:
- ✅ **登録製番同期**: 正常動作（複数端末間で同期が取れている）
- ✅ **登録操作**: 正常動作（追加が即座に反映され、巻き戻らない）
- ✅ **削除操作**: 正常動作（削除が即座に反映され、復活しない）
- ✅ **サイネージ反映**: 正常動作（生産スケジュールコンテンツへの反映が正常）

**解決状況**: ✅ **解決済み**（2026-02-03）

---

### [KB-212] 生産スケジュール行ごとの備考欄追加機能

**実装日時**: 2026-01-29

**事象**: 
- 生産スケジュールの各行に現場リーダーが備考を記入できる機能が必要
- 備考はlocation単位で管理し、同一locationの端末間で共有される必要がある

**要因**: 
- 生産スケジュールの各行に備考を記入する機能が実装されていなかった
- 現場での作業指示や注意事項を記録する手段がなかった

**有効だった対策**: 
- ✅ **備考欄追加機能（2026-01-29）**:
  1. **新規テーブル追加**: `ProductionScheduleRowNote`テーブルを追加（`csvDashboardRowId` + `location` + `note`（100文字以内））
  2. **一意制約**: `@@unique([csvDashboardRowId, location])`で同一行・同一locationでの重複を防止
  3. **APIエンドポイント追加**: `PUT /kiosk/production-schedule/:rowId/note`で備考の保存・削除
  4. **バリデーション**: 100文字以内・改行不可の制限を実装
  5. **フロントエンド実装**: `ProductionSchedulePage.tsx`に備考編集機能を追加（インライン編集、Enter/Escapeキー対応）

**実装の詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
// 備考の保存・削除
app.put('/kiosk/production-schedule/:rowId/note', async (request) => {
  const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
  const locationKey = resolveLocationKey(clientDevice);
  const params = productionScheduleNoteParamsSchema.parse(request.params);
  const body = productionScheduleNoteBodySchema.parse(request.body);

  const note = body.note.slice(0, 100).trim();
  if (note.length === 0) {
    // 空文字の場合は削除
    await prisma.productionScheduleRowNote.deleteMany({
      where: {
        csvDashboardRowId: row.id,
        location: locationKey,
      },
    });
    return { success: true, note: null };
  }
  
  // upsertで保存
  await prisma.productionScheduleRowNote.upsert({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: row.id,
        location: locationKey,
      },
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      location: locationKey,
      note,
    },
    update: { note },
  });
  return { success: true, note };
});
```

```typescript
// apps/web/src/pages/kiosk/ProductionSchedulePage.tsx
const NOTE_MAX_LENGTH = 100;

const startNoteEdit = (rowId: string, currentNote: string | null) => {
  setEditingNoteRowId(rowId);
  setEditingNoteValue(currentNote ?? '');
};

const saveNote = (rowId: string) => {
  const value = editingNoteValue.replace(/\r?\n/g, '').trim().slice(0, NOTE_MAX_LENGTH);
  noteMutation.mutate(
    { rowId, note: value || null },
    {
      onSuccess: () => {
        cancelNoteEdit();
        scheduleQuery.refetch();
      },
    }
  );
};
```

**学んだこと**:
- **location単位の管理**: 備考はlocation単位で管理することで、同一locationの端末間で共有され、異なるlocation間では独立して管理できる
- **インライン編集**: テーブル内で直接編集できるUIを実装することで、操作性が向上する
- **改行削除**: フロントエンド側で改行を削除することで、100文字以内の制限と改行不可の制限を両立できる
- **空文字の扱い**: 空文字の場合は削除することで、備考をクリアする操作を直感的に実現できる

**解決状況**: ✅ **解決済み**（2026-01-29）

**実機検証**:
- ✅ 統合テスト成功（備考の保存・削除・取得が正常に動作）
- ✅ GitHub Actions CI成功
- ✅ デプロイ成功（Pi5/Pi4/Pi3）
- ✅ 実機検証完了（2026-01-29）:
  - 備考の保存・削除が正常に動作することを確認
  - 100文字以内の制限が正常に動作することを確認
  - 改行が削除されることを確認
  - location単位で管理されることを確認
  - インライン編集が正常に動作することを確認（Enter/Escapeキー対応）

**関連ファイル**:
- `apps/api/prisma/schema.prisma`（`ProductionScheduleRowNote`モデル追加）
- `apps/api/prisma/migrations/20260129120000_add_production_schedule_row_note/migration.sql`（マイグレーション）
- `apps/api/src/routes/kiosk.ts`（備考保存・削除エンドポイント実装）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（統合テスト追加）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（備考編集UI実装）
- `apps/web/src/api/hooks.ts`（`useUpdateKioskProductionScheduleNote`フック追加）

**関連KB**:
- [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索): 生産スケジュール機能の拡張（資源CDフィルタ・加工順序割当・検索状態同期）

---

### [KB-215] Gmail OAuthリフレッシュトークンの7日間制限問題（未検証アプリ）

**日付**: 2026-01-29

**事象**:
- Gmail OAuth認証が約1週間で切れてしまい、手動で再認証が必要になる
- 管理コンソール → Gmail設定 → OAuth認証を手動で実行すれば使えるようになるが、運用負荷が高い

**要因**:
- Google Cloud Consoleでアプリが「**本番モード（Production）**」だが「**未検証**」状態だった
- Googleの仕様により、**未検証のアプリ**（機密性の高いスコープを使用）はリフレッシュトークンが**7日間で期限切れ**になる
- 検証済みのアプリはリフレッシュトークンが**無期限**（6ヶ月間未使用で失効）
- 当初「テストモード vs 本番モード」が原因と推測したが、実際は「**検証済み vs 未検証**」が問題だった

**仕様（Googleの制限）**:
| アプリの状態 | リフレッシュトークン有効期間 |
|---|---|
| 未検証（テストモードまたは本番モード） | **7日間** |
| 検証済み（本番モード） | **無期限**（6ヶ月間未使用で失効） |

**解決策（検証を完了する手順）**:
1. **Google Cloud Console** → **Google Auth Platform** → **ブランディング** にアクセス
2. 以下の情報を入力:
   - **アプリケーションのホームページ**: `https://denkoushi.github.io/RaspberryPiSystem_002/`
   - **プライバシーポリシーリンク**: `https://denkoushi.github.io/RaspberryPiSystem_002/privacy-policy.html`
   - **承認済みドメイン**: `denkoushi.github.io` を追加
3. 「保存」をクリック
4. **検証センター** → 「**問題は修正した**」または「**検出された問題は正しくないと思う**」を選択して検証をリクエスト
5. Googleの審査を待つ（数日〜数週間）

**GitHub Pages用ファイル（作成済み）**:
- `docs/index.html`: アプリケーションのホームページ（プライバシーポリシーへのリンク含む）
- `docs/privacy-policy.html`: プライバシーポリシーページ

**GitHub Pagesの設定手順**:
1. GitHubリポジトリ → **Settings** → **Pages**
2. **Source**: `main` ブランチ、`/docs` フォルダを選択
3. **Save** をクリック
4. 数分後、`https://denkoushi.github.io/RaspberryPiSystem_002/` でアクセス可能

**検証リクエスト時の注意点**:
- 「ウェブサイトが登録されていません」エラー: GitHub Pagesのドメイン所有権確認が求められる場合がある
- **対処法1**: 「検出された問題は正しくないと思う」を選択し、GitHub Pagesを使用していることを説明
- **対処法2**: Google Search Consoleでドメイン所有権を確認（HTMLメタタグを`index.html`に追加）

**現在の状況**: 🔄 **検証リクエスト中**（2026-01-29）
- プライバシーポリシーページとホームページを作成・公開済み
- Google Cloud Consoleでブランディング情報を入力・保存済み
- 検証センターで「検出された問題は正しくないと思う」を選択してリクエスト済み
- Googleの審査待ち

**検証完了後の手順**:
1. 検証が完了したら、管理コンソール → Gmail設定 → 「**OAuth認証**」を1回実行
2. 以後は自動リフレッシュで運用可能（手動再認証不要）

**学んだこと**:
- Google OAuthの7日間制限は「テストモード」だけでなく「未検証アプリ」にも適用される
- 自分だけが使うアプリでも、機密性の高いスコープ（`gmail.readonly`, `gmail.modify`）を使用する場合は検証が必要
- GitHub Pagesで簡易的なプライバシーポリシーページを公開することで検証要件を満たせる

**関連ファイル**:
- `docs/index.html`（GitHub Pages用ホームページ）
- `docs/privacy-policy.html`（GitHub Pages用プライバシーポリシー）
- `apps/api/src/services/backup/gmail-oauth.service.ts`（Gmail OAuth実装）
- `apps/api/src/routes/gmail/oauth.ts`（Gmail OAuthルート）

**関連KB**:
- [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる): Gmail OAuthのinvalid_grantエラー対応（再認可導線の整備）
- [KB-123](./api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了): Gmail経由CSV取り込みの初期実装
- [KB-229](./api.md#kb-229-gmail認証切れ時のslack通知機能追加): Gmail認証切れ時のSlack通知機能追加
- [KB-230](./api.md#kb-230-gmail認証切れの実機調査と回復): Gmail認証切れの実機調査と回復

---

### [KB-229] Gmail認証切れ時のSlack通知機能追加

**日付**: 2026-02-06

**Context**:
- CSVインポート定期実行時にGmail認証切れが発生しても、管理者に通知されず、CSV取り込みが失敗し続けていた
- 手動実行時はエラーメッセージが返るが、定期実行時はログに記録されるのみで、運用者が気づきにくかった

**Symptoms**:
- CSVインポートスケジュールの実行履歴で連続失敗が発生
- エラーメッセージ: `"Gmailの再認可が必要です（invalid_grant）"`
- Gmailの受信ボックスに未読メールが蓄積（CSV取り込みが失敗している）

**Investigation**:
- CSVインポート履歴（`/api/imports/schedule/csv-import-measuringinstrumentloans/history`）を確認
- 最後の10回のスケジュール実行がすべて`FAILED`状態
- エラーメッセージはすべて`"Gmailの再認可が必要です（invalid_grant）"`
- Gmail OAuth設定（`/api/gmail/config`）で`accessToken`と`refreshToken`が`False`を確認
- 最後の成功実行は`2026-02-05T12:00:00Z`（21:00 JST）で、その後すべて失敗

**Root cause**:
- Gmail OAuth認証トークン（accessToken/refreshToken）が期限切れまたは無効化されていた
- 定期実行時のエラーがSlackに通知されていなかったため、運用者が気づくのが遅れた

**Fix**:
- CSVインポートスケジューラー（`CsvImportScheduler`）にGmail認証切れ検知機能を追加
- 定期実行時（`isManual: false`）に`GmailReauthRequiredError`または`invalid_grant`エラーを検知
- 検知時にAlerts Platform経由でSlack通知を送信
- アラートタイプ: `gmail-oauth-expired`
- ルーティング: `ops`チャンネル（`#rps-ops`）
- メッセージ: 「Gmail認証が切れています。管理コンソールの「OAuth認証」を実行してください。」
- 重複抑制: fingerprintベースのdedupeで連続通知を抑制（1回のみ通知）
- 手動実行時は通知しない（定期実行のみ）

**Prevention**:
- 定期実行時のGmail認証切れを自動検知し、Slack通知で運用者に即座に通知
- dedupeにより、同じエラーが連続発生しても1回のみ通知され、運用ノイズを削減
- アラート生成の失敗はログに記録するが、インポート処理を中断しない（エラー処理の堅牢性）

**実装ファイル**:
- `apps/api/src/services/imports/csv-import-scheduler.ts`: Gmail認証切れ検知とアラート生成ロジック
- `apps/api/src/services/alerts/alerts-config.ts`: `gmail-oauth-expired`のルーティング設定
- `apps/api/src/services/imports/__tests__/csv-import-scheduler.test.ts`: テストコード追加

**関連KB**:
- [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる): Gmail OAuthのinvalid_grantエラー対応（再認可導線の整備）
- [KB-215](./api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ): Gmail OAuthリフレッシュトークンの7日間制限問題
- [KB-230](./api.md#kb-230-gmail認証切れの実機調査と回復): Gmail認証切れの実機調査と回復

**解決状況**: ✅ **実装完了・デプロイ完了**（2026-02-06）

---

### [KB-230] Gmail認証切れの実機調査と回復

**日付**: 2026-02-06

**Context**:
- Pi3のサイネージ右ペイン（計測機器持出返却）が更新されていない
- Gmailの受信ボックスにメールが残っており、CSV取り込みが失敗している可能性

**Symptoms**:
- サイネージ右ペイン（計測機器持出返却）に最新データが表示されない
- Gmailの受信ボックスに未読メールが蓄積
- CSVインポートスケジュールの実行履歴で連続失敗が発生
- エラーメッセージ: `"Gmailの再認可が必要です（invalid_grant）"`

**Investigation**:
1. **CSVインポート履歴の確認**:
   - `/api/imports/schedule/csv-import-measuringinstrumentloans/history`を確認
   - 最後の10回のスケジュール実行がすべて`FAILED`状態
   - エラーメッセージはすべて`"Gmailの再認可が必要です（invalid_grant）"`

2. **Gmail OAuth設定の確認**:
   - `/api/gmail/config`を確認
   - `accessToken`: `False`
   - `refreshToken`: `False`
   - `clientId`: `True`
   - `clientSecret`: `True`

3. **最後の成功実行時刻の確認**:
   - 最後の成功実行: `2026-02-05T12:00:00Z`（21:00 JST）
   - その後、すべての実行が失敗

4. **今日の貸出イベント数の確認**:
   - `/api/measuring-instruments/loan-events/today-borrowed`: 0件
   - CSV取り込みが失敗しているため、データが更新されていない

**Root cause**:
- Gmail OAuth認証トークン（accessToken/refreshToken）が期限切れまたは無効化されていた
- KB-215で説明されている7日間制限問題により、リフレッシュトークンが無効化された可能性

**Fix**:
- 管理コンソール → Gmail設定 → 「OAuth認証」を実行してGmailの再認可を実施
- 再認可後、手動実行でCSV取り込みをテスト
- 手動実行で189行が正常に追加されることを確認
- ただし、今日の貸出イベント数は0件（CSVの日付が今日の日付ではないため）

**Prevention**:
- KB-229で実装したSlack通知機能により、今後はGmail認証切れを自動検知して通知
- 定期実行時に認証切れが発生した場合、`#rps-ops`チャンネルにSlack通知が送信される
- dedupeにより、連続通知を抑制し、運用ノイズを削減

**学んだこと**:
- Gmail認証切れは定期的に発生する可能性があるため、自動検知と通知機能が重要
- 手動実行時はエラーメッセージが返るが、定期実行時はログに記録されるのみで気づきにくい
- Slack通知により、運用者が即座に問題を把握できるようになった

**関連KB**:
- [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる): Gmail OAuthのinvalid_grantエラー対応（再認可導線の整備）
- [KB-215](./api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ): Gmail OAuthリフレッシュトークンの7日間制限問題
- [KB-229](./api.md#kb-229-gmail認証切れ時のslack通知機能追加): Gmail認証切れ時のSlack通知機能追加

**解決状況**: ✅ **調査完了・回復完了**（2026-02-06）

---

### [KB-231] 生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化

**日付**: 2026-02-06

**Context**:
- 生産スケジュールの登録製番上限が8件に制限されており、より多くの製番を登録・表示したい要望があった
- サイネージに20件を表示する場合、現在のカード高さでは画面に収まらないため、カード高さを最適化する必要があった

**Symptoms**:
- キオスクの生産スケジュール画面で、登録製番が8件を超えると追加できない
- APIのバリデーションで`max(8)`が設定されており、9件目以降が拒否される
- サイネージに20件を表示する場合、カードが大きすぎて画面に収まらない

**Investigation**:
1. **API側の制限確認**:
   - `apps/api/src/routes/kiosk.ts`のZodスキーマで`activeQueries`と`history`が`max(8)`に設定されている
   - `normalizeSearchHistory`関数で`slice(0, 8)`が実行されている
2. **フロントエンド側の制限確認**:
   - `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`の`normalizeHistoryList`と`toggleHistoryQuery`で`slice(0, 8)`が実行されている
3. **サイネージ側の制限確認**:
   - `apps/api/src/services/visualization/data-sources/production-schedule/production-schedule-data-source.ts`の`normalizeHistory`で`slice(0, 8)`が実行されている
   - `apps/api/src/services/visualization/renderers/progress-list/progress-list-renderer.ts`の`minCardHeight`が`210 * scale`に設定されており、20件表示には大きすぎる
4. **初回実装の問題**:
   - 最初はサイネージ側（データソースとレンダラー）のみを変更したが、キオスクUI側の制限が残っていた
   - APIのバリデーションとフロントエンドの正規化ロジックが8件のままだったため、キオスクで20件登録できなかった

**Root cause**:
- 登録製番上限が複数箇所（APIバリデーション、API正規化、フロントエンド正規化、サイネージデータソース）に分散しており、一部のみを変更しても全体が機能しなかった
- サイネージのカード高さが20件表示に適していなかった

**Fix**:
1. **API側の変更**:
   - `apps/api/src/routes/kiosk.ts`のZodスキーマで`activeQueries`と`history`を`max(20)`に変更
   - `normalizeSearchHistory`関数で`slice(0, 20)`に変更
2. **フロントエンド側の変更**:
   - `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`の`normalizeHistoryList`と`toggleHistoryQuery`で`slice(0, 20)`に変更
3. **サイネージ側の変更**:
   - `apps/api/src/services/visualization/data-sources/production-schedule/production-schedule-data-source.ts`の`normalizeHistory`で`slice(0, 20)`に変更（既に実施済み）
   - `apps/api/src/services/visualization/renderers/progress-list/progress-list-renderer.ts`の`minCardHeight`を`105 * scale`（210の半分）に変更
   - カードスケールの基準値も`130 * scale`（260の半分）に変更
4. **テスト追加**:
   - `apps/api/src/services/visualization/__tests__/progress-list-renderer.test.ts`に20件表示のテストケースを追加
   - `apps/api/src/services/visualization/data-sources/production-schedule/__tests__/production-schedule-data-source.test.ts`に20件制限のテストケースを追加

**Prevention**:
- 制限値が複数箇所に分散している場合は、すべての箇所を同時に更新する必要があることを認識
- サイネージのカード高さは表示件数に応じて調整可能にする設計を維持
- テストで上限値の動作を検証し、変更漏れを防止

**実装ファイル**:
- `apps/api/src/routes/kiosk.ts`: Zodスキーマと`normalizeSearchHistory`関数の上限変更
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`: フロントエンド側の上限変更
- `apps/api/src/services/visualization/data-sources/production-schedule/production-schedule-data-source.ts`: サイネージデータソースの上限変更（既に実施済み）
- `apps/api/src/services/visualization/renderers/progress-list/progress-list-renderer.ts`: サイネージレンダラーのカード高さ最適化
- `apps/api/src/services/visualization/__tests__/progress-list-renderer.test.ts`: 20件表示のテスト追加
- `apps/api/src/services/visualization/data-sources/production-schedule/__tests__/production-schedule-data-source.test.ts`: 20件制限のテスト追加

**関連KB**:
- [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索): 生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）
- [KB-209](./api.md#kb-209-生産スケジュール検索状態の全キオスク間共有化): 生産スケジュール検索状態の全キオスク間共有化
- [KB-210](./api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正): 生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正
- [KB-228](./infrastructure/signage.md#kb-228-生産スケジュールサイネージデザイン修正タイトルkpi配置パディング統一): 生産スケジュールサイネージデザイン修正

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了・動作確認完了**（2026-02-06）

---

### [KB-242] history-progressエンドポイント追加と製番進捗集計サービス

**実装日時**: 2026-02-10

**Context**:
- キオスクの生産スケジュール画面で、登録製番の×削除ボタンを進捗に応じて白/グレー白縁に切替える機能を実装する必要があった
- サイネージの`ProductionScheduleDataSource`は既に製番進捗を集計していたが、キオスクUI用のエンドポイントがなかった

**Decision**:
- `SeibanProgressService`を新設し、既存の製番進捗集計SQLを移植
- `GET /kiosk/production-schedule/history-progress`エンドポイントを追加（shared historyから進捗マップを返す）
- `ProductionScheduleDataSource`を`SeibanProgressService`を利用するように切替（重複ロジック排除）

**実装内容**:
1. **SeibanProgressService**: `progressBySeiban(fseibans: string[])`メソッドで、指定された製番リストに対する進捗マップ（`{ [fseiban]: { completed, total, pct } }`）を返す
2. **history-progressエンドポイント**: shared `search-state`の`history`から製番リストを取得し、`SeibanProgressService`で進捗を集計して返す
3. **ProductionScheduleDataSource**: 自前のSQLを削除し、`SeibanProgressService`を利用するように変更

**レスポンス形式**:
```json
{
  "progressBySeiban": {
    "ABC12345": { "completed": 3, "total": 3, "pct": 100 },
    "DEF67890": { "completed": 1, "total": 2, "pct": 50 }
  }
}
```

**テスト**:
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`にhistory-progressエンドポイントの統合テストを追加

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了・キオスク動作検証OK**（2026-02-10）

**関連KB**:
- [KB-242](./frontend.md#kb-242-生産スケジュール登録製番削除ボタンの進捗連動ui改善): 生産スケジュール登録製番削除ボタンの進捗連動UI改善（フロントエンド側）

---

### [KB-246] Gmailゴミ箱自動削除機能（深夜バッチ）

**実装日時**: 2026-02-10

**Context**:
- CSVダッシュボード取り込みで処理済みメールをゴミ箱へ移動する機能は実装済みだったが、ゴミ箱内のメールが蓄積され続ける問題があった
- Gmail APIには`users.trash.empty`のような一括削除APIが存在しないため、個別に削除する必要があった
- ユーザーが手動で削除したメールと区別するため、処理済みメールにラベルを付与する必要があった

**Symptoms**:
- CSV取り込み後にゴミ箱へ移動したメールが蓄積され続ける
- 手動で削除する必要があり、運用負荷が高い
- ゴミ箱の容量が増加し続ける

**Investigation**:
1. **Gmail APIの調査**:
   - `users.trash.empty`のような一括削除APIは存在しない
   - `users.messages.delete`で個別に完全削除する必要がある
   - `users.messages.list`でゴミ箱内のメールを検索可能（`label:TRASH`）
2. **削除タイミングの検討**:
   - 当初は「30分後に自動削除」を検討したが、Gmail検索演算子の`older_than`は分単位をサポートしない
   - カスタムラベル（`rps_processed`）を付与し、ゴミ箱移動時にラベルを付与することで処理済みメールを識別可能に
   - 深夜バッチで`in:trash label:rps_processed`を全削除する方式に変更
3. **スケジューリングの検討**:
   - `node-cron`を使用して深夜（デフォルト: 3:00 JST）に1日1回実行
   - 既存の`CsvImportScheduler`と同様のパターンを採用

**Root cause**:
- Gmail APIに一括削除APIが存在しない
- 処理済みメールを識別する仕組みがなかった
- 自動削除のスケジューリング機能がなかった

**Fix**:
1. **ラベル管理機能の追加** (`apps/api/src/services/backup/gmail-api-client.ts`):
   - `findLabelIdByName(labelName: string): Promise<string | undefined>`: 既存ラベルの検索
   - `ensureLabel(labelName: string): Promise<string>`: ラベルの作成（存在しない場合）
   - `trashMessage`メソッドを修正し、ゴミ箱移動前に`rps_processed`ラベルを付与
2. **ゴミ箱クリーンアップ機能の追加** (`apps/api/src/services/backup/gmail-api-client.ts`):
   - `cleanupProcessedTrash(params?: { processedLabelName?: string; }): Promise<GmailTrashCleanupResult>`: ゴミ箱内の処理済みメールを検索して削除
   - Gmail検索クエリ: `in:trash label:rps_processed`
   - 検索結果の各メールを`users.messages.delete`で完全削除
3. **サービス層の追加** (`apps/api/src/services/gmail/gmail-trash-cleanup.service.ts`):
   - `GmailTrashCleanupService`: 設定読み込み、`GmailStorageProvider`の解決、クリーンアップ実行
   - Gmail設定が不完全な場合はスキップ
4. **スケジューラーの追加** (`apps/api/src/services/gmail/gmail-trash-cleanup.scheduler.ts`):
   - `GmailTrashCleanupScheduler`: `node-cron`を使用して深夜に実行
   - 環境変数で有効/無効、実行時刻、ラベル名を設定可能
5. **環境変数の追加** (`apps/api/src/config/env.ts`):
   - `GMAIL_TRASH_CLEANUP_ENABLED`（デフォルト: `true`）
   - `GMAIL_TRASH_CLEANUP_CRON`（デフォルト: `0 3 * * *`）
   - `GMAIL_TRASH_CLEANUP_LABEL`（デフォルト: `rps_processed`）
6. **メインアプリケーションへの統合** (`apps/api/src/main.ts`):
   - `GmailTrashCleanupScheduler`を起動（`csvImportScheduler.start()`の後）
   - グレースフルシャットダウン時にスケジューラーを停止

**Prevention**:
- 環境変数で動作を制御可能にし、必要に応じて無効化可能
- ラベル名を環境変数で設定可能にし、運用要件に応じて調整可能
- ユニットテストでラベル管理とクリーンアップロジックを検証

**実装ファイル**:
- `apps/api/src/services/backup/gmail-api-client.ts`: ラベル管理とゴミ箱クリーンアップ機能
- `apps/api/src/services/backup/storage/gmail-storage.provider.ts`: `cleanupProcessedTrash`メソッドの追加
- `apps/api/src/services/gmail/gmail-trash-cleanup.service.ts`: サービス層
- `apps/api/src/services/gmail/gmail-trash-cleanup.scheduler.ts`: スケジューラー
- `apps/api/src/config/env.ts`: 環境変数定義
- `apps/api/src/main.ts`: スケジューラーの起動・停止
- `apps/api/src/services/backup/__tests__/gmail-api-client.test.ts`: ユニットテスト追加
- `apps/api/src/services/gmail/__tests__/gmail-trash-cleanup.service.test.ts`: サービス層のユニットテスト
- `docs/guides/gmail-setup-guide.md`: ドキュメント更新

**学んだこと**:
- Gmail APIには一括削除APIが存在しないため、検索→個別削除のパターンが必要
- カスタムラベルを使用することで、アプリが処理したメールを識別可能に
- Gmail検索演算子の`older_than`は分単位をサポートしないため、分単位条件を要件にする場合は別実装が必要
- `node-cron`を使用したスケジューリングは、既存の`CsvImportScheduler`と同様のパターンで実装可能

**関連KB**:
- [KB-123](./api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了): Gmail経由CSV取り込み（手動実行）の実機検証完了
- [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる): Gmail OAuthのinvalid_grantでCSV取り込みが500になる
- [KB-229](./api.md#kb-229-gmail認証切れ時のslack通知機能追加): Gmail認証切れ時のSlack通知機能追加

**関連ドキュメント**:
- [docs/guides/gmail-setup-guide.md](../guides/gmail-setup-guide.md#4-ゴミ箱自動削除深夜1回): Gmailセットアップガイド（ゴミ箱自動削除セクション）

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了**（2026-02-10）

---

### [KB-248] 生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化）

**実装日時**: 2026-02-11

**事象**: 
- 生産スケジュール検索画面で、資源CDの検索ボタン（資源CDピルボタン群）が表示されるまでに時間がかかるようになった
- ページマウント時に資源CDボタンが表示されず、数秒〜数十秒待たされる体感があった

**要因**: 
- **根本原因**: `GET /kiosk/production-schedule/resources` エンドポイントの実行時間が約29秒と非常に遅かった
- **直接原因**: コミット `fb95b9c`（2026-02-10）で `buildMaxProductNoWinnerCondition`（相関サブクエリ）が `resources` エンドポイントに追加され、DB負荷が増加
- **技術的詳細**:
  1. 資源CDボタン群は `resourcesQuery` の結果で描画されるため、API応答が遅いと「ボタン登場」が遅くなる
  2. `buildMaxProductNoWinnerCondition` は行ごとに「同一論理キーの中で最大ProductNoの行ID」を選ぶ相関サブクエリで、`CsvDashboardRow` 全件に対して実行される
  3. 相関サブクエリ内で `Seq Scan` が発生し、7,211行のループで各2行をスキャン（合計約14,422行スキャン）
  4. `rowData->>'FSIGENCD'` に対する式インデックスが存在せず、`DISTINCT/ORDER BY` もフルスキャンに依存

**Investigation**:
1. **仮説1: scheduleQueryの応答遅延** → REJECTED（検索時のみ実行、初期表示には影響しない）
2. **仮説2: search-state/history-progressの遅延** → REJECTED（KB-247でhistory-progressは30秒に変更済み、search-stateはシンプルなPK検索）
3. **仮説3: UIの待機条件** → REJECTED（ツールバーは`resourcesQuery`に依存せず即時レンダリング）
4. **仮説4: 資源CDピルの描画待ち** → CONFIRMED（`resourcesQuery.data`が来るまで何も表示されない）
5. **仮説5: resources APIの重いクエリ** → CONFIRMED（`EXPLAIN (ANALYZE, BUFFERS)`で約29秒を確認）

**Root cause**:
- `buildMaxProductNoWinnerCondition` の相関サブクエリ内で `Seq Scan` が発生し、7,211行のループで各2行をスキャン
- `rowData->>'FSIGENCD'` に対する式インデックスが存在せず、`DISTINCT/ORDER BY` もフルスキャンに依存
- 相関サブクエリのプランナーが部分インデックスを十分に活用できず、非部分インデックスが必要だった

**Fix**:
1. **式インデックス追加（2026-02-11）**:
   - `csv_dashboard_row_prod_schedule_resource_cd_idx`: 資源CD抽出用（部分インデックス、NULL/空文字除外）
   - `csv_dashboard_row_prod_schedule_logical_key_idx`: 論理キー一致用（部分インデックス）
   - `csv_dashboard_row_prod_schedule_winner_lookup_idx`: winner探索+ORDER BY対応（部分インデックス）
   - `csv_dashboard_row_winner_lookup_global_idx`: 相関サブクエリ用（非部分インデックス、プランナーが確実に拾うため）

2. **計測による検証**:
   - 本番DBで `EXPLAIN (ANALYZE, BUFFERS)` を取得し、ボトルネックを特定
   - 変更前: `Execution Time: 29299.650 ms`（約29.3秒）
   - 変更後: `Execution Time: 81.947 ms`（約0.082秒）
   - **改善率: 約357倍高速化**

3. **マイグレーション実装**:
   - `apps/api/prisma/migrations/20260211123000_add_prod_schedule_expr_indexes/migration.sql`
   - `IF NOT EXISTS` で安全に適用可能
   - 本番DBには直接DDL適用済み、リポジトリにはマイグレーションファイルとして記録

**実装の詳細**:
```sql
-- 資源CD抽出用（部分インデックス）
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_prod_schedule_resource_cd_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    ("rowData"->>'FSIGENCD')
  )
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND ("rowData"->>'FSIGENCD') IS NOT NULL
    AND ("rowData"->>'FSIGENCD') <> '';

-- 相関サブクエリ用（非部分インデックス、プランナーが確実に拾うため）
CREATE INDEX IF NOT EXISTS "csv_dashboard_row_winner_lookup_global_idx"
  ON "CsvDashboardRow" (
    "csvDashboardId",
    (COALESCE("rowData"->>'FSEIBAN', '')),
    (COALESCE("rowData"->>'FHINCD', '')),
    (COALESCE("rowData"->>'FSIGENCD', '')),
    (COALESCE("rowData"->>'FKOJUN', '')),
    (CASE
      WHEN ("rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("rowData"->>'ProductNo'))::bigint
      ELSE -1
    END) DESC,
    "createdAt" DESC,
    "id" DESC
  );
```

**Prevention**:
- パフォーマンス問題の早期発見: 新規機能追加時は `EXPLAIN (ANALYZE, BUFFERS)` で実行計画を確認
- 相関サブクエリの使用時は、プランナーがインデックスを拾えるよう非部分インデックスも検討
- 式インデックスの活用: JSONBカラムからの抽出値でWHERE/ORDER BYする場合は式インデックスを検討
- CIでの自動検証: マイグレーションファイルはCIで自動検証されるため、構文エラーは早期発見可能

**学んだこと**:
- **相関サブクエリとインデックス**: 相関サブクエリ内では、部分インデックスが十分に活用されない場合がある。非部分インデックスを追加することで、プランナーが確実にインデックスを使用できる
- **式インデックスの効果**: JSONBカラムからの抽出値（`rowData->>'FSIGENCD'`）に対する式インデックスは、`DISTINCT/ORDER BY` のパフォーマンスを大幅に改善できる
- **計測の重要性**: `EXPLAIN (ANALYZE, BUFFERS)` で実行計画を確認することで、ボトルネックを正確に特定できる
- **段階的な最適化**: まず部分インデックスを試し、効果が限定的な場合は非部分インデックスも検討する段階的アプローチが有効

**実機検証結果**: ✅ **本番DBで計測・検証完了・キオスク実機動作確認完了**（2026-02-11）
- **DB計測結果**:
  - 変更前: `Execution Time: 29299.650 ms`（約29.3秒）
  - 変更後: `Execution Time: 81.947 ms`（約0.082秒）
  - `history-progress` 相当SQLも改善: `Execution Time: 314.251 ms` → `Execution Time: 2.291 ms`
  - API体感: `curl` で `ttfb=0.244928s`, `total=0.245218s`（HTTP 200）
- **キオスク実機動作確認**（2026-02-11）:
  - ✅ 資源CDボタンが即座に表示されるようになった（ページマウント時に即時表示）
  - ✅ 体感速度が大幅に向上し、問題なく使用可能
  - ✅ ユーザー体験が改善され、待機時間が解消された
- **CI検証**: CI全ジョブ成功、マイグレーションが正常に適用されることを確認

**関連ファイル**:
- `apps/api/prisma/migrations/20260211123000_add_prod_schedule_expr_indexes/migration.sql`（新規: 式インデックス追加）
- `apps/api/src/routes/kiosk.ts`（`GET /kiosk/production-schedule/resources` エンドポイント）
- `apps/api/src/services/production-schedule/row-resolver/max-product-no-sql.ts`（`buildMaxProductNoWinnerCondition`）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（資源CDボタン群の描画）
- `apps/web/src/api/hooks.ts`（`useKioskProductionScheduleResources`）

**関連KB**:
- [KB-205](./api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側): 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）
- [KB-247](./frontend.md#kb-247-生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化): 生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化

**解決状況**: ✅ **実装完了・CI成功・本番DB適用完了・実機検証完了**（2026-02-11）

---

### [KB-249] CSVダッシュボードの日付パースでタイムゾーン変換の二重適用問題

**EXEC_PLAN.md参照**: feat/signage-visualization-layout-improvement ブランチ（2026-02-11）

**事象**: 
- CSVダッシュボード取り込み時に、JST日時（例: `2026/2/11 8:47`）がUTCに変換される際、UTC+9オフセットが二重に適用されていた
- 結果として、`2026-02-10T23:47:00.000Z`（1日前）として保存され、当日（JST）の未点検判定が正しく動作しなかった

**要因**: 
- **根本原因**: `CsvDashboardIngestor.extractOccurredAt`で、JST日時をUTCに変換する際に、`new Date(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0)`でローカルタイムゾーンでDateオブジェクトを作成し、その後`- 9 * 60 * 60 * 1000`でUTC+9オフセットを引いていた
- しかし、`new Date()`コンストラクタは実行環境のローカルタイムゾーンで解釈するため、Mac（JST）とPi5（JST）では問題なく動作するが、UTC環境では異なる結果になる可能性がある
- さらに、`Date.UTC`を使用せずにローカルタイムゾーンで作成した後、手動でオフセットを引く方法は、実行環境に依存し、二重適用のリスクがある

**有効だった対策**: 
- ✅ **解決済み**（2026-02-11）: `Date.UTC`を直接使用し、JSTの時間から9時間を引いた値をUTCとして扱うように修正
  ```typescript
  // 修正前
  const date = new Date(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0);
  const utcDate = new Date(date.getTime() - 9 * 60 * 60 * 1000);
  
  // 修正後
  const utcDate = new Date(Date.UTC(yearNum, monthNum, dayNum, hourNum - 9, minuteNum, 0, 0));
  ```
- これにより、実行環境のローカルタイムゾーンに依存せず、常にJST→UTCの変換が正しく行われる

**学んだこと**: 
- **タイムゾーン変換は実行環境に依存しない方法を使用する**: `Date.UTC`を使用することで、実行環境のローカルタイムゾーンに依存しない変換が可能
- **オフセットの二重適用を避ける**: ローカルタイムゾーンでDateオブジェクトを作成してから手動でオフセットを引く方法は、実行環境に依存し、二重適用のリスクがある
- **JST→UTC変換は`Date.UTC`で直接行う**: `Date.UTC(year, month, day, hour - 9, minute, second)`の形式で、JSTの時間から9時間を引いた値をUTCとして扱う

**関連ファイル**: 
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（`extractOccurredAt`メソッド）

**解決状況**: ✅ **解決済み**（2026-02-11、CI成功・デプロイ完了・実機検証完了）

---

### [KB-251] 未点検加工機サイネージ可視化データソースの追加

**EXEC_PLAN.md参照**: feat/signage-visualization-layout-improvement ブランチ（2026-02-11）

**事象**:
- 既存の未点検加工機抽出ロジックを、サイネージで再利用できる可視化データソースとして提供する必要があった
- 新しい専用スロットを増やさず、既存の `visualization` 経路に乗せることが要件だった

**要因**:
- `MachineService.findUninspected` はAPIエンドポイント用には実装済みだったが、可視化基盤（DataSource/Renderer）とは未接続だった
- 運用上、`csvDashboardId` の設定漏れが起きる可能性があり、入力契約の明示が必要だった

**有効だった対策**:
- ✅ `uninspected_machines` データソースを追加し、`MachineService.findUninspected({ csvDashboardId, date? })` を直接再利用
- ✅ `uninspected_machines` レンダラーを追加し、KPI（稼働中/点検済み/未点検）+ 一覧の単画面表示を実装
- ✅ 可視化作成APIのスキーマにバリデーションを追加し、`dataSourceType=uninspected_machines` 時は `dataSourceConfig.csvDashboardId` を必須化
- ✅ 設定不足・不正時は空表示ではなく、サイネージ上に明示メッセージを表示

**検証**:
- `visualizations.integration.test.ts` に `csvDashboardId` 未設定時の400応答テストを追加
- `uninspected-machines-data-source.test.ts` で正常/設定不足/件数制限を検証
- `uninspected-machines-renderer.test.ts` で正常レンダリングとエラー表示を検証

**関連ファイル**:
- `apps/api/src/services/visualization/data-sources/uninspected-machines/uninspected-machines-data-source.ts`
- `apps/api/src/services/visualization/renderers/uninspected-machines/uninspected-machines-renderer.ts`
- `apps/api/src/services/visualization/initialize.ts`
- `apps/api/src/routes/visualizations/schemas.ts`
- `apps/api/src/routes/__tests__/visualizations.integration.test.ts`

**解決状況**: ✅ **実装完了・テスト成功**（2026-02-11）

---

### [KB-253] 加工機CSVインポートのデフォルト列定義とDB設定不整合問題

**日付**: 2026-02-11

**事象**: 
- 加工機CSVインポート時に「加工機CSVの2行目でエラー: equipmentManagementNumber と name が undefined」が発生
- DBに列定義が登録されていない場合でも、デフォルト列定義を使用するように実装したが、エラーが続いた
- 実際のCSVファイル（`加工機_マスター.csv`）はローカルテストでは正常にパースできた

**要因**: 
- **根本原因**: DB側の`master-config-machines`レコードの`columnDefinitions`で、`internalName`が壊れていた
  - 正しい値: `equipmentManagementNumber`, `name`
  - 実際の値: `設備管理番号`, `加工機_名称`（日本語ヘッダーがそのまま`internalName`になっていた）
- このため、`CsvRowMapper`がマッピングした結果、`equipmentManagementNumber`と`name`が`undefined`になり、Zodスキーマのバリデーションでエラーが発生

**試行した対策**: 
- [試行1] デフォルト列定義を`MachineCsvImporter`に追加 → ローカルテストでは成功したが、本番環境ではDB側の設定が優先され、壊れた設定が使用されていた
- [試行2] CSVインポートのエラーメッセージを改善（実際のCSVヘッダーを表示） → デバッグしやすくなったが、根本原因は解決していなかった

**有効だった対策**: 
- ✅ **DB側の列定義を直接修正（2026-02-11）**:
  - `CsvDashboard`テーブルの`master-config-machines`レコードの`columnDefinitions`を正しい`internalName`に更新
  - SQLで直接修正: `UPDATE "CsvDashboard" SET "columnDefinitions" = '[...]'::jsonb WHERE id = 'master-config-machines'`
  - 修正後、CSVインポートが正常に動作することを確認

**学んだこと**: 
- **DB側の設定が優先される**: `getEffectiveConfig`が`null`を返さない場合、DB側の設定が使用される。デフォルト列定義は「DB側に設定がない場合」のフォールバック
- **列定義の`internalName`は英語キーである必要がある**: `internalName`はシステム内部で使用するキー名であり、日本語ヘッダーとは別物。`csvHeaderCandidates`で日本語ヘッダーとマッピングする
- **DB設定の検証**: 列定義を設定する際は、`internalName`が正しい英語キーであることを確認する必要がある
- **エラーメッセージの重要性**: 実際のCSVヘッダーを表示することで、デバッグが容易になる

**再発防止**: 
- 列定義を設定する際は、`internalName`が正しい英語キーであることを確認する
- 管理コンソールの「CSV取り込み」→「取り込み設定（列定義・許可・戦略）」で列定義を設定する際、デフォルト値が正しく読み込まれることを確認する
- DB側の設定を直接確認する方法をドキュメント化する

**関連ファイル**: 
- `apps/api/src/services/imports/importers/machine.ts`（デフォルト列定義の追加）
- `apps/api/src/services/imports/csv-row-mapper.ts`（エラーメッセージ改善）
- `apps/api/src/services/imports/csv-import-config.service.ts`（列定義取得）

**解決状況**: ✅ **解決済み**（2026-02-11）
- DB側の列定義を修正し、CSVインポートが正常に動作することを確認

---
