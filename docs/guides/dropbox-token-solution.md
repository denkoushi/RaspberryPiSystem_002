# Dropboxトークン常時アクセス解決策

最終更新: 2025-12-15

## 問題の整理

**現状**: Dropboxバックアップ機能は、スケジュール実行時に自動的にDropboxにアップロードする必要があります。しかし、トークンが期限切れになると、バックアップが失敗します。

**要件**: **常時アクセス可能なトークンが必要**（スケジュールバックアップが自動実行されるため）

## 解決策

### 解決策1: App Consoleで「No expiration」トークンを生成（推奨・最も簡単）

Dropbox App Consoleで、生成されるトークンを無期限に設定できます。

#### 手順

1. **Dropbox App Consoleにアクセス**
   - https://www.dropbox.com/developers/apps を開く
   - アプリを選択

2. **OAuth 2設定を確認・変更**
   - 「Settings」タブを開く
   - 「OAuth 2」セクションを確認
   - **「Access token expiration」を「No expiration」に設定**（可能な場合）
     - この設定が表示されない場合は、アプリの種類によっては利用できない可能性があります

3. **新しいトークンを生成**
   - 「Generated access token」セクションで「Generate」ボタンをクリック
   - 表示されたトークンをコピー（`sl.`で始まる長い文字列）

4. **Pi5に設定**
   ```bash
   # Macのターミナルから実行
   DROPBOX_TOKEN="sl.新しいトークン"
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002/infrastructure/docker && sed -i 's/DROPBOX_ACCESS_TOKEN=.*/DROPBOX_ACCESS_TOKEN=$DROPBOX_TOKEN/' .env && grep DROPBOX_ACCESS_TOKEN .env"
   
   # APIコンテナを再起動
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml restart api"
   ```

#### 確認方法

```bash
# トークンの有効性を確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api env | grep DROPBOX"
```

### 解決策2: OAuth 2.0フローでリフレッシュトークンを取得（将来的な実装）

「No expiration」設定が利用できない場合、またはよりセキュアな方法が必要な場合：

1. **OAuth 2.0フローを実装**
   - リフレッシュトークンを取得
   - アクセストークンが期限切れになったら自動的にリフレッシュ

2. **現在の実装状況**
   - ⚠️ **未実装**: 現在のシステムはリフレッシュトークンの自動更新機能を持っていません
   - 実装には追加開発が必要です

### 解決策3: 定期的なトークン更新スクリプト（暫定対応）

短期トークンしか取得できない場合の暫定対応：

1. **トークン更新スクリプトを作成**
   - 定期的に（例: 3時間ごと）新しいトークンを生成
   - `.env`ファイルを自動更新
   - APIコンテナを再起動

2. **cronジョブで自動実行**
   - Pi5上でcronジョブを設定
   - ただし、この方法は推奨されません（手動トークン生成が必要）

## 推奨される対応

**最優先**: **解決策1を試してください**

1. App Consoleで「Access token expiration」を「No expiration」に設定できるか確認
2. 可能であれば、新しいトークンを生成して設定
3. これで常時アクセスが可能になります

**確認できない場合**:
- アプリの種類（「Full Dropbox」vs「App folder」）によって設定が異なる可能性があります
- 「Full Dropbox」アクセスのアプリでは「No expiration」が利用できる可能性が高いです

## トラブルシューティング

### 「Access token expiration」設定が見つからない

- アプリの種類を確認（「Full Dropbox」アクセスに変更を検討）
- または、アプリを再作成して「Full Dropbox」アクセスで作成

### トークンを設定しても期限切れエラーが続く

1. トークンが正しく設定されているか確認
2. APIコンテナが再起動されているか確認
3. 新しいトークンを再生成して設定

### 長期的な解決が必要

- OAuth 2.0フローとリフレッシュトークンの自動更新機能を実装することを検討
- 実装には追加開発が必要です
