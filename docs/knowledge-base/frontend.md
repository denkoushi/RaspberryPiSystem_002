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
**件数**: 27件  
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

**学んだこと**: 
- USBカメラは起動直後に暗転フレームを生成するため、フレーム内容の検証が必要
- フロントエンドとサーバー側の両方で検証することで、確実に黒画像を防止できる
- `sharp().stats()`のチャネル名は環境によって異なる可能性があるため、フォールバック処理が必要
- 輝度しきい値は環境変数で調整可能にすることで、実環境に応じた最適化が可能

**解決状況**: ✅ **解決済み**（2025-12-04）

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

**関連ファイル**: 
- `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`

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
