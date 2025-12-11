---
title: トラブルシューティングナレッジベース - API関連
tags: [トラブルシューティング, API, レート制限, 認証]
audience: [開発者]
last-verified: 2025-11-30
related: [index.md, ../guides/ci-troubleshooting.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - API関連

**カテゴリ**: API関連  
**件数**: 18件  
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

