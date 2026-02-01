# KB-XXX: キオスク入力フィールド保護ルールの調査と提案

**作成日**: 2026-02-02  
**状態**: 調査完了・提案準備中  
**関連**: [api-key-policy.md](../guides/api-key-policy.md), [frontend.md](./frontend.md)

## Context

Raspberry Pi 4を再起動した後、APIキーとIDがランダムな文字列（`QAZwsxedcrftvgbuyhnk,olp.;` と `q3artf5uyh7p;.z BNM,..`）に置き換わり、データベースにアクセスできなくなった。

**原因**: キーボードにジュースをこぼして拭いた際に、キーボードのキーが誤って押され、入力フィールドにランダムな文字列が入力された。この値が`localStorage`に保存され、再起動後もその値が読み込まれた。

## 調査結果

### 1. Pi5、Pi4、Pi3のIDとAPIキー

#### Raspberry Pi 5（サーバー）
- **APIキー**: `client-key-raspberrypi5-server`
- **Client ID** (status-agent用): `raspberrypi5-server`
- **UUID** (ClientDevice.id): データベースで自動生成（heartbeatエンドポイントで登録時に生成）
- **参照**: `infrastructure/ansible/inventory.yml` (41-44行目)

#### Raspberry Pi 4（キオスク）
- **APIキー**: `client-key-raspberrypi4-kiosk1`
- **Client ID** (status-agent用): `raspberrypi4-kiosk1`
- **UUID** (ClientDevice.id): `43bb79fd-6f4c-42fb-b342-5531687581be`
- **参照**: `docs/guides/api-key-policy.md` (25行目), `infrastructure/ansible/inventory.yml` (53-54行目)

#### Raspberry Pi 3（サイネージ）
- **APIキー**: `client-key-raspberrypi3-signage1`
- **Client ID** (status-agent用): `raspberrypi3-signage1`
- **UUID** (ClientDevice.id): `d1f81cfa-af3c-4958-9252-7da69d4b7e96`
- **参照**: `docs/guides/api-key-policy.md` (24行目), `infrastructure/ansible/inventory.yml` (85-86行目)

#### デモ・開発用
- **APIキー**: `client-demo-key`
- **UUID** (ClientDevice.id): `5c88681a-1f1c-4c7f-a5c7-fbfc0a7387a2`
- **参照**: `docs/guides/api-key-policy.md` (23行目)

### 2. 現在の実装の問題点

#### 入力フィールドのバリデーション不足
- `KioskHeader.tsx`の入力フィールドにバリデーションがない
- 任意の文字列が入力可能で、`localStorage`に保存される

#### localStorageの自動保存
- `useLocalStorage`フックが`value`が変更されるたびに自動的に`localStorage`に保存
- 不正な値でも保存されてしまう

#### 読み込み時の検証不足
- `useLocalStorage`は`JSON.parse`に失敗した場合はデフォルト値を返すが、形式チェックは行わない
- 不正な形式の値でもそのまま使用される可能性がある

## 提案: 入力フィールドの保護ルール

### 1. 入力値のバリデーション

#### APIキーの形式チェック
- 形式: `client-key-*` または `client-demo-key`
- 最小長: 8文字
- 最大長: 100文字
- 許可文字: 英数字、ハイフン、アンダースコア

#### ID（UUID）の形式チェック
- 形式: UUID v4形式（`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`）
- または空文字列（オプショナル）

### 2. 不正値の自動修復

#### 読み込み時の検証と修復
- `useLocalStorage`で読み込んだ値を検証
- 不正な値の場合はデフォルト値に自動復元
- ログに記録（開発環境のみ）

### 3. 入力フィールドの保護

#### オプションA: キオスクモードでの編集不可（推奨）
- キオスクモードでは入力フィールドを`readOnly`にする
- 管理者モード（管理コンソール）でのみ編集可能

#### オプションB: 入力時のリアルタイムバリデーション
- 入力中にリアルタイムで形式チェック
- 不正な値の場合はエラーメッセージを表示
- 保存をブロック

### 4. 実装方針

1. **バリデーション関数の作成**
   - `apps/web/src/utils/validation.ts`にバリデーション関数を追加
   - APIキーとUUIDの形式チェック

2. **useLocalStorageの拡張**
   - バリデーション関数を組み込み
   - 不正値の自動修復機能を追加

3. **KioskHeaderの更新**
   - 入力フィールドにバリデーションを追加
   - エラーメッセージの表示
   - オプションAを採用する場合は`readOnly`属性を追加

## 実装の優先順位

1. **高**: 読み込み時の検証と自動修復（再発防止）✅ 実装完了
2. **中**: 入力値のバリデーション（ユーザー体験向上）✅ 実装完了
3. **低**: キオスクモードでの編集不可（運用方針による）⏸️ 未実装（必要に応じて追加可能）

## 実装内容

### 1. バリデーション関数の作成 ✅

`apps/web/src/utils/validation.ts`を作成し、以下の関数を実装：
- `isValidApiKey(apiKey: string)`: APIキーの形式チェック
- `isValidUuid(uuid: string)`: UUID形式のチェック
- `validateAndSanitizeApiKey(apiKey, defaultValue)`: APIキーの検証と自動修復
- `validateAndSanitizeUuid(uuid)`: UUIDの検証と自動修復

### 2. useLocalStorageの拡張 ✅

`apps/web/src/hooks/useLocalStorage.ts`に以下を追加：
- `useLocalStorageApiKey(key, defaultValue)`: APIキー用のバリデーション付きフック
- `useLocalStorageUuid(key, defaultValue)`: UUID用のバリデーション付きフック

両フックは以下の機能を提供：
- 読み込み時の自動バリデーションと修復
- 保存時の自動バリデーション
- 不正値の自動修復（デフォルト値または空文字列に置換）

### 3. KioskLayoutの更新 ✅

`apps/web/src/layouts/KioskLayout.tsx`を更新：
- `useLocalStorage`を`useLocalStorageApiKey`と`useLocalStorageUuid`に置き換え
- 自動バリデーションと修復が有効化

### 4. KioskHeaderの更新 ✅

`apps/web/src/components/kiosk/KioskHeader.tsx`を更新：
- リアルタイムバリデーション機能を追加
- エラーメッセージの表示機能を追加
- 入力フィールドにエラー時の視覚的フィードバック（赤枠）を追加

## 動作確認

### 読み込み時の自動修復
- localStorageに不正な値が保存されている場合、読み込み時に自動的にデフォルト値に修復される
- 開発環境ではコンソールに警告が表示される

### 入力時のバリデーション
- APIキー入力時にリアルタイムで形式チェック
- UUID入力時にリアルタイムで形式チェック
- エラーがある場合は赤枠とエラーメッセージを表示
- バリデーションが通った場合のみ保存

## 関連ファイル

- `apps/web/src/utils/validation.ts`: バリデーション関数（新規作成）
- `apps/web/src/components/kiosk/KioskHeader.tsx`: 入力フィールドの実装（更新）
- `apps/web/src/hooks/useLocalStorage.ts`: localStorage管理フック（拡張）
- `apps/web/src/layouts/KioskLayout.tsx`: レイアウトコンポーネント（更新）
- `apps/web/src/api/client.ts`: DEFAULT_CLIENT_KEYの定義
- `docs/guides/api-key-policy.md`: APIキーの方針ドキュメント

## 今後の改善案

1. **キオスクモードでの編集不可**: 必要に応じて、キオスクモードでは入力フィールドを`readOnly`にする
2. **管理コンソールでの編集**: 管理コンソールでは編集可能な専用画面を提供する
3. **バリデーションルールの拡張**: 必要に応じて、より厳密なバリデーションルールを追加する

## 参考

- [KB-XXX: キーボード誤入力によるlocalStorage破損問題](./frontend.md#kb-xxx-キーボード誤入力によるlocalstorage破損問題)
