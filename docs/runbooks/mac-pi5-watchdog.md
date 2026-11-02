# Mac から業務用 Pi5 を見張る

- 更新日: 2026-11-01
- 対象: 運用者の Mac（ログイン中の LaunchAgent）
- 関連: [M3 計画](../plans/fleet-100-scale-gap-execplan.md)、[システム通知](./kiosk-inquiry-inbox.md#システム通知)

## 入れ方

Mac に bash と python3 が必要（標準ライブラリだけを使う）。
Tailscale と、既存の SSH 接続名 `raspi5-tailscale`（対話なしで認証でき、ホスト鍵が確認済み）を事前に用意する。

リポジトリのルートから実行する。

```bash
bash scripts/mac/pi5-watchdog/install.sh
```

監視スクリプトを `~/Library/Application Support/raspi-pi5-watchdog/` へコピーし、
`~/Library/LaunchAgents/com.raspi.pi5-watchdog.plist` を登録する。再実行は登録を入れ直す。
ログイン時と300秒ごとに健康確認する。macOS の通知設定・集中モードも確認する。

既定の確認先は `https://100.106.158.2/api/system/health`。
変更時は登録済み plist の `EnvironmentVariables` に次を設定し、bootout/bootstrap で読み直す。
`install.sh` の再実行は plist の手編集を上書きする。

| 環境変数 | 用途 |
| --- | --- |
| `PI5_WATCHDOG_URL` | HTTPS の健康確認 URL |
| `PI5_WATCHDOG_CERT_SHA256` | Pi5 証明書全体の SHA-256（16進、`:` 区切り可。信頼できる経路で確認した値だけに更新） |
| `PI5_WATCHDOG_STATE` | 状態ファイルの絶対パス |
| `PI5_WATCHDOG_LOG` | ログの絶対パス |

Pi5 の証明書は自己署名のため、CA 検証の代わりに証明書全体の SHA-256 を固定値と照合する。
一致した同じ TLS 接続だけで健康確認を送り、不一致なら失敗として扱う。
Pi5 の証明書を作り直したときは、この値も更新する。

## 確認の仕方

```bash
launchctl print gui/$(id -u)/com.raspi.pi5-watchdog
cat "$HOME/Library/Application Support/raspi-pi5-watchdog/state.json"
tail -n 20 "$HOME/Library/Logs/raspi-pi5-watchdog.log"
```

HTTP 200、`status: ok`、`checks.database.status: ok` がすべて必要。
1回の試行は接続・送受信の各段階が15秒以内、失敗時は30秒後に1回だけ再試行する。
2回とも失敗すると Mac に通知し、down 継続中は30分ごとに念押しする。
復旧すると Mac に停止時間（最初の失敗確認から復旧確認まで）を知らせ、SSH で
`/opt/RaspberryPiSystem_002/scripts/generate-alert.sh` を呼び、
`pi5-watchdog-recovered` を既存のファイル取り込み経路へ1件残す。
API はこの type を Chat 用として扱い、停止時間を表示する。新しい Slack 配送は作らない。
同じファイルの再取り込みは追記しない。別の復旧は24時間以内でも追記する。
API のファイル取り込みが有効で、対象キオスクの「システム通知」が有効であることを確認する。
API 側の対応が未反映なら、Chat の文言と配送の振る舞いは保証できないため、先に API の対応を反映する。
SSH が失敗した場合は Mac に「フローティングChatに残せませんでした」と通知する。自動再送はしない。

ログは1MBで1世代回す。URL・応答本文・コマンドのエラー内容は記録しない。
`invalid_state` の場合は監視が終了するため、状態ファイルを退避してから再実行する（停止時間は失われる）。

## 止め方

```bash
bash scripts/mac/pi5-watchdog/uninstall.sh
```

登録を解除し plist を削除する。繰り返し実行できる。状態ファイルとログは保持する。
再開するには install を実行する。保持した down 状態から復旧すれば、停止中の時間も含めて通知する。

## 限界

Mac が眠っている・閉じている・ログアウト中、または Tailscale が切れている間は Pi5 を見張れない。
Tailscale の切断は Pi5 の停止と区別できず、Mac が動いていれば健康確認失敗として通知する。
Mac の通知はその Mac でしか見えない。5分間隔のため、確認の間に止まって戻った場合は分からない。
停止時間は監視から見た概算で、実際の電源断時間ではない。状態を保存してから通知するため、
通知処理中の Mac の終了や通知拒否などでは通知が届かないことがある。

ローカル検証（実機・launchctl はスタブへ差し替え）:

```bash
python3 -m unittest discover -s scripts/mac/pi5-watchdog/tests -p 'test_*.py'
```
