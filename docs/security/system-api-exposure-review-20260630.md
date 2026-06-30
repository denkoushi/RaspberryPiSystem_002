# system系API公開範囲レビュー（2026-06-30）

最終更新: 2026-07-01 JST

## 目的

外部からの侵入、踏み台化、データ持出、乗っ取りの足がかりになり得る system系API の公開範囲を確認する。

2026-06-30時点の初回作業は調査のみ。2026-07-01に追加実装として system系API の公開範囲を縮小した。MFA/2段階認証、30日記憶仕様、既存DBデータは変更していない。

## 結論

`/api/system/*` のうち、管理操作系は認証されていた。一方で、監視・表示用途の一部APIが未認証で公開されていたため、追加実装で以下の通り閉じた。

特に `/api/system/metrics` は、業務規模に関する件数とNode.js/サイネージ状態を返すため、ADMIN/MANAGER JWT 必須へ変更した。

実機反映はこの文書更新時点では未実施。ローカル検証は [security-hardening-history-20260630.md](./security-hardening-history-20260630.md) の第3段階に記録済み。反映する場合は Pi5 先行で `verify-phase12-real.sh`、未認証拒否、正規 `x-client-key` の `deploy-status`、Docker/APIログを確認する。

## 対象API

| API | 現状 | 主な返却内容 | 依存 | リスク |
|-----|------|--------------|------|--------|
| `GET /api/system/health` | 未認証で200/503。ただし返却は `status`/`timestamp` のみ | 最小ヘルス状態 | Docker healthcheck、Ansible health-check、デプロイ手順、各種検証 | 低 |
| `GET /api/system/health/detail` | ADMIN/MANAGER必須 | DB接続状態、メモリ、イベントループ、Playwright、uptime | 管理者の障害切り分け | 低 |
| `GET /api/system/metrics` | ADMIN/MANAGER必須 | DB接続数、持出中件数、従業員数、工具数、Node.jsメモリ、イベントループ、サイネージworker状態 | 管理者の監視/性能調査/テスト | 低 |
| `GET /api/system/system-info` | ADMIN/MANAGER必須 | CPU温度、CPU負荷 | 現行Webコード上の利用なし | 低 |
| `GET /api/system/network-mode` | ADMIN/MANAGER必須 | 回線判定、configuredMode、detectedMode、判定元、レイテンシ | 管理画面ヘッダー `NetworkModeBadge` | 低 |
| `GET /api/system/deploy-status` | 有効な `x-client-key` 必須 | 端末別メンテ状態 | キオスク画面 `KioskLayout` | 低 |
| `GET /api/system/debug/logs` | ADMIN必須 | 直近エラー | 管理者用 | 低 |
| `GET /api/system/debug/requests` | ADMIN必須 | 直近リクエスト | 管理者用 | 低 |
| `GET /api/system/local-llm/status` | ADMIN/MANAGER必須 | LocalLLM状態 | 管理画面 | 低 |
| `POST /api/system/local-llm/chat/completions` | ADMIN/MANAGER必須 | LLM実行 | 管理画面 | 低 |
| `GET /api/system/dgx-resource/overview` | ADMIN/MANAGER必須 | DGX状態 | 管理画面 | 低 |
| `GET /api/system/dgx-resource/events` | ADMIN/MANAGER必須 | DGXイベント | 管理画面 | 低 |
| `POST /api/system/dgx-resource/actions` | ADMIN/MANAGER必須 | DGX操作 | 管理画面 | 低 |
| `POST /api/system/stackchan/chat` | ADMIN/MANAGER必須 | LLM実行 | 管理画面 | 低 |

## 実機確認（Pi5）

対象:

- Pi5: `100.106.158.2`
- 実施: 2026-06-30 21:25-21:27 JST
- 方法: HTTPS経由の読み取りリクエストのみ

結果:

| API | 未認証HTTP | 備考 |
|-----|------------|------|
| `/api/system/health` | `200` | `database/memory/eventLoop/playwright` は `ok` |
| `/api/system/metrics` | `200` | text/plain。業務件数とNode.js/サイネージ状態を含む |
| `/api/system/system-info` | `200` | CPU温度/負荷を返す |
| `/api/system/network-mode` | `200` | `detectedMode=maintenance`, `configuredMode=local`, `status=internet_connected` |
| `/api/system/deploy-status` | `200` | キーなしでは `isMaintenance:false` |
| `/api/system/debug/logs` | `401` | ADMIN認証が必要 |
| `/api/system/local-llm/status` | `401` | ADMIN/MANAGER認証が必要 |
| `/api/system/dgx-resource/overview` | `401` | ADMIN/MANAGER認証が必要 |

ネットワーク面:

- Pi5は `0.0.0.0:80` / `0.0.0.0:443` と `[::]:80` / `[::]:443` で待ち受け。
- UFWは `80/tcp` と `443/tcp` を Anywhere から許可。
- APIコンテナ自体の8080は外部公開されておらず、Caddy経由で `/api/*` が到達する。
- 実機は `USE_LOCAL_CERTS=true` のため `Caddyfile.local` を使用。
- `Caddyfile.local` には `Caddyfile.production` にある `/admin*` のCIDR制限ブロックが無い。
- Mac作業環境から Tailscale IP の `/admin` はHTTP `200`。これはSPAが配信されるという意味で、管理APIの認証を突破できるという意味ではない。
- LAN IP `192.168.10.230` は今回の作業環境から到達不可。LAN側の到達性は現場確認が必要。

## 影響整理

### 2026-07-01 実装差分

- `metrics`、`system-info`、`network-mode` は ADMIN/MANAGER JWT 必須。
- `health` は公開版を薄くし、詳細版を `/api/system/health/detail` として追加。
- `deploy-status` は有効な `x-client-key` 必須。キーなしは `CLIENT_KEY_REQUIRED`、不正キーは `INVALID_CLIENT_KEY`。
- `/preview/import` など未ログインの `AdminLayout` では `NetworkModeBadge` を表示せず、不要な401を避ける。
- Pi5 が使う `Caddyfile.local` / `Caddyfile.local.template` に `/admin*` CIDR制限を追加。

### 運用影響

- Docker healthcheck、Ansible health-check、`verify-phase12-real.sh` は `GET /api/system/health` の `status` を見るため継続可能。
- Prometheus等の無人 `/api/system/metrics` scrape は、現仕様では使えない。必要になった場合は専用トークンまたは内部限定経路を別途設計する。
- 正常なキオスクWebは全リクエストに `x-client-key` を付けるため、`deploy-status` は従来通り利用可能。キー欠落/不正端末は401になる。

## 次の段階

1. 実機反映する場合は Pi5 のみ先行し、標準検証とログ確認を行う。
2. Prometheus等の無人監視が必要になった場合のみ、専用metricsトークンまたは内部限定経路を設計する。

## 今回未確認

- Tailscale管理画面側のACL実体。
- LAN側からの到達性。
- 実運用Prometheus等が `/api/system/metrics` を外部からscrapeしているか。
- 2026-07-01追加実装のPi5実機反映。
