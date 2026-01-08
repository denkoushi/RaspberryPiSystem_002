# サイネージレイアウト設定の実機検証手順

最終更新: 2026-01-06

## 概要

サイネージレイアウトとコンテンツの疎結合化実装（`layoutConfig`フィールド追加）の実機検証手順です。

## 検証項目

### 1. レガシー形式のスケジュールが正しく変換されること

既存の`contentType`/`pdfId`形式のスケジュールが、新形式の`layoutConfig`へ自動変換されて表示されることを確認します。

### 2. 新形式のスケジュールが正しく表示されること

管理コンソールから新形式（`layoutConfig`）でスケジュールを作成し、Pi3で正しく表示されることを確認します。

### 3. 各レイアウトパターンの動作確認

以下の組み合わせを検証します：

- **FULLレイアウト + loansスロット**: 持出一覧を全画面表示
- **FULLレイアウト + pdfスロット**: PDFを全画面表示
- **SPLITレイアウト + 左loans/右pdf**: 左に持出一覧、右にPDF
- **SPLITレイアウト + 左pdf/右loans**: 左にPDF、右に持出一覧

## 検証手順

### 事前準備

1. **Pi3のサイネージサービスを起動**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl start signage-lite.service'"
   ```

2. **検証スクリプトを実行**:
   ```bash
   ./scripts/test/verify-signage-layout-config.sh
   ```

### 検証1: レガシー形式のスケジュール確認

1. **現在のスケジュール状態を確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/schedules | jq '.'"
   ```

2. **現在のコンテンツを確認**（レガシー形式が新形式へ変換されていることを確認）:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/content | jq '{contentType, layoutConfig}'"
   ```

3. **Pi3での表示確認**:
   - Pi3のサイネージ画面を確認
   - レガシー形式のスケジュールが正しく表示されることを確認

### 検証2: 新形式のスケジュール作成と確認

1. **管理コンソールにアクセス**:
   - `https://100.106.158.2/admin/signage/schedules` にアクセス
   - ログイン（管理者権限が必要）

2. **新形式のスケジュールを作成**:

   **例1: FULLレイアウト + loansスロット**
   - 「新規作成」をクリック
   - レイアウト: 「全体表示」を選択
   - 全体表示のコンテンツ: 「持出一覧」を選択
   - スケジュール設定（曜日、時間帯、優先順位）を設定
   - 「保存」をクリック

   **例2: FULLレイアウト + pdfスロット**
   - 「新規作成」をクリック
   - レイアウト: 「全体表示」を選択
   - 全体表示のコンテンツ: 「PDF」を選択
   - PDFを選択
   - スケジュール設定を設定
   - 「保存」をクリック

   **例3: SPLITレイアウト + 左loans/右pdf**
   - 「新規作成」をクリック
   - レイアウト: 「左右分割」を選択
   - 左側のコンテンツ: 「持出一覧」を選択
   - 右側のコンテンツ: 「PDF」を選択
   - PDFを選択
   - スケジュール設定を設定
   - 「保存」をクリック

   **例4: SPLITレイアウト + 左pdf/右loans**
   - 「新規作成」をクリック
   - レイアウト: 「左右分割」を選択
   - 左側のコンテンツ: 「PDF」を選択
   - PDFを選択
   - 右側のコンテンツ: 「持出一覧」を選択
   - スケジュール設定を設定
   - 「保存」をクリック

3. **APIでスケジュールを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/schedules | jq '.schedules[] | select(.layoutConfig != null) | {name, layoutConfig}'"
   ```

4. **Pi3での表示確認**:
   - Pi3のサイネージ画面を確認
   - 新形式のスケジュールが正しく表示されることを確認
   - レイアウトとコンテンツが期待通りに表示されることを確認

### 検証3: スケジュール編集の確認

1. **既存のレガシー形式スケジュールを編集**:
   - 管理コンソールで既存のスケジュールを編集
   - レイアウトやコンテンツを変更
   - 「保存」をクリック

2. **保存後のスケジュールを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/schedules | jq '.schedules[] | select(.id == \"<スケジュールID>\") | {name, layoutConfig}'"
   ```

3. **Pi3での表示確認**:
   - Pi3のサイネージ画面を確認
   - 編集後のスケジュールが正しく表示されることを確認

## トラブルシューティング

### Pi3のサイネージサービスが停止している

```bash
# Pi3のサイネージサービスを起動
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl start signage-lite.service'"

# サービス状態を確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"
```

### サイネージ画像が更新されない

1. **APIのサイネージ画像を確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s -H 'x-client-key: client-key-raspberrypi3-signage1' https://100.106.158.2/api/signage/current-image -o /tmp/test-signage.jpg && file /tmp/test-signage.jpg"
   ```

2. **Pi3の画像ファイルを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -lh /var/cache/signage/current.jpg'"
   ```

3. **サイネージサービスを再起動**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl restart signage-lite.service'"
   ```

### レイアウトが期待通りに表示されない

1. **APIのコンテンツを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/content | jq '{contentType, layoutConfig}'"
   ```

2. **APIログを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api --tail 50 | grep -i signage"
   ```

## 検証チェックリスト

- [ ] レガシー形式のスケジュールが正しく変換されて表示される
- [ ] FULLレイアウト + loansスロットが正常に表示される
- [ ] FULLレイアウト + pdfスロットが正常に表示される
- [ ] SPLITレイアウト + 左loans/右pdfが正常に表示される
- [ ] SPLITレイアウト + 左pdf/右loansが正常に表示される
- [ ] スケジュール編集時に新形式で保存される
- [ ] Pi3のサイネージサービスが正常に動作している

## 関連ドキュメント

- [サイネージモジュール仕様](../modules/signage/README.md)
- [KB-150: サイネージレイアウトとコンテンツの疎結合化実装完了](../knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了)
- [デプロイガイド](./deployment.md)

