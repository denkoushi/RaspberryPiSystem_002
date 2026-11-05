# Pi4 キオスク共通イメージ（M6 Step 2–3、実機未検証）

ビルド元だけを管理する。arm64 ネイティブの Raspberry Pi OS / Debian bookworm または trixie をビルドホストに使う。Mac、x86、クロスビルドは対象外。端末は Ethernet で準備する。Wi-Fi の設定は扱わない。

## ビルド

公式 rpi-image-gen を別ディレクトリへ取得して依存を入れる。以下の `SOURCE_DIR` はこの README があるディレクトリの絶対パスへ置き換える。

```bash
git clone https://github.com/raspberrypi/rpi-image-gen
cd rpi-image-gen
sudo ./install_deps.sh
SOURCE_DIR=/absolute/path/to/infrastructure/image/rpi-image-gen
rpi-image-gen metadata --lint "$SOURCE_DIR/layer/pi4-kiosk-base.yaml"
rpi-image-gen build -S "$SOURCE_DIR" -c config/pi4-kiosk-base.yaml -- IGconf_ssh_pubkey_user1="$(cat /path/to/pi5-controller.pub)"
```

Pi5 controller の **SSH 公開鍵**だけを指定する。秘密鍵は渡さない。公開鍵もリポジトリには保存しない。`ssh.pubkey_only: y`、共通ユーザーは明示的に `kiosk`。パスワードログインを使わず、`sudoers.d/90-kiosk` でパスワードなし sudo を許可し、ビルド中に visudo 検査する。成果物はビルド作業ディレクトリの `work/pi4-kiosk-base/pi4-kiosk-base.img`。

Debian trixie の Docker engine と Compose v2 プラグイン、LightDM/labwc/Chromium、Python 3、OpenSSH、公式 apt 配布の Tailscale、UTF-8 locale、Asia/Tokyo を入れる。LightDM は kiosk の labwc セッションへ自動ログインする。labwc の autostart の xset が Xwayland を起動し、セッションの D-Bus と X0 は実機で確認する。

`/opt/RaspberryPiSystem_002`、status-agent、kiosk の業務用 unit、アプリコンテナは入れない。status-agent 等は標準の first-install で Ansible が入れる。Tailscale への参加はビルド中に行わない。SSH host key と machine-id はビルド rootfs から削除し、初回起動で生成させる（SSH は ssh-keygen -A の drop-in を追加）。

## 初回起動

`pi4-bootstrap.example.json` は動かない偽の例。書き込み後の boot パーティション直下に `pi4-bootstrap.json` を置く（起動後は `/boot/firmware/pi4-bootstrap.json`）。キーは `hostname` と `tailscale_auth_key` の2つだけ。hostname は小文字 RFC 1123 ラベル、最大63文字。Tailscale 管理者が `tag:kiosk` を許可した短い有効期限の非再利用・一回限りの auth key を発行する。FAT 上では Unix のアクセス権に頼れないため、カードと作業用コピーを厳重に扱う。

Ethernet をつないで起動すると root oneshot が hostname を設定し、Tailscale の Running を確認して鍵ファイルを削除し同期する。秘密値を引数へ直接出さず、0600 の一時ファイルを `--auth-key=file:` で渡して finally 相当の context manager で削除する。失敗時は値を出さず非ゼロ終了し、入力を残す。原因を直した後は `sudo systemctl start pi4-first-boot.service` で再試行する。Running なら再 join しない。成功したら `/var/lib/pi4-first-boot/done` を書き、unit を無効化する。登録や deploy は行わない。

[新規端末の準備手順](../../../docs/runbooks/pi4-spare-swap.md#共通イメージから新しい端末を用意する試行前)で参加、登録、exact-host first-install を確認する。

## 検証と残る確認

```bash
python3 -m unittest discover -s scripts/ci/tests -p test_pi4_first_boot.py
python3 -m py_compile infrastructure/image/rpi-image-gen/pi4-first-boot.py
```

上記はリポジトリルートで実行する。テストは `.github/workflows/ci.yml` の既存 repo-policy unittest discovery 対象。`PI4_FIRST_BOOT_ROOT` はテスト用ファイル prefix、`PATH` はコマンド差し替え用。本番 unit では設定しない。

未検証（実ビルド・実機起動の前に運用可能とは扱わない）:

- rpi4 + trixie-minbase + image-rpios の組み合わせ、hook 順序、成果物のサイズと起動可否。公式 metadata lint もビルドホストで実行する。
- apt の取得、kiosk アカウントの生成・ロック設定と公開鍵のみの SSH、sudoers、Compose プラグインの実動作。
- LightDM の labwc 自動ログイン、Xwayland X0、D-Bus、画面、および変更していない first-install preflight 全体の通過。
- 最終イメージに識別情報が残らないこと、各端末で machine-id / SSH host key が別々に生成されること。
- 実際の Tailscale パッケージ・tailnet ポリシーと一回限りの鍵での参加、削除、再起動後の継続。file: 対応は[公式 CLI ソース](https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/up.go)で確認済みだが、インストールされた版でも確認する。
- 電源断耐性。boot FAT の入力削除と rootfs の done 作成は単一トランザクションではない。間で電源が落ちて入力も done もなければ、Running を確認し、同じ hostname の入力を管理者が再用意して再試行する。ファイル削除は SD の物理的な残留消去を保証しないため、一回限り・短期限を必須とする。

配布元: [rpi-image-gen](https://github.com/raspberrypi/rpi-image-gen)、[Tailscale apt](https://pkgs.tailscale.com/stable/)、[Debian Compose プラグイン配置](https://packages.debian.org/trixie/arm64/docker-compose/filelist)。
