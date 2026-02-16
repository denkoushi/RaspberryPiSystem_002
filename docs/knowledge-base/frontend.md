---
title: トラブルシューティングナレッジベース - フロントエンド関連
tags: [トラブルシューティング, フロントエンド, React, XState]
audience: [開発者]
last-verified: 2025-01-03
related: [index.md, ../modules/tools/README.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - フロントエンド関連

**カテゴリ**: フロントエンド関連  
**件数**: 40件  
**索引**: [index.md](./index.md)

---

### [KB-006] キオスクの接続が不安定

**EXEC_PLAN.md参照**: Surprises & Discoveries (行154-162)

**事象**: 
- キオスクからAPIサーバーに接続できない
- 再起動後に接続できなくなる

**要因**: 
- IPアドレスの変更
- CORS設定の問題
- `VITE_API_BASE_URL`の設定が不適切

**試行した対策**: 
- [試行1] `VITE_API_BASE_URL`を絶対URLに設定 → **失敗**（CORSエラーが発生）
- [試行2] `VITE_API_BASE_URL`を相対パス（`/api`）に設定 → **成功**（Caddyのリバースプロキシ経由で接続）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: `VITE_API_BASE_URL`を相対パス（`/api`）に設定し、Caddyのリバースプロキシ経由で接続するように変更

**学んだこと**: 
- CORSエラーを避けるには、相対パスを使用してリバースプロキシ経由で接続する
- IPアドレスが変わっても、相対パスを使用することで問題を回避できる
- `.env`ファイルで環境変数を管理することで、IPアドレスの変更に対応しやすくなる

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/docker/.env`

---

### [KB-016] XState v5のassignの誤用

**EXEC_PLAN.md参照**: Surprises & Discoveries (行148-150)

**事象**: 
- キオスクの状態機械`borrowMachine.ts`でXState v5の`assign`を誤用し、`pnpm run build`がTypeScriptエラーで停止した

**要因**: 
- XState v5の`assign`の使い方が間違っていた
- `event`が`undefined`の可能性を考慮していなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-19）: `assign(({ event }) => ({ ... }))`形式でcontext差分を返すよう修正し、イベント存在を`event?.type`で確認したうえでUIDを設定

**学んだこと**: 
- XState v5の`assign`は、context差分を返す必要がある
- イベントが`undefined`の可能性を考慮する必要がある

**解決状況**: ✅ **解決済み**（2025-11-19）

**関連ファイル**: 
- `apps/web/src/features/kiosk/borrowMachine.ts`

---

### [KB-022] キオスクがラズパイ5に接続できない

**EXEC_PLAN.md参照**: Surprises & Discoveries

**事象**: 
- ラズパイ4のキオスクがラズパイ5に接続できない
- 再起動後に接続できなくなる

**要因**: 
- `VITE_API_BASE_URL`の設定が不適切（絶対URLを使用していたためCORSエラーが発生）
- IPアドレスの変更に対応できていない

**試行した対策**: 
- [試行1] `VITE_API_BASE_URL`を絶対URLに設定 → **失敗**（CORSエラーが発生）
- [試行2] `VITE_API_BASE_URL`を相対パス（`/api`）に設定 → **成功**（Caddyのリバースプロキシ経由で接続）
- [試行3] `.env`ファイルで環境変数を管理 → **成功**（IPアドレスの変更に対応しやすくなる）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: `VITE_API_BASE_URL`を相対パス（`/api`）に設定し、Caddyのリバースプロキシ経由で接続するように変更。`.env`ファイルで環境変数を管理することで、IPアドレスの変更に対応しやすくした。

**学んだこと**: 
- CORSエラーを避けるには、相対パスを使用してリバースプロキシ経由で接続する
- IPアドレスが変わっても、相対パスを使用することで問題を回避できる
- `.env`ファイルで環境変数を管理することで、IPアドレスの変更に対応しやすくなる

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/docker/.env`

---

### [KB-026] キオスク画面のリダイレクトが設定変更時に反映されない

**EXEC_PLAN.md参照**: Phase 6 実機テスト（フロントエンドUI）（2025-11-27）

**事象**: 
- 管理画面で`defaultMode`を`PHOTO`から`TAG`に変更しても、`/kiosk/photo`から`/kiosk/tag`にリダイレクトされない
- `/kiosk`までURLを削って戻さないとリダイレクトされない

**要因**: 
- `KioskRedirect`コンポーネントが`/kiosk`ルートでのみマウントされていたため、`/kiosk/photo`や`/kiosk/tag`にいる場合、設定変更を検知できなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-27）: `KioskLayout`内で`KioskRedirect`を常にマウントし、どのページでも設定変更を監視できるように変更
- `KioskRedirect`で返却ページ（`/kiosk/return`）ではリダイレクトしないように修正

**学んだこと**: 
- ルートレベルのコンポーネントは、子ルートでも設定変更を監視する必要がある場合は、レイアウトコンポーネント内で常にマウントする必要がある
- React Routerの`Outlet`を使用するレイアウトコンポーネント内で、設定変更を監視するコンポーネントを配置することで、すべての子ルートで動作する

**解決状況**: ✅ **解決済み**（2025-11-27）

**関連ファイル**: 
- `apps/web/src/components/KioskRedirect.tsx`
- `apps/web/src/layouts/KioskLayout.tsx`

---

### [KB-027] NFCイベントが重複発火して持出一覧に自動追加が止まらない

**EXEC_PLAN.md参照**: Phase 6 実機テスト（フロントエンドUI）（2025-11-27）

**事象**: 
- `/kiosk/photo`でタグを1回スキャンすると、持出一覧に自動追加が止まらない
- スキャンを1回もしなければ発生しない
- 根本原因が直っていない

**要因**: 
- `useNfcStream`フックが同じイベント（同じ`uid`と`timestamp`）を複数回発火していた可能性
- `KioskPhotoBorrowPage`の`useEffect`の依存配列に`nfcEvent`オブジェクト全体が含まれていたため、同じイベントでもオブジェクト参照が変わるたびに`useEffect`が再実行されていた

**試行した対策**: 
- [試行1] `KioskPhotoBorrowPage`で`processingRef`と`processedUidsRef`を使用して重複処理を防止 → **部分的に成功**（重複は減ったが根本原因は解決していない）
- [試行2] `useNfcStream`フック内で、同じイベントキー（`uid:timestamp`）を記録し、同じイベントは1回だけ発火するように修正 → **部分的に成功**（根本原因の一部を修正）
- [試行3] `KioskPhotoBorrowPage`の`useEffect`の依存配列を`nfcEvent`から`nfcEvent?.uid`と`nfcEvent?.timestamp`に変更 → **成功**（根本原因を解決）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-27）: `KioskPhotoBorrowPage`の`useEffect`の依存配列を`nfcEvent`から`nfcEvent?.uid`と`nfcEvent?.timestamp`に変更。同じイベントでもオブジェクト参照が変わることで`useEffect`が再実行される問題を解決。`useNfcStream`フック内でも同じイベント（`uid:timestamp`）を複数回発火しないように修正。

**学んだこと**: 
- WebSocketから受信したイベントをそのまま`setEvent`で設定すると、同じイベントが複数回発火する可能性がある
- `useEffect`の依存配列にオブジェクト全体を含めると、オブジェクト参照が変わるたびに再実行される
- 依存配列には実際に使用する値（`uid`、`timestamp`）のみを含めることで、値が変わったときだけ再実行される
- イベントの重複を防ぐには、フックレベルとコンポーネントレベルの両方で重複チェックを行う必要がある

**解決状況**: ✅ **解決済み**（2025-11-27）

**関連ファイル**: 
- `apps/web/src/hooks/useNfcStream.ts`
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`

---

### [KB-028] デバッグログの環境変数制御

**EXEC_PLAN.md参照**: Phase 6 実機テスト（フロントエンドUI）（2025-11-27）

**事象**: 
- 365日24時間動作する環境で、デバッグログが大量に出力され続けるとメモリ使用量が増加する可能性がある
- 開発中はログが必要だが、本番環境では不要

**要因**: 
- デバッグログが常に出力されていた
- 環境による制御ができなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-27）: `VITE_ENABLE_DEBUG_LOGS`環境変数でデバッグログの出力を制御できるように実装
- デフォルトは常にログを出力（開発中に便利）
- 本番環境でログを無効化したい場合は`VITE_ENABLE_DEBUG_LOGS=false`を設定
- エラーログは常に出力（問題の特定に必要）

**学んだこと**: 
- 365日24時間動作する環境では、ログの出力量を制御することが重要
- 環境変数で制御することで、開発環境と本番環境で異なる動作を実現できる
- デフォルトは開発に便利な設定にし、本番環境で必要に応じて無効化できるようにする

**解決状況**: ✅ **解決済み**（2025-11-27）

**関連ファイル**: 
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `apps/web/src/components/KioskRedirect.tsx`
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`
- `docs/requirements/system-requirements.md`

---

### [KB-029] 従業員編集画面でバリデーションエラーメッセージが表示されない

**EXEC_PLAN.md参照**: Phase 6 実機テスト（統合フロー）（2025-11-27）

**事象**: 
- 従業員編集画面で社員コードが4桁数字でない場合、バリデーションエラーが発生するが、エラーメッセージが表示されない
- ユーザーが何を修正すれば良いか分からない

**要因**: 
- `handleSubmit`関数でエラーハンドリングが不足していた
- Zodバリデーションエラーの`issues`配列からエラーメッセージを抽出していなかった
- `create.error`や`update.error`を表示するUIがなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-27）: `handleSubmit`関数にtry-catchを追加し、エラーメッセージ表示UIを追加
- Zodバリデーションエラーの`issues`配列からエラーメッセージを抽出して表示するように修正
- `create.error`と`update.error`を表示するUIを追加

**学んだこと**: 
- Zodバリデーションエラーは`issues`配列に詳細なエラーメッセージが含まれる
- フロントエンドでエラーハンドリングを行う際は、`issues`配列からメッセージを抽出する必要がある
- ユーザーに分かりやすいエラーメッセージを表示することで、操作の改善が容易になる

**解決状況**: ✅ **解決済み**（2025-11-27）

**関連ファイル**: 
- `apps/web/src/pages/tools/EmployeesPage.tsx`
- `apps/api/src/plugins/error-handler.ts`

---

### [KB-035] useEffectの依存配列にisCapturingを含めていた問題（重複処理）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- NFCタグを1回スキャンすると、2件の持出記録が作成される
- 重複処理防止の時間を10秒から3秒に短縮した直後から発生

**要因**: 
- `KioskPhotoBorrowPage`の`useEffect`の依存配列に`isCapturing`が含まれていた
- NFCイベント処理開始時に`setIsCapturing(true)`を呼び出すと、`isCapturing`の値が変わり、`useEffect`が再実行される
- 再実行時に`processingRef.current`がまだ`true`になる前に処理が開始されるため、重複処理が発生

**試行した対策**: 
- [試行1] 重複処理防止の時間を10秒から3秒に短縮 → **失敗**（問題が悪化し、1回タッチで2件登録されるようになった）
- [試行2] `isCapturing`を依存配列から除外 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: `useEffect`の依存配列から`isCapturing`を除外し、`processingRef.current`で重複処理を制御
- 依存配列を`[nfcEvent?.uid, nfcEvent?.timestamp, photoBorrowMutation, resolvedClientId]`に限定

**学んだこと**: 
- `useEffect`の依存配列に状態変数を含めると、その状態が変更されるたびに再実行される
- 状態変数の変更が`useEffect`内で行われる場合、無限ループや重複処理の原因になる
- 重複処理を防ぐには、`useRef`を使用してフラグを管理し、依存配列には含めない
- ESLintの`react-hooks/exhaustive-deps`ルールは参考にしつつも、意図的に依存配列から除外する場合はコメントで理由を明記する

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`

---

### [KB-068] 写真撮影持出のサムネイルが真っ黒になる問題（輝度チェック対策）

**EXEC_PLAN.md参照**: Phase 6 実機検証（2025-12-01）、[tool-management-debug-execplan.md](../plans/tool-management-debug-execplan.md)

**事象**: 
- 写真撮影持出で登録されたLoanのサムネイルが真っ黒で表示される
- アイテム自体は登録されているが、サムネイルが視認できない
- USBカメラ（特にラズパイ4）で発生しやすい

**要因**: 
1. **USBカメラの露光安定化**: USBカメラの起動直後（200〜500ms）に露光・ホワイトバランスが安定せず、最初の数フレームが暗転または全黒になる
2. **フロントエンドの検証不足**: 現在の実装ではフレーム内容を検査せず、そのまま保存している
3. **サーバー側の検証不足**: サーバー側でも画像の輝度をチェックしていない

**試行した対策**: 
- [試行1] フロントエンドで100ms待機してから撮影 → **部分的成功**（改善したが完全には解決しない）
- [試行2] フロントエンドでフレームの平均輝度をチェック → **成功**（暗いフレームを検出して再撮影を促す）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. フロントエンドで`capturePhotoFromStream`内で`ImageData`の平均輝度を計算（Rec. 601式）
  2. 平均輝度が18未満の場合はエラーを投げて再撮影を促す
  3. サーバー側で`sharp().stats()`を使用してRGBチャネルの平均輝度を計算
  4. 平均輝度が`CAMERA_MIN_MEAN_LUMA`（デフォルト18）未満の場合は422エラーを返す
  5. 環境変数`CAMERA_MIN_MEAN_LUMA`でしきい値を調整可能

- ⚠️ **変更**（2026-02-11）: 閾値チェックを削除（KB-248参照）
  - 雨天・照明なしの環境でも撮影可能にするため、フロントエンド・バックエンドの両方で閾値チェックを削除
  - 500ms待機＋5フレーム選択ロジックは維持（カメラの露出調整を待つため）

**学んだこと**: 
- USBカメラは起動直後に暗転フレームを生成するため、フレーム内容の検証が必要
- フロントエンドとサーバー側の両方で検証することで、確実に黒画像を防止できる
- `sharp().stats()`のチャネル名は環境によって異なる可能性があるため、フォールバック処理が必要
- 輝度しきい値は環境変数で調整可能にすることで、実環境に応じた最適化が可能
- **閾値チェックは負荷問題を引き起こす可能性がある**: ストリーム保持によるPi4の負荷問題を回避するため、閾値チェックを削除し、どんな明るさでも撮影可能にした（KB-248参照）

**解決状況**: ✅ **解決済み**（2025-12-04）、**変更**（2026-02-11、KB-248参照）

**関連ファイル**: 
- `apps/web/src/utils/camera.ts`
- `apps/api/src/services/tools/loan.service.ts`
- `apps/api/src/config/camera.config.ts`
- `apps/api/src/routes/__tests__/photo-borrow.integration.test.ts`
- `docs/plans/tool-management-debug-execplan.md`

---

### [KB-036] 履歴画面の画像表示で認証エラー（window.openでの新しいタブ）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- 履歴画面でサムネイルをクリックすると、新しいタブが開くが「認証トークンが必要です」というエラーが表示される
- 元画像が表示されない

**要因**: 
- `window.open()`で新しいタブを開くと、認証情報（JWTトークン）が渡されない
- 元画像エンドポイント（`/api/storage/photos/*`）は認証が必要なため、401エラーが発生

**試行した対策**: 
- [試行1] `window.open(fullImageUrl, '_blank')`で新しいタブを開く → **失敗**（401エラー）
- [試行2] 認証付きでAPIから画像を取得し、モーダルで表示 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `api.get(imagePath, { responseType: 'blob' })`で認証付きで画像を取得
  2. `URL.createObjectURL(response.data)`でBlobからURLを生成
  3. モーダルで画像を表示
  4. モーダルを閉じるときに`URL.revokeObjectURL()`でURLを解放

**学んだこと**: 
- `window.open()`では認証情報（Authorization ヘッダー）が渡されない
- 認証が必要なリソースを表示する場合は、APIクライアント経由で取得する必要がある
- Blobを使用する場合は、メモリリークを防ぐために`URL.revokeObjectURL()`で解放する
- モーダルで画像を表示することで、ユーザー体験も向上する（新しいタブを開かずに済む）

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/pages/tools/HistoryPage.tsx`

---

### [KB-037] カメラプレビューのCPU負荷問題（常時プレビュー削除）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- カメラプレビューを常時表示していると、CPU使用率が80%、CPU温度が65°Cまで上昇
- ブラウザを閉じるとCPU使用率が2%に低下し、温度も下がる
- ラズパイ4のパフォーマンスに負荷がかかっている

**要因**: 
- カメラプレビューを常時表示しているため、ブラウザが継続的にフレームをレンダリングしている
- 640x480、15fpsの設定でも、24時間365日の運用では負荷が高い

**試行した対策**: 
- [試行1] カメラプレビューの解像度を640x480、フレームレートを15fpsに制限 → **部分的に成功**（負荷は下がったが、まだ高い）
- [試行2] 常時プレビューを削除し、NFCタグスキャン時のみカメラを起動 → **成功**（CPU使用率が2-5%に低下）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. カメラプレビューの`useEffect`を削除
  2. `video`要素の表示を削除
  3. NFCタグスキャン時に`captureAndCompressPhoto()`を呼び出し、撮影時のみカメラを起動
  4. 撮影完了後、`captureAndCompressPhoto()`内で自動的にカメラを停止

**学んだこと**: 
- **常時プレビューは不要**: 写真撮影機能では、スキャン時のみカメラを起動すれば十分
- **CPU負荷の測定**: `vcgencmd measure_temp`や`top`コマンドでCPU温度・使用率を測定できる
- **パフォーマンス最適化**: 24時間365日の運用では、不要な処理を削減することが重要
- **ユーザー体験**: プレビューがなくても、スキャン時に自動的に撮影されるため、ユーザー体験は維持される

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `apps/web/src/utils/camera.ts`

---

### [KB-038] カメラ撮影時のCPU100%問題（video要素のクリーンアップ）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- NFCタグスキャン時にカメラで撮影すると、CPU使用率が100%で張り付く
- 撮影後もCPU負荷が下がらない

**要因**: 
- `capturePhotoFromStream`関数で`video`要素を作成しているが、DOMに追加されていない
- `video.play()`がPromiseを返すが`await`していない
- 撮影後に`video`要素をクリーンアップしていないため、メモリリークとCPU負荷が発生

**試行した対策**: 
- [試行1] `video.play()`を`await`で待機 → **部分的に成功**（改善したが、まだCPU負荷が高い）
- [試行2] `video`要素をDOMに追加し、適切にクリーンアップ → **成功**（CPU負荷が正常に戻る）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `video`要素をDOMに追加（非表示: `position: fixed`, `opacity: 0`）
  2. `video.play()`を`await`で待機
  3. メタデータ読み込みをPromiseで待機（タイムアウト5秒）
  4. 撮影前に100ms待機してフレームを安定化
  5. `finally`ブロックで確実にクリーンアップ（`video.pause()`, `srcObject = null`, DOMから削除）

**学んだこと**: 
- **DOMに追加する重要性**: `video`要素をDOMに追加することで、ブラウザの最適化が有効になる
- **適切なクリーンアップ**: `finally`ブロックで確実にリソースを解放する
- **メモリリークの防止**: `video`要素を削除しないと、メモリリークとCPU負荷が発生する
- **非同期処理の適切な待機**: `video.play()`や`onloadedmetadata`を適切に待機することで、安定した動作が可能

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/utils/camera.ts`

---

### [KB-040] 返却一覧の自動更新が不要だった問題（CPU負荷軽減）

**EXEC_PLAN.md参照**: Progress (2025-11-28)

**事象**: 
- 返却一覧の自動更新間隔を2秒→10秒に変更したが、さらにCPU負荷を軽減したい
- 自動更新が本当に必要か疑問に思った

**要因**: 
- 返却ボタン、取消ボタン、写真撮影持出のすべての手動操作で`invalidateQueries`が呼び出されるため、即座に反映される
- 他のラズパイ4のアイテムは表示しない（`clientId`でフィルタリング）ため、外部からの更新は不要
- 以前に反映されなかった問題の記録は見つからなかった

**試行した対策**: 
- [試行1] 自動更新間隔を2秒→10秒に変更 → **部分的に成功**（CPU負荷は軽減したが、さらに軽減可能）
- [試行2] 自動更新を無効化（`refetchInterval: false`） → **成功**（CPU負荷がさらに軽減、手動操作でも即座に反映されることを確認）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: `useActiveLoans`の`refetchInterval`を`false`に設定して自動更新を無効化
- 手動操作（返却・取消・写真撮影持出）では`invalidateQueries`により即座に反映されるため、自動更新は不要

**学んだこと**: 
- **不要な自動更新の削除**: 手動操作で即座に反映される場合は、自動更新は不要
- **パフォーマンス最適化**: 不要なAPIリクエストを削減することで、CPU負荷を軽減できる
- **要件の再確認**: 以前の実装理由が不明確な場合は、要件を再確認して不要な機能を削除する
- **365日24時間運用**: 長期運用を考慮すると、不要な処理は削除すべき

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/api/hooks.ts`
- `apps/web/src/pages/kiosk/KioskReturnPage.tsx`

---

### [KB-043] KioskRedirectが/adminパスでも動作してしまい、管理画面にアクセスできない問題

**EXEC_PLAN.md参照**: Progress (2025-11-28)

**事象**: 
- `/admin/signage/pdfs`にアクセスしようとすると、勝手に`/kiosk/photo`にリダイレクトされる
- 管理画面のサイネージ設定ページにアクセスできない
- ブラウザのコンソールに`[KioskRedirect] Redirecting to /kiosk/photo`というログが出力される

**要因**: 
- `KioskRedirect`コンポーネントが`/`パスで使用されているため、すべてのパスでレンダリングされる可能性がある
- `KioskRedirect`コンポーネント内でパスのチェックが不十分で、`/admin`パスでも動作してしまっていた
- React Routerのルーティング設定では、`/`パスが最初にマッチするため、`KioskRedirect`が実行される

**試行した対策**: 
- [試行1] ルーティング設定を確認 → **部分的に成功**（ルーティング設定は正しい）
- [試行2] `KioskRedirect`コンポーネントにパスチェックを追加し、`/`または`/kiosk`パスでのみ動作するように修正 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `KioskRedirect`コンポーネントの`useEffect`の最初にパスチェックを追加
  2. `normalizedPath === ''`（ルートパス）または`normalizedPath === '/kiosk'`の場合のみ処理を実行
  3. それ以外のパス（`/admin`など）の場合は早期リターンで処理をスキップ
  4. TypeScriptの型エラーを修正（`normalizedPath`の型を適切に処理）

**学んだこと**: 
- **コンポーネントのスコープ制限**: 特定のパスでのみ動作すべきコンポーネントは、パスチェックを最初に行う
- **React Routerの動作**: `/`パスが最初にマッチするため、すべてのパスでコンポーネントがレンダリングされる可能性がある
- **早期リターンの重要性**: 不要な処理を避けるために、条件チェックを最初に行う
- **デバッグログの活用**: コンソールログで問題の原因を特定できる

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/components/KioskRedirect.tsx`
- `apps/web/src/App.tsx`

---

### [KB-045] 分割表示でPDFがスライドしない問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- サイネージの分割表示（SPLIT）で、PDFをスライドショー設定にしても自動的にページが切り替わらない
- 単体表示（PDFのみ）ではスライドショーが動作するが、分割表示では動作しない

**要因**: 
- `SignageService.getContent()` が分割表示時に `displayMode` を `SignageDisplayMode.SINGLE` に固定していた
- PDFの `displayMode`（`SLIDESHOW` または `SINGLE`）が引き継がれていなかった

**試行した対策**: 
- [試行1] `SignageDisplayPage.tsx` のスライドショーロジックを確認 → **問題なし**（ロジック自体は正しい）
- [試行2] `SignageService.getContent()` で分割表示時にPDFの `displayMode` を引き継ぐように修正 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `SignageService.getContent()` の分割表示処理を修正
  2. PDFが存在する場合、PDFの `displayMode`（`SLIDESHOW` または `SINGLE`）を `content.displayMode` に設定
  3. フロントエンド側で `content.displayMode === 'SLIDESHOW'` の場合に自動ページ切り替えを実行

**学んだこと**: 
- **データの引き継ぎ**: サーバー側で設定された情報（`displayMode`）をフロントエンドに正しく渡すことで、期待通りの動作を実現できる
- **設定の一貫性**: PDFの設定（スライドショー/単一表示）を分割表示でも尊重することで、ユーザー体験を向上できる

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `apps/api/src/services/signage/signage.service.ts`
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`

---

### [KB-046] サイネージのサムネイルアスペクト比がおかしい問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- サイネージの工具管理データ表示で、サムネイル画像が縦横に引き伸ばされて表示される
- 工具管理画面（キオスク/管理画面）で表示されているアイテムカードと同じサイズ・比率で表示されない

**要因**: 
- `SignageDisplayPage.tsx` のツールカードで、画像に `object-cover` を指定していたが、アスペクト比が指定されていなかった
- コンテナのサイズに応じて画像が引き伸ばされていた

**試行した対策**: 
- [試行1] 画像の `object-fit` を確認 → **問題なし**（`object-cover` は正しく設定されていた）
- [試行2] 画像をラッパーdivで囲み、`aspectRatio: '4 / 3'` を指定して、工具管理画面と同じアスペクト比に統一 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. ツールカードの画像をラッパーdivで囲む
  2. ラッパーに `aspectRatio: '4 / 3'` を指定（工具管理画面と同じ比率）
  3. 画像に `object-cover` を指定して、アスペクト比を維持しながらコンテナに収める
  4. 単体表示と分割表示の両方で同じアスペクト比を適用

**学んだこと**: 
- **アスペクト比の指定**: CSSの `aspect-ratio` プロパティを使用することで、画像の縦横比を固定できる
- **UIの一貫性**: 同じデータを表示する画面では、見た目を統一することでユーザー体験を向上できる
- **レスポンシブデザイン**: アスペクト比を指定することで、異なる画面サイズでも適切に表示される

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`

---

### [KB-064] Pi4キオスクでカメラが起動しない: facingModeの指定方法の問題

**EXEC_PLAN.md参照**: なし（2025-12-02発生）

**事象**: 
- Pi4のキオスク画面で従業員タグをスキャンしてもカメラが起動しない
- エラーメッセージが表示されず、カメラAPIが呼ばれていないように見える
- 数日前までは正常に動作していた

**要因**: 
- `apps/web/src/utils/camera.ts`の`getCameraStream`関数で、`facingMode: 'environment'`から`facingMode: { ideal: 'environment' }`に変更された
- Pi4のUSBカメラが`facingMode: { ideal: 'environment' }`形式をサポートしていない可能性がある
- フォールバックロジックが追加されたが、USBカメラでは`facingMode`自体が認識されない可能性がある

**試行した対策**: 
- [試行1] `facingMode: { ideal: 'environment' }`形式でフォールバックロジックを追加 → **失敗**（USBカメラが認識されない）
- [試行2] 動いていた時のコード（`facingMode: 'environment'`）に戻す → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-02）:
  1. `apps/web/src/utils/camera.ts`を動いていた時のコード（コミット`5f03d0b`）に戻した
  2. `facingMode: 'environment'`形式を使用（`facingMode: { ideal: 'environment' }`形式は削除）
  3. フォールバックロジックを削除し、シンプルな実装に戻した

**学んだこと**: 
- USBカメラでは`facingMode`の指定方法が重要で、`'environment'`形式の方が互換性が高い
- `{ ideal: 'environment' }`形式はモバイルデバイス向けの最適化だが、USBカメラでは動作しない可能性がある
- 動作していたコードを変更する際は、変更前後の動作確認が重要
- 数日前の動作していたブランチと比較することで、問題の原因を特定できる

**解決状況**: ✅ **解決済み**（2025-12-02）

**関連ファイル**: 
- `apps/web/src/utils/camera.ts`
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`

---

### [KB-065] カメラエラーメッセージが表示されない: デバッグログの出力条件が厳しすぎる

**EXEC_PLAN.md参照**: なし（2025-12-02発生）

**事象**: 
- Pi4のキオスク画面でカメラが起動しないが、エラーメッセージが表示されない
- ブラウザコンソールにもエラーログが出力されない
- 問題の原因特定が困難

**要因**: 
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`のエラーハンドリングで、デバッグログの出力が環境変数`VITE_ENABLE_DEBUG_LOGS`に依存していた
- 本番環境では`VITE_ENABLE_DEBUG_LOGS`が`false`に設定されている可能性がある
- エラーメッセージの表示は行われていたが、コンソールログが出力されないため、問題の特定が困難だった

**試行した対策**: 
- [試行1] 環境変数`VITE_ENABLE_DEBUG_LOGS`を確認 → **失敗**（設定されていない）
- [試行2] エラーログを常に出力するように修正 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-02）:
  1. `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`のエラーハンドリングを修正
  2. `console.error`を常に出力するように変更（環境変数の条件を削除）
  3. カメラ起動時のログ（`console.log`）も追加して、処理の流れを追跡できるようにした

**学んだこと**: 
- エラーログは常に出力すべきで、環境変数で制御するのは適切ではない
- デバッグログとエラーログは区別し、エラーログは常に出力する
- カメラAPIの呼び出し時には、開始ログとエラーログの両方を出力することで、問題の特定が容易になる
- フルスクリーン環境ではブラウザコンソールが見えないため、ログファイルへの出力も検討すべき

**解決状況**: ✅ **解決済み**（2025-12-02）

**関連ファイル**: 
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`

---

### [KB-091] NFC/カメラ入力のスコープ分離: 別ページからのイベント横漏れ防止

**EXEC_PLAN.md参照**: 計測機器管理システム実装（2025-12-11）

**事象**: 
- 計測機器ページで氏名タグをスキャンした直後に、`defaultMode=PHOTO`によりPHOTOページへ遷移
- PHOTOページが遷移直前のNFCイベントを拾い、意図せず自動撮影が1回発火
- 同一NFCリーダーを複数機能で共用しているため、入力の横漏れが発生

**要因**: 
- `useNfcStream`フックがアプリ全体で共有されており、画面/モード単位のスコープ分離がなかった
- WebSocket経由のNFCイベントがすべてのページで購読され、遷移直後に古いイベントを処理してしまう
- `KioskRedirect`が`defaultMode`に従い自動遷移するため、意図しないページでイベントを受信

**有効だった対策**: 
- ✅ **解決済み**（2025-12-11）:
  1. `useNfcStream`フックに`enabled`パラメータを追加（デフォルト`false`）
  2. `enabledAt`タイムスタンプを記録し、`enabled=true`になった時刻より前のイベントを無視
  3. 各キオスクページで`useMatch`を使用し、アクティブなルートの時のみNFCを有効化:
     - `/kiosk/photo` → `useMatch('/kiosk/photo')`
     - `/kiosk/tag` → `useMatch('/kiosk/tag')`
     - `/kiosk/instruments/borrow` → `useMatch('/kiosk/instruments/borrow')`
  4. 管理コンソールページ（`EmployeesPage`、`ItemsPage`）も同様にスコープ分離

**実装のポイント**:
```typescript
// useNfcStream.ts
export function useNfcStream(enabled = false) {
  const enabledAtRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!enabled) {
      enabledAtRef.current = null;
      return;
    }
    // enabled=trueになった時刻を記録
    enabledAtRef.current = new Date().toISOString();
    // ... WebSocket接続
    socket.onmessage = (message) => {
      const payload = JSON.parse(message.data);
      // 遷移前のイベントを無視
      if (enabledAtRef.current && payload.timestamp < enabledAtRef.current) {
        return;
      }
      setEvent(payload);
    };
  }, [enabled]);
}

// 各ページでの使用例
const isActiveRoute = useMatch('/kiosk/photo');
const nfcEvent = useNfcStream(Boolean(isActiveRoute));
```

**学んだこと**: 
- 複数機能で同一入力デバイスを共用する場合、スコープ分離が必須
- WebSocketイベントはタイムスタンプで古いイベントをフィルタリングする
- React Routerの`useMatch`でルートマッチングを判定し、アクティブページのみ購読を有効化
- 将来の機能拡張でも同じパターンで入力スコープを管理可能

**解決状況**: ✅ **解決済み**（2025-12-11）

**関連ファイル**: 
- `apps/web/src/hooks/useNfcStream.ts`
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`
- `apps/web/src/pages/tools/EmployeesPage.tsx`
- `apps/web/src/pages/tools/ItemsPage.tsx`

**関連計画書**: 
- `docs/plans/nfc-stream-isolation-plan.md`

---

### [KB-095] 計測機器タグスキャン時の自動遷移機能

**EXEC_PLAN.md参照**: 計測機器管理システム実装（2025-12-12）

**事象**: 
- 持出タブ（`/kiosk/tag`）またはPHOTOモード（`/kiosk/photo`）で計測機器タグをスキャンすると、工具/従業員タグとして処理されエラーが発生
- カメラが起動し、「氏名紐づけないUID」としてエラーメッセージが表示される
- 計測機器タグと従業員/工具タグの区別ができていなかった

**要因**: 
- 持出タブ/PHOTOモードは工具・従業員のNFCフローを前提として設計されていた
- 計測機器タグはDBに別テーブル（`MeasuringInstrumentTag`）で管理されており、工具タグと区別する判定ロジックがなかった
- NFCスキャン時に計測機器かどうかを判定せず、一律で工具フローを実行していた

**有効だった対策**: 
- ✅ **解決済み**（2025-12-12）:
  1. `getUnifiedItems({ category: 'ALL' })`で工具と計測機器のマップを事前取得
  2. NFCイベント受信時に`tagTypeMap`でキャッシュ判定、または`getMeasuringInstrumentByTagUid`でAPI判定
  3. **計測機器として明示的に登録されているタグのみ**計測機器タブへ遷移
  4. 未登録タグ（404）は従来の工具/従業員フローを継続（従業員タグの誤判定を防止）
  5. PHOTOモードでも同様のロジックを実装し、カメラ起動前に計測機器タグを判定
  6. 計測機器持出完了後の戻り先を`kioskConfig.defaultMode`に基づいて決定（PHOTO/TAG）

**実装のポイント**:
```typescript
// KioskBorrowPage.tsx / KioskPhotoBorrowPage.tsx
// マップで計測機器タグと判定できる場合は即座に遷移
if (cachedType === 'MEASURING_INSTRUMENT') {
  navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
  return;
}

// APIで判定（計測機器として登録されている場合のみ遷移）
try {
  const instrument = await getMeasuringInstrumentByTagUid(nfcEvent.uid);
  if (instrument) {
    navigate(`/kiosk/instruments/borrow?tagUid=${encodeURIComponent(nfcEvent.uid)}`);
    return;
  }
} catch {
  // 404や他のエラーは従業員/工具フローを継続
  // ※未登録タグを計測機器として扱うと従業員タグが誤判定されるため
}
// 計測機器でなければ工具/従業員フローを継続
```

**教訓**: 
- 複数種類のタグを扱う場合、スキャン時に種類を判定するロジックを各ページに統一的に実装する
- **未登録タグ（404）を特定タイプとして扱わない**: 従業員タグも「計測機器として未登録」なので404が返され、誤判定の原因となる
- 明示的に登録されているタグのみを対象タイプとして扱う

**解決状況**: ✅ **解決済み**（2025-12-12）

**関連ファイル**: 
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`

---

### [KB-096] クライアントログ取得のベストプラクティス（postClientLogsへの統一）

**EXEC_PLAN.md参照**: 計測機器管理システム実装（2025-12-12）

**事象**: 
- Cursorデバッグログ（`http://127.0.0.1:7242/...`）がPi4クライアントから到達不可
- ログが管理コンソールに表示されず、デバッグが困難

**要因**: 
- `127.0.0.1`はlocalhostを指すため、Pi4のブラウザからはPi4自身に送信される
- CursorデバッグサーバーはMac上で動作しており、Pi4からは到達できない
- 既存の`postClientLogs`（API経由）が全ページに実装されていなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-12）:
  1. Cursorデバッグログ（`fetch('http://127.0.0.1:7242/...')`）を全ページから削除
  2. `postClientLogs`を全キオスクページに統一的に実装
  3. NFCイベント発生時に`postClientLogs`でログを送信

**実装のポイント**:
```typescript
// 全キオスクページで統一パターンを使用
postClientLogs(
  {
    clientId: resolvedClientId || 'raspberrypi4-kiosk1',
    logs: [
      {
        level: 'DEBUG',
        message: 'tag-page nfc event', // ページごとに識別可能なメッセージ
        context: { uid: nfcEvent.uid, cachedType, isFirstScan }
      }
    ]
  },
  resolvedClientKey
).catch(() => {});
```

**ログメッセージ一覧**:
| ページ | メッセージ |
|--------|-----------|
| `/kiosk/tag` | `tag-page nfc event` |
| `/kiosk/photo` | `photo-page nfc event` |
| `/kiosk/instruments/borrow` | `instrument-page nfc event` |

**教訓**: 
- ローカル環境向けのデバッグ手法（localhost宛ログ）は本番環境では機能しない
- 既存のインフラ（`postClientLogs` → `/clients/logs` API → DB → 管理コンソール）を活用する
- クライアントログはAPI経由でサーバーに送信し、管理コンソールで一元管理する

**解決状況**: ✅ **解決済み**（2025-12-12）

**関連ファイル**: 
- `apps/web/src/api/client.ts`（`postClientLogs`関数）
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`
- `apps/api/src/routes/clients.ts`（`/clients/logs`エンドポイント）

---

### [KB-109] CSVインポートスケジュールページのUI統一（バックアップペインと同じUI）

**EXEC_PLAN.md参照**: Gmailデータ取得機能実装（2025-12-29）

**事象**: 
- CSVインポートスケジュールページの日付指定UIがバックアップペインと異なり、独自のUIが使用されていた
- ユーザーが「日付のUIはバックアップペインのUIにせよ。独自を増やすなUIを統一せよ」と要望
- 複数回のデプロイ後も変更が反映されず、UIが統一されていなかった

**要因**: 
- 初期実装でcron形式のテキスト入力フィールドが使用されていた
- バックアップペイン（`BackupTargetForm.tsx`）では時刻入力（`type="time"`）と曜日選択ボタンが使用されていた
- UIの統一性が考慮されていなかった

**試行した対策**: 
- [試行1] cron形式のテキスト入力フィールドを削除し、時刻入力と曜日選択ボタンに変更 → **部分的成功**（UIは統一されたが、デプロイが反映されなかった）
- [試行2] デプロイ標準手順を確認し、`--force-recreate --build`オプションを使用 → **成功**（UI変更が反映された）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-29）:
  1. `CsvImportSchedulePage.tsx`のスケジュール入力UIを`BackupTargetForm.tsx`と同じUIに統一
  2. 時刻入力: `<Input type="time" ... />`を使用
  3. 曜日選択: 各曜日のボタンで選択可能に（動的スタイリング）
  4. UI形式からcron形式への変換関数（`formatCronSchedule`）を実装
  5. デプロイ標準手順（`docs/guides/deployment.md`）を遵守し、`--force-recreate --build`オプションを使用

**実装のポイント**:
```typescript
// BackupTargetForm.tsxと同じUIパターンを使用
const [scheduleTime, setScheduleTime] = useState('02:00');
const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([]);

// UI形式からcron形式への変換
const formatCronSchedule = (time: string, daysOfWeek: number[]): string => {
  const [hours, minutes] = time.split(':').map(Number);
  const cronDays = daysOfWeek.length === 0 ? '*' : daysOfWeek.join(',');
  return `${minutes} ${hours} * * ${cronDays}`;
};
```

**学んだこと**: 
- UIの統一性はユーザー体験の向上に重要
- 既存のUIパターン（`BackupTargetForm.tsx`）を参考にすることで、一貫性のあるUIを実現できる
- デプロイ標準手順を遵守することで、変更が確実に反映される
- デプロイ前に`docs/guides/deployment.md`を確認し、標準手順に従うことが重要

**解決状況**: ✅ **解決済み**（2025-12-29）

**追加の改善**（2025-12-29）:
- スケジュール表示を人間が読みやすい形式に変更（cron形式 `0 4 * * 1,2,3` → 「毎週月曜日、火曜日、水曜日の午前4時」）
- `formatScheduleForDisplay`関数を実装し、cron形式を日本語形式に変換
- テーブル表示から`font-mono`クラスを削除し、可読性を向上

**実装のポイント（追加）**:
```typescript
// cron形式を人間が読みやすい形式に変換
function formatScheduleForDisplay(cronSchedule: string): string {
  const parsed = parseCronSchedule(cronSchedule);
  const { time, daysOfWeek } = parsed;
  // 時刻を日本語形式に変換（午前/午後の判定）
  // 曜日を日本語形式に変換
  return `毎週${dayLabels}の${timeStr}`;
}
```

**関連ファイル**: 
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`
- `apps/web/src/components/backup/BackupTargetForm.tsx`
- `docs/guides/deployment.md`

---

### [KB-111] CSVインポートスケジュールの表示を人間が読みやすい形式に変更

**発生日時**: 2025-12-29

**事象**: 
- CSVインポートスケジュールページのテーブルで、スケジュールがcron形式（`0 4 * * 1,2,3`）で表示されていた
- ユーザーが「スケジュールの表記が人間には理解できない、記号の羅列だ」と指摘
- 一般ユーザーにはcron形式が理解しにくい

**要因**: 
- スケジュールをcron形式のまま表示していた
- 人間が読みやすい形式への変換機能が実装されていなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-29）:
  1. `formatScheduleForDisplay`関数を実装し、cron形式を日本語形式に変換
  2. 時刻を日本語形式に変換（午前/午後の判定、分が0の場合は「時」のみ表示）
  3. 曜日を日本語形式に変換（「毎週月曜日、火曜日、水曜日」など）
  4. テーブル表示から`font-mono`クラスを削除し、可読性を向上

**実装のポイント**:
```typescript
/**
 * cron形式のスケジュールを人間が読みやすい形式に変換
 * cron形式: "0 4 * * 1,2,3" → "毎週月曜日、火曜日、水曜日の午前4時"
 */
function formatScheduleForDisplay(cronSchedule: string): string {
  const parsed = parseCronSchedule(cronSchedule);
  const { time, daysOfWeek } = parsed;
  
  // 時刻を日本語形式に変換（午前/午後の判定）
  let timeStr: string;
  if (hourNum === 0) {
    timeStr = minuteNum === 0 ? '午前0時' : `午前0時${minuteNum}分`;
  } else if (hourNum < 12) {
    timeStr = minuteNum === 0 ? `午前${hourNum}時` : `午前${hourNum}時${minuteNum}分`;
  } else if (hourNum === 12) {
    timeStr = minuteNum === 0 ? '午後12時' : `午後12時${minuteNum}分`;
  } else {
    const pmHour = hourNum - 12;
    timeStr = minuteNum === 0 ? `午後${pmHour}時` : `午後${pmHour}時${minuteNum}分`;
  }
  
  // 曜日を日本語形式に変換
  if (daysOfWeek.length === 0) {
    return `毎日${timeStr}`;
  }
  const dayLabels = daysOfWeek
    .sort((a, b) => a - b)
    .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
    .filter(Boolean)
    .join('、');
  return `毎週${dayLabels}の${timeStr}`;
}
```

**学んだこと**: 
- ユーザー体験の向上には、技術的な形式（cron形式）を人間が読みやすい形式に変換することが重要
- テーブル表示では`font-mono`クラスを削除することで、可読性が向上する
- 既存の`parseCronSchedule`関数を活用することで、コードの重複を避けられる

**解決状況**: ✅ **解決済み**（2025-12-29）

**機能拡張（2026-02-16）**:
- ✅ **分のリスト形式の表示改善**: `15,25,35,45,55 * * * 0,1,2,3,4,5,6`のような形式を「毎週日、月、火、水、木、金、土の 15、25、35、45、55分」と読みやすく表示
- ✅ **規則的な間隔の自動検出**: `parseCronSchedule`関数を拡張し、10分間隔などの規則的な間隔は`intervalMinutes`モードとして扱い、UIで編集可能に
- ✅ **実機検証完了**: 管理コンソールのCSV取り込みタブで、スケジュール一覧のcron表示が読みやすくなっていることを確認

**実装の詳細（機能拡張）**:
```typescript
// parseCronSchedule関数の拡張: 分のリスト形式を検出
if (minute.includes(',') && hour === '*') {
  const minuteList = minute.split(',').map(m => parseInt(m.trim(), 10))
    .filter(m => !isNaN(m) && m >= 0 && m < 60).sort((a, b) => a - b);
  if (minuteList.length > 0) {
    // 規則的な間隔（10分間隔など）を検出
    const intervals = [];
    for (let i = 1; i < minuteList.length; i++) {
      intervals.push(minuteList[i] - minuteList[i - 1]);
    }
    // すべての間隔が同じ場合、intervalMinutesモードとして扱う
    if (intervals.length > 0 && intervals.every(iv => iv === intervals[0])) {
      const intervalMinutes = intervals[0];
      if (intervalMinutes >= MIN_INTERVAL_MINUTES) {
        return { mode: 'intervalMinutes', intervalMinutes, ... };
      }
    }
  }
}

// formatScheduleForDisplay関数の拡張: 分のリスト形式を読みやすく表示
if (mode === 'custom' && minute.includes(',')) {
  const minuteStr = minuteList.map(m => m.toString().padStart(2, '0')).join('、');
  return `毎週${dayLabels}の ${minuteStr}分`;
}
```

**学んだこと（機能拡張から）**:
- 分のリスト形式（`15,25,35,45,55`）は、規則的な間隔（10分間隔）として検出できる場合は`intervalMinutes`モードとして扱い、UIで編集可能にする
- 規則的でない場合は`custom`モードとして扱い、編集不可として表示するが、読みやすい形式で表示する
- 既存の`parseCronSchedule`関数を拡張することで、後方互換性を保ちながら新機能を追加できる

**関連ファイル**: 
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`
- `apps/web/src/pages/admin/csv-import-schedule-utils.ts`（`parseCronSchedule`、`formatScheduleForDisplay`関数の拡張）
- `apps/web/src/pages/admin/__tests__/csv-import-schedule-utils.test.ts`（テストケース追加）

---

### [KB-116] CSVインポートスケジュールページのフォーム状態管理改善

**日付**: 2025-12-30

**事象**: 
- スケジュールを削除した後、「新規作成」ボタンを押すと、削除したスケジュールのデータがフォームに残っていた
- 編集モードから新規作成モードに切り替わったときも、編集データがフォームに残っていた
- ログアウトして再表示すると消えていた（状態管理の問題）

**要因**: 
- `formData`が編集モードと新規作成モードで共有されていた
- 削除後に`formData`をリセットしていなかった
- 編集モードから新規作成モードに切り替わったときに、編集状態をクリアしていなかった
- `useEffect`で`showCreateForm`が`true`になったときに`formData`をリセットしていたが、編集モードがアクティブな場合は先にクリアする必要があった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-30）:
  1. **削除後のリセット**: `handleDelete`で削除したスケジュールが編集中だった場合は`cancelEdit()`を呼んで編集状態をクリア
  2. **新規作成時のリセット**: `useEffect`で`showCreateForm`が`true`になったときに`formData`をリセット
  3. **編集から新規作成への切り替え**: 「新規作成」ボタンの`onClick`で、編集モードがアクティブな場合は先に`cancelEdit()`を呼んで編集状態をクリアしてから`setShowCreateForm(true)`を呼ぶ

**実装のポイント**:
```typescript
// 新規作成フォームを開いた時にスケジュールの初期値を設定
useEffect(() => {
  if (showCreateForm) {
    // フォームデータを初期化（編集データや削除後に残った古いデータをクリア）
    setFormData({
      id: '',
      name: '',
      provider: undefined,
      targets: [],
      employeesPath: '',
      itemsPath: '',
      schedule: '0 2 * * *',
      timezone: 'Asia/Tokyo',
      enabled: true,
      replaceExisting: false,
      autoBackupAfterImport: {
        enabled: false,
        targets: ['csv']
      }
    });
    setScheduleTime('02:00');
    setScheduleDaysOfWeek([]);
  }
}, [showCreateForm]);

// 新規作成ボタン
<Button
  onClick={() => {
    // 編集モードがアクティブな場合は先にクリア
    if (editingId !== null) {
      cancelEdit();
    }
    setShowCreateForm(true);
  }}
  disabled={showCreateForm || editingId !== null}
>
  新規作成
</Button>
```

**学んだこと**: 
- フォーム状態管理では、モード切り替え時に必ず状態をリセットする必要がある
- `useEffect`の依存配列を適切に設定することで、状態の同期を保つことができる
- 部分最適ではなく、全体設計を確認してから修正することが重要
- 編集モードと新規作成モードで状態を共有する場合は、切り替え時に必ずリセットする

**解決状況**: ✅ **解決済み**（2025-12-30）

**関連ファイル**: 
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`

---

### [KB-119] 計測機器UID編集時の手動編集フラグ管理

**日付**: 2025-01-XX

**事象**: 
- 計測機器のUIDを手動編集しても、`useEffect`が`editingTags`の変更を検知してフォームを上書きしてしまう
- ユーザーがキーボードで入力した値が、APIから取得したタグ情報で上書きされる

**要因**: 
- **根本原因**: `useEffect`が`editingTags`の変更を検知すると、ユーザーの手動編集を無視してフォームを更新していた
- 手動編集とAPIからの自動更新を区別する仕組みがなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: `useRef`を使用して手動編集フラグ（`isManualEditRef`）を追加し、手動編集時は`useEffect`でフォームを更新しないように修正
- 編集開始時、NFCスキャン時、送信後、編集キャンセル時にフラグをリセット

**実装のポイント**:
```typescript
const isManualEditRef = useRef(false);

useEffect(() => {
  if (!editingId || !editingTags) return;
  const existingTagUid = editingTags[0]?.rfidTagUid ?? '';
  // ユーザーが手動で編集していない場合のみ、既存のタグUIDを設定
  if (!isManualEditRef.current) {
    setForm((prev) => ({ ...prev, rfidTagUid: existingTagUid }));
  }
}, [editingId, editingTags]);

<Input
  value={form.rfidTagUid}
  onChange={(e) => {
    isManualEditRef.current = true; // 手動編集フラグを設定
    setForm({ ...form, rfidTagUid: e.target.value });
  }}
/>
```

**学んだこと**: 
- フォームの自動更新と手動編集を区別するには、フラグを使用する必要がある
- `useRef`を使用することで、再レンダリングをトリガーせずにフラグを管理できる
- 編集開始時、NFCスキャン時、送信後、編集キャンセル時にフラグをリセットすることで、適切なタイミングで自動更新を有効化できる

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/web/src/pages/tools/MeasuringInstrumentsPage.tsx`

---

### [KB-120] 吊具管理画面のレイアウト改善（一覧表と編集フォームの重なり解消）

**日付**: 2025-01-XX

**事象**: 
- 吊具管理画面で一覧表と編集フォームが横並びで重なって見づらい
- グリッドレイアウト（`lg:grid-cols-[3.5fr,1fr]`）で一覧表と編集フォームが横並びになっていたが、画面サイズによっては被ってしまう

**要因**: 
- **根本原因**: 編集フォームが一覧表と同じCard内に横並びで配置されていた
- グリッドレイアウトの比率が適切でなく、一覧表の幅が広すぎた
- 編集フォームが右側に配置されていたが、一覧表の横スクロールと重なって見づらかった

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: 編集フォームを別のCardとして分離し、一覧表の下に縦配置に変更
- 編集フォーム内のフィールドを2列のグリッドレイアウト（`md:grid-cols-2`）に変更し、より使いやすく改善

**実装のポイント**:
```typescript
// 修正前: 横並びレイアウト
<div className="grid gap-4 lg:grid-cols-[3.5fr,1fr]">
  <div className="overflow-x-auto">
    {/* 一覧表 */}
  </div>
  <div className="rounded-md border border-slate-500 bg-white p-4">
    {/* 編集フォーム */}
  </div>
</div>

// 修正後: 縦配置レイアウト
<Card title="吊具マスター">
  <div className="overflow-x-auto">
    {/* 一覧表 */}
  </div>
</Card>

<Card title={isEditing ? '吊具編集' : '吊具登録'}>
  <div className="grid gap-4 md:grid-cols-2">
    {/* 編集フォーム（2列グリッド） */}
  </div>
</Card>
```

**学んだこと**: 
- 一覧表と編集フォームを別のCardとして分離することで、レイアウトの柔軟性が向上する
- 縦配置にすることで、画面サイズに関わらず重ならずに表示できる
- 編集フォーム内のフィールドを2列のグリッドレイアウトにすることで、より多くの情報を効率的に表示できる
- 他のページ（従業員管理、工具管理）と同様のパターンに統一することで、UIの一貫性が保たれる

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/web/src/pages/tools/RiggingGearsPage.tsx`

---

### [KB-122] 計測機器管理画面にdepartment表示・編集機能を追加

**日付**: 2025-01-XX

**事象**: 
- 計測機器管理画面に`department`列が表示されていない
- `department`フィールドの編集機能がない
- DBには`department`フィールドが存在するが、UIで表示・編集できない

**要因**: 
- **根本原因**: 
  - Web共有型`MeasuringInstrument`に`department`フィールドがなかった
  - APIの計測機器作成/更新スキーマに`department`がなかった
  - APIサービスのcreate/update入力に`department`がなかった
  - フロントエンドの一覧表とフォームに`department`がなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-01-XX）: 
  - API: 計測機器create/updateに`department`フィールドを追加
  - API: `/api/tools/departments`エンドポイントを追加（従業員マスターから部署一覧を取得）
  - shared-types: `MeasuringInstrument`に`department`フィールドを追加
  - Web: 計測機器管理画面に部署列と選択式編集（ドロップダウン）を追加

**実装のポイント**:
```typescript
// API: 部署一覧取得エンドポイント
app.get('/departments', { preHandler: canView }, async () => {
  const employees = await prisma.employee.findMany({
    select: { department: true },
    where: {
      AND: [
        { department: { not: null } },
        { department: { not: '' } }
      ]
    }
  });
  const departmentSet = new Set<string>();
  employees.forEach((emp) => {
    if (emp.department && emp.department.trim() !== '') {
      departmentSet.add(emp.department);
    }
  });
  return { departments: Array.from(departmentSet).sort() };
});

// Web: 部署選択フィールド
const { data: departmentsData } = useDepartments();
const departments = departmentsData?.departments ?? [];

<select
  value={form.department}
  onChange={(e) => setForm({ ...form, department: e.target.value })}
>
  <option value="">選択してください</option>
  {departments.map((dept) => (
    <option key={dept} value={dept}>{dept}</option>
  ))}
</select>
```

**学んだこと**: 
- 既存のCRUDパターンに従って最小限の変更で実装できる
- 部署候補は従業員マスターから動的に取得することで、データの一貫性を保つことができる
- 選択式フィールドは`useDepartments`フックを使用して候補を取得し、ドロップダウンで表示する
- Prismaの`where`句で複数の条件を指定する場合は`AND`条件を使用する必要がある

**解決状況**: ✅ **解決済み**（2025-01-XX）

**関連ファイル**: 
- `apps/web/src/pages/tools/MeasuringInstrumentsPage.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/api/src/routes/tools/departments.ts`
- `packages/shared-types/src/measuring-instruments/index.ts`

---

### [KB-117] CSVインポートUIの4フォーム分割実装

**日付**: 2025-12-31

**事象**: 
- USBメモリ経由のCSVインポート機能が、従業員・工具のみに対応しており、計測機器・吊具のCSVインポートがUIから実行できなかった
- 既存の`MasterImportPage.tsx`は、従業員・工具の2つのフォームのみを表示していた
- 検証のためには、各データタイプを個別にアップロードできるUIが必要だった

**要因**: 
- 既存の`MasterImportPage.tsx`は、従業員・工具の2つのフォームのみを実装していた
- 計測機器・吊具のCSVインポートは、APIレベルでは実装済みだったが、UIから実行するフォームがなかった
- 各データタイプを個別にアップロードできるUIが必要だった

**有効だった対策**: 
- ✅ **解決済み**（2025-12-31）: 4つのフォームに分割し、各データタイプを個別にアップロードできるように改善
  1. **共通コンポーネント作成**: `ImportForm`コンポーネントを作成し、各データタイプのフォームを共通化
  2. **4つのフォーム表示**: 従業員・工具・計測機器・吊具の4つのフォームを個別に表示
  3. **新APIフック追加**: `useImportMasterSingle`フックを追加し、`POST /api/imports/master/:type`エンドポイントを呼び出す
  4. **各フォームの独立性**: 各フォームで`replaceExisting`を個別に設定可能
  5. **ファイル選択の改善**: 各フォームでファイル名を表示し、選択したファイルを確認可能に

**実装のポイント**:
```typescript
// ImportFormコンポーネント（共通化）
function ImportForm({ type, label, fileName }: ImportFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const importMutation = useImportMasterSingle();
  
  const handleSubmit = async () => {
    if (!file) return;
    
    await importMutation.mutateAsync({
      type,
      file,
      replaceExisting
    });
  };
  
  return (
    <div className="space-y-2">
      <label>{label}</label>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      {file && <p>選択ファイル: {file.name}</p>}
      <label>
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.target.checked)}
        />
        既存データをクリアしてから取り込み（{label}のみ）
      </label>
      <button onClick={handleSubmit}>取り込み開始</button>
    </div>
  );
}

// MasterImportPage.tsx（4つのフォームを表示）
export function MasterImportPage() {
  return (
    <div className="space-y-6">
      <Card title="USB 一括登録">
        <ImportForm type="employees" label="従業員CSV" fileName="employees.csv" />
        <ImportForm type="items" label="工具CSV" fileName="items.csv" />
        <ImportForm type="measuringInstruments" label="計測機器CSV" fileName="measuring-instruments.csv" />
        <ImportForm type="riggingGears" label="吊具CSV" fileName="rigging-gears.csv" />
      </Card>
    </div>
  );
}
```

**学んだこと**: 
- 共通コンポーネントを作成することで、コードの重複を避けられる
- 各データタイプを個別にアップロードできるUIにより、ユーザビリティが向上する
- ファイル選択の改善により、ユーザーが選択したファイルを確認できる
- 各フォームで`replaceExisting`を個別に設定できることで、柔軟性が向上する

**解決状況**: ✅ **解決済み**（2025-12-31）

**関連ファイル**: 
- `apps/web/src/pages/admin/MasterImportPage.tsx`
- `apps/web/src/pages/admin/components/ImportForm.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`

---

### [KB-125] キオスクお問い合わせフォームのデザイン変更

**日付**: 2026-01-03

**事象**:
- キオスクUIのお問い合わせフォームのデザインを改善する必要があった
- 送信者を社員名簿から選択できるようにしたい
- 「よくある困りごと」を削除し、依頼内容をドロップダウンで選択できるようにしたい
- 打合せ日時の選択フィールドを追加したい

**要因**:
- **根本原因**: 既存のフォームは「よくある困りごと」の選択式ボタンと詳細テキストエリアのみで、送信者情報や打合せ日時が含まれていなかった
- ユーザーからの要望で、より実用的なフォームデザインが必要だった

**有効だった対策**:
- ✅ **解決済み**（2026-01-03）:
  1. **送信者ドロップダウン**: `useKioskEmployees()`フックを使用して社員名簿から選択可能に
  2. **依頼内容ドロップダウン**: 「よくある困りごと」を削除し、「現場まで来てください。」を選択式に変更
  3. **打合せ日時フィールド**: 日付（`type="date"`）と時刻（`type="time"`）の入力欄を追加
  4. **デフォルト日時**: `useEffect`を使用して、モーダルが開かれた時点の日時をデフォルト値として設定
  5. **詳細フィールド**: 既存の詳細（任意）テキストエリアを維持

**実装のポイント**:
```typescript
// apps/web/src/components/kiosk/KioskSupportModal.tsx
export function KioskSupportModal({ isOpen, onClose }: KioskSupportModalProps) {
  const [clientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const { data: employees, isLoading: isLoadingEmployees } = useKioskEmployees(clientKey || DEFAULT_CLIENT_KEY);
  
  const [selectedSender, setSelectedSender] = useState<string>('');
  const [requestType, setRequestType] = useState<string>('');
  const [meetingDate, setMeetingDate] = useState<string>('');
  const [meetingTime, setMeetingTime] = useState<string>('');
  const [message, setMessage] = useState('');

  // モーダルが開かれたときに日時をデフォルト値に設定
  useEffect(() => {
    if (isOpen) {
      setMeetingDate(getDefaultDate());
      setMeetingTime(getDefaultTime());
    }
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    // メッセージを組み立て
    const selectedEmployee = employees?.find((emp: { id: string; displayName: string; department: string | null }) => emp.id === selectedSender);
    const senderName = selectedEmployee?.displayName || '不明';
    const requestTypeLabel = requestTypes.find((rt) => rt.value === requestType)?.label || '';
    
    let userMessage = `送信者: ${senderName}\n依頼内容: ${requestTypeLabel}`;
    
    if (meetingDate && meetingTime) {
      userMessage += `\n打合せ日時: ${meetingDate} ${meetingTime}`;
    }
    
    if (message.trim()) {
      userMessage += `\n詳細: ${message.trim()}`;
    }

    await postKioskSupport({ message: userMessage, page: location.pathname }, clientKey || DEFAULT_CLIENT_KEY);
  };
}
```

**学んだこと**:
- `useEffect`を使用して、モーダルが開かれた時点の日時をデフォルト値として設定することで、ユーザーの入力負担を軽減できる
- キオスク専用のエンドポイント（`/api/kiosk/employees`）を使用することで、認証エラーを回避できる
- フォームの各フィールドを必須/任意で適切に設定することで、ユーザビリティが向上する

**解決状況**: ✅ **解決済み**（2026-01-03）

**関連ファイル**:
- `apps/web/src/components/kiosk/KioskSupportModal.tsx`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/api/src/routes/kiosk.ts`

---

### [KB-136] WebRTC useWebRTCフックのcleanup関数が早期実行される問題

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- 着信通知を受信して`callState`を`'incoming'`に設定しても、即座に`cleanup()`が呼ばれて`'idle'`に戻る
- 結果として着信モーダルが表示されない
- ログで`incoming effect evaluated`→`cleanup called`の連続発生を確認

**要因**: 
- `useWebRTC`フックに渡す`onLocalStream`、`onRemoteStream`、`onError`コールバックが`KioskCallPage.tsx`内のインライン関数
- これらのインライン関数は毎回再生成されるため、`useCallback`の依存配列が変化
- 結果として`cleanup`関数が再生成され、`useEffect([cleanup])`が再実行
- `useEffect`のクリーンアップ関数として古い`cleanup`が呼ばれ、状態がリセット

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: コールバックを`useRef`で保持し、`cleanup`を安定化
```typescript
// useWebRTC.ts
const onLocalStreamRef = useRef(onLocalStream);
const onRemoteStreamRef = useRef(onRemoteStream);
const onErrorRef = useRef(onError);

useEffect(() => {
  onLocalStreamRef.current = onLocalStream;
  onRemoteStreamRef.current = onRemoteStream;
  onErrorRef.current = onError;
}, [onLocalStream, onRemoteStream, onError]);

const cleanup = useCallback(() => {
  // cleanup logic - 安定した参照を使用
}, []); // 空の依存配列

useEffect(() => {
  return () => cleanup();
}, []); // アンマウント時のみ実行
```

**学んだこと**:
- `useEffect`の依存配列に含まれる関数が毎回再生成されると、意図しないクリーンアップが発生する
- コールバック関数は`useRef`で保持し、安定した参照を維持する
- `cleanup`関数は`useCallback([], [])`で安定化し、アンマウント時のみ実行されるようにする
- デバッグログで状態変化のタイミングを追跡することが重要

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/features/webrtc/hooks/useWebRTC.ts`
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`

---

### [KB-137] マイク未接続端末でのrecvonlyフォールバック実装

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- Pi4（マイク未接続）で通話を受話すると「Could not start audio source」エラーが発生
- `getUserMedia(audio)`が`NotAllowedError`または`NotFoundError`で失敗
- 通話が即座に切断される

**要因**: 
- `getUserMedia`失敗時に即座に`cleanup()`を呼んで通話を終了する実装だった
- マイクが物理的に存在しない端末では音声取得が常に失敗
- 受信専用（recvonly）でも通話を継続できるはずだった

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: `getUserMedia`失敗時にrecvonlyモードで継続
```typescript
// useWebRTC.ts - startCall/accept内
try {
  const stream = await getAudioStream();
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  onLocalStreamRef.current?.(stream);
} catch (error) {
  // マイク取得失敗時はrecvonly（受信専用）で継続
  console.warn('Microphone unavailable, continuing in recvonly mode:', error);
  // cleanup()を呼ばず、ローカルストリームなしで継続
}
```

**学んだこと**:
- マイク/カメラがない端末でも通話を受信できるようにする（受信専用モード）
- `getUserMedia`失敗は致命的エラーではなく、gracefulにハンドリングする
- エラー時のフォールバック動作を明確に定義する
- 実機検証で様々なハードウェア構成をテストすることが重要

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/features/webrtc/hooks/useWebRTC.ts`
- `apps/web/src/features/webrtc/utils/media.ts`

---

### [KB-138] ビデオ通話時のDOM要素へのsrcObjectバインディング問題

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- ビデオを有効化してもMac側で黒い画面が表示される
- カメラのLEDは点灯しているが映像が表示されない
- `video.play()`のログが出力されない

**要因**: 
- `<video>`要素を条件付きレンダリング（`isVideoEnabled && localStream`）していた
- `onLocalStream`コールバックでMediaStreamを受け取った時点では、まだ`<video>`要素がDOMに存在しない
- `srcObject`を設定しようとしても対象要素がない

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: `useEffect`でストリームとDOM要素の両方が存在する時に`srcObject`を設定
```typescript
// KioskCallPage.tsx
const [localStreamForUi, setLocalStreamForUi] = useState<MediaStream | null>(null);
const localVideoRef = useRef<HTMLVideoElement>(null);

// onLocalStreamコールバックでstateを更新
const handleLocalStream = (stream: MediaStream) => {
  setLocalStreamForUi(stream);
};

// useEffectでsrcObjectをバインド
useEffect(() => {
  if (localStreamForUi && localVideoRef.current) {
    localVideoRef.current.srcObject = localStreamForUi;
    localVideoRef.current.play().catch(console.warn);
  }
}, [localStreamForUi]);
```

**学んだこと**:
- 条件付きレンダリングとMediaStreamの組み合わせは注意が必要
- `srcObject`の設定は、DOM要素が存在するタイミングで行う
- `useEffect`を使用してストリームとDOM要素の両方が利用可能な時にバインドする
- `video.play()`は必ず呼び出し、autoplay policyに対応する

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`

---

### [KB-139] WebRTCシグナリングのWebSocket接続管理（重複接続防止）

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- コンソールログに`connect called`が連続で出力される
- 複数のWebSocket接続が同時に試行される
- 接続成功後も再接続が繰り返される

**要因**: 
- `useEffect`の依存配列に`connect`関数が含まれていた
- `connect`関数は毎レンダリングで再生成される（依存する状態が変化するため）
- 結果として`useEffect`が連続実行され、複数の接続試行が発生

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: 接続状態チェックと`isConnecting`フラグを追加
```typescript
// useWebRTCSignaling.ts
const [isConnecting, setIsConnecting] = useState(false);

const connect = useCallback(() => {
  // 既に接続済みまたは接続試行中なら何もしない
  const currentState = socketRef.current?.readyState;
  if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
    return;
  }
  setIsConnecting(true);
  // ...
}, [...]);

useEffect(() => {
  if (enabled) connect();
  else disconnect();
  return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [enabled]); // connect/disconnectを依存配列から除外
```

**学んだこと**:
- `useEffect`の依存配列から関数を除外する場合は、その影響を理解した上で`eslint-disable`コメントを付ける
- WebSocket接続状態（`readyState`）をチェックして重複接続を防止する
- `isConnecting`状態を使用して接続試行中の重複を防ぐ
- 無限ループを防ぐため、依存関係を慎重に設計する

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`

---

### [KB-140] useLocalStorageとの互換性のためのJSON.stringify対応

**EXEC_PLAN.md参照**: feat/webrtc-voice-call実装（2026-01-04〜05）

**事象**: 
- Macで発信先一覧にPi4が表示されない
- APIへのリクエストで`x-client-key`がPi4のキーになっている
- `localStorage`に設定したMac用のクライアントキーが正しく読み取れない

**要因**: 
- `useLocalStorage`フックは値をJSON形式で保存する（`JSON.stringify`）
- 手動で`localStorage.setItem`した値がJSON形式でない場合、`useLocalStorage`が正しく読み取れない
- `resolveClientKey()`関数がJSON.parseに失敗してフォールバック値を返す

**有効だった対策**: 
- ✅ **解決済み**（2026-01-05）: `JSON.stringify`を使用して保存するよう手順を更新
```javascript
// ブラウザのコンソールで実行
localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-mac-kiosk1'))
localStorage.setItem('kiosk-client-id', JSON.stringify('mac-kiosk-1'))
```
- `resolveClientKey`関数で両形式（JSON/生文字列）をサポート

**追加対策**: 
- デバッグ用にURLクエリパラメータでクライアントキーを上書きできる機能を追加
```
https://100.106.158.2/kiosk/call?clientKey=client-key-mac-kiosk1&clientId=mac-kiosk-1
```

**学んだこと**:
- `useLocalStorage`フックはJSON形式で保存するため、手動設定時も`JSON.stringify`を使用する
- 既存データとの互換性のため、読み取り時は両形式をサポートする
- デバッグ用にURLパラメータで設定を上書きできると便利
- ドキュメントに正しい設定手順を明記する

**解決状況**: ✅ **解決済み**（2026-01-05）

**関連ファイル**:
- `apps/web/src/api/client.ts`
- `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`
- `docs/guides/webrtc-verification.md`

---

## KB-149: バックアップ履歴ページに用途列を追加（UI改善）

**EXEC_PLAN.md参照**: バックアップ履歴ページUI改善（2026-01-06）

**目的**:
- バックアップ履歴のテーブルに「用途」列を追加し、各バックアップ対象の用途を一目で把握できるようにする
- `targetKind`と`targetSource`から用途を自動判定し、人間が読みやすい形式で表示する

**実装内容**:
- ✅ **解決済み**（2026-01-06）: 以下の対策を実装し、バックアップ履歴の可読性を向上させた。
  1. **`getTargetPurpose`関数の追加**: `targetKind`と`targetSource`から用途を判定する関数を追加
     - **ファイル系**: `backup.json`（バックアップ設定）、`vault.yml`（Ansible設定）、`.env`（環境変数）、証明書ファイルなど
     - **ディレクトリ系**: 証明書ディレクトリ、PDFファイル、Tailscale設定、SSH鍵など
     - **データベース**: データベース（全データ）
     - **CSV**: 従業員データ、アイテムデータ、計測機器データ、吊具データなど
     - **画像**: 写真・サムネイル
     - **クライアントファイル/ディレクトリ**: NFCエージェント設定、Tailscale設定など
  2. **テーブルに「用途」列を追加**: 「対象」列の後に配置し、各バックアップ履歴の用途を表示
  3. **colSpanの調整**: 空の行のcolSpanを9から10に変更

**表示例**:
| 日時 | 操作種別 | 対象 | **用途** | ストレージ | ... |
|------|---------|------|---------|-----------|-----|
| 2026-01-06 15:00 | バックアップ | file (/app/config/backup.json) | **バックアップ設定（Gmail/Dropboxトークン）** | dropbox | ... |
| 2026-01-06 15:00 | バックアップ | file (/app/host/infrastructure/ansible/host_vars/raspberrypi5/vault.yml) | **Ansible設定（Dropbox認証情報）** | dropbox | ... |
| 2026-01-06 15:00 | バックアップ | file (/opt/RaspberryPiSystem_002/apps/api/.env) | **API環境変数** | dropbox | ... |
| 2026-01-06 15:00 | バックアップ | database (postgresql://...) | **データベース（全データ）** | dropbox | ... |

**学んだこと**:
- **UI改善の重要性**: パスや`targetKind`だけでは用途が分かりにくいが、「用途」列を追加することで一目で把握できる
- **自動判定の実装**: `targetKind`と`targetSource`から用途を自動判定することで、運用者の負担を軽減
- **可読性の向上**: 日本語で用途を表示することで、非技術者でも理解しやすくなる

**解決状況**: ✅ **解決済み**（2026-01-06: 実装完了、2026-01-06: CI成功、2026-01-06: 実機検証完了）

**実機検証結果**（2026-01-06）:
- ✅ **用途列の表示**: バックアップ履歴ページに「用途」列が正しく表示されることを確認
- ✅ **用途の判定**: 各バックアップ履歴の用途が正しく判定され、日本語で表示されることを確認
- ✅ **レイアウト**: テーブルのレイアウトが崩れず、すべての列が正しく表示されることを確認

**関連ファイル**:
- `apps/web/src/pages/admin/BackupHistoryPage.tsx`（getTargetPurpose関数、用途列の追加）

---

### [KB-171] WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定）

**実装日時**: 2026-01-16

**事象**: 
- ビデオ通話機能が動作しない（Pi4とMacで確認）
- WebSocket接続が確立されない
- シグナリングサーバーへの接続が試行されない

**要因**: 
- `KioskCallPage.tsx`で`clientKey`と`clientId`が設定されていなかった
- `useWebRTCSignaling`フックの`connect()`関数は`localStorage`から`clientKey`と`clientId`を取得するが、`KioskCallPage.tsx`で`useLocalStorage`を呼んでいなかったため、`localStorage`に値が保存されない
- `connect()`内で`clientKey`または`clientId`が空のため、93行目で早期リターンし、WebSocket接続が試行されない

**実施した対策**: 
- ✅ **（当時）`KioskCallPage.tsx`に`useLocalStorage`を追加**: `clientKey`と`clientId`を`localStorage`から取得して保持
- ✅ **（当時）`resolveClientKey`関数の改善**: `DEFAULT_CLIENT_KEY`フォールバックを追加

**追記（2026-02-09）**:
- 通話IDは`ClientDevice.id`（UUID）に統一し、`kiosk-client-id`（localStorage）は不要になった
- `KioskLayout`/`KioskHeader`はAPI由来の`selfClientId`を表示する
- `/kiosk/*`や`/signage`表示中でも着信できるよう、WebRTCシグナリング接続をページから分離し常時保持（着信時に`/kiosk/call`へ自動切替、終了後に元画面へ復帰）
- Pi3は通話対象から除外（`/api/kiosk/call/targets`で除外フィルタ適用）

**実装の詳細**:
1. **`KioskCallPage.tsx`の修正**: `useLocalStorage`フックを追加し、`clientKey`と`clientId`を取得
   ```typescript
   // clientKeyとclientIdをlocalStorageから取得（WebRTCシグナリングに必要）
   const [clientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
   const [clientId] = useLocalStorage('kiosk-client-id', '');
   ```
2. **`resolveClientKey`関数の改善**: `localStorage`に値がない場合や空文字の場合、`DEFAULT_CLIENT_KEY`を返すように修正

**学んだこと**:
1. **通話IDの単一ソース化が重要**: 複数系統のID（localStorage、statusClientId）を混在させると疎通が破綻しやすい
2. **`x-client-key`の一貫性**: UI表示・APIヘッダー・WebSocket接続で同じキーを使う必要がある
3. **新しいページ追加時の注意**: 通話/疎通に関わるIDとキーの取得元を明文化してから実装する

**解決状況**: ✅ **解決済み**（2026-01-16）

**関連ファイル**:
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`（useLocalStorage追加）
- `apps/web/src/api/client.ts`（resolveClientKey関数の改善）
- `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`（connect関数）

---

### [KB-225] キオスク入力フィールド保護ルールの実装と実機検証

**実装日時**: 2026-02-02

**事象**: 
- Raspberry Pi 4を再起動した後、APIキーとIDがランダムな文字列（`QAZwsxedcrftvgbuyhnk,olp.;` と `q3artf5uyh7p;.z BNM,..`）に置き換わり、データベースにアクセスできなくなった
- キーボードにジュースをこぼして拭いた際に、キーボードのキーが誤って押され、入力フィールドにランダムな文字列が入力された
- この値が`localStorage`に保存され、再起動後もその値が読み込まれた

**要因**: 
- `KioskHeader.tsx`の入力フィールドが編集可能で、任意の文字列が入力可能だった
- `useLocalStorage`フックが`value`が変更されるたびに自動的に`localStorage`に保存し、不正な値でも保存されてしまった
- 読み込み時の検証が不足しており、不正な形式の値でもそのまま使用されていた

**実施した対策**: 
- ✅ **入力フィールドの完全削除**: `KioskHeader.tsx`の`<Input>`コンポーネントを削除し、`<span>`要素による表示のみに変更
- ✅ **localStorageへの書き込み抑制**: 各キオスクページから`useLocalStorage('kiosk-client-key')`の使用を削除
- ✅ **起動時防御の実装**: `kiosk-client-key`が未設定/空の場合のみ`DEFAULT_CLIENT_KEY`を設定（既存キーは保持）
- ✅ **自動復旧機能の実装**: 401（`INVALID_CLIENT_KEY`）時に自動的に`DEFAULT_CLIENT_KEY`へ復元してページをリロード

**実装の詳細**:
1. **`KioskHeader.tsx`の修正**: `<Input>`コンポーネントを`<span>`に変更し、編集不可に
   ```typescript
   <span className="text-white/70">
     APIキー: <span className="font-mono text-white/90">{formatKey(clientKey)}</span>
   </span>
   ```
2. **各キオスクページの修正**: `useLocalStorage`の使用を削除し、`resolvedClientKey`を`DEFAULT_CLIENT_KEY`に直接設定
3. **`client.ts`の修正**: 未設定時のみ`DEFAULT_CLIENT_KEY`を設定、`resetKioskClientKey()`関数と`axios` interceptorを追加

**実機検証結果（2026-02-02）**:
- ✅ **IDとAPIキーが編集不可に改善されている**: ヘッダーのAPIキー/IDが表示のみで編集できないことを確認
- ✅ **生産スケジュールの値が表示されている**: 生産スケジュール画面で値が正常に表示されることを確認
- ⏸️ **自動復旧機能は後日試す予定**: 開発者ツールでlocalStorageを手動で不正な値に変更し、APIアクセス時の自動復旧を確認予定

**追記（2026-02-09）**:
- 通話IDは`ClientDevice.id`（UUID）に統一し、`kiosk-client-id`（localStorage）は通話に不要

**トラブルシューティング**:
- **デプロイ後の入力欄が残る問題**: Webコンテナが再ビルドされていない場合、古いビルドが動いている可能性がある。`docker compose build --no-cache web && docker compose up -d web`で再ビルドが必要

**学んだこと**:
1. **UIロックの重要性**: 入力フィールドを削除することで、誤入力の根本原因を排除できる
2. **localStorageへの依存削減**: 入力UIからの書き込みを排除し、必要最低限の保存に限定する
3. **自動復旧の実装**: APIエラー（401/INVALID_CLIENT_KEY）を検知して自動的に復旧することで、運用負荷を軽減できる
4. **デプロイ時の再ビルド確認**: コード変更時はWebコンテナの再ビルドが必要であり、デプロイログで確認すべき

**解決状況**: ✅ **実装完了・実機検証完了**（2026-02-02）

**関連ファイル**:
- `apps/web/src/components/kiosk/KioskHeader.tsx`（入力フィールド削除・表示のみに変更）
- `apps/web/src/api/client.ts`（起動時防御・自動復旧機能の実装）
- `apps/web/src/layouts/KioskLayout.tsx`（表示/APIヘッダーを実際に利用するキーに統一）
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`（localStorage使用削除）
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`（localStorage使用削除）
- `apps/web/src/pages/kiosk/KioskRiggingBorrowPage.tsx`（localStorage使用削除）
- `apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`（localStorage使用削除）
- `apps/web/src/pages/kiosk/KioskReturnPage.tsx`（localStorage使用削除）
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`（localStorage使用削除）
- `apps/web/src/components/kiosk/KioskSupportModal.tsx`（localStorage使用削除）

**参考**:
- [KB-225: キオスク入力フィールド保護ルールの実装と実機検証](./kiosk-input-protection-investigation.md)

---

### [KB-184] 生産スケジュールキオスクページ実装と完了ボタンのグレーアウト・トグル機能

**実装日時**: 2026-01-XX（初回実装）、2026-01-24（UI改善：テーブル形式化）、2026-01-26（列名変更・FSEIBAN全文表示）

**事象**: 
- PowerAppsの生産スケジュールUIを参考に、キオスクページ（`/kiosk/production-schedule`）を実装
- CSVダッシュボード（`ProductionSchedule_Mishima_Grinding`）のデータをキオスク画面で表示
- 完了ボタン（赤いボタン）を押すと`progress`フィールドに「完了」が入り、完了した部品を視覚的に識別可能に
- **UI改善（2026-01-24）**: カード形式では表示数に限界があり、より多くのアイテムを表示するためにテーブル形式に変更
- **列名変更・FSEIBAN全文表示（2026-01-26）**: `ProductNo`を「製造order番号」に変更、`FSEIBAN`を「製番」に変更し、`FSEIBAN`のマスクを削除して全文を表示

**実装内容**: 
- ✅ **キオスクページ実装**: `ProductionSchedulePage.tsx`を実装し、CSVダッシュボードのデータを表示
- ✅ **完了ボタンのグレーアウト**: `progress='完了'`のアイテムを`opacity-50 grayscale`で視覚的にグレーアウト
- ✅ **完了ボタンのトグル機能**: 完了ボタンを押すと`progress`が「完了」→空文字（未完了）にトグル
- ✅ **完了ボタンの色変更**: 完了状態に応じて背景色を変更（未完了=赤、完了=グレー）
- ✅ **チェックマーク位置調整**: 「✓」ボタンとテキストの重なりを解消（`pr-11`でパディング追加）
- ✅ **FSEIBAN表示**: `FSEIBAN`の下3桁を表示（`seibanMasked`と併記）
- ✅ **列名変更（2026-01-26）**: `ProductNo`を「製造order番号」に変更、`FSEIBAN`を「製番」に変更
- ✅ **FSEIBAN全文表示（2026-01-26）**: `FSEIBAN`のマスクを削除し、8文字の英数字を全文表示
- ✅ **UI改善（2026-01-24）**: カード形式からテーブル形式に変更し、表示密度を向上
  - **1行2アイテム表示**: 幅1200px以上の画面で1行に2アイテムを表示（レスポンシブ対応）
  - **列幅自動調整**: CSVダッシュボードの列幅計算ロジックをフロントエンドに移植し、テキスト幅に応じて自動調整
  - **完了チェックボタン**: 左端に配置し、完了状態を視覚的に識別可能に

**API変更**:
- ✅ **GET /kiosk/production-schedule**: すべての行を返すように変更（完了済みも含む）
- ✅ **PUT /kiosk/production-schedule/:rowId/complete**: トグル機能を実装（完了→未完了、未完了→完了）

**実装の詳細**:
1. **キオスクページ**: `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`を実装
   - CSVダッシュボードのデータを取得（`useQuery`）
   - 完了状態に応じたスタイリング（`opacity-50 grayscale`）
   - 完了ボタンのトグル機能（`useMutation`）
   - **UI改善（2026-01-24）**: テーブル形式への変更
     - `ResizeObserver`を使用したコンテナ幅の監視
     - 幅1200px以上で2列表示、未満で1列表示（レスポンシブ）
     - `columnWidth.ts`ヘルパーを使用した列幅自動調整
     - 行のペアリング（`rowPairs`）による2アイテム表示
2. **列幅計算ヘルパー**: `apps/web/src/features/kiosk/columnWidth.ts`を新規作成
   - CSVダッシュボードの列幅計算ロジック（`csv-dashboard-template-renderer.ts`）をフロントエンドに移植
   - `computeColumnWidths`関数: テキスト幅に基づく列幅計算
   - `approxTextEm`関数: 半角/全角文字を考慮したテキスト幅推定
   - `shrinkToFit`関数: コンテナ幅を超える場合の比例縮小
3. **APIエンドポイント**: `apps/api/src/routes/kiosk.ts`を修正
   - `GET /kiosk/production-schedule`: `progress`フィルタを削除し、すべての行を返す
   - `PUT /kiosk/production-schedule/:rowId/complete`: トグルロジックを実装
4. **テスト更新**: `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`を更新
   - 完了済みアイテムも返されることを確認
   - トグル機能の動作を確認

**トラブルシューティング**:
1. **seed.tsの`enabled: true`不足**: `ProductionSchedule_Mishima_Grinding`の`upsert`で`update`ブロックに`enabled: true`がなく、無効化される可能性があった。`update`ブロックに`enabled: true`を追加して修正。
2. **prisma db seed失敗**: 本番環境（Raspberry Pi）で`prisma db seed`が失敗（`tsx`がdev依存のため）。直接SQLで`INSERT ... ON CONFLICT DO UPDATE`を実行して解決。
3. **CIテスト失敗**: API変更により、テストの期待値が不一致。テストを更新して完了済みアイテムも含むことを確認するように修正。

**学んだこと**:
1. **完了状態の視覚的表現**: グレーアウト（`opacity-50 grayscale`）により、完了済みアイテムを一目で識別可能
2. **トグル機能の実装**: 完了→未完了のトグルにより、誤操作時の復元が可能
3. **seed.tsの注意点**: `upsert`の`update`ブロックに`enabled`などの必須フィールドを含める必要がある
4. **本番環境でのseed実行**: `tsx`がdev依存のため、本番環境では直接SQLで実行する必要がある場合がある
5. **UI改善（2026-01-24）**:
   - **表示密度の向上**: カード形式からテーブル形式への変更により、1行あたりの表示数を2倍に（幅1200px以上の場合）
   - **ロジックの再利用**: バックエンドの列幅計算ロジックをフロントエンドに移植し、一貫したUI動作を実現
   - **レスポンシブデザイン**: `ResizeObserver`を使用した動的なレイアウト切り替え
   - **モジュール化**: 列幅計算ロジックを`columnWidth.ts`に分離し、保守性を向上

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-XX）

**実機検証結果**: ✅ **すべて正常動作**（2026-01-XX、2026-01-24 UI改善後も正常動作）
- CSVダッシュボードのデータがキオスク画面に表示されることを確認
- 完了ボタンを押すと`progress`が「完了」に更新されることを確認
- 完了済みアイテムがグレーアウトされることを確認
- 完了ボタンを再度押すと`progress`が空文字（未完了）に戻ることを確認
- チェックマークとテキストの重なりが解消されていることを確認
- `FSEIBAN`の下3桁が表示されることを確認
- **UI改善後（2026-01-24）**: テーブル形式で正常表示、1行2アイテム表示（幅1200px以上）、列幅自動調整が正常動作することを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（キオスクページ実装、2026-01-24にテーブル形式化、2026-01-26に列名変更・FSEIBAN全文表示）
- `apps/web/src/features/kiosk/columnWidth.ts`（列幅計算ヘルパー、2026-01-24に新規作成）
- `apps/api/src/routes/kiosk.ts`（APIエンドポイント修正）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（テスト更新）
- `apps/api/prisma/seed.ts`（`enabled: true`追加、列名変更）
- `apps/api/src/services/csv-dashboard/csv-dashboard-template-renderer.ts`（列幅計算ロジックの参考元）

---

### [KB-202] 生産スケジュールキオスクページの列名変更とFSEIBAN全文表示

**実装日時**: 2026-01-26

**事象**: 
- キオスク画面の生産スケジュールページで、`ProductNo`が「製番01」と表示されていたが、実際は「製造order番号」（10桁数字）であるべき
- `FSEIBAN`が「製番02」と表示されていたが、実際は「製番」（8文字英数字）であるべき
- `FSEIBAN`がマスク表示（下3桁のみ）されていたが、全文表示が必要

**要因**: 
- **列名**: `seed.ts`の`displayName`が「製番01」「製番02」となっており、実際の仕様と不一致
- **FSEIBAN表示**: `ProductionSchedulePage.tsx`で`FSEIBAN`をマスク表示していたが、仕様では全文表示が必要

**有効だった対策**: 
- ✅ **列名変更（2026-01-26）**:
  1. `seed.ts`で`ProductNo`の`displayName`を「製造order番号」に変更
  2. `seed.ts`で`FSEIBAN`の`displayName`を「製番」に変更
  3. `ProductionSchedulePage.tsx`の`tableColumns`ラベルを更新
- ✅ **FSEIBAN全文表示（2026-01-26）**:
  1. `ProductionSchedulePage.tsx`から`seibanMasked`と`seibanLastDigits`のロジックを削除
  2. `FSEIBAN`をそのまま表示（8文字の英数字）

**実装の詳細**:
```typescript
// seed.ts
{
  key: 'ProductNo',
  displayName: '製造order番号', // 変更前: '製番01'
  // ...
},
{
  key: 'FSEIBAN',
  displayName: '製番', // 変更前: '製番02'
  // ...
}

// ProductionSchedulePage.tsx
const tableColumns = [
  // ...
  { key: 'ProductNo', label: '製造order番号' }, // 変更前: 'ProductNo'
  // ...
  { key: 'FSEIBAN', label: '製番' }, // 変更前: 'FSEIBAN'
];

// FSEIBAN表示（マスク削除）
<td>{row.FSEIBAN}</td> // 変更前: {seibanMasked} ({seibanLastDigits})
```

**学んだこと**:
- **列名の一貫性**: CSVダッシュボードの列名は、実際のデータ仕様と一致させる必要がある
- **表示仕様**: マスク表示が必要な場合と全文表示が必要な場合を明確に区別する
- **seed.tsの更新**: 列名変更は`seed.ts`とUIの両方で更新する必要がある

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-26）

**実機検証結果**: ✅ **すべて正常動作**（2026-01-26）
- キオスク画面で「製造order番号」「製番」が正しく表示されることを確認
- `FSEIBAN`が8文字の英数字で全文表示されることを確認

**関連ファイル**:
- `apps/api/prisma/seed.ts`（列名変更）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（列名変更・FSEIBAN全文表示）

---

### [KB-204] CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング

**実装日時**: 2026-01-27

**事象**: 
- CSVインポートスケジュールページで、1つのスケジュールの「実行」ボタンを押すと、他のスケジュールのボタンも「実行中...」と表示されてしまう
- 複数のスケジュールを同時に実行しようとすると、競合が発生する可能性がある
- 既に実行中のスケジュールを再度実行しようとすると、500エラーが発生していた

**要因**: 
- **UI状態管理**: `useState`のみで実行中のスケジュールIDを管理していたため、非同期更新の遅延により、複数の`handleRun`呼び出しが同時に進行してしまっていた
- **APIエラーハンドリング**: スケジューラーから「CSV import is already running」エラーが返された際、500エラーとして処理されていた

**有効だった対策**: 
- ✅ **useRefによる競合防止（2026-01-27）**:
  1. `runningScheduleIdRef`（`useRef`）を追加し、実行中のスケジュールIDを即座に反映される参照で追跡
  2. `handleRun`関数の先頭で`runningScheduleIdRef.current`をチェックし、既に実行中の場合は早期リターン
  3. `useState`（`runningScheduleId`）はUI更新用として維持し、`useRef`と併用
- ✅ **409エラーハンドリング（2026-01-27）**:
  1. `apps/api/src/routes/imports.ts`の`POST /imports/schedule/:id/run`エンドポイントで、エラーメッセージに「CSV import is already running」が含まれる場合、409 `ApiError`を返すように修正
  2. ユーザーフレンドリーなエラーメッセージ（`インポートは既に実行中です: ${id}`）を返す

**実装の詳細**:
```typescript
// CsvImportSchedulePage.tsx
const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
const runningScheduleIdRef = useRef<string | null>(null); // 即座に反映される参照（競合防止用）

const handleRun = async (id: string) => {
  // useRefで即座にチェック（useStateの非同期更新を待たない）
  if (runningScheduleIdRef.current !== null) {
    return; // 既に実行中
  }

  // confirm後、実際の実行前に設定
  runningScheduleIdRef.current = id;
  setRunningScheduleId(id);
  
  try {
    await run.mutateAsync(id);
    // ...
  } catch (error) {
    // ...
  } finally {
    // useRefとuseStateの両方をクリア
    runningScheduleIdRef.current = null;
    setRunningScheduleId(null);
  }
};
```

```typescript
// apps/api/src/routes/imports.ts
app.post('/imports/schedule/:id/run', { preHandler: mustBeAdmin }, async (request) => {
  try {
    // ...
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    if (error instanceof Error) {
      // 既に実行中の場合は409で返す
      if (
        error.message.includes('CSV import is already running') ||
        error.message.includes('already running')
      ) {
        throw new ApiError(409, `インポートは既に実行中です: ${id}`);
      }
      // ...
    }
    throw error;
  }
});
```

**学んだこと**:
- **React状態管理**: `useState`の非同期更新により、複数のイベントハンドラーが同時に実行される可能性がある。`useRef`を使用することで、即座に反映される参照で競合を防止できる
- **エラーハンドリング**: スケジューラーからのエラーメッセージを適切に解釈し、ユーザーフレンドリーなHTTPステータスコード（409 Conflict）を返すことで、UIでのエラー表示が改善される
- **競合防止**: 実行中の状態を`useRef`と`useState`の両方で管理することで、即座のチェックとUI更新の両方を実現できる

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-27）

**実機検証結果**: ✅ **すべて正常動作**（2026-01-27）
- 1つのスケジュールの「実行」ボタンを押しても、他のスケジュールのボタンが「実行中...」と表示されないことを確認
- 既に実行中のスケジュールを再度実行しようとすると、409エラーが返されることを確認
- Gmail経由のCSV取り込みが正常に動作することを確認（`********`（8個のアスタリスク）も正常に取得）

**関連ファイル**:
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`（useRefによる競合防止）
- `apps/api/src/routes/imports.ts`（409エラーハンドリング）

---

### [KB-192] 管理コンソールのサイネージプレビュー機能実装とJWT認証問題

**日付**: 2026-01-23

**事象**:
- 管理コンソールに「サイネージプレビュー」タブを追加し、Pi3で表示中のサイネージ画像をプレビューできるようにした
- ブラウザで直接表示しようとしたが、`GET /api/signage/current-image 401 (Unauthorized)` エラーが発生し、画像が表示されなかった
- ブラウザログに認証エラーが記録されていた

**要因**:
- `SignagePreviewPage.tsx`で`fetch('/api/signage/current-image', { credentials: 'include' })`を使用していた
- `credentials: 'include'`はCookie認証用であり、本システムはJWT認証（`Authorization`ヘッダー）を使用している
- `fetch`では`Authorization`ヘッダーを自動付与できないため、401エラーが発生していた
- `/api/signage/current-image`エンドポイントは、`x-client-key`ヘッダーまたはJWT認証が必要な実装になっていた

**有効だった対策**:
- ✅ **解決済み**（2026-01-23）: `fetch`を`axios(api)`クライアントに変更し、JWT認証ヘッダーを自動付与
  1. **axiosクライアントの使用**: `api.get('/signage/current-image', { responseType: 'blob' })`でBlob取得
  2. **自動認証ヘッダー付与**: `api`クライアントが`setAuthToken`で設定されたJWTトークンを`Authorization`ヘッダーに自動付与
  3. **Blob処理**: `URL.createObjectURL`でBlobをURLに変換し、`<img>`要素で表示
  4. **メモリリーク防止**: `useEffect`のクリーンアップで`URL.revokeObjectURL`を実行

**実装の詳細**:
1. **UI実装**: `apps/web/src/pages/admin/SignagePreviewPage.tsx`
   - 30秒ごとの自動更新と手動更新ボタンを実装
   - エラー表示とローディング状態の管理
   - 画像のアスペクト比を維持した表示（`aspect-video`、`object-contain`）

2. **ルーティング**: `apps/web/src/App.tsx`
   - `/admin/signage/preview`ルートを追加

3. **ナビゲーション**: `apps/web/src/layouts/AdminLayout.tsx`
   - 「サイネージプレビュー」タブを追加

**トラブルシューティング**:
1. **401エラーの原因特定**:
   - 症状: `GET /api/signage/current-image 401 (Unauthorized)`
   - 原因: `fetch`ではJWT認証ヘッダーが付与されない
   - 対策: `axios(api)`クライアントを使用して自動認証ヘッダーを付与

2. **セキュリティ考慮**:
   - 最初はクエリパラメータ（`?key=...`）でのクライアントキー指定を追加したが、セキュリティ上の懸念から管理コンソール内タブとして実装
   - JWT認証を使用することで、認証済みユーザーのみがアクセス可能

**学んだこと**:
- 管理コンソール内のAPI呼び出しは、`fetch`ではなく`axios(api)`クライアントを使用することで、JWT認証ヘッダーが自動付与される
- `credentials: 'include'`はCookie認証用であり、JWT認証には`Authorization`ヘッダーが必要
- Blob取得時は`responseType: 'blob'`を指定し、`URL.createObjectURL`でURLに変換してから表示する
- メモリリークを防ぐため、`useEffect`のクリーンアップで`URL.revokeObjectURL`を実行する

**解決状況**: ✅ **実装完了・実機検証完了**（2026-01-23）

**関連ファイル**:
- `apps/web/src/pages/admin/SignagePreviewPage.tsx`（UI実装）
- `apps/web/src/App.tsx`（ルーティング追加）
- `apps/web/src/layouts/AdminLayout.tsx`（ナビゲーション追加）
- `apps/api/src/routes/signage/render.ts`（APIエンドポイント、クエリパラメータサポートも追加）

---

### [KB-206] 生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側）

**実装日時**: 2026-01-26

**事象**: 
- 生産スケジュール画面で3000件のデータを表示する際、Pi4で初期表示に8秒、アイテム完了操作に23秒かかる問題が発生
- 検索機能が「動作していない」と報告された
- ユーザーの使い方は「検索窓で製番を入力→検索→履歴から選択」であり、最初は何も表示せず、検索したものだけ表示すれば事足りる
- カラム幅計算が全データ行を走査しており、CPU負荷が高い

**要因**: 
- **初期表示**: 検索条件がない場合でも全データ（2000件）を取得していた
- **検索機能**: `productNo`パラメータのみで、`FSEIBAN`（製番）での検索ができなかった
- **カラム幅計算**: `computeColumnWidths`が全データ行を走査しており、3000件の場合にCPU負荷が高い
- **検索履歴**: 履歴から削除する機能がなかった

**有効だった対策**: 
- ✅ **初期表示の最適化（2026-01-26）**:
  1. **検索時のみデータ取得**: `useKioskProductionSchedule`に`enabled: hasQuery`オプションを追加し、検索条件がない場合はAPI呼び出しをスキップ
  2. **初期表示メッセージ**: 検索条件がない場合は「検索してください。」と表示
  3. **`pageSize`変更**: 2000から400に変更（API側と統一）
- ✅ **検索機能の改善（2026-01-26）**:
  1. **`q`パラメータ対応**: `inputProductNo`を`inputQuery`に変更し、`q`パラメータで検索
  2. **プレースホルダー変更**: 「製造order番号 / 製番で検索」に変更
  3. **検索履歴の削除機能**: 各履歴アイテムに黄色の「×」ボタンを追加し、クリックで履歴から削除
  4. **検索履歴の動作改善**: 削除した履歴が現在の検索条件と一致する場合は、検索をクリア
- ✅ **UI改善（2026-01-26）**:
  1. **クリアボタンの視認性向上**: `variant="secondary"`に変更し、視認性を向上
  2. **カラム幅計算の最適化**: `normalizedRows.slice(0, 80)`でサンプリングし、CPU負荷を削減
  3. **検索履歴のUI改善**: 履歴アイテムをクリック可能な`div`に変更し、黄色の「×」ボタンを`absolute`配置

**実装の詳細**:
```typescript
// apps/web/src/pages/kiosk/ProductionSchedulePage.tsx
const [inputQuery, setInputQuery] = useState('');
const [activeQuery, setActiveQuery] = useState<string>('');

const queryParams = useMemo(
  () => ({
    q: activeQuery.length > 0 ? activeQuery : undefined,
    page: 1,
    pageSize: 400 // 2000から400に変更
  }),
  [activeQuery]
);

const hasQuery = activeQuery.trim().length > 0;
const scheduleQuery = useKioskProductionSchedule(queryParams, { enabled: hasQuery }); // 検索時のみ取得

// カラム幅計算のサンプリング
const widthSampleRows = useMemo(
  () => normalizedRows.slice(0, 80).map((row) => row.values), // 80件のみサンプリング
  [normalizedRows]
);

// 検索履歴の削除機能
{history.map((h) => (
  <div
    key={h}
    role="button"
    onClick={() => applySearch(h)}
    className="relative cursor-pointer rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
  >
    {h}
    <button
      type="button"
      aria-label={`履歴から削除: ${h}`}
      className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-slate-900 shadow hover:bg-amber-300"
      onClick={(event) => {
        event.stopPropagation();
        setHistory((prev) => prev.filter((item) => item !== h));
        if (activeQuery === h) {
          setActiveQuery('');
          setInputQuery('');
        }
      }}
    >
      ×
    </button>
  </div>
))}

// 初期表示
{!hasQuery ? (
  <p className="text-sm font-semibold text-white/80">検索してください。</p>
) : scheduleQuery.isLoading ? (
  <p className="text-sm font-semibold text-white/80">読み込み中...</p>
) : normalizedRows.length === 0 ? (
  <p className="text-sm font-semibold text-white/80">該当するデータはありません。</p>
) : (
  // テーブル表示
)}
```

**学んだこと**:
- **条件付きデータ取得**: `enabled`オプションを使用することで、不要なAPI呼び出しを防ぎ、初期表示のパフォーマンスを向上できる
- **サンプリングによる最適化**: カラム幅計算など、全データを走査する必要がない処理はサンプリングすることで、CPU負荷を大幅に削減できる
- **検索履歴のUX改善**: 履歴から削除する機能を追加することで、ユーザビリティが向上する
- **`stopPropagation`の重要性**: 履歴アイテムの「×」ボタンで`stopPropagation()`を使用することで、親要素のクリックイベントを防げる

**解決状況**: ✅ **実装完了・CI成功・Mac実機検証完了**（2026-01-26）
- Pi4での実機検証は明日実施予定

**実機検証結果**: ✅ **Macで正常動作**（2026-01-26）
- 初期表示が即座に「検索してください。」と表示されることを確認（API呼び出しなし）
- 検索機能が正常に動作することを確認（ProductNo/FSEIBANの統合検索）
- 検索履歴の削除機能が正常に動作することを確認
- クリアボタンが視認しやすくなっていることを確認
- 検索結果が正しく表示されることを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（初期表示最適化、検索機能改善、UI改善）
- `apps/web/src/api/client.ts`（`getKioskProductionSchedule`関数に`q`パラメータ追加）
- `apps/web/src/api/hooks.ts`（`useKioskProductionSchedule`フックに`enabled`オプション追加）

---

### [KB-207] 生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード）

**実装日時**: 2026-01-27

**事象**: 
- 完了チェックボタンの配色が赤背景/白✓で、視認性が低い
- 検索履歴チップを複数選択してOR検索したいが、現在は単一選択のみ
- 検索入力時に物理キーボードが使えない環境（タッチパネル）で入力が困難

**要因**: 
- **チェックボタン配色**: 未完了=赤背景/白✓、完了=灰背景/白✓で、状態識別が分かりにくい
- **検索履歴**: 単一選択のみで、複数の製番を同時に検索できない
- **ソフトキーボード**: 英数字入力用のソフトウェアキーボードが存在しない

**有効だった対策**: 
- ✅ **チェックボタン配色変更（2026-01-27）**:
  1. **白背景・黒✓**: ボタン背景を常に白、チェック（✓）は常に黒に変更
  2. **状態識別は枠色**: 未完了=赤枠（`border-red-500`）、完了=灰枠（`border-slate-400`）で状態を識別
  3. **既存の行グレーアウトは維持**: 完了した行は`opacity-50 grayscale`で視覚的にグレーアウト
- ✅ **検索履歴のトグル選択 + OR検索（2026-01-27）**:
  1. **状態管理の変更**: `activeQuery: string`を`activeQueries: string[]`に変更し、複数選択を配列で保持
  2. **トグル選択**: チップをクリックすると選択/解除がトグルされ、選択中は色が付く（`border-emerald-300 bg-emerald-400 text-slate-900`）
  3. **OR検索**: 複数選択されたチップをカンマ区切りで`q`パラメータに結合し、API側でOR検索を実行
  4. **検索ボタン**: 入力欄が空でない場合は、その文字列を履歴に追加しつつ単一選択として`activeQueries=[value]`にする
  5. **クリア**: `activeQueries=[]`、入力欄も空に
- ✅ **ソフトウェアキーボード実装（2026-01-27）**:
  1. **新規コンポーネント**: `KioskKeyboardModal.tsx`を新規作成
  2. **キーボードアイコン**: 検索入力欄の横にキーボードアイコン（⌨）ボタンを追加
  3. **モーダル表示**: キーボードアイコンをクリックすると、ポップアップでソフトウェアキーボードを表示
  4. **英数字入力**: A-Z（大文字固定）、0-9のキーを配置
  5. **操作ボタン**: Backspace（1文字削除）、Clear（全削除）、Cancel（キャンセル）、OK（確定）ボタンを実装
  6. **入力確定**: OKボタンで入力値を`inputQuery`に反映し、モーダルを閉じる

**実装の詳細**:
```typescript
// apps/web/src/pages/kiosk/ProductionSchedulePage.tsx
const [activeQueries, setActiveQueries] = useState<string[]>([]);
const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
const [keyboardValue, setKeyboardValue] = useState('');

// 正規化（重複除去・空除去）
const normalizedActiveQueries = useMemo(() => {
  const unique = new Set<string>();
  activeQueries
    .map((query) => query.trim())
    .filter((query) => query.length > 0)
    .forEach((query) => unique.add(query));
  return Array.from(unique);
}, [activeQueries]);

// OR検索用のqパラメータ（カンマ区切り）
const queryParams = useMemo(
  () => ({
    q: normalizedActiveQueries.length > 0 ? normalizedActiveQueries.join(',') : undefined,
    page: 1,
    pageSize: 400
  }),
  [normalizedActiveQueries]
);

// トグル選択
const toggleHistoryQuery = (value: string) => {
  setActiveQueries((prev) => {
    const exists = prev.includes(value);
    if (exists) {
      return prev.filter((item) => item !== value);
    }
    const next = [...prev, value];
    return next.slice(0, 8); // 最大8件
  });
};

// チェックボタンの配色変更
<button
  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-black shadow hover:bg-slate-100 disabled:opacity-60 ${
    left.isCompleted ? 'border-slate-400' : 'border-red-500'
  }`}
  aria-label={left.isCompleted ? '未完了に戻す' : '完了にする'}
  onClick={() => handleComplete(left.id)}
  disabled={completeMutation.isPending}
>
  ✓
</button>

// 検索履歴チップ（トグル選択）
{history.map((h) => {
  const isActive = normalizedActiveQueries.includes(h);
  return (
    <div
      key={h}
      role="button"
      onClick={() => toggleHistoryQuery(h)}
      className={`relative cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        isActive
          ? 'border-emerald-300 bg-emerald-400 text-slate-900 hover:bg-emerald-300'
          : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      {h}
      {/* 削除ボタン */}
    </div>
  );
})}

// ソフトウェアキーボードモーダル
<KioskKeyboardModal
  isOpen={isKeyboardOpen}
  value={keyboardValue}
  onChange={setKeyboardValue}
  onCancel={() => setIsKeyboardOpen(false)}
  onConfirm={() => {
    setInputQuery(keyboardValue);
    setIsKeyboardOpen(false);
  }}
/>
```

**API側の実装**:
```typescript
// apps/api/src/routes/kiosk.ts
// qパラメータの最大長を200に緩和（複数選択対応）
q: z.string().min(1).max(200).optional(),

// カンマ区切りを解析してOR検索
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
```

**学んだこと**:
- **状態管理の拡張**: 単一選択から複数選択への拡張は、`string`から`string[]`への変更で自然に実現できる
- **UI状態の視覚的フィードバック**: 選択状態を色で表現することで、ユーザーが現在の選択状態を直感的に理解できる
- **モーダルコンポーネントの分離**: ソフトウェアキーボードを独立したコンポーネントにすることで、再利用性と保守性が向上する
- **APIパラメータの拡張**: カンマ区切りで複数の検索条件を受け取ることで、OR検索を実現できる

**解決状況**: ✅ **解決済み**（2026-01-27）

**実機検証**:
- ✅ Macで動作確認完了
- ✅ Pi4で動作確認完了
- ✅ チェックボタンが白背景・黒✓で表示されることを確認
- ✅ 検索履歴チップのトグル選択が正常に動作することを確認
- ✅ 複数選択時のOR検索が正常に動作することを確認
- ✅ ソフトウェアキーボードが正常に表示・入力・確定されることを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（チェックボタン配色変更、検索履歴トグル選択、ソフトキーボード統合）
- `apps/web/src/components/kiosk/KioskKeyboardModal.tsx`（新規: ソフトウェアキーボードコンポーネント）
- `apps/api/src/routes/kiosk.ts`（`q`パラメータのカンマ区切りOR検索実装）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（OR検索の統合テスト追加）

---

### [KB-208] 生産スケジュールUI改良（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）

**実装日時**: 2026-01-27

**事象**: 
- 実機検証で、検索登録製番と資源CDを併用する検索機能がOR条件になっていたが、AND条件にしたい要望
- ドロップダウン選択後の数字が背景色に埋もれて見えない問題

**要因**: 
- 検索条件の結合ロジックがOR条件（`queryConditions`を`OR`で結合）になっていた
- ドロップダウンの文字色が資源CDの色と統一されていたため、背景色と同化して視認性が低下

**有効だった対策**: 
- ✅ **検索条件のAND結合（2026-01-27）**:
  1. **条件の分離**: テキスト検索条件（`textConditions`）と資源CD条件（`resourceConditions`）を分離
  2. **AND結合**: 両方が存在する場合は`AND`で結合（`textConditions AND resourceConditions`）
  3. **資源CD条件内はOR**: `resourceCds`と`resourceAssignedOnlyCds`は資源CD条件内でOR結合
  4. **統合テスト更新**: テストケースをAND条件に合わせて更新（`q=A&resourceAssignedOnlyCds=1`で`['0000']`のみヒット）
- ✅ **ドロップダウン文字色の変更（2026-01-27）**:
  1. **資源CD色の統一を解除**: ドロップダウンから`getResourceColorClasses`による色付けを削除
  2. **文字色を黒に固定**: `text-black`を適用し、背景色（白）とのコントラストを確保
  3. **枠線色は維持**: `border-slate-300`で枠線のみ色付け（視認性と統一性のバランス）

**実装の詳細**:
```typescript
// apps/api/src/routes/kiosk.ts
// テキスト条件と資源CD条件を分離
const textConditions: Prisma.Sql[] = [];
for (const token of uniqueTokens) {
  // ... 既存のヒューリスティックロジック
  textConditions.push(...);
}

const resourceConditions: Prisma.Sql[] = [];
if (resourceCds.length > 0) {
  resourceConditions.push(Prisma.sql`("rowData"->>'FSIGENCD') IN (...)`);
}
if (assignedOnlyCds.length > 0) {
  resourceConditions.push(Prisma.sql`id IN (SELECT ...)`);
}

// AND結合（両方が存在する場合）
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
```

```typescript
// apps/web/src/pages/kiosk/ProductionSchedulePage.tsx
// ドロップダウンの文字色を黒に固定
<select
  className="h-7 w-16 rounded border border-slate-300 bg-white px-2 text-sm text-black"
  // ...
>
  <option value="">-</option>
  {options.map((num) => (
    <option key={num} value={num}>{num}</option>
  ))}
</select>
```

**学んだこと**:
- **検索条件の結合ロジック**: テキスト検索と資源CDフィルタはAND結合、資源CD条件内はOR結合という2層構造を明確に分離することで、意図通りの動作を実現できる
- **UIの視認性**: 色の統一性よりも視認性を優先し、ドロップダウンは白背景・黒文字で統一することで、どの資源CDでも読みやすさを確保できる
- **条件の分離**: `textConditions`と`resourceConditions`を分離することで、条件の組み合わせを柔軟に制御できる

**解決状況**: ✅ **解決済み**（2026-01-27）

**実機検証**:
- ✅ Macで動作確認完了
- ✅ Pi4で動作確認完了
- ✅ 検索登録製番と資源CDのAND検索が正常に動作することを確認
- ✅ ドロップダウンの文字が黒で視認性が向上したことを確認

**関連ファイル**:
- `apps/api/src/routes/kiosk.ts`（検索条件のAND結合実装）
- `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（AND検索の統合テスト追加）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（ドロップダウン文字色を黒に変更）

---

### [KB-211] キオスク持出タブの持出中アイテムが端末間で共有されない問題

**Context**: キオスクの持出タブ（NFCタブ・写真タブ）で表示する「持出中」一覧が、端末ごとに分かれており、Pi4で持ち出したアイテムがMacブラウザで開いたキオスクに表示されない。

**Symptoms**:
- Pi4で持ち出したアイテムが、別端末（Macブラウザ等）で開いたキオスクの持出タブに表示されない
- 持出タブは全端末で同一の「持出中」一覧を表示する仕様であるべき

**Investigation**:
- **仮説1**: APIがクライアントキーやclientIdでフィルタしている → API側は `clientId` がクエリで**明示指定された場合のみ**フィルタし、省略時は全件返す仕様（CONFIRMED: APIは正しい）
- **仮説2**: フロントで `useActiveLoans(clientId, ...)` にローカル端末の `clientId` を渡している → **CONFIRMED**: `KioskPhotoBorrowPage.tsx` のみ `useActiveLoans(resolvedClientId, resolvedClientKey)` としており、`KioskBorrowPage.tsx` は `useActiveLoans(undefined, resolvedClientKey)` で全件取得していた

**Root cause**: `KioskPhotoBorrowPage.tsx` がローカル端末の `clientId` を `useActiveLoans` に渡していたため、APIに `?clientId=...` が付き、その端末の貸出のみ返っていた。

**Fix**: `KioskPhotoBorrowPage.tsx` で `useActiveLoans(resolvedClientId, ...)` を `useActiveLoans(undefined, resolvedClientKey)` に変更。返却一覧・持出タブは全クライアント分を表示するため、`clientId` を送らない。

**Prevention**:
- 持出タブ・返却一覧で「全端末の持出中」を表示する画面では、必ず `useActiveLoans(undefined, clientKey)` を渡す（[api-key-policy.md](../guides/api-key-policy.md) 参照）
- 新規キオスクページでアクティブ貸出一覧を使う場合は、`KioskBorrowPage` / `KioskPhotoBorrowPage` の呼び出し方を参照する

**References**: `docs/guides/api-key-policy.md`, `apps/api/src/routes/tools/loans/active.ts`, `apps/web/src/api/client.ts`（`getActiveLoans`）

**解決状況**: ✅ **解決済み**（2026-01-29）。CI成功、デプロイ（Pi5・Pi4対象）、実機検証完了。

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
  1. **UI実装**: `ProductionSchedulePage.tsx`に備考編集機能を追加
  2. **インライン編集**: テーブル内で直接編集できるUIを実装（編集モードと表示モードの切り替え）
  3. **キーボード操作**: Enterキーで保存、Escapeキーでキャンセル
  4. **バリデーション**: 100文字以内・改行不可の制限を実装（`NOTE_MAX_LENGTH = 100`）
  5. **改行削除**: 入力時に改行を自動削除（`replace(/\r?\n/g, '')`）

**実装の詳細**:
```typescript
// apps/web/src/pages/kiosk/ProductionSchedulePage.tsx
const NOTE_MAX_LENGTH = 100;

const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
const [editingNoteValue, setEditingNoteValue] = useState('');
const isCancellingNoteRef = useRef(false);

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

const cancelNoteEdit = () => {
  setEditingNoteRowId(null);
  setEditingNoteValue('');
  isCancellingNoteRef.current = false;
};

// UI実装（インライン編集）
{editingNoteRowId === left.id ? (
  <input
    type="text"
    value={editingNoteValue}
    onChange={(e) => setEditingNoteValue(e.target.value)}
    onBlur={() => {
      if (isCancellingNoteRef.current) {
        isCancellingNoteRef.current = false;
        return;
      }
      saveNote(left.id);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNote(left.id);
      }
      if (e.key === 'Escape') {
        isCancellingNoteRef.current = true;
        cancelNoteEdit();
      }
    }}
    maxLength={NOTE_MAX_LENGTH}
    className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs text-black"
    autoFocus
    aria-label="備考を編集"
  />
) : (
  <span className="flex items-center gap-1">
    <span className="min-w-0 truncate text-white/90" title={left.note ?? undefined}>
      {left.note ? (left.note.length > 18 ? `${left.note.slice(0, 18)}…` : left.note) : ''}
    </span>
    <button
      type="button"
      onClick={() => startNoteEdit(left.id, left.note)}
      disabled={noteMutation.isPending}
      className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
      aria-label="備考を編集"
    >
      <PencilIcon />
    </button>
  </span>
)}
```

**学んだこと**:
- **インライン編集**: テーブル内で直接編集できるUIを実装することで、操作性が向上する
- **キーボード操作**: Enterキーで保存、Escapeキーでキャンセルを実装することで、マウス操作なしで編集できる
- **改行削除**: 入力時に改行を自動削除することで、100文字以内の制限と改行不可の制限を両立できる
- **視覚的フィードバック**: 編集モードと表示モードを明確に分離することで、ユーザーが現在の状態を理解しやすくなる
- **文字数制限の表示**: 18文字を超える場合は省略表示（`…`）し、`title`属性で全文を表示することで、長い備考も確認できる

**解決状況**: ✅ **解決済み**（2026-01-29）

**実機検証**:
- ✅ 統合テスト成功（備考の保存・削除・取得が正常に動作）
- ✅ GitHub Actions CI成功
- ✅ デプロイ成功（Pi5/Pi4/Pi3）
- ✅ 実機検証完了（2026-01-29）:
  - 備考の保存・削除が正常に動作することを確認
  - 100文字以内の制限が正常に動作することを確認
  - 改行が削除されることを確認
  - インライン編集が正常に動作することを確認（Enter/Escapeキー対応）
  - 備考の表示・編集が正常に動作することを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（備考編集UI実装）
- `apps/web/src/api/hooks.ts`（`useUpdateKioskProductionScheduleNote`フック追加）
- `apps/api/src/routes/kiosk.ts`（備考保存・削除エンドポイント実装）

**関連KB**:
- [KB-208](./frontend.md#kb-208-生産スケジュールui改良資源cdfilter加工順序割当検索状態同期and検索): 生産スケジュールUIの改良（資源CDフィルタ・加工順序割当・検索状態同期）
- [KB-212](./api.md#kb-212-生産スケジュール行ごとの備考欄追加機能): API側の備考欄追加機能実装

---

### [KB-221] 生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装）

**実装日時**: 2026-02-01

**事象**: 
- 納期日機能の初期実装では`<input type="date">`を使用していたが、操作性が低かった
- 特に「今日」「明日」「明後日」などの頻繁に使用する日付の選択が煩雑だった
- 日付選択後にOKボタンを押す必要があり、操作ステップが多かった

**要因**: 
- ブラウザ標準の`<input type="date">`は操作性が限定的で、頻繁に使用する日付の選択が効率的でない
- 日付選択後の確定操作が必要で、操作ステップが増える

**有効だった対策**: 
- ✅ **カスタムカレンダーUI実装（2026-02-01）**:
  1. **カスタムカレンダーグリッド**: `<input type="date">`から置き換え、7列×6行のグリッドでカレンダーを表示
  2. **今日/明日/明後日ボタン**: 頻繁に使用する日付をワンクリックで選択可能に
  3. **自動確定**: 日付選択時に自動的に確定し、OKボタン不要に
  4. **月ナビゲーション**: 前月/次月ボタンで月を移動可能に
  5. **今日の日付の強調表示**: 現在の日付を視覚的に識別可能に
  6. **初期表示月の調整**: 既に設定済みの納期日の月を初期表示（未設定時は現在の月）

**実装の詳細**:
```typescript
// apps/web/src/components/kiosk/KioskDatePickerModal.tsx
export function KioskDatePickerModal({
  isOpen,
  value,
  onCancel,
  onCommit
}: KioskDatePickerModalProps) {
  // React Hooksはearly returnの前に配置（ルール違反修正）
  const today = useMemo(() => new Date(), []);
  const todayKey = toYmd(today);
  const selectedDate = useMemo(() => parseYmd(value), [value]);
  const [displayMonth, setDisplayMonth] = useState<Date>(
    () => getMonthStart(selectedDate ?? today)
  );

  useEffect(() => {
    if (!isOpen) return;
    setDisplayMonth(getMonthStart(selectedDate ?? today));
  }, [isOpen, selectedDate, today]);

  if (!isOpen) return null; // early returnはhooksの後

  // カレンダーグリッドのレンダリング
  // 今日/明日/明後日ボタンの実装
  // 月ナビゲーションの実装
}
```

**技術的修正**: 
- **React Hooksのルール違反修正**: `useMemo`/`useState`/`useEffect`をearly return（`if (!isOpen) return null;`）の前に移動。ESLintの`react-hooks/rules-of-hooks`エラーを解消。

**学んだこと**:
- **カスタムUIコンポーネント**: ブラウザ標準の`<input type="date">`からカスタムカレンダーUIに置き換えることで、操作性を大幅に改善できる
- **React Hooksのルール**: React Hooksは常にコンポーネントのトップレベルで呼び出す必要がある（early returnの前に配置）
- **頻繁な操作の最適化**: 頻繁に使用する操作（今日/明日/明後日）をワンクリックで選択できるようにすることで、ユーザー体験が向上する
- **自動確定の実装**: 日付選択時に自動的に確定することで、操作ステップを削減できる

**解決状況**: ✅ **解決済み**（2026-02-01）

**実機検証**:
- ✅ 統合テスト成功（納期日の保存・削除・取得が正常に動作）
- ✅ GitHub Actions CI成功
- ✅ デプロイ成功（Pi5）
- ✅ 実機検証完了（2026-02-01）:
  - カレンダー表示が正常に動作することを確認
  - 日付選択時に自動的に確定されることを確認
  - 今日/明日/明後日ボタンが正常に動作することを確認
  - 月ナビゲーションが正常に動作することを確認
  - 既に設定済みの納期日の月が初期表示されることを確認

**関連ファイル**:
- `apps/web/src/components/kiosk/KioskDatePickerModal.tsx`（カスタムカレンダーUI実装）
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（納期日編集UI統合）
- `apps/web/src/features/kiosk/productionSchedule/formatDueDate.ts`（日付フォーマットユーティリティ）

**関連KB**:
- [KB-212](./frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能): 生産スケジュール行ごとの備考欄追加機能（納期日機能の前段階実装）

---

### [KB-223] 生産スケジュール備考のモーダル編集化と処理列追加

**実装日時**: 2026-02-01

**事象**:
- 備考欄は表示時に省略され、編集時は入力範囲が狭く全文を確認しづらかった
- 備考や納期の追加で品名列は折り返されるが、品番/製造order番号は折り返し対象外でレイアウトが詰まりやすかった
- 作業種別（処理）を行ごとに記録する欄がなかった

**要因**:
- 備考編集がセル内の`input`に固定されていた
- 文字列の折り返し対象が品名中心で、品番/製造order番号は折り返し不可だった
- 行単位での処理種別の保存先がなかった

**有効だった対策**:
- ✅ **備考のモーダル編集化**: 編集/新規入力時はポップアップで全文が見えるように変更（保存は改行なし100文字）
- ✅ **備考の2行表示**: 一覧は2行まで折り返して視認性を向上
- ✅ **処理列の追加**: ドロップダウンで `塗装/カニゼン/LSLH/その他01/その他02` を選択可能に
- ✅ **品番/製造order番号の折り返し対応**: 折り返し対象を拡張し、列幅の詰まりを緩和

**解決状況**: ✅ **解決済み**（2026-02-01）

**実装の詳細**:
- **備考モーダル**: `KioskNoteModal`コンポーネントを新規作成。`textarea`で最大100文字の入力を受け付け、文字数カウントを表示。保存時は改行を削除して単一行として保存。
- **処理列**: `ProductionScheduleRowNote`モデルに`processingType`フィールドを追加（`String? @db.VarChar(20)`）。APIエンドポイント`PUT /kiosk/production-schedule/:rowId/processing`を追加。フロントエンドにドロップダウンを実装（未選択状態も許可）。
- **折り返し対応**: `ProductNo`と`FHINCD`列に`break-all`クラスを追加し、長い文字列でも折り返されるように改善。`computeColumnWidths`から`ProductNo`の固定幅を削除し、動的幅調整に参加させる。

**学んだこと**:
- **モーダルUIの実装**: 頻繁に編集する項目は、セル内編集ではなくモーダルで全文を確認できるようにすることで、ユーザー体験が大幅に向上する
- **データ整合性の考慮**: `note`、`dueDate`、`processingType`の3フィールドがすべて空/nullの場合のみレコードを削除するロジックを実装し、データの整合性を維持
- **列幅の動的調整**: 固定幅を削除し、テキスト内容に応じて動的に調整することで、レイアウトの詰まりを緩和できる

**実機検証結果（2026-02-01）**:
- ✅ **統合テスト成功**: 備考の保存・取得、処理種別の保存・取得が正常に動作することを確認
- ✅ **GitHub Actions CI成功**: 全ジョブ（lint-and-test, e2e-smoke, docker-build, e2e-tests）成功
- ✅ **デプロイ成功**: Pi5でデプロイ成功（マイグレーション適用済み）
- ✅ **実機検証完了（2026-02-01）**:
  - 備考モーダルが正常に開き、全文を確認しながら編集できることを確認
  - 備考が2行まで折り返して表示されることを確認
  - 処理列のドロップダウンが正常に動作し、選択・未選択状態が正しく保存されることを確認
  - 品番/製造order番号が長い場合でも折り返されて表示されることを確認
  - 備考・納期・処理の3フィールドが独立して動作することを確認

**関連ファイル**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`（備考モーダル・処理列・折り返し対応）
- `apps/web/src/components/kiosk/KioskNoteModal.tsx`（備考モーダル）
- `apps/api/src/routes/kiosk.ts`（処理種別エンドポイント）
- `apps/api/prisma/schema.prisma`（`processingType`フィールド追加）
- `apps/api/prisma/migrations/20260201055642_add_production_schedule_processing_type/`（マイグレーション）

**関連KB**:
- [KB-212](./frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能): 備考欄追加の初期実装
- [KB-221](./frontend.md#kb-221-生産スケジュール納期日機能のui改善カスタムカレンダーui実装): 納期日UI改善
- [KB-224](./infrastructure/ansible-deployment.md#kb-224-デプロイ時のマイグレーション未適用問題): デプロイ時のマイグレーション未適用問題

---

### [KB-239] キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入）

**実装日時**: 2026-02-08

**事象**:
- キオスクヘッダーの「管理コンソール」ボタンがテキストで表示され、スペースを占有していた
- サイネージプレビュー機能が管理コンソール内にのみ存在し、キオスクから直接確認できなかった
- 再起動/シャットダウンボタンが2つ並んでおり、スペースを占有していた
- モーダル（サイネージプレビュー、電源メニュー）が画面上辺を超えて見切れ、画面全体に表示されなかった

**要因**:
- **UIデザイン**: テキストボタンがスペースを占有し、アイコン化でスペースを確保できる
- **機能配置**: サイネージプレビューが管理コンソール専用で、キオスクからアクセスできなかった
- **モーダル表示位置問題**: 
  - `KioskLayout`の`<header>`要素に`backdrop-blur`（CSS `filter`プロパティ）が適用されていた
  - CSS仕様により、親要素に`filter`がある場合、子要素の`position: fixed`は親要素を基準にする（`transform`や`filter`が新しい包含ブロックを作成）
  - モーダルが`KioskHeader`内でレンダリングされていたため、親要素のDOM階層制約を受けていた

**有効だった対策**:
- ✅ **管理コンソールボタンのアイコン化**: テキスト「管理コンソール」を歯車アイコン（`GearIcon`）に変更し、`aria-label`でアクセシビリティを確保
- ✅ **サイネージプレビュー機能の追加**: キオスクヘッダーに「サイネージ」ボタン（歯車アイコン付き）を追加し、モーダルでサイネージプレビューを表示
- ✅ **電源メニューの統合**: 再起動/シャットダウンボタンを電源アイコン（`PowerIcon`）1つに統合し、クリックでポップアップメニューを表示
- ✅ **React Portalの導入**: モーダルコンポーネント（`KioskSignagePreviewModal`、`KioskPowerMenuModal`、`KioskPowerConfirmModal`）を`createPortal(..., document.body)`で`document.body`に直接レンダリングし、DOM階層の制約を回避
- ✅ **モーダルスタイリングの改善**: 
  - 外側divに`overflow-y-auto`を追加してスクロール可能に
  - `items-center`を`items-start`に変更して上端揃え
  - Cardに`max-h-[calc(100vh-2rem)] my-4`を追加して垂直方向のサイズ制御
  - サイネージプレビューは`w-[calc(100vw-2rem)] max-w-none`で全幅表示
- ✅ **E2Eテストの安定化**: 
  - `scrollIntoViewIfNeeded()`で要素をビューポート内に確実に表示
  - Escキー（`page.keyboard.press('Escape')`）でモーダルを閉じる方式に変更し、ビューポート外エラーを回避
  - `waitForLoadState('networkidle')`でページ読み込み完了を待機

**解決状況**: ✅ **解決済み**（2026-02-08）

**実装の詳細**:
- **React Portal**: `react-dom`の`createPortal`を使用し、モーダルを`document.body`に直接レンダリングすることで、親要素のCSS `filter`（`backdrop-blur`）の影響を回避
- **モーダルコンポーネント**: 
  - `KioskSignagePreviewModal`: サイネージ画像を30秒ごとに自動更新、手動更新ボタン、Blob取得と`URL.createObjectURL`/`URL.revokeObjectURL`によるメモリリーク防止
  - `KioskPowerMenuModal`: 電源操作選択メニュー（再起動/シャットダウン）
  - `KioskPowerConfirmModal`: 電源操作の確認ダイアログ
- **アクセシビリティ**: アイコンボタンに`aria-label`と`title`属性を追加し、スクリーンリーダー対応
- **E2Eテスト**: Playwrightの`getByRole`セレクタとEscキー操作で安定性を向上

**学んだこと**:
- **CSS `filter`プロパティの影響**: `backdrop-blur`などの`filter`プロパティは、子要素の`position: fixed`を親要素基準にする。モーダルを画面全体に表示するには、React PortalでDOM階層を回避する必要がある
- **React Portalの活用**: `createPortal`を使用することで、DOM階層の制約を回避し、モーダルを画面全体に正しく表示できる
- **E2Eテストの安定化**: ビューポート外エラーを避けるため、`scrollIntoViewIfNeeded()`とEscキー操作を活用する
- **アクセシビリティ**: アイコンボタンには必ず`aria-label`や`title`を追加し、スクリーンリーダー対応を確保する

**実機検証結果（2026-02-08）**:
- ✅ **統合テスト成功**: モーダルの開閉、サイネージ画像の取得・表示、電源操作の確認が正常に動作することを確認
- ✅ **GitHub Actions CI成功**: 全ジョブ（lint-and-test, e2e-smoke, docker-build, e2e-tests）成功
- ✅ **デプロイ成功**: Pi5とPi4でデプロイ成功
- ✅ **実機検証完了（2026-02-08）**:
  - 管理コンソールボタンが歯車アイコンに変更され、スペースが確保されたことを確認
  - サイネージプレビューボタンが追加され、モーダルでサイネージ画像が正常に表示されることを確認
  - 電源アイコンをクリックするとメニューが表示され、再起動/シャットダウンが選択できることを確認
  - モーダルが画面全体に正しく表示され、画面上辺を超えて見切れないことを確認
  - サイネージプレビューが全画面表示されることを確認

**関連ファイル**:
- `apps/web/src/components/kiosk/KioskHeader.tsx`（ヘッダーコンポーネント、アイコン化、モーダル統合）
- `apps/web/src/components/kiosk/KioskSignagePreviewModal.tsx`（サイネージプレビューモーダル、React Portal使用）
- `apps/web/src/components/kiosk/KioskPowerMenuModal.tsx`（電源メニューモーダル、React Portal使用）
- `apps/web/src/components/kiosk/KioskPowerConfirmModal.tsx`（電源確認モーダル、React Portal使用）
- `apps/web/src/layouts/KioskLayout.tsx`（`backdrop-blur`が適用されている親要素）
- `e2e/kiosk.spec.ts`（E2Eテスト、Escキー操作と`scrollIntoViewIfNeeded`使用）

**関連KB**:
- [KB-192](./frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題): 管理コンソールのサイネージプレビュー機能実装（キオスクへの統合前）

---

### [KB-240] モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化

**EXEC_PLAN.md参照**: Progress (2026-02-08)

**事象**: 
- キオスクと管理コンソールでモーダル実装が分散しており、アクセシビリティ対応が不統一
- E2Eテストが不安定で、strict mode violationやタイミング問題が発生
- サイネージプレビューが全画面表示に対応していない
- 管理コンソールで`window.confirm`を使用しており、アクセシビリティに問題がある

**要因**: 
- モーダルコンポーネントが各ページで個別実装されており、共通ロジックが重複
- ARIA属性、フォーカストラップ、スクロールロックなどのアクセシビリティ機能が統一されていない
- E2Eテストで要素の可視性確認やタイミング待機が不十分
- Fullscreen APIを使用した全画面表示機能が未実装
- ネイティブ`window.confirm`はアクセシビリティに問題があり、カスタムUIに置き換えが必要

**有効だった対策**: 
- ✅ **共通Dialogコンポーネントの作成**: `apps/web/src/components/ui/Dialog.tsx`を作成し、Portal、ARIA属性、Escキー処理、バックドロップクリック、スクロールロック、フォーカストラップ、フォーカス復元を統合実装
- ✅ **キオスク全モーダルの統一**: `KioskPowerMenuModal`、`KioskPowerConfirmModal`、`KioskSignagePreviewModal`、`KioskSupportModal`、`KioskNoteModal`、`KioskDatePickerModal`、`KioskKeyboardModal`をDialogベースに統一
- ✅ **サイネージプレビューの全画面対応**: Fullscreen API（`element.requestFullscreen()`、`document.exitFullscreen()`、`fullscreenchange`イベント）を実装し、Escキーで全画面解除→モーダル閉じるの優先順位を実装
- ✅ **ConfirmDialogとuseConfirmの実装**: `ConfirmDialog.tsx`と`ConfirmContext.tsx`（`useConfirm`フック）を作成し、Promiseベースの確認ダイアログを実装
- ✅ **管理コンソールのwindow.confirm置換**: `EmployeesPage`、`ItemsPage`、`MeasuringInstrumentsPage`、`InstrumentTagsPage`、`InspectionItemsPage`、`GmailConfigPage`、`BackupTargetsPage`で`window.confirm`を`useConfirm`に置換
- ✅ **アクセシビリティ標準化**: 
  - `KioskLayout`に`sr-only`の`<h1>`を追加（ページタイトル）
  - アイコンボタンとダイアログに適切な`aria-label`属性を追加
  - `initialFocusRef`でモーダル開閉時のフォーカス管理を実装
- ✅ **E2Eテストの安定化**: 
  - `e2e/helpers.ts`に`clickByRoleSafe`（`scrollIntoViewIfNeeded` + `click`）と`closeDialogWithEscape`（Escキー操作）を追加
  - `e2e/kiosk.spec.ts`と`e2e/admin.spec.ts`でヘルパー関数を使用
  - `expect.poll()`でUI更新をポーリング待機（バックアップ削除テスト）
- ✅ **CIの修正**: 
  - import順序のlintエラー修正（`Dialog.tsx`、`AdminLayout.tsx`）
  - `.trivyignore`にCaddy依存関係の新規脆弱性（CVE-2026-25793、CVE-2025-61730、CVE-2025-68121）を追加
  - E2Eテストのstrict mode violation修正（`first()`で先頭要素を明示指定）

**解決状況**: ✅ **解決済み**（2026-02-08）

**実装の詳細**:
- **Dialogコンポーネント**: 
  - React Portal（`createPortal`）で`document.body`に直接レンダリング
  - ARIA属性（`role="dialog"`、`aria-modal="true"`、`aria-labelledby`、`aria-describedby`）を自動設定
  - Escキー処理（`closeOnEsc`）、バックドロップクリック（`closeOnBackdrop`）、スクロールロック（`lockScroll`）、フォーカストラップ（`trapFocus`）、フォーカス復元（`returnFocus`）を実装
  - `initialFocusRef`でモーダル開閉時の初期フォーカスを制御
  - サイズ指定（`sm`、`md`、`lg`、`full`）に対応
- **ConfirmDialogコンポーネント**: 
  - Dialogをベースに、確認/キャンセルボタンを標準化
  - `tone`プロパティ（`danger`/`primary`）でボタンの色を制御
- **ConfirmContext**: 
  - React ContextでPromiseベースの確認ダイアログを提供
  - `useConfirm`フックで任意のコンポーネントから確認ダイアログを呼び出し可能
  - `AdminLayout`に`ConfirmProvider`を追加し、管理コンソール全体で利用可能に
- **Fullscreen API**: 
  - `KioskSignagePreviewModal`に全画面表示ボタンを追加
  - `isFullscreen`状態で全画面状態を管理
  - `fullscreenchange`イベントで状態を同期
  - Escキーで全画面解除→モーダル閉じるの優先順位を実装

**学んだこと**:
- **モーダルの共通化**: Portal、ARIA属性、フォーカス管理などのアクセシビリティ機能を共通コンポーネントに集約することで、一貫性と保守性が向上する
- **Promiseベースの確認ダイアログ**: `useConfirm`フックにより、非同期処理と確認ダイアログを自然に統合できる
- **Fullscreen API**: ブラウザネイティブのFullscreen APIを使用することで、カスタム実装よりも安定した全画面表示が可能
- **E2Eテストの安定化**: `scrollIntoViewIfNeeded()`と`expect.poll()`を使用することで、タイミング問題を回避できる
- **アクセシビリティ標準**: `sr-only`見出し、`aria-label`属性、フォーカス管理により、スクリーンリーダー対応が向上する

**実機検証結果（2026-02-08）**:
- ✅ **GitHub Actions CI成功**: 全ジョブ（lint-and-test, e2e-smoke, docker-build, e2e-tests）成功
- ✅ **デプロイ成功**: Pi5、Pi4、Pi3でデプロイ成功（`failed=0`）
- ✅ **ヘルスチェック成功**: APIヘルスチェック（`status: ok`）、Dockerコンテナ正常起動、サイネージサービス正常稼働を確認

**関連ファイル**:
- `apps/web/src/components/ui/Dialog.tsx`（共通Dialogコンポーネント）
- `apps/web/src/components/ui/ConfirmDialog.tsx`（確認ダイアログコンポーネント）
- `apps/web/src/contexts/ConfirmContext.tsx`（useConfirmフック）
- `apps/web/src/components/kiosk/KioskSignagePreviewModal.tsx`（Fullscreen API実装）
- `apps/web/src/components/kiosk/KioskPowerMenuModal.tsx`（Dialogベースに統一）
- `apps/web/src/components/kiosk/KioskPowerConfirmModal.tsx`（Dialogベースに統一）
- `apps/web/src/pages/admin/GmailConfigPage.tsx`（useConfirm使用）
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`（useConfirm使用）
- `apps/web/src/pages/tools/EmployeesPage.tsx`（useConfirm使用）
- `apps/web/src/pages/tools/ItemsPage.tsx`（useConfirm使用）
- `apps/web/src/pages/tools/MeasuringInstrumentsPage.tsx`（useConfirm使用）
- `apps/web/src/pages/tools/InstrumentTagsPage.tsx`（useConfirm使用）
- `apps/web/src/pages/tools/InspectionItemsPage.tsx`（useConfirm使用）
- `apps/web/src/layouts/AdminLayout.tsx`（ConfirmProvider追加）
- `apps/web/src/layouts/KioskLayout.tsx`（sr-only見出し追加）
- `e2e/helpers.ts`（clickByRoleSafe、closeDialogWithEscape追加）
- `e2e/kiosk.spec.ts`（ヘルパー関数使用）
- `e2e/admin.spec.ts`（ヘルパー関数使用、expect.poll使用）
- `.trivyignore`（Caddy依存関係の脆弱性追加）

**関連KB**:
- [KB-239](./frontend.md#kb-239-キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決react-portal導入): キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入）

---

### [KB-241] WebRTCビデオ通話の常時接続と着信自動切り替え機能実装

**実装日時**: 2026-02-09

**事象**: 
- Pi4が`/kiosk/*`や`/signage`表示中に着信を受けられない
- 発信側が「Callee is not connected」エラーで通話できない
- 通話画面（`/kiosk/call`）を開いていないとWebSocket接続が確立されない

**要因**: 
- WebRTCシグナリング接続が`KioskCallPage`内でのみ確立されていた
- 他のキオスク画面やサイネージ画面では接続が維持されていなかった
- 着信時に自動的に通話画面へ切り替わる機能がなかった

**有効だった対策**: 
- ✅ **常時接続機能の実装（2026-02-09）**:
  1. **`WebRTCCallProvider`の作成**: React ContextでWebRTC状態を全ルートで共有
  2. **`CallAutoSwitchLayout`の作成**: `/kiosk/*`と`/signage`の全ルートをラップ
  3. **`App.tsx`のルーティング修正**: `CallAutoSwitchLayout`を`/kiosk/*`と`/signage`に適用
  4. **着信時の自動切り替え**: `callState === 'incoming'`時に現在のパスを`sessionStorage`に保存し、`/kiosk/call`へ自動遷移
  5. **通話終了後の自動復帰**: `callState === 'idle' || 'ended'`時に元のパスへ自動復帰
  6. **Pi3の通話対象除外**: `WEBRTC_CALL_EXCLUDE_CLIENT_IDS`環境変数で除外フィルタを実装

**実装の詳細**:
```typescript
// apps/web/src/features/webrtc/context/WebRTCCallContext.tsx
export function WebRTCCallProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const webrtc = useWebRTC({ enabled: true });

  // 着信時の自動切り替え
  useEffect(() => {
    if (webrtc.callState !== 'incoming') return;
    if (location.pathname === '/kiosk/call') return;

    const returnPath = `${location.pathname}${location.search}`;
    window.sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
    navigate('/kiosk/call');
  }, [webrtc.callState, location.pathname, location.search, navigate]);

  // 通話終了後の自動復帰
  useEffect(() => {
    if (!shouldReturnOnCallState(webrtc.callState)) return;
    const returnPath = window.sessionStorage.getItem(RETURN_PATH_KEY);
    if (returnPath && returnPath !== location.pathname) {
      navigate(returnPath, { replace: true });
    }
    window.sessionStorage.removeItem(RETURN_PATH_KEY);
  }, [webrtc.callState, location.pathname, navigate]);
}

// apps/web/src/App.tsx
<Route element={<CallAutoSwitchLayout />}>
  <Route path="/signage" element={<SignageDisplayPage />} />
  <Route element={<KioskLayout />}>
    <Route path="/kiosk/*" ... />
  </Route>
</Route>
```

**API側の実装**:
```typescript
// apps/api/src/routes/kiosk.ts
const getWebRTCCallExcludeClientIds = (): Set<string> =>
  new Set(parseCsvList(process.env.WEBRTC_CALL_EXCLUDE_CLIENT_IDS));

// GET /kiosk/call/targets
const excludedClientIds = getWebRTCCallExcludeClientIds();
return {
  targets: devices
    .filter((t) => t.clientId !== selfClientId)
    .filter((t) => !excludedClientIds.has(t.clientId))
};
```

**学んだこと**:
- **React Contextによる状態共有**: 複数のルートで同じWebRTCインスタンスを共有することで、接続を常時維持できる
- **自動画面切り替えの実装**: `useEffect`で`callState`を監視し、着信時に自動的に通話画面へ遷移することで、ユーザー体験が向上する
- **`sessionStorage`による復帰パス管理**: 通話終了後に元の画面へ戻ることで、作業の中断を最小限に抑えられる
- **環境変数による柔軟な除外設定**: `WEBRTC_CALL_EXCLUDE_CLIENT_IDS`で特定のクライアントを除外することで、用途に応じた設定が可能

**解決状況**: ✅ **解決済み**（2026-02-09、実機検証完了: 2026-02-10）

**実機検証結果**:
- ✅ **APIレベルでの動作確認**: 発信先一覧APIが正常に動作し、Pi3が除外されることを確認
- ✅ **デプロイ成功**: Pi5とPi4でデプロイ成功（Run ID: 20260209-xxxxx-xxxxx, state: success）
- ✅ **MacからPi4への通話テスト**: MacからPi4への通話が正常に動作することを確認（音声・ビデオ双方向通信）
- ✅ **着信時の自動切り替え**: Pi4が`/kiosk/*`や`/signage`表示中に着信があった場合、自動的に`/kiosk/call`へ切り替わることを確認
- ✅ **通話終了後の自動復帰**: 通話終了後、元の画面（`/kiosk/*`や`/signage`）へ自動的に復帰することを確認

**関連ファイル**:
- `apps/web/src/features/webrtc/context/WebRTCCallContext.tsx`（WebRTC Context Provider、自動切り替え・復帰ロジック）
- `apps/web/src/features/webrtc/components/CallAutoSwitchLayout.tsx`（Layoutコンポーネント）
- `apps/web/src/App.tsx`（ルーティング設定）
- `apps/api/src/routes/kiosk.ts`（Pi3除外フィルタ）
- `apps/api/src/routes/__tests__/kiosk.integration.test.ts`（除外ロジックの統合テスト）

**関連KB**:
- [KB-171](./frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定): WebRTCビデオ通話機能の初期実装（clientKey/clientId未設定問題）
- [KB-136](./frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題): useWebRTCフックのcleanup関数が早期実行される問題
- [KB-139](./frontend.md#kb-139-webrtcシグナリングのwebsocket接続管理重複接続防止): WebRTCシグナリングのWebSocket接続管理（重複接続防止）

---

### [KB-242] 生産スケジュール登録製番削除ボタンの進捗連動UI改善

**実装日時**: 2026-02-10

**事象**: 
- 登録製番ボタン右上の×削除ボタンが、進捗状態に関係なく常に同じ見た目で表示されていた
- 完了済み製番と未完了製番の識別が削除ボタン上では困難だった

**要望**: 
- 進捗100%の製番は削除ボタンを白で表示（削除可能であることを明確に）
- 未完了の製番は削除ボタンをグレー白縁で表示（視覚的に区別）

**有効だった対策**: 
- ✅ **進捗連動UIの実装（2026-02-10）**:
  1. **API**: `GET /kiosk/production-schedule/history-progress`エンドポイントを追加（shared historyから進捗マップを返す）
  2. **Service**: `SeibanProgressService`を新設し、既存の製番進捗集計SQLを移植
  3. **DataSource**: `ProductionScheduleDataSource`を共通サービス利用へ切替（重複ロジック排除）
  4. **Web**: `useProductionScheduleHistoryProgress`フックを追加し、進捗マップを取得
  5. **UI**: 削除ボタンのスタイルを進捗に応じて切替（100%完了=白、未完了=グレー白縁）

**実装ファイル**:
- `apps/web/src/api/hooks.ts`: `useProductionScheduleHistoryProgress`フック
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`: 削除ボタンのスタイル切替
- `apps/api/src/services/production-schedule/seiban-progress.service.ts`: 製番進捗集計サービス
- `apps/api/src/routes/kiosk.ts`: history-progressエンドポイント
- `apps/api/src/services/visualization/data-sources/production-schedule/production-schedule-data-source.ts`: 共通サービス利用へ切替

**学んだこと**:
- **進捗マップの共有**: キオスクUIとサイネージの両方で同じ進捗データが必要な場合、サービス層を共通化することで整合性と保守性を確保できる
- **視覚的フィードバック**: 削除ボタンの色を進捗で変えることで、ユーザーが状態を直感的に把握できる

**解決状況**: ✅ **解決済み**（2026-02-10）

**実機検証結果**:
- ✅ **デプロイ成功**: Pi5とPi4でデプロイ成功（Run ID: 20260210-080354-23118）
- ✅ **キオスク動作検証OK**: 登録製番の進捗表示と削除ボタンの色切替が正常に動作

**関連KB**:
- [KB-231](./api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化): 生産スケジュール登録製番上限の拡張
- [KB-232](./infrastructure/signage.md#kb-232-サイネージ未完部品表示ロジック改善表示制御正規化動的レイアウト): サイネージ未完部品表示ロジック改善

---

### [KB-243] WebRTCビデオ通話の映像不安定問題とエラーダイアログ改善

**実装日時**: 2026-02-10

**事象**: 
- 相手側の動画が最初取得できない（通話開始直後に映像が表示されない）
- 「ビデオを有効/無効」を切り替えると相手側の画像が止まる
- しばらく無操作すると相手側の画像が止まる
- 相手キオスク未起動時にエラーメッセージがユーザビリティ悪い（`alert()`で生のエラーメッセージを表示）

**要因**: 
1. **`useWebRTC`が`localStream`/`remoteStream`をrefで保持して返すだけ**で、`ontrack`で更新されてもReactが再描画せずUIが更新されない
2. **`disableVideo()`がtrackを`stop/remove`**しており、相手側が最後のフレームで停止しやすい
3. **`enableVideo()`で`addTrack`時に別の`MediaStream`を渡す**ことで、相手側の`ontrack`が別streamを参照し、音声/映像で別streamになる環境で不安定
4. **PeerConnectionの接続状態監視（`disconnected/failed`検知・復旧）が無い**ため、無操作で接続が劣化しても復旧しない
5. **エラーメッセージが`alert()`で生表示**されており、ユーザー向けの説明が不足

**有効だった対策**: 
- ✅ **映像不安定問題の修正（2026-02-10）**:
  1. **`localStream`/`remoteStream`をstateで保持**: `useWebRTC`にstateを追加し、`ontrack`更新時にUI再描画を確実化
  2. **受信トラックを単一MediaStreamに集約**: `pc.ontrack`で`event.streams[0]`依存をやめ、受信トラックを単一のMediaStreamに集約してUIに渡す（音声/映像で別streamになる環境での不安定を回避）
  3. **`disableVideo()`でtrackをstop/removeしない**: `enabled=false`に変更（送信停止はするがtrackは生かす）ことで、相手側のフリーズを回避
  4. **`enableVideo()`の改善**: 既存trackがliveなら再有効化、新規は初回のみ再ネゴ、以後は`replaceTrack`を使用
  5. **接続状態監視とICE restart**: `connectionState`/`iceConnectionState`が`disconnected/failed`に寄った場合、少し待ってからICE restartのofferを送る最小の復旧処理を追加
- ✅ **エラーダイアログ改善（2026-02-10）**:
  1. **`alert()`を`Dialog`に置換**: `KioskCallPage`の`alert()`連発をやめ、`Dialog`コンポーネントで統一
  2. **エラーメッセージのユーザー向け変換**: `Callee is not connected`を「相手のキオスクが起動していません」という説明ダイアログに変換

**実装の詳細**:
```typescript
// apps/web/src/features/webrtc/hooks/useWebRTC.ts
// localStream/remoteStreamをstateで保持
const [localStream, setLocalStream] = useState<MediaStream | null>(null);
const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

// toUiStream: track追加/削除があってもReactの再描画が走るように、毎回新しいMediaStreamを作る
const toUiStream = useCallback((stream: MediaStream | null): MediaStream | null => {
  if (!stream) return null;
  return new MediaStream(stream.getTracks());
}, []);

// pc.ontrack: 受信トラックを単一MediaStreamに集約
pc.ontrack = (event) => {
  const existing = remoteStreamRef.current ?? new MediaStream();
  const track = event.track;
  if (!existing.getTracks().some((t) => t.id === track.id)) {
    existing.addTrack(track);
  }
  remoteStreamRef.current = existing;
  setRemoteStream(toUiStream(existing)); // state更新でUI再描画
};

// disableVideo: trackをstop/removeしない
const disableVideo = useCallback(() => {
  localStreamRef.current?.getVideoTracks().forEach((track) => {
    track.enabled = false; // stop/removeではなくenabled=false
  });
  setLocalStream(toUiStream(localStreamRef.current));
  setIsVideoEnabled(false);
}, [isVideoEnabled, toUiStream]);

// enableVideo: 既存trackがあれば再有効化、新規はreplaceTrack
const enableVideo = useCallback(async () => {
  const existingVideo = localStreamRef.current?.getVideoTracks()?.[0] ?? null;
  if (existingVideo && existingVideo.readyState === 'live') {
    existingVideo.enabled = true; // 再有効化
    setIsVideoEnabled(true);
    return;
  }
  // 新規track追加時はreplaceTrackを使用（再ネゴ不要）
  if (videoSenderRef.current) {
    await videoSenderRef.current.replaceTrack(videoTrack);
  } else {
    videoSenderRef.current = peerConnectionRef.current.addTrack(videoTrack, localStreamRef.current);
    await renegotiate('enableVideo');
  }
}, [currentCallId, isVideoEnabled, renegotiate, toUiStream]);

// 接続状態監視とICE restart
pc.onconnectionstatechange = () => {
  const state = pc.connectionState;
  if (state === 'failed' || state === 'disconnected') {
    scheduleIceRestart(); // 2.5秒後にICE restart
  }
};

pc.oniceconnectionstatechange = () => {
  const ice = pc.iceConnectionState;
  if (ice === 'failed' || ice === 'disconnected') {
    scheduleIceRestart();
  }
};
```

```typescript
// apps/web/src/pages/kiosk/KioskCallPage.tsx
// エラーダイアログのユーザー向け変換
const toUserFacingError = useCallback((error: Error): { title: string; description?: string } => {
  const msg = error.message || '';
  if (/Callee is not connected/i.test(msg)) {
    return {
      title: '相手のキオスクが起動していません',
      description: '相手端末が通話待機状態ではないため、発信できません。相手端末の電源が入っていること、ブラウザが起動していること、キオスク画面/サイネージ画面が表示されていることを確認してから再試行してください。',
    };
  }
  // その他のエラーもユーザー向けに変換
  return { title: 'エラー', description: msg ? `エラーが発生しました: ${msg}` : 'エラーが発生しました。' };
}, []);

// Dialogコンポーネントで表示
<Dialog
  isOpen={Boolean(errorDialog)}
  onClose={() => setErrorDialog(null)}
  title={errorDialog?.title}
  description={errorDialog?.description}
  ariaLabel="通話エラー"
  size="md"
>
  <div className="mt-4 flex justify-end">
    <Button type="button" onClick={() => setErrorDialog(null)}>OK</Button>
  </div>
</Dialog>
```

**学んだこと**:
- **React stateとrefの使い分け**: UIに反映させる必要がある値はstateで保持し、refだけでは再描画が走らない
- **MediaStreamの扱い**: `ontrack`で`event.streams[0]`に依存すると、音声/映像で別streamが届く環境で不安定になる。受信トラックを単一のMediaStreamに集約することで安定化
- **WebRTC trackの停止方法**: `stop/remove`すると相手側が最後のフレームで停止しやすい。`enabled=false`で送信を止めることで、相手側のフリーズを回避
- **`replaceTrack`の活用**: 既存senderがある場合は`replaceTrack`を使用することで、再ネゴシエーションを避けられる
- **接続状態監視の重要性**: PeerConnectionの接続状態を監視し、劣化時にICE restartすることで、無操作による接続切断を防げる
- **エラーメッセージのユーザビリティ**: 技術的なエラーメッセージをユーザー向けの説明に変換することで、ユーザー体験が向上する

**解決状況**: ✅ **解決済み**（2026-02-10）

**実機検証結果**:
- ✅ **通話開始直後に相手映像が表示される**: トグル無しで正常に映像が表示されることを確認
- ✅ **ビデオON/OFF時の相手側フリーズ回避**: 切り替えても相手側の映像が固まらないことを確認
- ✅ **無操作時の接続維持**: 数分放置しても相手側の映像が止まらないことを確認
- ✅ **エラーダイアログの改善**: 相手キオスク未起動時に分かりやすい説明ダイアログが表示されることを確認
- ✅ **デプロイ成功**: Pi5とPi4でデプロイ成功（Run ID: 20260210-105120-4601）
- ✅ **CI成功**: 全ジョブ（lint-and-test, e2e-smoke, docker-build, e2e-tests）成功

**関連ファイル**:
- `apps/web/src/features/webrtc/hooks/useWebRTC.ts`（localStream/remoteStreamのstate化、track集約、disableVideo/enableVideo改善、接続状態監視）
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`（エラーダイアログ改善）

**関連KB**:
- [KB-241](./frontend.md#kb-241-webrtcビデオ通話の常時接続と着信自動切り替え機能実装): WebRTCビデオ通話の常時接続と着信自動切り替え機能実装
- [KB-136](./frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題): useWebRTCフックのcleanup関数が早期実行される問題
- [KB-138](./frontend.md#kb-138-ビデオ通話時のdom要素へのsrcobjectバインディング問題): ビデオ通話時のDOM要素へのsrcObjectバインディング問題

---

### [KB-244] Pi4キオスクの備考欄に日本語入力状態インジケーターを追加

**発生日**: 2026-02-10

**Context**:
- Pi4キオスクの備考欄で日本語入力が可能になったが、全画面表示のためシステムレベルのIMEインジケーターが見えない
- ユーザーが現在の入力モード（日本語/英字）を確認できない
- キーボードからの日本語入力切り替え（Ctrl+Space）ができない問題も発見

**Symptoms**:
- 備考欄にアルファベットしか入力できない
- 現在の入力モードが分からない（全画面表示でシステムインジケーターが非表示）
- Ctrl+SpaceやAlt+`で日本語入力に切り替えられない

**Investigation**:
- **仮説1**: IBus設定が不適切（CONFIRMED）
  - `gsettings get org.freedesktop.ibus.general engines-order`が`@as []`（空）
  - `ibus engine`実行時に「エンジンが設定されていません」と表示
  - `gsettings get org.freedesktop.ibus.general.hotkey triggers`が`['<Super>space']`（Ctrl+Spaceではない）
- **仮説2**: Chromiumの全画面モードでIMEショートカットがブロックされる（INCONCLUSIVE）
  - Chromiumのkioskモードではキーボードショートカットが制限される可能性がある
  - ただし、IBus設定が空のため、設定修正後の動作は未確認
- **仮説3**: WebアプリからOSのIMEを直接制御できない（CONFIRMED）
  - ブラウザからOSのIME（ibus/mozc）を直接切り替える標準APIは存在しない
  - `compositionstart`/`compositionend`イベントで入力モードを検出することは可能

**Root cause**:
1. **IBus設定の未設定**: `engines-order`が空で、切替対象エンジンが設定されていない
2. **ホットキー設定の不一致**: デフォルトが`<Super>space`で、ユーザーが期待する`Ctrl+Space`ではない
3. **全画面表示による視認性の問題**: システムレベルのIMEインジケーターが非表示

**Fix**:
- ✅ **注釈文の修正**（2026-02-10）:
  1. 切り替え方法の注釈を「Ctrl+Space または Alt+`（半角/全角）」→「全角半角キー」に修正
  2. 実機動作（全角半角キー単独押し）と一致するように変更
- ✅ **現在モード表示の削除**（2026-02-10）:
  1. `isComposing` stateと`compositionstart`/`compositionend`イベントリスナーを削除
  2. インジケーター表示（「あ 日本語」「A 英字」）を削除
  3. 理由: 入力中のみ表示され、確定後は日本語入力モードでも「A 英字」に戻る不正確な動作のため
- ✅ **IBus設定の永続化**（2026-02-10）:
  1. Ansibleロール（`kiosk/tasks/main.yml`）にIBus設定タスクを追加
  2. `engines-order`を`['xkb:jp::jpn', 'mozc-jp']`に設定
  3. `hotkey triggers`を`['<Control>space']`に設定
  4. DBusユーザーバスが無い場合は安全にスキップ（デプロイ失敗回避）
  5. 冪等性を確保（差分がある時だけchanged）
- ✅ **Pi4再起動ボタンのエラーハンドリング改善**（2026-02-10）:
  1. `apps/api/src/routes/kiosk.ts`の`fs.mkdir`に`EEXIST`エラーハンドリングを追加
  2. ボリュームマウントされたディレクトリでも正常に動作するように修正

**Prevention**:
- AnsibleでIBus設定を永続化することで、Pi4再起動後も設定が維持される
- デプロイ時に自動的にIBus設定が適用されるため、手動設定が不要
- 注釈文を実機動作に合わせることで、ユーザーが正しい切り替え方法を理解できる

**実機検証結果**:
- ✅ **切り替え方法**: 全角半角キーの単独押しで日本語入力モードが切り替わることを確認
- ✅ **注釈文修正**: 「Ctrl+Space または Alt+`（半角/全角）」→「全角半角キー」に修正し、実機動作と一致することを確認
- ✅ **現在モード表示削除**: 入力中のみ表示され、確定後は日本語入力モードでも「A 英字」に戻る不正確な動作のため、表示を削除
- ✅ **IBus設定**: `engines-order`と`hotkey triggers`が正しく設定されることを確認
- ✅ **デプロイ成功**: Pi5とPi4でデプロイ成功（Run ID: 20260210-131708-15247, state: success）

**関連ファイル**:
- `apps/web/src/components/kiosk/KioskNoteModal.tsx`（注釈文修正、現在モード表示削除）
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`（IBus設定永続化）
- `apps/api/src/routes/kiosk.ts`（再起動ボタンのエラーハンドリング改善）

**学んだこと**:
- **ブラウザからOSのIME状態を直接取得する標準APIは存在しない**: `compositionstart`/`compositionend`は入力中（未確定）のみ検出でき、IMEのON/OFF状態は検出できない
- **実機検証の重要性**: 想定した動作（Ctrl+Space）と実際の動作（全角半角キー）が異なる場合があるため、実機検証が必須
- **不正確な表示より非表示**: 現在モード表示が不正確な場合は、ユーザーを混乱させる可能性があるため、削除する方が良い

**解決状況**: ✅ **解決済み**（2026-02-10、実機検証完了）

---

### [KB-247] 生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化

**実装日時**: 2026-02-10

**Context**:
- 生産スケジュール画面で、登録製番ボタン右上の×削除ボタンの応答性が若干落ちた気がするという報告があった
- KB-242で実装した完未完判定機能（`useKioskProductionScheduleHistoryProgress()`）が追加され、4秒ごとにポーリングが実行されていた

**Symptoms**:
- ×ボタンを押したときの反応が若干遅い気がする
- クリックの取りこぼしや反応の遅れが発生する可能性がある

**Investigation**:
1. **仮説1**: 完未完判定ロジック（`isComplete = progressBySeiban[h]?.status === 'complete'`）が重い（REJECTED）
   - このロジック自体はO(1)の軽量な処理で、体感劣化の原因にはなりにくい
2. **仮説2**: `history-progress`の4秒ポーリングが原因（CONFIRMED）
   - `useKioskProductionScheduleHistoryProgress()`が`refetchInterval: 4000`で常時実行
   - React Queryの`refetchInterval`は、データが同じでも`isFetching`が変動し、ページ全体の再レンダーが発生しやすい
   - `ProductionSchedulePage`は最大400行の巨大テーブルを含むため、再レンダーコストが高い
   - 4秒ごとに2回（フェッチ開始・完了）の再レンダーが発生し、Pi4等の非力端末でメインスレッドが詰まりやすい
3. **仮説3**: API側の重い集計SQLが原因（CONFIRMED）
   - `/kiosk/production-schedule/history-progress`エンドポイントが4秒ごとに実行
   - `fetchSeibanProgressRows()`がJSON列抽出（`rowData->>'FSEIBAN'`、`rowData->>'progress'`）とGROUP BYを実行
   - 式インデックスが存在しないため、データ件数が増えるとDB負荷が高くなる
   - DB負荷/遅延が増えると、フロント側のフェッチ状態変動・更新が増えやすい

**Root cause**:
1. **フロント側**: `history-progress`の4秒ポーリングにより、重い`ProductionSchedulePage`（最大400行）が頻繁に再レンダーされる
2. **サーバー/DB側**: 4秒ごとにJSON抽出＋集計SQL（式インデックスなし）が実行され、DB負荷/遅延が増えるとフロント側の更新が増える

**Fix**:
- ✅ **ポーリング間隔の最適化**（2026-02-10）:
  1. `useKioskProductionScheduleHistoryProgress()`の`refetchInterval`を`4000`→`30000`（30秒）に変更
  2. `useKioskProductionScheduleSearchState()`と`useKioskProductionScheduleSearchHistory()`は4秒のまま維持（端末間同期の速さを維持）
  3. 完未完表示の更新間隔は最大30秒の遅延となるが、応答性改善を優先

**Prevention**:
- ポーリング間隔は用途に応じて適切に設定する（同期が必要なものは短く、表示のみのものは長く）
- 重いページ（大量のDOM要素を含む）では、ポーリング間隔を長めに設定する
- DB側の式インデックス検討（将来的な最適化候補）

**実装ファイル**:
- `apps/web/src/api/hooks.ts`（`useKioskProductionScheduleHistoryProgress()`の`refetchInterval`変更）

**学んだこと**:
- **React Queryの`refetchInterval`はデータが同じでも再レンダーを発生させる**: `isFetching`の変動により、データが変わらなくても再レンダーが発生する
- **重いページではポーリング間隔の影響が大きい**: 最大400行のテーブルを含むページでは、4秒ごとの再レンダーが体感劣化の原因になる
- **用途に応じたポーリング間隔の設定**: 端末間同期が必要なもの（`search-state`）は短く、表示のみのもの（`history-progress`）は長く設定する
- **DB側の最適化も重要**: JSON列抽出＋集計SQLは式インデックスがないと重くなるため、将来的な最適化候補として検討する

**関連KB**:
- [KB-242](./frontend.md#kb-242-生産スケジュール登録製番削除ボタンの進捗連動ui改善): 生産スケジュール登録製番削除ボタンの進捗連動UI改善
- [KB-205](./api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側): 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）

**解決状況**: ✅ **解決済み**（2026-02-10、デプロイ完了）

---

### [KB-248] カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応）

**実装日時**: 2026-02-11

**Context**:
- 雨天・照明なしの環境で、閾値0.1でも「写真が暗すぎます」エラーが発生
- 人間の目では暗いとは感じない環境でも、カメラの露出調整が完了する前に撮影されるためエラーになる
- 過去にカメラストリームを常時ONにしていたが、Pi4の負荷が高くシステムが落ちた経験がある

**Symptoms**:
- 雨天・照明なしの環境で、閾値を0.1に下げても「写真が暗すぎます」エラーが発生
- 補光で1回成功すれば、補光なしでも何度も成功する（ストリーム継続中は露出調整が保持される）
- 再起動後の1回目のNFCタグスキャン時にエラーになりやすい

**Investigation**:
1. **仮説1**: 閾値が高すぎる（REJECTED）
   - 閾値を18→8→1→0.1と下げても、雨天・照明なし環境ではエラーが発生
2. **仮説2**: カメラの露出調整待機時間が短い（CONFIRMED）
   - `capturePhotoFromStream`で100ms待機では不十分
   - USBカメラの露出調整には200〜500msかかる
   - 500ms待機＋5フレーム試行（各100ms間隔）に変更
3. **仮説3**: ストリーム停止時に露出調整がリセットされる（CONFIRMED）
   - ストリームを停止すると、カメラの露出調整もリセットされる
   - 補光で1回成功後、補光なしでも成功するのは、ストリーム継続中は露出調整が保持されているため
4. **仮説4**: ストリーム保持による負荷問題（CONFIRMED）
   - 過去にカメラストリームを常時ONにしていたが、Pi4の負荷が高くシステムが落ちた
   - ストリーム保持は負荷が高く、Pi4では不可

**Root cause**:
1. **カメラの露出調整タイミング**: USBカメラは起動直後に自動で露出調整を行うが、調整完了前に撮影すると暗い画像になる
2. **ストリーム停止による露出調整リセット**: ストリームを停止すると露出調整もリセットされるため、次回スキャン時には再調整が必要
3. **負荷問題**: ストリーム保持はPi4の負荷が高く、システムが落ちる可能性があるため不可

**Fix**:
- ✅ **閾値チェックの削除**（2026-02-11）:
  1. フロントエンド（`apps/web/src/utils/camera.ts`）の閾値チェックを削除
  2. バックエンド（`apps/api/src/services/tools/loan.service.ts`）の閾値チェックを削除
  3. テスト（`apps/api/src/routes/__tests__/photo-borrow.integration.test.ts`）の暗い画像拒否テストをスキップ
  4. **500ms待機＋5フレーム選択ロジックは維持**（カメラの露出調整を待つため）

**Prevention**:
- カメラの露出調整を待つロジック（500ms待機＋5フレーム選択）は維持
- ストリーム保持による負荷問題を避けるため、閾値チェックは削除
- どんな明るさでも撮影可能にすることで、ユーザー体験を向上

**実装ファイル**:
- `apps/web/src/utils/camera.ts`（閾値チェック削除、500ms待機＋5フレーム選択ロジック維持）
- `apps/api/src/services/tools/loan.service.ts`（閾値チェック削除）
- `apps/api/src/routes/__tests__/photo-borrow.integration.test.ts`（暗い画像拒否テストをスキップ）

**学んだこと**:
- **USBカメラの露出調整は時間がかかる**: 起動直後200〜500msで露出調整が完了するため、待機時間が必要
- **複数フレーム選択は有効**: 5フレームを試行して最も明るいフレームを選択することで、露出調整後の明るい画像を取得できる
- **ストリーム停止で露出調整がリセットされる**: ストリームを停止すると露出調整もリセットされるため、次回スキャン時には再調整が必要
- **ストリーム保持は負荷が高い**: Pi4ではストリーム保持による負荷でシステムが落ちる可能性があるため、不可
- **閾値チェックは負荷問題を引き起こす可能性がある**: ストリーム保持による負荷問題を回避するため、閾値チェックを削除し、どんな明るさでも撮影可能にした

**関連KB**:
- [KB-068](./frontend.md#kb-068-写真撮影持出のサムネイルが真っ黒になる問題輝度チェック対策): 写真撮影持出のサムネイルが真っ黒になる問題（輝度チェック対策）

**解決状況**: ✅ **解決済み**（2026-02-11、実機検証完了）

---

### [KB-249] 加工機マスターデータのCSVインポートと未点検加工機抽出機能の実装

**EXEC_PLAN.md参照**: feat/signage-visualization-layout-improvement ブランチ（2026-02-11）

**事象**: 
- 加工機マスターデータをCSVインポートし、未点検加工機を抽出する機能が必要だった
- マスターテーブルは今後も様々な用途で使うため、従業員名簿と同様に流用可能な扱いにする必要があった

**実装内容**: 
- ✅ **実装完了**（2026-02-11）: 加工機マスターデータのCSVインポート機能、未点検加工機抽出機能、管理コンソールUIを実装
  1. **データベーススキーマ**: `Machine`モデルを追加（`equipmentManagementNumber`をユニークキーとして使用）
  2. **CSVインポーター**: `MachineCsvImporter`を実装（既存の`CsvImporter`インターフェースに準拠）
  3. **APIエンドポイント**: 
     - `GET /api/tools/machines`: 加工機一覧取得（検索・フィルタ対応）
     - `GET /api/tools/machines/uninspected`: 未点検加工機一覧取得（当日JST基準）
  4. **管理コンソールUI**: `/admin/tools/machines-uninspected`ページを追加（未点検加工機一覧表示）
  5. **CSVインポート設定**: `machines`タイプをCSVインポート設定に追加

**仕様**:
- **未点検の定義**: マスターテーブルで`稼働状態=稼働中`の加工機のうち、当日（JST）の点検結果CSVダッシュボードに記録がないもの
- **結合キー**: `設備管理番号`（`equipmentManagementNumber`）でマスターデータとファクトデータを結合
- **日付判定**: 当日（JST）の範囲を`formatTokyoDate`と`resolveTokyoDayRange`で正確に計算
- **データ抽出**: `CsvDashboardRow.rowData`から`設備管理番号`を抽出（`extractEquipmentNumber`関数）

**トラブルシューティング**:
- **CSVインポート設定の初期化**: 初回インポート時に`machines`のCSVインポート設定が`null`だったため、デフォルト列定義を明示的に保存する必要があった
- **タイムゾーン変換の二重適用**: KB-249参照（CSVダッシュボードの日付パースでタイムゾーン変換の二重適用問題）

**学んだこと**: 
- **マスターデータの再利用性**: マスターテーブルは様々な用途で使うため、従業員名簿と同様に流用可能な設計にする
- **CSVインポート設定の初期化**: 新しいデータタイプを追加する際は、CSVインポート設定を明示的に初期化する必要がある
- **タイムゾーン処理**: JST基準の日付判定は、`Date.UTC`を使用して実行環境に依存しない変換を行う

**関連ファイル**: 
- `apps/api/prisma/schema.prisma`（`Machine`モデル）
- `apps/api/src/services/imports/importers/machine.ts`（`MachineCsvImporter`）
- `apps/api/src/services/tools/machine.service.ts`（`MachineService`）
- `apps/api/src/routes/tools/machines/index.ts`（APIエンドポイント）
- `apps/web/src/pages/tools/MachinesUninspectedPage.tsx`（管理コンソールUI）

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了・実機検証完了**（2026-02-11）

---

### [KB-252] 未点検加工機サイネージ設定導線（可視化ダッシュボード経由）の実装

**EXEC_PLAN.md参照**: feat/signage-visualization-layout-improvement ブランチ（2026-02-11）

**事象**:
- 管理コンソールから未点検加工機をサイネージコンテンツとして選択しやすくする必要があった
- 可視化ダッシュボードの入力が自由形式JSONのため、運用時に `csvDashboardId` の設定漏れが発生しやすかった

**要因**:
- 可視化ダッシュボード作成UIは汎用設計で、未点検加工機用途のプリセットや入力ガイドがなかった
- サイネージスケジュール画面の可視化選択肢で、用途判別の情報が不足していた

**有効だった対策**:
- ✅ 可視化ダッシュボード管理画面に「未点検加工機プリセットを適用」ボタンを追加
  - `dataSourceType=uninspected_machines`
  - `rendererType=uninspected_machines`
  - `dataSourceConfig` / `rendererConfig` の推奨テンプレートを自動入力
- ✅ `uninspected_machines` 選択時に `dataSourceConfig.csvDashboardId` を必須バリデーション
- ✅ `csvDashboardId` を手入力させず、**CSVダッシュボードをUIで選択**できるように改善
  - `uninspected_machines` プリセット適用時に `csvDashboardId` 選択ドロップダウンを表示
  - 無効（`enabled=false`）のCSVダッシュボードも表示し、名前に `(無効)` を付けて誤選択を防止
  - 一覧取得時の `enabled: true` 固定フィルタを外し、「選択肢に出てこない」事故を防止
- ✅ 「点検結果CSVダッシュボードが存在しない」状況に対して、`加工機_日常点検結果` を**プリセット作成**できるボタンをCSVダッシュボード画面に追加
- ✅ サイネージスケジュール画面の可視化プルダウンに用途ラベル（`未点検加工機`）を表示
- ✅ 表示仕様を「日次設備集約」に更新（2026-02-12）
  - JST当日のみ対象
  - 1設備管理番号あたり1行に集約
  - `点検結果` 列を `正常X/異常Y` 形式で表示（`点検項目` 列は非表示）
  - 稼働中マスターに存在し当日記録がない設備は `未使用` と表示

**運用トラブルシューティング（今回詰まった点）**:
- **エラー**: 「未点検加工機データソースでは csvDashboardId が必須です」  
  - **対処**: 可視化ダッシュボードの編集画面で `csvDashboardId` をドロップダウン選択して保存
- **症状**: `csvDashboardId` の選択肢に「加工機_日常点検結果」が出ない  
  - **原因候補**: CSVダッシュボードが未作成 / 無効化されている / 一覧取得が有効のみフィルタされている  
  - **対処**: CSVダッシュボード画面でプリセット作成し、必要なら有効化してから再選択

**学んだこと**:
- 汎用機能に業務用途を載せる場合は、専用機能を増やすより「プリセット + 必須入力ガード」の方が保守しやすい
- 運用ミス対策は「保存時バリデーション」と「選択時の識別情報」の両方が必要
- 「参照先リソースのID」を手入力させるとミスが起きやすい。**作成（プリセット）→選択（ドロップダウン）→保存（バリデーション）**の順でガードする
- サイネージ用途では「生CSVの1行=1点検項目」の粒度をそのまま見せるより、業務判断単位（1設備）へ集約した方が可読性と運用性が高い
- 集約ロジックはサービス層に置き、データソース/レンダラーは表示責務に限定すると、他画面への再利用と仕様変更がしやすい

**関連ファイル**:
- `apps/web/src/pages/admin/VisualizationDashboardsPage.tsx`
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx`
- `apps/api/src/services/tools/machine.service.ts`
- `apps/api/src/services/visualization/data-sources/uninspected-machines/uninspected-machines-data-source.ts`
- `apps/api/src/services/visualization/renderers/uninspected-machines/uninspected-machines-renderer.ts`
- `apps/api/src/services/visualization/data-sources/uninspected-machines/__tests__/uninspected-machines-data-source.test.ts`
- `apps/api/src/services/tools/__tests__/machine.service.test.ts`

**解決状況**: ✅ **実装完了・テスト通過**（2026-02-12）

---

### [KB-254] 加工機マスタのメンテナンスページ追加（CRUD機能）

**日付**: 2026-02-11

**事象**: 
- 加工機マスタデータをCSVインポートしたが、管理コンソールに従業員名簿や計測機器のようなメンテナンスタブが存在しなかった
- 加工機マスタデータの登録・編集・削除ができない状態だった

**要因**: 
- 加工機マスタのCRUD機能が実装されていなかった
- APIエンドポイントは`GET /api/tools/machines`と`GET /api/tools/machines/uninspected`のみで、作成・更新・削除ができなかった

**有効だった対策**: 
- ✅ **加工機マスタのCRUD機能実装（2026-02-11）**:
  1. **APIエンドポイント追加**:
     - `POST /api/tools/machines`: 加工機作成
     - `PUT /api/tools/machines/:id`: 加工機更新
     - `DELETE /api/tools/machines/:id`: 加工機削除
  2. **サービス層実装**: `MachineService`に`create`, `update`, `delete`メソッドを追加
  3. **フロントエンドページ追加**: `/admin/tools/machines`ページを追加（`MachinesPage.tsx`）
     - 加工機登録・編集フォーム
     - 加工機一覧テーブル（検索・フィルタ対応）
     - 編集・削除機能
  4. **ナビゲーション追加**: `AdminLayout.tsx`に「加工機」タブを追加
  5. **React Queryフック追加**: `useMachineMutations`フックを追加（create, update, delete）

**実装の詳細**:
- **フォーム**: 設備管理番号、加工機名称、略称、分類、稼働状態、NC/Manual、メーカー、工程分類、クーラントの入力フィールド
- **検索・フィルタ**: 名称、設備管理番号、分類、メーカーで検索、稼働状態でフィルタ
- **編集機能**: 一覧から「編集」ボタンをクリックしてフォームに値を設定、編集完了後に「上書き保存」
- **削除機能**: 削除前に確認ダイアログを表示

**学んだこと**: 
- **マスターデータの一貫性**: 従業員名簿や計測機器と同様に、加工機マスタも管理コンソールからCRUD操作できるようにすることで、運用の一貫性を保つ
- **既存パターンの再利用**: `EmployeesPage.tsx`を参考にすることで、UIの一貫性と実装効率を向上
- **ブランチ管理**: `main`ブランチにマージした変更が、`feat/signage-visualization-layout-improvement`ブランチに反映されていなかったため、マージが必要だった

**関連ファイル**: 
- `apps/api/src/routes/tools/machines/index.ts`（APIエンドポイント）
- `apps/api/src/services/tools/machine.service.ts`（サービス層）
- `apps/web/src/pages/tools/MachinesPage.tsx`（フロントエンドページ）
- `apps/web/src/layouts/AdminLayout.tsx`（ナビゲーション）
- `apps/web/src/api/client.ts`（APIクライアント）
- `apps/web/src/api/hooks.ts`（React Queryフック）

**解決状況**: ✅ **実装完了・CI成功・デプロイ完了・実機検証完了**（2026-02-11）

**実機検証結果（2026-02-11）**:
- ✅ **加工機の登録**: 設備管理番号、加工機名称、略称、分類、稼働状態、NC/Manual、メーカー、工程分類、クーラントの入力が正常に動作することを確認
- ✅ **加工機の編集**: 一覧から「編集」ボタンをクリックしてフォームに値を設定し、「上書き保存」で正常に更新されることを確認
- ✅ **加工機の削除**: 削除前に確認ダイアログが表示され、確認後に正常に削除されることを確認
- ✅ **検索・フィルタ機能**: 名称、設備管理番号、分類、メーカーでの検索が正常に動作することを確認。稼働状態（稼働中/停止中/メンテナンス中）でのフィルタが正常に動作することを確認
- ✅ **一覧表示**: 加工機一覧が正常に表示され、ページネーションが正常に動作することを確認

---
