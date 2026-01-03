---
title: トラブルシューティングナレッジベース - API関連
tags: [トラブルシューティング, API, レート制限, 認証]
audience: [開発者]
last-verified: 2025-01-03
related: [index.md, ../guides/ci-troubleshooting.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - API関連

**カテゴリ**: API関連  
**件数**: 23件  
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

