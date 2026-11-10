# 監視カメラ(Pi Zero 2 W)運用

3D プリンタ作業場を静止画で見守る。Zero 2 W + UVC USB カメラが 10 秒ごとに JPEG を Pi5 へ送り、Pi5 が 30 秒に 1 枚だけ DGX の画像対応モデルに「人がいるか」を聞く。人が写ったときだけ、その前後の数枚を保存する。管理画面「AI」→「監視カメラ」で日付ごとに見る。

## 役割分担

- 端末: 撮って送るだけ。画像処理、差分検知、判定、ディスク保存はしない。送信に失敗した画像は捨てる。
- Pi5: 判定(1 回の問い合わせに画像 1 枚)、保存、30 日で自動削除、容量上限。
- DGX が止まっている/忙しいとき: 判定せず 1 分に 1 枚だけ「未判定」として保存する。これも 30 日削除と容量上限の対象。

## 対象 OS と前提

- 端末は Raspberry Pi OS Bullseye 以降(systemd 247 以上)。playbook は先に systemd のバージョンを確かめ、足りなければ止まる。
- カメラ agent は playbook がコピーした Pi5 証明書のみを信頼する（`inventory-zero-edge.yml` の SHA-256 で固定）。Pi5 証明書を交換したら `watch_cam_server_cert_sha256` を更新して再配備する。heartbeat agent の TLS 検証は引き続き省略する（別件）。

## 端末を追加する

1. 端末名は `zero-edge-cam-1` のように `zero-edge-cam-` で始める(死活監視と受信の両方がこの名前を見る)。
2. Pi5 の `infrastructure/ansible/inventory-zero-edge-hosts.yml`(git 管理外、権限 0600)の `watch_cam` グループに書く。標準 fleet の `inventory.yml` には入れない。端末キーは `openssl rand -hex 24` などで Pi5 上で作り、画面やチャットに出さない。

```yaml
all:
  children:
    watch_cam:
      hosts:
        zero-edge-cam-1:
          ansible_host: 100.x.y.z
          ansible_user: pi
          status_agent_client_id: zero-edge-cam-1
          status_agent_location: "プリンタ作業場"
          watch_cam_client_key: "<端末キー>"
```

3. 同じ端末キーで端末を API に登録する。管理画面に端末の追加機能は無いので、管理者の `POST /api/clients`(`{apiKey, name, location}`)を使う。管理者は二段階認証が必要で、ログインに `totpCode` を付ける。Pi5 では `https://127.0.0.1/api` に届く。パスワードと 6 桁コードは人が入力し、端末キーは上のファイルから読む。成功すると HTTP 200 が返る。
4. 対象 SHA が main にあり CI が成功していることを確かめてから、Pi5 で実行する。

```sh
ansible-playbook -i inventory.yml -i inventory-zero-edge.yml -i inventory-zero-edge-hosts.yml playbooks/watch-cam.yml --limit "zero-edge-cam-1"
```

playbook は v4l-utils、NTP、揮発 journald(上限 8MB)、専用ユーザー、撮影サービスと毎分の heartbeat を用意し、Bluetooth 関連を止める。

## 配備直後の確認(発熱・省電力)

Wi-Fi の省電力と LED は自動では変えない。端末で確認して決める。

```sh
iw dev wlan0 get power_save
vcgencmd measure_temp
systemctl status watch-cam-agent.service status-agent.timer
journalctl -u watch-cam-agent.service -n 50 --no-pager
timedatectl show -p NTPSynchronized --value
```

- 温度は撮影中でも 60℃ 未満を目安にする。超えるなら設置場所と通風を見直す。
- Wi-Fi 省電力が `on` で送信が遅れるなら切る。切る場合も恒久設定は playbook に足す。
- 電源 LED が作業場で気になるなら、`config.txt` で消す(端末個別の判断)。

## 判定の確認(見逃し・誤判定)

質問文と閾値は Pi5 の環境変数で変えられる。再起動で反映する。

- `WATCH_CAMERA_PERSON_PROMPT`: 判定の質問文。JSON の返し方はコードが後ろに付ける。
- `WATCH_CAMERA_PERSON_MIN_CONFIDENCE`: 0〜1、既定 0.5。人ありとみなす最小の確信度。

判定に送る画像だけ、Lab の L（輝度）に CLAHE をかける（色成分 a/b は維持）。失敗時は元画像で判定する。
保存画像と管理画面の画像は元のまま。`WATCH_CAMERA_JUDGE_ENHANCE=false` で補正を停止できる（既定 true）。

実際の作業場の写真で確かめる手順:

1. 人が写る写真と写らない写真を、時間帯(朝・昼・夜、照明の違い)を変えて 10 枚ずつ以上集める。人は全身、体の一部だけ、遠く、機械の陰、の場合を入れる。
2. 同じ質問文で 1 枚ずつ判定する(Pi5 の `getInferenceRuntime().createVisionCompletionPort()` と同じ経路。管理画面の写真ラベルと同じモデルが答える)。複数枚を 1 回で送らない(画像の取り違えが起きる)。
3. 見逃し(人がいるのに false)と誤判定(いないのに true)を数え、閾値と質問文を調整する。見逃しを減らす方向を優先する。
4. 運用開始後は、管理画面の一覧で「人」が写っていない写真が多くないか、数日ごとに見る。

DGX の停止中は「未判定」の写真が増える。これは正常な縮退動作で、人が写った瞬間の保存は保証されない。

## 保存と容量

- 保存先は既存の写真置き場(`photos/watch-camera/`)。毎日 03:40 に 30 日を過ぎたものを消す。
- 合計が `WATCH_CAMERA_MAX_BYTES`(既定 2GiB)に達すると新規を保存せず捨てる。80% を超えるとログに警告(1 時間に 1 回)。警告が出たら保存日数の短縮か上限の引き上げを検討する。
- 端末側の SD カードに画像は残らない。

## 既知の制限

- 画像の実ファイルだけが残って DB の行が無い「孤立ファイル」は、自動では掃除しない。容量上限の集計にも入らないので、異常終了が続いた後は `photos/watch-camera/` の容量を手で確かめる。
- 端末が複数台あると、DGX への問い合わせは全体で 1 本に絞るため、取り合いになった端末はその回の判定を飛ばして未判定の扱いになる。台数を増やすときは判定間隔を見直す。
- 削除でファイルを消せなかった行は DB に残し、次の夜に再試行する。失敗が続くとログに警告が出る。

## 長期運用の確認(ソークテスト)

初回導入と大きな変更の後、24〜72 時間続けて次を見る。

1. 管理画面で、人がいない時間も含めて「未判定」以外の抜けが無いか、受信が途切れていないか。
2. `vcgencmd measure_temp` を数時間おきに記録し、上がり続けていないか。
3. `journalctl -u watch-cam-agent.service` が肥大化していない(通常は状態が変わったときだけ出る)。
4. 次を一つずつ行い、手作業なしで戻ることを確かめる: カメラの USB を抜き差し、Wi-Fi を切る、Pi5 を止める、端末の電源を入れ直す。戻らなければ `systemctl restart watch-cam-agent.service` と journald を確認する。
5. 受信が止まると heartbeat(`zero-edge-` 接頭辞)の死活監視で気づける。

## 復旧

- 401/403: 端末キーと端末名(`zero-edge-cam-` 接頭辞)を確認し、playbook を再実行する。
- 画像が来ない: カメラの接続(`v4l2-ctl --list-devices`)、Wi-Fi、時刻同期を確認する。サービスは異常終了や無応答(WatchdogSec=60)で自動再起動する。
- 戻す場合は既知の正常なファイルを再配備する。Pi5 側の保存済み画像は残る。


## 見本

1. 管理画面「監視カメラ」→「見本」でカメラ・間隔・期間・上限枚数を選び、「撮影を始める」。期間または上限で終了し、途中なら「撮影を止める」。
2. 直近の見本写真を開き、正常・異常・あとでを押して印づけする。同じ印を再度押すと解除でき、絞り込みで確認できる。
3. 「この見本をすべて消す」を2回押して全消去する。保存先は `photos/watch-camera-samples/{sessionId}/{frameId}.jpg`、自動削除はせず手動削除のみ。専用合計上限は `WATCH_CAMERA_SAMPLE_MAX_BYTES`（既定2GiB、各セッションはInt上限まで）で、超える写真は保存せず撮影を完了する。
