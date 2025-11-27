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

