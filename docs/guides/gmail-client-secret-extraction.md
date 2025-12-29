# Gmail Client Secretの取得方法

最終更新: 2025-12-29

## 概要

Google Cloud ConsoleでOAuth 2.0クライアントIDを作成した後、Client Secretを取得する方法を説明します。

## 方法1: JSONファイルから取得（推奨）

### 手順

1. **JSONファイルをダウンロード**
   - Google Cloud Consoleの認証情報作成完了画面で「ダウンロード」ボタンをクリック
   - または、認証情報ページでOAuth 2.0クライアントIDの右側にある「ダウンロード」アイコンをクリック
   - JSONファイルがダウンロードされます（例: `client_secret_993241073118-xxxxx.apps.googleusercontent.com.json`）

2. **JSONファイルを開く**
   - Macの「テキストエディット」や「VS Code」などで開く
   - または、ターミナルで以下のコマンドを実行：
     ```bash
     cat ~/Downloads/client_secret_*.json
     ```

3. **`client_secret`フィールドを確認**
   - JSONファイルの内容は以下のような形式です：
     ```json
     {
       "web": {
         "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
         "project_id": "your-project-id",
         "auth_uri": "https://accounts.google.com/o/oauth2/auth",
         "token_uri": "https://oauth2.googleapis.com/token",
         "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
         "client_secret": "GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
         "redirect_uris": [
           "https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback"
         ]
       }
     }
     ```
   - **`client_secret`**フィールドの値（例: `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx`）をコピー

4. **Client Secretを使用**
   - コピーした値を、Pi5のGmail設定やスクリプトで使用します

## 方法2: 認証情報ページから直接確認

### 手順

1. **認証情報ページにアクセス**
   - Google Cloud Consoleで「APIとサービス」→「認証情報」を選択

2. **OAuth 2.0クライアントIDを選択**
   - 作成したOAuth 2.0クライアントID（例: `Pi5 Gmail Client`）をクリック

3. **Client Secretを確認**
   - 「クライアントシークレット」セクションに値が表示されます
   - 値が表示されない場合は、「シークレットを表示」ボタンをクリック
   - ⚠️ **注意**: Client Secretは一度しか表示されない場合があります。必ず安全な場所に保存してください

## 方法3: ターミナルでJSONファイルから抽出（Mac）

JSONファイルをダウンロードした後、ターミナルで以下のコマンドを実行すると、Client Secretだけを抽出できます：

```bash
# JSONファイルのパスを指定（例: ~/Downloads/client_secret_*.json）
cat ~/Downloads/client_secret_*.json | grep -o '"client_secret": "[^"]*' | cut -d'"' -f4
```

または、`jq`コマンドがインストールされている場合：

```bash
# jqを使用してclient_secretを抽出
cat ~/Downloads/client_secret_*.json | jq -r '.web.client_secret'
```

## 注意事項

- **Client Secretは機密情報です**: 他人に共有したり、Gitにコミットしたりしないでください
- **一度しか表示されない場合があります**: Client Secretを紛失した場合は、新しいOAuth 2.0クライアントIDを作成する必要があります
- **安全に保存**: Client Secretは、Pi5の設定ファイルや環境変数に保存されますが、適切な権限で保護してください

## トラブルシューティング

### JSONファイルが見つからない

- ダウンロードフォルダ（`~/Downloads`）を確認
- ファイル名は `client_secret_` で始まります
- ブラウザのダウンロード履歴を確認

### Client Secretが表示されない

- 認証情報ページで「シークレットを表示」ボタンをクリック
- 新しいOAuth 2.0クライアントIDを作成し直す

### JSONファイルの形式が違う

- JSONファイルは `web` キーを持つオブジェクトを含む必要があります
- 正しいOAuth 2.0クライアントIDのJSONファイルをダウンロードしているか確認

