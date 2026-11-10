# KB-433: Tailscale 経由で管理画面が Forbidden になる件と、Pi5 の SNAT 停止

- Status: 実機対応済み（Pi5 で手動変更）。標準リリースにも同じ設定を追加
- Scope: `raspberrypi5`、`infrastructure/ansible/roles/release_pi5/tasks/host-tailscale-no-snat.yml`
- Date: 2026-10-31

## Symptoms

- Mac から Tailscale 経由（`https://100.106.158.2/admin/...`）で管理画面を開くと、Caddy が `Forbidden`（403）を返した。
- `/kiosk` と `/api` は同じ経路でも 200 だった。Tailscale の HTTPS 入口（`:8443`）経由でも 403 だった。

## Investigation

- Pi5 の許可リスト（`logs/deploy/bluegreen/admin-allow-nets.caddy`）は `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32` で、Mac の `100.64.230.31` を含んでいた。
- Caddy のアクセスログでは、Pi5 自身以外の接続元がすべて `172.18.0.1`（gateway コンテナの bridge のゲートウェイ）だった。2026-02 の古いログには本来の `100.x` が残っていた。いつから変わったかは、ログが残っておらず確定できない。
- 仕組み: tailnet からの 443 は Docker の DNAT で gateway コンテナ（`172.18.0.5`）へ転送される。`ts-forward` が `tailscale0` から入った転送パケットに印を付け、`ts-postrouting` の MASQUERADE が接続元を bridge のアドレスへ書き換える。Mac から1回アクセスすると、この MASQUERADE の計数が増えることを確認した。
- Pi5 の Tailscale は `NoSNAT: false`（`--snat-subnet-routes` の既定値）のままだった。Pi5 は subnet route も exit node も出していない。

## Fix

- Pi5 で `tailscale set --snat-subnet-routes=false` を実行した。`ts-postrouting` の MASQUERADE が消え、Mac から `/admin/machine-signal` が 200 になった。`/kiosk` と `/api/system/health` も 200 のままだった。
- Pi4 のキオスクの既存の接続は、張り直されるまで `172.18.0.1` のまま見える。新しい接続から本来の `100.x` で届く。
- 標準リリース（`release_pi5`）に `host-tailscale-no-snat.yml` を追加した。`tailscale debug prefs` の `NoSNAT` が false のときだけ設定を変える。失敗してもリリースは止めず、報告だけする。
- 許可リストに `172.18.0.1` を足す方法は採らない。bridge 経由で届くもの（`[::]:443` の docker-proxy 経由の IPv6 など）をすべて通してしまい、管理画面の制限がほぼ無くなるため。

## Rollback

- `sudo tailscale set --snat-subnet-routes=true`。標準リリースで再び false に戻るので、恒久的に戻すときは `host-tailscale-no-snat.yml` の呼び出しも外す。
