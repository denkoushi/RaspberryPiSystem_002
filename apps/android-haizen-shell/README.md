# 配膳 Android シェル（Milestone 2）

既存の配膳Web画面をWebViewで開き、現品票の撮影ボタンから端末内OCRを起動します。
ML KitのLatinモデルはAPKに同梱されます。製番候補の補正・業務操作にはサーバー接続が必要です。
仕様は [ExecPlan](../../docs/plans/android-haizen-shell-ocr-execplan.md) を参照してください。

## ビルド・インストール

独立したGradleプロジェクトです。JDK 17、Android SDK 34を使用します。
このディレクトリで `local.properties` の `sdk.dir` または `ANDROID_HOME` を設定して実行します。
依存関係の初回取得には開発端末のネット接続が必要です。

```sh
./gradlew testDebugUnitTest
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n jp.raspisystem.haizen.shell/.MainActivity
```

Windowsでは `gradlew.bat` を使用します。アプリ名は「配膳」、パッケージは
`jp.raspisystem.haizen.shell` です。旧OCR計測スパイクとは別アプリになります。
同じ署名鍵を保持して更新してください。

接続先は `app/build.gradle.kts` の `BuildConfig.HAIZEN_ORIGIN`、開始画面は
`BuildConfig.HAIZEN_START_PATH` で設定します。端末からTailscale経由で接続先へ到達でき、
HTTPS証明書が有効である必要があります。

## クライアントキーの初回設定（debug版）

1. 端末のUSBデバッグを許可してPCへ接続し、「配膳」を開きます。
2. PCのChromeで `chrome://inspect/#devices` を開き、配膳WebViewの **inspect** を選びます。
3. DevToolsのConsoleで次を実行し、ダイアログに管理者から受け取ったキーを入力します。
   キーをソースコードや共有ログへ記載しないでください。

```js
const clientKey = prompt('配膳端末のクライアントキー');
if (clientKey) {
  localStorage.setItem('kiosk-client-key', JSON.stringify(clientKey));
  location.reload();
}
```

値は文字列をJSON化して保存します。アプリデータを削除しない限り設定は保持されます。
WebViewのリモートデバッグはdebugビルドだけで有効です。

## 読み取り・操作

- 現品票の撮影ボタンを押し、カメラ権限を許可します。
- 製番全体を黄色い枠へ入れます。枠内の文字から候補を表示し、同じ候補が2フレーム連続すると確定します。
- 確定時は端末設定に従った短い触覚フィードバックがあり、Webへ戻ってサーバー補正結果を反映します。
  製造オーダー抽出のため、確定フレームの認識全文も送ります。
- 「やめる」またはスキャン画面の戻る操作でキャンセルします。入力値は変更しません。
- シェルの戻る操作はWebView履歴を戻し、履歴がなければ何もしません。
- 接続先と異なるoriginのリンクはシステムブラウザへ渡します。
- Webの既存バーコード読取には同一originのカメラ権限のみ許可します。
  写真入力のファイル選択にも対応し、通常ブラウザでは従来の写真OCRを使用します。

ビルド・単体テストに加え、実機で読取、キャンセル、連打、戻る、バーコードカメラ、
ファイル選択、外部リンクと権限拒否を確認してください。
