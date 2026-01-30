Title: ADR-20260130: Tailscale主運用とlocal緊急フォールバック
Status: accepted
Context:
  - Tailscaleは当初「メンテナンス時のみ」前提で導入されたが、運用上は常時接続・遠隔保守の重要性が高い。
  - Ansibleの運用精度を最優先し、接続経路の迷い/分岐を最小化する必要がある。
  - Pi3はリソース制約があるが、`tailscaled`の常時稼働は実測で許容範囲に収まる。
Decision:
  - Tailscaleを**主（通常運用）**とし、local(LAN)は**緊急時のみ**に限定する。
  - Pi3/Pi4/Pi5は**`tailscaled` 常時ON**を原則とする。
  - Ansible運用はTailscale前提で**fail-fast**を行い、Tailscale未稼働時は原則停止する。
  - localの使用は「Tailscale障害/認証不能/障害対応」時のみ許可し、手順を明文化する。
Alternatives:
  - local主（通常運用）+ Tailscaleは保守時のみ: 既存文書はこの前提だが、運用の分岐が大きく事故リスクが高い。
  - Tailscaleのみ（local不使用）: さらに単純化できるが、緊急時の到達経路がなくなるため採用しない。
Consequences:
  - ドキュメント全体の前提（「メンテ時のみTailscale」）を書き換える必要がある。
  - `tailscale_auth_key`の管理やTailscale稼働監視が運用の必須事項になる。
  - `network_mode`の説明は「tailscale標準/local緊急」に統一される。
References:
  - docs/guides/deployment.md
  - docs/guides/environment-setup.md
  - docs/knowledge-base/infrastructure/security.md (KB-071)
  - docs/plans/security-hardening-execplan.md (Decision Log)
