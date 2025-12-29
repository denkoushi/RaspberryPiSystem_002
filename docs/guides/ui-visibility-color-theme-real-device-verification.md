# UI視認性向上カラーテーマ 実機検証手順書

最終更新: 2025-12-17

## 概要

本ドキュメントでは、UI視認性向上カラーテーマ（提案3）の実機検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Raspberry Pi 4**: クライアント（キオスク + NFCリーダー）
- **Pi3/Pi4**: サイネージ表示端末

## デプロイ前の確認事項

### 1. ネットワーク環境の確認

現在のネットワーク環境（オフィス/自宅）を確認し、Pi5上の`group_vars/all.yml`の`network_mode`を適切に設定してください。

```bash
# Pi5上のnetwork_modeを確認
ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# 必要に応じて変更（Tailscaleモードの場合）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

詳細は [デプロイメントガイド](./deployment.md) を参照してください。

### 2. ブランチの確認

実機検証用のブランチ `feature/improve-visibility-color-theme` がリモートにプッシュされていることを確認してください。

```bash
# リモートブランチの確認
git ls-remote --heads origin feature/improve-visibility-color-theme
```

## デプロイ手順

### ステップ1: Pi5へのデプロイ

```bash
# Pi5にSSH接続
ssh denkon5sd02@100.106.158.2

# リポジトリディレクトリに移動
cd /opt/RaspberryPiSystem_002

# featureブランチをデプロイ
./scripts/server/deploy.sh feature/improve-visibility-color-theme
```

**期待される結果**:
- ✅ リポジトリが更新される
- ✅ Dockerコンテナが再ビルドされる
- ✅ コンテナが正常に起動する

### ステップ2: デプロイ後の確認

```bash
# コンテナの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# APIのヘルスチェック
curl http://localhost:8080/health

# Webサーバーの確認
curl http://localhost:4173
```

**期待される結果**:
- ✅ すべてのコンテナが`Up`状態
- ✅ APIヘルスチェックが`200 OK`を返す
- ✅ Webサーバーが正常に応答する

## 実機検証チェックリスト

### 1. 管理コンソールの視認性確認

#### 1.1 統合一覧ページ (`/admin/tools/unified`)

- [ ] **背景色**: メイン背景が`bg-slate-800`（中程度のダーク）になっている
- [ ] **カード背景**: カードが`bg-white`（純白）になっている
- [ ] **アイテム種別バッジ**: 
  - 工具（TOOL）: `bg-blue-500` + `text-white` + 🔧アイコン
  - 計測機器（MEASURING_INSTRUMENT）: `bg-purple-600` + `text-white` + 📏アイコン
  - 吊具（RIGGING_GEAR）: `bg-orange-500` + `text-white` + ⚙️アイコン
- [ ] **フォントサイズ**: 最小14px以上、主要テキスト16px以上
- [ ] **コントラスト**: 文字がはっきり見える（約21:1のコントラスト比）

#### 1.2 アイテム一覧ページ (`/admin/tools/items`)

- [ ] **テーブルヘッダー**: `bg-slate-200` + `text-slate-900` + `font-semibold`
- [ ] **テーブルセル**: `text-slate-700` + 適切なフォントサイズ
- [ ] **フォーム要素**: `border-2 border-slate-300` + `bg-white` + `text-slate-900`

#### 1.3 その他の管理コンソールページ

- [ ] **ダッシュボード** (`/admin`): カードが`bg-white` + `text-slate-900`
- [ ] **従業員管理** (`/admin/tools/employees`): テーブルとフォームが新テーマ適用
- [ ] **履歴** (`/admin/tools/history`): テーブルが新テーマ適用
- [ ] **計測機器管理** (`/admin/tools/measuring-instruments`): テーブルとフォームが新テーマ適用
- [ ] **吊具管理** (`/admin/tools/rigging-gears`): テーブルとフォームが新テーマ適用

### 2. キオスクの視認性確認

#### 2.1 持出画面 (`/kiosk/tag`)

- [ ] **背景色**: メイン背景が`bg-slate-800`
- [ ] **成功メッセージ**: `bg-emerald-600` + `text-white` + `border-2 border-emerald-700`
- [ ] **ステップカード**: アクティブ状態が明確に識別できる

#### 2.2 返却画面 (`/kiosk`)

- [ ] **アイテムカード**: アイテム種別に応じた背景色（工具=青、計測機器=紫、吊具=オレンジ）
- [ ] **アイコン**: 🔧、📏、⚙️が適切に表示される
- [ ] **テキスト**: 白文字でコントラスト比約21:1

#### 2.3 計測機器持出画面 (`/kiosk/instruments/borrow`)

- [ ] **フォーム要素**: `border-2 border-slate-300` + `bg-white` + `text-slate-900`
- [ ] **ラベル**: `text-sm font-semibold text-slate-700`
- [ ] **点検項目カード**: `bg-slate-100` + `border-2 border-slate-300`

#### 2.4 吊具持出画面 (`/kiosk/rigging/borrow`)

- [ ] **タイトル**: `text-xl font-bold text-slate-900`
- [ ] **説明文**: `text-sm font-semibold text-slate-700`
- [ ] **UID表示**: `font-mono font-semibold text-slate-900`

### 3. サイネージの視認性確認

#### 3.1 サイネージ表示 (`/signage`)

- [ ] **背景色**: メイン背景が`bg-slate-800`
- [ ] **工具カード**: 現状のダーク背景を維持（要件定義通り）
- [ ] **計測機器カード**: 現状の藍系背景を維持（要件定義通り）
- [ ] **フォントサイズ**: 最小14px以上
- [ ] **アイコン**: 🔧、📏、⚙️が適切に表示される

### 4. 異なる照明条件での視認性確認

#### 4.1 蛍光灯照明

- [ ] **管理コンソール**: 文字がはっきり見える
- [ ] **キオスク**: アイテム種別が色とアイコンで識別できる
- [ ] **サイネージ**: 距離からでも識別可能

#### 4.2 LED照明

- [ ] **管理コンソール**: 文字がはっきり見える
- [ ] **キオスク**: アイテム種別が色とアイコンで識別できる
- [ ] **サイネージ**: 距離からでも識別可能

#### 4.3 自然光

- [ ] **管理コンソール**: 文字がはっきり見える
- [ ] **キオスク**: アイテム種別が色とアイコンで識別できる
- [ ] **サイネージ**: 距離からでも識別可能

### 5. 距離からの視認性確認

#### 5.1 モニターから1m離れた位置

- [ ] **管理コンソール**: 主要な情報が識別できる
- [ ] **キオスク**: アイテム種別が識別できる
- [ ] **サイネージ**: 主要な情報が識別できる

#### 5.2 モニターから2m離れた位置

- [ ] **管理コンソール**: 主要な情報が識別できる
- [ ] **キオスク**: アイテム種別が識別できる
- [ ] **サイネージ**: 主要な情報が識別できる

### 6. 色覚多様性テスト

#### 6.1 色だけでなくアイコンでも識別可能か

- [ ] **工具**: 🔧アイコンで識別可能
- [ ] **計測機器**: 📏アイコンで識別可能
- [ ] **吊具**: ⚙️アイコンで識別可能

### 7. レスポンシブテスト

#### 7.1 異なる画面サイズでの表示確認

- [ ] **モバイルサイズ**: フォントサイズが適切に表示される
- [ ] **タブレットサイズ**: テーブルやフォームが適切にスクロール可能
- [ ] **デスクトップサイズ**: すべての要素が適切に表示される

## 検証結果の記録

検証結果は以下の形式で記録してください：

```markdown
## 検証結果

### 検証日時
- 日時: YYYY-MM-DD HH:MM
- 検証者: [名前]
- 環境: [オフィス/自宅]

### 検証結果サマリー
- ✅ 成功項目: [項目数]
- ⚠️ 要改善項目: [項目数]
- ❌ 失敗項目: [項目数]

### 詳細結果
[各項目の検証結果を記録]
```

## トラブルシューティング

### デプロイが失敗する場合

1. **ネットワークモードの確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   ```

2. **コンテナのログ確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs web"
   ```

3. **リポジトリの状態確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && git status"
   ```

### 視認性が改善されていない場合

1. **ブラウザのキャッシュをクリア**
   - ブラウザの開発者ツールで「キャッシュの無効化とハード再読み込み」を実行

2. **コンテナの再ビルド**
   ```bash
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web"
   ```

## 関連ドキュメント

- [UI視認性向上カラーテーマ要件定義](../requirements/ui-visibility-color-theme.md)
- [残タスク洗い出し](./ui-visibility-color-theme-remaining-tasks.md)
- [デプロイメントガイド](./deployment.md)
- [検証チェックリスト](./verification-checklist.md)
