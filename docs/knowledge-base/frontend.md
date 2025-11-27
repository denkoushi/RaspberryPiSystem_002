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
**件数**: 6件  
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
