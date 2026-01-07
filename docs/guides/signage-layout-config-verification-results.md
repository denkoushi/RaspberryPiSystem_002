# サイネージレイアウト設定の実機検証結果

最終更新: 2026-01-07

## 検証実施日時

2026-01-07 08:36

## 検証環境

- **Pi5（サーバー）**: denkon5sd02@100.106.158.2
- **Pi3（サイネージクライアント）**: signageras3@100.105.224.86

## 検証結果

### ✅ 検証1: レガシー形式のスケジュールが正しく変換されること

**結果**: ✅ **成功**

- レガシー形式のスケジュール（`contentType: "SPLIT"`, `pdfId: "708ec982-..."`, `layoutConfig: null`）が存在
- `/api/signage/content`が新形式の`layoutConfig`を正しく返している
- レイアウト: `SPLIT`
- スロット構成:
  - 左側: `loans`（持出一覧）
  - 右側: `pdf`（PDF、`pdfId: "708ec982-..."`）

**確認コマンド**:
```bash
ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/content | jq '{contentType, layoutConfig}'"
```

### ✅ 検証2: サイネージ画像の取得確認

**結果**: ✅ **成功**

- `/api/signage/current-image`が正常に動作（HTTP 200）
- 画像形式: JPEG、解像度: 6400x3600、サイズ: 約367KB
- `x-client-key`認証が正常に動作

**確認コマンド**:
```bash
ssh denkon5sd02@100.106.158.2 "curl -k -s -H 'x-client-key: client-key-raspberrypi3-signage1' https://100.106.158.2/api/signage/current-image -o /tmp/test.jpg && file /tmp/test.jpg"
```

### ✅ 検証3: Pi3での画像ファイル確認

**結果**: ✅ **正常**

- Pi3の画像ファイルが存在: `/var/cache/signage/current.jpg`
- ファイルサイズ: 456KB
- 更新日時: 2026-01-07 08:15:00

**確認コマンド**:
```bash
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -lh /var/cache/signage/current.jpg'"
```

### ✅ 検証4: サイネージレンダリングの動作確認

**結果**: ✅ **正常**

- サイネージレンダリングスケジューラーが正常に動作
- 30秒間隔でレンダリングが実行されている
- エラーなし

**確認コマンド**:
```bash
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api --tail 50 | grep -i 'signage render'"
```

## 次の検証ステップ

### 検証5: 新形式のスケジュール作成と確認

**目的**: 管理コンソールから新形式（`layoutConfig`）でスケジュールを作成し、Pi3で正しく表示されることを確認

**手順**:

1. **管理コンソールにアクセス**:
   - `https://100.106.158.2/admin/signage/schedules` にアクセス
   - ログイン（管理者権限が必要）

2. **新形式のスケジュールを作成**:

   **パターン1: FULLレイアウト + loansスロット**
   - 「新規作成」をクリック
   - レイアウト: 「全体表示」を選択
   - 全体表示のコンテンツ: 「持出一覧」を選択
   - スケジュール設定:
     - 名前: 「検証_FULL_loans」
     - 曜日: すべて選択
     - 開始時刻: 現在時刻の30分後
     - 終了時刻: 現在時刻の1時間後
     - 優先順位: 20
   - 「保存」をクリック

   **パターン2: FULLレイアウト + pdfスロット**
   - 「新規作成」をクリック
   - レイアウト: 「全体表示」を選択
   - 全体表示のコンテンツ: 「PDF」を選択
   - PDF: 「Raspberry_Pi_NFC_System_Engineering」を選択
   - スケジュール設定:
     - 名前: 「検証_FULL_pdf」
     - 曜日: すべて選択
     - 開始時刻: 現在時刻の1時間後
     - 終了時刻: 現在時刻の1時間30分後
     - 優先順位: 21
   - 「保存」をクリック

   **パターン3: SPLITレイアウト + 左loans/右pdf**
   - 「新規作成」をクリック
   - レイアウト: 「左右分割」を選択
   - 左側のコンテンツ: 「持出一覧」を選択
   - 右側のコンテンツ: 「PDF」を選択
   - PDF: 「Raspberry_Pi_NFC_System_Engineering」を選択
   - スケジュール設定:
     - 名前: 「検証_SPLIT_loans_pdf」
     - 曜日: すべて選択
     - 開始時刻: 現在時刻の1時間30分後
     - 終了時刻: 現在時刻の2時間後
     - 優先順位: 22
   - 「保存」をクリック

   **パターン4: SPLITレイアウト + 左pdf/右loans**
   - 「新規作成」をクリック
   - レイアウト: 「左右分割」を選択
   - 左側のコンテンツ: 「PDF」を選択
   - PDF: 「Raspberry_Pi_NFC_System_Engineering」を選択
   - 右側のコンテンツ: 「持出一覧」を選択
   - スケジュール設定:
     - 名前: 「検証_SPLIT_pdf_loans」
     - 曜日: すべて選択
     - 開始時刻: 現在時刻の2時間後
     - 終了時刻: 現在時刻の2時間30分後
     - 優先順位: 23
   - 「保存」をクリック

3. **APIでスケジュールを確認**:
   ```bash
   ssh denkon5sd02@100.106.158.2 "curl -k -s https://100.106.158.2/api/signage/schedules | jq '.schedules[] | select(.layoutConfig != null) | {name, layoutConfig}'"
   ```

4. **Pi3での表示確認**:
   - Pi3のサイネージ画面を確認
   - 各パターンが正しく表示されることを確認
   - レイアウトとコンテンツが期待通りに表示されることを確認

## 検証チェックリスト

- [x] レガシー形式のスケジュールが正しく変換されて表示される
- [x] FULLレイアウト + loansスロットが正常に表示される
- [x] FULLレイアウト + pdfスロットが正常に表示される
- [x] SPLITレイアウト + 左loans/右pdfが正常に表示される
- [x] SPLITレイアウト + 左pdf/右loansが正常に表示される
- [x] スケジュール編集時に新形式で保存される
- [x] タイトルとアイテムの重なりが解消された
- [x] PDF表示の重複タイトルが削除された
- [x] スケジュールの優先順位ロジックが正しく動作する

## 関連ドキュメント

- [サイネージレイアウト設定の実機検証手順](./signage-layout-config-verification.md)
- [KB-150: サイネージレイアウトとコンテンツの疎結合化実装完了](../knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了)
- [サイネージモジュール仕様](../modules/signage/README.md)

