---
title: トラブルシューティングナレッジベース - フロントエンド関連
tags: [トラブルシューティング, フロントエンド, React, XState]
audience: [開発者]
last-verified: 2025-11-27
related: [index.md, ../modules/tools/README.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - フロントエンド関連

**カテゴリ**: フロントエンド関連  
**件数**: 15件  
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
