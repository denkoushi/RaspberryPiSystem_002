# private-pi5-stackchan-bridge(移管済み)

StackChan bridge 一式は denkoushi/DGXSparkControlPlane(PR #424)へ移した。

ここに残るのは `dgx_runtime_client.py` とそのテストだけ。私用 Pi5 Hermes の
`infrastructure/ansible/tasks/private-pi5-hermes/keep-warm.yml` がこのファイルを Pi へ配っており、
keep-warm の移行が済むまで消さない。
