---
title: サイネージ軽量表示(端末側の仕組みと運用)
tags: [デジタルサイネージ, Raspberry Pi 3, 軽量クライアント, 運用]
audience: [開発者, 運用者]
last-verified: 2026-11-26
related: [README.md, ../../architecture/signage-module-architecture.md, ../../guides/signage-client-setup.md, ../../runbooks/pi3-signage-tailscale-recovery.md]
category: modules
update-frequency: medium
---

# サイネージ軽量表示(端末側の仕組みと運用)

最終更新: 2026-11-26

## 1. この文書の範囲

サイネージの「軽量表示」は、表示端末が画面を自分で組み立てず、サーバー(Pi5)が描画した 1 枚の JPEG 画像を取得して全画面で出すだけの方式です。ブラウザ(Chromium)を使わないので、メモリの小さい Raspberry Pi 3 でも常時動かせます。

この文書は、端末側の仕組みと運用(動作、設定、確認、トラブル時の見方)だけを扱います。次の内容は別の文書にあります。

- サイネージ全体の構成(スケジュール、表示できる種類、描画の仕組み、API 一覧、データベース): [../../architecture/signage-module-architecture.md](../../architecture/signage-module-architecture.md)
- 端末の初期セットアップの案内(Android を含む): [../../guides/signage-client-setup.md](../../guides/signage-client-setup.md)
- Pi3 が表示されなくなったときの復旧: [../../runbooks/pi3-signage-tailscale-recovery.md](../../runbooks/pi3-signage-tailscale-recovery.md)

## 2. 対象の端末

| 端末 | 表示方法 | 管理の方法 |
|---|---|---|
| Raspberry Pi 3(本番のサイネージ端末 1 台) | `feh` で画像を全画面表示 | Ansible の `signage` グループ(ロール `signage`)で配備 |
| Android タブレットなど(型落ち端末) | ブラウザで Web の `/signage-lite` を開く | 端末側の設定のみ(Ansible の対象外) |

- Pi3 は `infrastructure/ansible/inventory.yml` の `signage` グループにあり、メモリが小さいため、配備中は画面管理の `lightdm` を一時停止します。
- Raspberry Pi Zero 2W は表示端末にしません。機種ごとの役割は [../../runbooks/device-model-roles.md](../../runbooks/device-model-roles.md) を参照してください。以前の計画にあった Zero 2W での実機試験や 24 時間耐久試験は、現在の運用には含まれていません。

根拠: `infrastructure/ansible/inventory.yml`(`signage` グループ)、`infrastructure/ansible/roles/signage/tasks/main.yml`、`docs/guides/signage-client-setup.md`

## 3. 端末の動き(Pi3)

```
signage-lite-update.timer(30 秒ごと)
   └ signage-update.sh が Pi5 の /api/signage/current-image を取得
        └ メモリ上の /run/signage/current.jpg に保存
signage-lite.service
   └ signage-display.sh が feh で current.jpg を全画面表示(ファイルの更新を検知して自動で再読込)
signage-lite-watchdog.timer(1 分ごと)  … 更新の停止を検知して自動復旧
signage-daily-reboot.timer(毎日 3:00)  … 日次の再起動
```

### 3.1 画像の取得(signage-update.sh)

- 取得先は `<サーバーURL>/api/signage/current-image` で、端末のクライアントキーを `x-client-key` ヘッダーで送ります。キーは curl の引数に出ないよう標準入力から渡します。
- 取得は 10 秒で打ち切ります。失敗したり空のファイルだったときは、前回の画像をそのまま表示し続けます。通信が切れても表示は止まりません。
- 初回だけ `mv` で作り、2 回目以降は `cat` で同じファイルへ上書きします(inode を変えない)。`feh --auto-reload` は `mv` による置き換えに追従できないことがあり、画面が更新されない、または飛んで見える原因になったためです。経緯は [KB-152](../../knowledge-base/infrastructure/signage.md#kb-152-サイネージページ表示漏れ調査と修正) を参照してください。
- 更新タイマーは起動 1 分後から 30 秒ごとで、精度を 1 秒に指定しています(既定の 1 分精度だと更新が 1 分単位に丸められるため)。
- 配備中は、画像の代わりに保守中の画面を表示します。Pi5 の `/api/system/deploy-status` を見て、配備中であれば保守画面(SVG を `rsvg-convert` で画像化)を `current.jpg` に書き、配備の進み具合を Pi5 へ返します。概要は [../../architecture/signage-module-architecture.md](../../architecture/signage-module-architecture.md) の「表示端末(Pi3)」にあります。

### 3.2 表示(signage-display.sh と signage-lite.service)

- 起動時に画面の自動オフ(スクリーンセーバーと省電力)を無効にします。
- `current.jpg` がなければ、すぐに取得を試み、最大 12 回(5 秒間隔)待ちます。それでも画像がなければサービスは異常終了し、10 秒後に自動で再起動して再試行します。
- `feh --fullscreen --auto-reload` で全画面表示します。`q` キーで `signage-lite.service` を停止できます。
- ネットワークへの接続を待たずに起動します。オフラインでも、メモリ上に画像が残っていればそれを表示します。
- 5 分間に 5 回失敗すると、それ以上の再起動を止めます(暴走防止)。

### 3.3 保存場所(tmpfs)

- 画像は `/run/signage`(メモリ上)に置きます。30 秒ごとの更新で SD カードに書き込まないため、SD カードの寿命と破損リスクを守れます。
- ディレクトリは systemd-tmpfiles が再起動のたびに作ります。
- 再起動すると画像は消えます。起動後に Pi5 へ接続できなければ、画像が取得できるまで表示できません。

### 3.4 自動復旧

- watchdog(1 分ごと)は、`current.jpg` が 120 秒より古いときに、まず `signage-lite-update.service` を実行し、5 秒後もまだ古ければ `signage-lite.service` を再起動します。画像がまだない起動直後は何もしません。
- 日次再起動は毎日 3:00 です。メモリの累積的な劣化を毎日リセットします。
- Ansible の配備のたびに、表示サービスと各タイマーを有効な状態に戻します(無効のまま残る状態を防ぐ)。

根拠: `infrastructure/ansible/roles/signage/templates/`(`signage-update.sh.j2`、`signage-display.sh.j2`、`signage-lite.service.j2`、`signage-lite-update.timer.j2`、`signage-lite-watchdog.sh.j2`、`signage-lite-watchdog.timer.j2`、`signage-daily-reboot.timer.j2`、`signage-lite.tmpfiles.conf.j2`)、`infrastructure/ansible/roles/signage/tasks/main.yml`

## 4. 接続の安全性(TLS とクライアントキー)

- 端末は、Pi5 の証明書の公開鍵を固定して接続します(`client_server_cert_pin` ロール、環境変数 `SIGNAGE_SERVER_CERT_PIN_ENABLED`)。固定が有効なときは、固定した鍵と一致する場合だけ接続します。
- 固定が無効で、`SIGNAGE_ALLOW_INSECURE_TLS=1` のときだけ証明書の検証を省略します(自己署名の証明書など、やむを得ない場合の逃げ道です)。
- 端末の設定は `/etc/raspisystem-signage/runtime.env` にあり、配備のたびに Ansible が書き直します。クライアントキーなどの秘密値は Ansible のボールト(vault)に置かれ、この文書には書きません。
- 画像取得用のキーと、配備の状態を報告するキー(status-agent 用)は別々です。

根拠: `infrastructure/ansible/roles/signage/templates/signage-runtime.env.j2`、`infrastructure/ansible/roles/signage/templates/signage-update.sh.j2`

## 5. 設定と配備

### 5.1 通常の配備(Ansible)

Pi3 の更新は標準のローリング更新で行います。手順と対象の絞り方は [../../guides/deployment.md](../../guides/deployment.md) と [../../guides/quick-start-deployment.md](../../guides/quick-start-deployment.md) を正本とします。

- Pi3 の設定(`inventory.yml` の `signage` グループ)で、サーバーの URL(`signage_server_url`)、画像取得用のクライアントキー(`signage_client_key`)、再起動対象のサービス一覧などを決めます。
- 配備中のメモリ確保のため、`lightdm` を一時停止します。そのため配備の途中では、表示サービスが一時的に異常な状態になることがあります。配備の最後に復旧して、通常は動作中に戻ります。
- Pi3 は負荷時に sudo の応答が遅れるため、接続の待ち時間を長めに設定してあります。

### 5.2 手動のセットアップ(setup-signage-lite.sh)

Ansible を使わず、端末で直接セットアップするときのスクリプトが `scripts/client/setup-signage-lite.sh` です。

```bash
sudo ./scripts/client/setup-signage-lite.sh <サーバーURL> <クライアントキー>
```

- 画像取得、表示、更新タイマーの設定を端末に入れ、古い Chromium 方式のサイネージ(`signage-display.service`、`kiosk-browser.service`)を止めます。
- 更新間隔は環境変数 `SIGNAGE_UPDATE_INTERVAL`(秒、既定 30)で変えられます。
- 証明書の検証をやむを得ず省略するときだけ `SIGNAGE_ALLOW_INSECURE_TLS=true` を付けます。
- このスクリプトは、画像の取得と表示の仕組みを入れるものです。watchdog と日次再起動は Ansible の配備で入ります。本番の端末は、Ansible の配備に統一してください。

### 5.3 サーバー側の設定(Pi5)

軽量表示の画像は、サーバーが端末ごとに作ります。関係する設定は次のとおりです。設定は `infrastructure/docker/docker-compose.server.yml` の `api` サービスの環境変数で行います。

| 環境変数 | 内容 | 既定値 |
|---|---|---|
| `SIGNAGE_RENDER_INTERVAL_SECONDS` | 描画の間隔(秒、10〜3600) | 30 |
| `SIGNAGE_RENDER_WIDTH` / `SIGNAGE_RENDER_HEIGHT` | 画像の大きさ | 1920 / 1080 |
| `SIGNAGE_PDF_DPI` | PDF を画像にするときの解像度 | Compose では 240 |
| `SIGNAGE_RENDER_DIR` | 描画結果の保存先 | コンテナ内の `/app/storage/signage-rendered` |
| `SIGNAGE_RENDER_KEEP_HISTORY` | `1` で履歴画像も残す | 残さない(推奨) |

- 大きなモニターを近くで見るときは、解像度を上げると文字がはっきりします。ただし画像が大きくなり、描画の時間と転送量が増えます。上げる場合は、端末で表示できることを確かめてから本番に反映してください。
- 描画の仕組みそのもの(スケジュール判定、スロット、worker での描画)は [../../architecture/signage-module-architecture.md](../../architecture/signage-module-architecture.md) を参照してください。

根拠: `apps/api/src/config/env/signage.ts`、`infrastructure/docker/docker-compose.server.yml`、`apps/api/src/lib/pdf-storage.ts`、`apps/api/src/lib/signage-render-storage.ts`

## 6. 画像の配信(Pi5 側の動作)

- `GET /api/signage/current-image` は、端末のクライアントキー(`x-client-key` ヘッダー。ブラウザ表示用には `key` クエリも可)を確認し、その端末用の最新画像を返します。キーが未登録なら 401 を返します。
- 端末用の画像がまだなければ、「表示するコンテンツがありません」というメッセージ画像を返します。
- 管理者は `clientDeviceId` を指定して、特定の端末向けの画像を確認できます。
- 画像は `Cache-Control: no-store` で返します。
- 描画の状態は `GET /api/signage/render/status`、手動の再描画は `POST /api/signage/render`(管理者・マネージャーのみ)です。管理画面のサイネージのハブ画面にある「今すぐ映し直す」ボタンが、この再描画を呼びます。
- 保存先には、端末ごとに最新の 1 枚(`current-<端末ID>.jpg`)だけを置きます。履歴画像は既定で作りません。もし履歴画像(`signage_*.jpg`)ができた場合は、毎日の `storage-maintenance` が削除し、最新の画像は残します。保存先の使用量が 80% と 90% を超えると、監視(`monitor.sh`)が警告を出します。経緯は [KB-130](../../knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) を参照してください。

根拠: `apps/api/src/routes/signage/render.ts`、`apps/api/src/lib/signage-render-storage.ts`、`scripts/server/storage-maintenance.sh`、`apps/web/src/pages/admin/SignageHubPage.tsx`

## 7. Android など(/signage-lite)

型落ちの Android タブレットなどでは、Web の `/signage-lite` ページを開きます。

- ページは、サーバーが描画した画像だけを 30 秒ごとに取り直して全画面で出します(重い `/signage` の画面は使いません)。
- 端末の識別は URL の `?clientKey=<端末のキー>` で行い、初回に端末のブラウザ(localStorage)へ保存します。キーが未設定のときは、設定を促す案内を出します。
- 取得できないときは、画面の上に確認の案内を出します。キーが Pi5 の端末として登録されていないと、画像の取得が 401 になります。
- 手順と、Chrome のサイトデータが原因の不具合は [../../guides/signage-client-setup.md](../../guides/signage-client-setup.md) と [KB-337](../../knowledge-base/infrastructure/signage.md#kb-337-android-signage-lite-401-chrome) を参照してください。

根拠: `apps/web/src/pages/signage/SignageLiteDisplayPage.tsx`、`apps/web/src/App.tsx`

## 8. 動作確認とトラブルシュート

端末(Pi3)で、次のように確認します。

```bash
systemctl status signage-lite                    # 表示サービス
systemctl status signage-lite-update.timer       # 画像の更新タイマー
systemctl status signage-lite-watchdog.timer     # watchdog
journalctl -u signage-lite -f                    # 表示のログ
ls -l /run/signage/current.jpg                   # 画像の更新時刻
```

サーバー(Pi5)で、画像が作られているかを確認します。

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml exec api ls -la /app/storage/signage-rendered
```

| 症状 | 見るところ |
|---|---|
| 画像が出ない | `/run/signage/current.jpg` があるか。再起動後は空なので、`/usr/local/bin/signage-update.sh` を実行して取得する |
| `feh: No loadable images specified` | 画像の取得前に表示サービスが起動した。更新を実行してから表示サービスを再起動する |
| 画像が更新されない | watchdog のタイマーが動いているか。手動で `systemctl start signage-lite-update.service` |
| 取得に失敗する(TLS) | 証明書の固定の設定と、Pi5 の証明書を確認する。検証の省略はやむを得ない場合だけ |
| 表示サービスが無効 | `systemctl is-enabled signage-lite.service`。無効なら配備で有効に戻す |
| デスクトップだけが出る(Pi3) | Tailscale の鍵の期限切れなどで Pi5 に届かない場合がある。[KB-386](../../knowledge-base/infrastructure/signage.md#kb-386-pi3サイネージ非表示tailscale-key-expiryとネットワーク経路) と [Runbook](../../runbooks/pi3-signage-tailscale-recovery.md)。Pi5 からの復旧用に `scripts/ops/recover-pi3-signage-remote.sh` がある |
| Pi5 側で画像が作られない | API のログで描画の失敗を確認し、`GET /api/signage/render/status` で描画が動いているかを見る |

## 9. 確認できていない事項

- 本番の Pi3 での、現在の実際の動作状態(サービスの稼働、表示の内容)。この文書は設定ファイルとコードから書いており、実機は確認していません。
- 本番の Pi5 に設定されている `SIGNAGE_*` の実際の値(解像度、描画の間隔など)。上の既定値は、リポジトリの設定の値です。
- `SIGNAGE_PDF_DPI` は、Compose で 240 に設定されています。コード側の初期値は 150 で、設定がないときだけ使われます。
- 手動セットアップ(`setup-signage-lite.sh`)で作る表示サービスの実行ユーザーと、Ansible で作る表示サービスの実行ユーザーが同じかどうか。
- 管理画面に、Pi3 の「通常 / 軽量」を切り替える設定があるかどうか。確かめた範囲では見つかっていません(Pi3 は軽量表示で固定されています)。
- Raspberry Pi Zero 2W を表示端末として動かした実績。
- 描画した画像に対する、Datadog や Prometheus などの外部監視への連携。確かめた範囲では見つかっていません。

## 関連ドキュメント

- [../../architecture/signage-module-architecture.md](../../architecture/signage-module-architecture.md)
- [README.md](./README.md)
- [../../guides/signage-client-setup.md](../../guides/signage-client-setup.md)
- [../../runbooks/pi3-signage-tailscale-recovery.md](../../runbooks/pi3-signage-tailscale-recovery.md)
- [../../runbooks/device-model-roles.md](../../runbooks/device-model-roles.md)
