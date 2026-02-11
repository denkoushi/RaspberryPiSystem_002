# KB-225: キオスク入力フィールド保護ルールの実装と実機検証

**作成日**: 2026-02-02  
**更新日**: 2026-02-02  
**状態**: ✅ 実装完了・実機検証完了  
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

## 実装方針の変更

初期提案では入力フィールドのバリデーション強化を検討していたが、ユーザー要件（「入力も削除も自在にできる。入力欄を設けず、表示だけにすればいいのに」）を踏まえ、**入力フィールドを完全に削除し、表示のみに変更**する方針に変更した。

## 実装内容

### 1. KioskHeaderの入力フィールド削除 ✅

`apps/web/src/components/kiosk/KioskHeader.tsx`を更新：
- `<Input>`コンポーネントを削除し、`<span>`要素による表示のみに変更
- APIキーとIDを編集不可にし、マスク表示（例: `clie…k1`）で表示
- `onClientKeyChange`、`onClientIdChange`、`handleClientKeyChange`、`handleClientIdChange`などの編集関連関数を削除

### 2. localStorageへの書き込み無効化 ✅

各キオスクページ（`KioskBorrowPage.tsx`、`KioskPhotoBorrowPage.tsx`、`KioskRiggingBorrowPage.tsx`、`KioskInstrumentBorrowPage.tsx`、`KioskReturnPage.tsx`、`KioskCallPage.tsx`、`KioskSupportModal.tsx`）を更新：
- `useLocalStorage('kiosk-client-key')`の使用を削除
- `resolvedClientKey`を`DEFAULT_CLIENT_KEY`に直接設定
- `resolvedClientId`を`undefined`または`DEFAULT_CLIENT_KEY`から派生する値に設定
- localStorageへの書き戻しパスを完全に削除

### 3. 起動時防御の実装 ✅

`apps/web/src/api/client.ts`を更新：
- 初期化時に`kiosk-client-key`が**未設定/空の場合のみ**`DEFAULT_CLIENT_KEY`を設定（既存キーは上書きしない）
- `resolveClientKey()`で`localStorage`の値を優先し、空なら`DEFAULT_CLIENT_KEY`へフォールバック
- 401(`INVALID_CLIENT_KEY`)時に自動復旧

`apps/web/src/layouts/KioskLayout.tsx`を更新：
- `clientKey`は**実際に利用するキー**（`resolveClientKey`相当）に合わせて表示
- `x-client-key`ヘッダーも同じキーに統一

### 4. 自動復旧機能の実装 ✅

`apps/web/src/api/client.ts`に以下を追加：
- `resetKioskClientKey()`関数: `kiosk-client-key`を`localStorage`から削除し、`DEFAULT_CLIENT_KEY`を設定してヘッダーを更新、キオスクパスの場合はページをリロード
- `axios` response interceptor: 401エラーで`INVALID_CLIENT_KEY`または`CLIENT_KEY_INVALID`コード/メッセージを検出した場合、`resetKioskClientKey()`を自動実行

## 追記（2026-02-09）

- **通話IDは`ClientDevice.id`（UUID）に統一**し、`kiosk-client-id`（localStorage）は通話に不要
- `/api/kiosk/call/targets`の`selfClientId`を通話IDとして使用

## 実機検証結果（2026-02-02）

### 検証項目

1. **IDとAPIキーの編集不可化** ✅
   - ヘッダーのAPIキー/IDが表示のみで編集できないことを確認
   - マスク表示（例: `clie…k1`）が正しく表示されることを確認

2. **生産スケジュールの表示** ✅
   - 生産スケジュール画面で値が正常に表示されることを確認

3. **自動復旧機能** ⏸️
   - 後日検証予定（開発者ツールでlocalStorageを手動で不正な値に変更し、APIアクセス時の自動復旧を確認）

### 検証結果サマリー

- ✅ **IDとAPIキーが編集不可に改善されている**
- ✅ **生産スケジュールの値が表示されている**
- ⏸️ **自動復旧機能は後日試す予定**

## トラブルシューティング

### デプロイ後の入力欄が残る問題

**症状**: 実機で入力欄が表示され、編集可能な状態が残る

**原因**: Webコンテナが再ビルドされていない（古いビルドが動いている）

**解決策**:
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache web && docker compose -f infrastructure/docker/docker-compose.server.yml up -d web"
```

**確認方法**:
- `KioskHeader.tsx`のコードで`<Input>`コンポーネントが存在しないことを確認
- ブラウザのハードリロード（Ctrl+Shift+R / Cmd+Shift+R）を実行

## 関連ファイル

- `apps/web/src/components/kiosk/KioskHeader.tsx`: 入力フィールド削除・表示のみに変更
- `apps/web/src/api/client.ts`: 起動時防御・自動復旧機能の実装
- `apps/web/src/layouts/KioskLayout.tsx`: 表示/APIヘッダーを実際に利用するキーに統一
- `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`: localStorage使用削除
- `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`: localStorage使用削除
- `apps/web/src/pages/kiosk/KioskRiggingBorrowPage.tsx`: localStorage使用削除
- `apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`: localStorage使用削除
- `apps/web/src/pages/kiosk/KioskReturnPage.tsx`: localStorage使用削除
- `apps/web/src/pages/kiosk/KioskCallPage.tsx`: localStorage使用削除
- `apps/web/src/components/kiosk/KioskSupportModal.tsx`: localStorage使用削除
- `docs/guides/api-key-policy.md`: APIキーの方針ドキュメント

## 学んだこと

1. **UIロックの重要性**: 入力フィールドを削除することで、誤入力の根本原因を排除できる
2. **localStorageへの依存削減**: 固定値（`DEFAULT_CLIENT_KEY`）を直接使用することで、状態の不整合を防げる
3. **自動復旧の実装**: APIエラー（401/INVALID_CLIENT_KEY）を検知して自動的に復旧することで、運用負荷を軽減できる
4. **デプロイ時の再ビルド確認**: コード変更時はWebコンテナの再ビルドが必要であり、デプロイログで確認すべき

## 参考

- [KB-010: client-key未設定で401エラーが発生する](./api.md#kb-010-client-key未設定で401エラーが発生する)
- [KB-171: WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定）](./frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定)
