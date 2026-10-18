# private-pi5-stackchan-bridge(移管済み)

StackChan bridge 一式は denkoushi/DGXSparkControlPlane(PR #424)へ移した。
私用 Pi5 Hermes の配備(playbook、keep-warm を含む)も DGXSparkControlPlane(PR #428)へ移した。

ここに残るのは `dgx_runtime_client.py` とそのテストだけ。私用 Pi5 の小説・調べもの・ツールの各機能が
`~/.hermes/dgx-keep-warm` にある同名のファイルを今も使っている。Pi 上のファイルが
DGXSparkControlPlane の版と同じだと確かめてから消す。
