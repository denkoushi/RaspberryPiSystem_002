# system系API公開範囲レビュー（2026-06-30）

最終更新: 2026-06-30 21:28 JST

## 目的

外部からの侵入、踏み台化、データ持出、乗っ取りの足がかりになり得る system系API の公開範囲を確認する。

今回の作業は調査のみ。API実装、Caddy設定、Ansible設定、MFA/2段階認証は変更していない。

## 結論

`/api/system/*` のうち、管理操作系は認証されている。一方で、監視・表示用途の一部APIは未認証で公開されている。

特に `/api/system/metrics` は、業務規模に関する件数とNode.js/サイネージ状態を返すため、情報露出として優先度が高い。

## 対象API

| API | 現状 | 主な返却内容 | 依存 | リスク |
|-----|------|--------------|------|--------|
| `GET /api/system/health` | 未認証で200 | DB接続状態、メモリ、イベントループ、Playwright、uptime | Docker healthcheck、Ansible health-check、デプロイ手順、各種検証 | 中 |
| `GET /api/system/metrics` | 未認証で200 | DB接続数、持出中件数、従業員数、工具数、Node.jsメモリ、イベントループ、サイネージworker状態 | 監視/性能調査/テスト | 高 |
| `GET /api/system/system-info` | 未認証で200 | CPU温度、CPU負荷 | 現行Webコード上の利用なし | 中 |
| `GET /api/system/network-mode` | 未認証で200 | 回線判定、configuredMode、detectedMode、判定元、レイテンシ | 管理画面ヘッダー `NetworkModeBadge` | 中 |
| `GET /api/system/deploy-status` | 未認証でも200。ただしキーなしは `isMaintenance:false` | 端末別メンテ状態 | キオスク画面 `KioskLayout` | 低-中 |
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

### すぐ閉じやすい候補

`/api/system/metrics`:

- 利用は監視/性能調査/テスト中心。
- 一般画面の通常操作には不要。
- ただし Prometheus等の実運用監視を使う場合は、トークンまたはlocalhost/CIDR許可が必要。

`/api/system/system-info`:

- 現行Webコード上の利用箇所は見つからない。
- 管理画面表示が復活する可能性はあるため、削除より ADMIN/MANAGER 必須化が安全。

### 慎重に扱う候補

`/api/system/network-mode`:

- 管理画面ヘッダーで使用。
- 管理画面はログイン後に表示されるため、API側も ADMIN/MANAGER 必須化しやすい。
- ただし未ログイン時にヘッダーを表示する導線がないことをテストで固定してから実施する。

`/api/system/deploy-status`:

- キオスクが8秒間隔で参照し、デプロイ中メンテ画面の表示に使う。
- 現在はWebクライアントが全リクエストに `x-client-key` を付けるため、正常端末はキー必須化に対応できる見込み。
- ただしキー欠落/不正時に `401` へ変えると、旧端末・設定不備端末でメンテ表示が効かなくなる可能性がある。

`/api/system/health`:

- Docker healthcheck、Ansible、手順書、障害切り分けに広く使われている。
- 一気に認証必須化するとデプロイ・復旧手順を壊しやすい。
- 公開版を薄くし、詳細情報を認証/localhost限定に分けるのが安全。

## 推奨する次の段階

1. `metrics` を ADMIN/MANAGER または localhost/CIDR 限定へ変更する案を作る。
2. `system-info` を ADMIN/MANAGER 必須へ変更する案を作る。
3. `network-mode` を ADMIN/MANAGER 必須へ変更し、管理画面の表示が崩れないことをテストする。
4. `health` は薄い公開版と詳細版に分割する案を作る。
5. `deploy-status` は全キオスク端末の `x-client-key` 実運用確認後、キー必須化を検討する。
6. `Caddyfile.local` に `/admin*` CIDR制限が無い点を別途扱う。

## 今回未確認

- Tailscale管理画面側のACL実体。
- LAN側からの到達性。
- 実運用Prometheus等が `/api/system/metrics` を外部からscrapeしているか。

