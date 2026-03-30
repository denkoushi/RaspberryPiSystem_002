---
title: トラブルシューティングナレッジベース - セキュリティ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2026-03-30
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - セキュリティ関連

**カテゴリ**: インフラ関連 > セキュリティ関連  
**件数**: 21件  
**索引**: [index.md](../index.md)

セキュリティ対策と監視に関するトラブルシューティング情報

---

### [KB-317] Ubuntu LocalLLM を Tailscale sidecar + `tag:llm` で分離公開する

**状況**: Ubuntu PC は実験用途でも使い続けつつ、本システム専用の LocalLLM だけを **tailnet に安全に参加**させたい。既存の手動運用 `~/llama.cpp` + `--host 0.0.0.0 --port 8081` は残すが、業務系は完全分離したい。

**事象**:
- 既存の `llama-server` は **ホストOS直起動**で、`0.0.0.0:8081` のため LAN 到達範囲へそのまま待ち受けていた。
- Ubuntu ホスト全体を tailnet に載せると、実験用の他プロセスまで tailnet 側へ露出する恐れがある。
- `docker compose config` や `tailscale` コンテナの起動ログに **`TS_AUTHKEY` が展開表示**され、漏えい時は revoke が必要になる。
- `tailscale up --advertise-tags=tag:llm` 後に `TS_EXTRA_ARGS` へ同じタグ設定を残さないと、**`requires mentioning all non-default flags`** で再起動ループした。

**有効だった対策**:
- ✅ **専用ユーザー/専用領域**を分離（`localllm`、`/home/localllm/local-llm-system`）
- ✅ **モデル実体も専用コピー**へ分離し、既存ユーザーのホームを直接読ませない
- ✅ **Tailscale sidecar + `network_mode: service:tailscale`** で `llama-server` / `nginx` を 1 ノード化
- ✅ 推論本体は **`127.0.0.1:38082`**、tailnet 入口は **`38081`** のみへ分離
- ✅ `nginx` で **`X-LLM-Token`** を検査し、認証なしは **403**
- ✅ Tailscale ACL を **`tag:server -> tag:llm: tcp:38081` のみ**にし、Pi5 以外からの直接到達を禁止

**実装のポイント**:
- tailnet ノード名: `ubuntu-local-llm-system`
- tailnet IP（2026-03-28時点）: `100.107.223.92`
- タグ: `tag:llm`
- 入口: `nginx:38081`
- 内部推論: `llama-server:38082`
- 既存の実験用 `~/llama.cpp` / `8081` は **別系統として維持**
- Pi5 API 側の入口: `GET /api/system/local-llm/status` / `POST /api/system/local-llm/chat/completions`
- Pi5 API は **`Authorization: Bearer ...`** を受け、Ubuntu 側には **`X-LLM-Token`** を付けて代理呼び出しする
- Pi5 API の返り値は upstream の生JSONではなく、`model` / `content` / `finishReason` / `usage` に正規化する

**学んだこと / 再発防止**:
- live secret 入りの状態で **`docker compose config` を実行しない**
- auth key は **参加後に revoke + ローカル削除** し、平常運用では残さない
- `tailscale up` で追加した **非デフォルト設定は `TS_EXTRA_ARGS` にも永続化**する
- 実験用ポートと業務用ポートは **分ける**（今回は `8081` と `38081`）
- Mac から Ubuntu LocalLLM へ直接 `curl` しても、ACL 上 **`tag:server -> tag:llm` のみ許可**なので到達しない。最終確認は **Pi5 API 経由**で行う
- Mac ローカルの Docker 検証では、本番用 `docker-compose.server.yml` の `/opt/...` bind mount をそのまま使わず、**`docker-compose.mac-local.override.yml`** でワークスペース配下 `.docker/local/` へ逃がす
- Pi5 **本番 API コンテナ**に `LOCAL_LLM_*` が入らないときは、Ubuntu 側より先に **Docker Compose の `env_file` 経路**を疑う（`apps/api/.env` のみ更新では届かないことがある。詳細は [KB-318](./ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）
- **オンデマンド制御の入口も `38081` に同居**させる。tailnet IP `100.107.223.92` は Ubuntu ホストそのものではなく **`local-llm-system` の sidecar** なので、Pi5 からホスト nginx の `39091` を直接叩く設計は不整合になりやすい
- `compose-nginx-1` で `${LLM_RUNTIME_CONTROL_TOKEN}` を使うなら、`compose.yaml` の nginx `envsubst` 対象に **`LLM_RUNTIME_CONTROL_TOKEN`** を入れないと **`unknown "llm_runtime_control_token" variable`** で再起動ループする
- `network_mode: service:tailscale` の nginx からホスト側 `control-server.mjs` を叩くとき、`127.0.0.1` は **コンテナ自身**を指す。`control-server.mjs` は **`0.0.0.0:39090`** で待受し、nginx は **Docker bridge gateway**（例: `172.19.0.1`）へ `proxy_pass` する

**関連ファイル**:
- `/home/localllm/local-llm-system/compose/compose.yaml`
- `/home/localllm/local-llm-system/config/nginx/default.conf.template`
- `/home/localllm/local-llm-system/config/runtime.env`
- `/home/localllm/.config/local-llm-system/api-token`
- `apps/api/src/plugins/local-llm-gateway.ts`
- `apps/api/src/routes/system/local-llm.ts`
- `apps/api/src/services/system/local-llm-proxy.service.ts`
- `infrastructure/docker/docker-compose.mac-local.override.yml`
- `infrastructure/ansible/templates/docker.env.j2`（Pi5 API 向け `LOCAL_LLM_*` の実効出力先。理由は [KB-318](./ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）
- `docs/runbooks/local-llm-tailscale-sidecar.md`
- `docs/security/tailscale-policy.md`
- `docs/security/system-inventory.md`
- `docs/decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md`

---

### [KB-309] GitHub 開発者アカウントの衛生チェック（ForceMemo / GlassWorm 系サプライチェーン対策）

**状況**: 2026-03 時点で公開されている調査（例: StepSecurity の ForceMemo、GlassWorm 系 VS Code / Cursor 拡張経由のトークン窃取）を踏まえ、**本リポジトリのメンテナ**が実施した予防的確認と、その後のトラブルシュート要点を記録する。

**背景（要約）**:
- **侵入の典型**: 悪意あるエディタ拡張等から **GitHub トークン**が窃取され、アカウントが乗っ取られる。
- **ForceMemo 系の特徴（報告ベース）**: デフォルトブランチへの **force-push**、末尾への **難読化 Python**（`setup.py` / `main.py` 等）、**author 日付を偽装**しつつ **committer** で改ざんが露呈するケース、オンチェーン **Solana memo** 経由の C2 など。
- **検索用 IOC（報告例）**: 変数名 `lzcdrtfxyqiplpd`（GitHub Code Search で既知侵害の横断調査に使われる）。

**本プロジェクトでの実施結果（2026-03-20 時点）**:
1. **2FA**: GitHub アカウントで **二要素認証（認証アプリ）を有効化**。リカバリコードはオフライン保管。
2. **PAT**: **Classic** / **Fine-grained** とも、**期限切れトークンを削除**（実運用上は既に失効済み）。今後は用途が明確なものだけを **最小権限・期限付き**で再発行する方針。
3. **セッション**: `https://github.com/settings/sessions` で一覧確認。**同一 IP の複数 active** はブラウザ/クライアント別セッションで起こり得るため、国・端末が不審なものだけを失効。
4. **SSH keys**: 登録は **1 本のみ**で、用途と一致を確認。
5. **GPG**: 署名未運用のため **鍵なし**（Vigilant mode は任意）。
6. **Cursor 拡張**: インストール済みは **日本語 Language Pack のみ**（拡張表面は最小）。
7. **リポジトリ調査（ローカルクローン）**: マーカー文字列 `lzcdrtfxyqiplpd` **ヒットなし**。`git push --dry-run` で **認証成功**（期限切れ PAT 削除後も **GitHub CLI / OS 資格情報**側の認証が有効な構成）。

**トラブルシューティング**:
| 症状 | 確認・対処 |
|------|------------|
| 2FA 後に `git push` が失敗 | HTTPS で **アカウントパスワード**を使っていた場合は不可。**PAT** 再発行、`gh auth login`、または **SSH** へ切替。 |
| 期限切れ PAT を消したら push できない | `gh auth status` を確認。必要なら `gh auth login`。CI やスクリプトに貼っていた PAT は **該当 Secrets も更新**。 |
| 履歴が「見た目変わらない」のにコード末尾が増えている | `git log` で **author date と committer date の大きな乖離**、committer が `null` 等の報告あり。疑わしければ **直近のデフォルトブランチとタグ/リリース**を再確認し、GitHub Security / メンテナに連絡。 |
| 依存インストールで怪しいネットワーク | `setup.py` 実行で **Solana RPC** や **nodejs.org への異常 DL** が混ざる報告あり。CI では egress 制限・監査（例: allowlist）を検討。 |

**参考（外部・一次に近い調査）**:
- [StepSecurity: ForceMemo](https://www.stepsecurity.io/blog/forcememo-hundreds-of-github-python-repos-compromised-via-account-takeover-and-force-push)
- [Truesec: GlassWorm](https://www.truesec.com/hub/blog/glassworm-self-propagating-vscode-extension)
- [GitHub Blog: supply chain hardening（一般対策）](https://github.blog/security-2/supply-chain-security/strengthening-supply-chain-security-preparing-for-the-next-malware-campaign/)

**再発防止（運用）**:
- メンテナは **四半期に一度**、上記 1〜5 を棚卸し（拡張は随時）。
- **`pip install git+https://github.com/...`** 利用時は、**デフォルトブランチの差分**を人間が確認するか、タグ/リリース固定を優先。

---

### [KB-259] 本番JWT秘密鍵のFail-fast化とkioskレート制限のRedis共有化

**EXEC_PLAN.md参照**: コード品質改善フェーズ4後続（2026-02-13）

**事象**:
- `NODE_ENV=production`でもJWT秘密鍵が未設定・弱値のまま起動し得る状態だった
- `/api/kiosk/*` はグローバルレート制限の広い除外に含まれており、共有IP環境で制御が粗かった

**要因**:
1. 環境変数スキーマが開発互換のデフォルト値を本番でも許容していた
2. kiosk専用のレート制御がインメモリMapで、複数プロセス/将来の水平分散で一貫性が保てない

**有効だった対策**:
- ✅ `apps/api/src/config/env.ts` に本番限定Fail-fastを追加（弱いJWT秘密鍵は起動時に拒否）
- ✅ kioskレート制限をサービス層へ抽出し、`RateLimiterStore`を導入
- ✅ Redis利用時は共有カウンタ、障害時はInMemoryフォールバックで可用性を維持
- ✅ `apps/api/src/plugins/rate-limit.ts` で `/api/kiosk` 一括除外を廃止し、`support/power`のみ個別制御へ整理

**実装のポイント**:
- **秘密鍵強度**: 最小長（32文字）+ 弱いパターン（`change-me`, `dev-`, `test-`等）を禁止
- **キー粒度**: `kiosk:{scope}:{clientKey}:{ip}` でカウントし、同一IP配下でも端末キー単位で制御
- **依存分離**: `routes -> services/security -> infra(store)` の方向を維持

**運用設定（追加）**:
- `RATE_LIMIT_REDIS_URL`（任意）: 設定時はRedis共有レート制限を使用
- `KIOSK_SUPPORT_RATE_LIMIT_MAX`, `KIOSK_SUPPORT_RATE_LIMIT_WINDOW_MS`
- `KIOSK_POWER_RATE_LIMIT_MAX`, `KIOSK_POWER_RATE_LIMIT_WINDOW_MS`

**再発防止**:
- 本番用シークレットをデプロイ前チェックに追加（未設定・弱値を禁止）
- kiosk系新規エンドポイントは「グローバル制限 + 端末単位制限」の二層方針で統一

**関連ファイル**:
- `apps/api/src/config/env.ts`
- `apps/api/src/services/security/rate-limiter-store.ts`
- `apps/api/src/services/security/kiosk-rate-limit.service.ts`
- `apps/api/src/plugins/rate-limit.ts`
- `apps/api/src/routes/kiosk/shared.ts`
- `apps/api/src/routes/kiosk/support.ts`
- `apps/api/src/routes/kiosk/power.ts`
- `apps/api/src/routes/backup/config-write.ts`
- `apps/api/src/routes/backup/oauth.ts`
- `apps/api/src/routes/gmail/oauth.ts`

---

### [KB-071] Tailscale導入とSSH接続設定

**⚠️ 更新（2026-01-30）**: 本KBの結論は [ADR-20260130-tailscale-primary-operations](../../decisions/ADR-20260130-tailscale-primary-operations.md) により**置き換え**られました。現在の正本は「Tailscale主（通常運用）、localは緊急時のみ」です。

**EXEC_PLAN.md参照**: Phase 2（旧: メンテナンス時の安全化/Tailscale導入, 2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- メンテナンス時にインターネット経由でAnsible実行・GitHubからpullする際、SSHポートをインターネットに公開する必要がある
- 動的IPアドレスで接続が不安定になる可能性がある
- 自宅と会社の両方から接続する際、IPアドレスが異なる

**要因**: 
1. **VPNの未導入**: TailscaleなどのVPNが導入されていなかった
2. **SSHポートの公開**: SSHポート（22）をインターネットに公開する必要があった
3. **動的IPの問題**: 動的IPアドレスで接続が不安定になる可能性がある

**試行した対策**: 
- [試行1] 固定IPアドレスを取得 → **失敗**（コストが高い、設定が複雑）
- [試行2] ポート転送を設定 → **失敗**（セキュリティリスクがある）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. Tailscaleアカウントを作成（無料プランで100デバイスまで利用可能）
  2. MacにTailscaleクライアントをインストール・認証
  3. Pi5、Pi4、Pi3にTailscaleクライアントをインストール
  4. 各デバイスで`sudo tailscale up`を実行して認証
  5. Tailscale IPアドレスを`group_vars/all.yml`に設定
  6. Mac側の`~/.ssh/config`に2つの接続設定を追加:
     - `raspi5-tailscale`: 通常運用（Tailscale経由 `100.106.158.2`）
     - `raspi5-local`: 緊急時のみ（ローカルネットワーク `192.168.10.230`）
  7. Ansibleタスク（`roles/common/tasks/tailscale.yml`）を作成し、自動インストール可能にする

**実装の詳細**:
- Tailscaleインストール:
  - Pi5: `curl -fsSL https://tailscale.com/install.sh | sh`
  - Pi4: Pi5経由でSSH接続してインストール
  - Pi3: Pi5経由でSSH接続してインストール（サイネージサービスを停止してから実行）
- Tailscale認証:
  - 各デバイスで`sudo tailscale up`を実行
  - 認証URLが表示されるので、Macのブラウザで開いて承認
  - `tailscale status`でIPアドレスを確認
- SSH接続設定:
  - `~/.ssh/config`に`raspi5-local`と`raspi5-tailscale`を追加
  - `IdentityFile`に正しいSSH鍵（`id_ed25519`）を指定
  - `StrictHostKeyChecking no`でホストキーチェックを無効化（初回接続時）

**学んだこと**: 
- Tailscaleは無料で利用でき、設定が簡単
- WireGuardベースで暗号化が強固
- 動的IPアドレスでも固定IPのように接続可能
- SSHポートをインターネットに公開する必要がない
- **Tailscaleを通常運用の標準**とし、**localは緊急時のみ**に限定するのが適切
- Pi3はリソースが限られているため、サイネージサービスを停止してからインストールする必要がある

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/common/tasks/tailscale.yml`
- `infrastructure/ansible/roles/common/tasks/main.yml`
- `~/.ssh/config`（Mac側）
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-072] Pi5のUFW適用とHTTPSリダイレクト強化

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- Pi5のポート80/443/22以外も開放されており、SSHがインターネット側から到達可能だった
- HTTPアクセスがそのまま提供され、HTTPS強制が徹底されていなかった

**要因**: 
1. UFWが未導入で、iptablesのデフォルト許可状態だった
2. HTTP→HTTPSリダイレクトはCaddyfile.localに存在したが、設定がコード化されておらず再現性が低かった

**試行した対策**: 
- [試行1] iptablesで手動設定 → **失敗**（再起動で消える、Ansible未管理）
- [試行2] Caddyでヘッダー追加のみ → **部分的成功**（HTTPSは使用できるがHTTPが残る）

**有効だった対策**: 
- ✅ UFWをAnsibleで導入し、デフォルトdeny/allow構成に設定
- ✅ HTTP(S)のみ許可、SSHはローカルLANとTailscaleのサブネットからのみ許可
- ✅ Caddyfile（dev/local/production）にHTTP→HTTPSリダイレクトとセキュリティヘッダーを明記
- ✅ `docker-compose.server.yml`で`/var/log/caddy`をホストにマウントして設定を一元化

**学んだこと**: 
- 工場LANとTailscaleネットワークだけを明示的に許可する事で、SSH暴露を避けられる
- WebサーバーのHTTPSリダイレクトはCaddyレイヤーで完結させるとシンプル
- ファイアウォールとリバースプロキシの設定はAnsible管理に統一しておくと再現性が高い

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/docker/Caddyfile*`
- `infrastructure/docker/docker-compose.server.yml`
- `docs/security/requirements.md`

---

---

### [KB-073] Caddyアクセスログとfail2ban（SSH/HTTP）の連携

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- fail2banでHTTP/APIの不正アクセスを検知したかったが、Caddyのログがstdoutのみで参照できない
- SSHブルートフォースも検知できていなかった

**要因**: 
1. Caddyコンテナのログがファイルに出力されておらず、ホスト上でfail2banが読めない
2. fail2banのjail/filterが未構成

**試行した対策**: 
- [試行1] docker logsをfail2banで読み込む → **失敗**（ファイルではないため不可）
- [試行2] journalctlでCaddyログを拾う → **失敗**（コンテナがjournaldに書き込んでいない）

**有効だった対策**: 
- ✅ `/var/log/caddy`をホストで作成し、コンテナにマウント
- ✅ Caddyの`log`ディレクティブでCLF形式をファイル出力
- ✅ fail2banに`factory.conf`（sshd + caddy-http-auth）と専用filterを追加
- ✅ Ansibleでテンプレート化し、サービス再起動まで自動化

**学んだこと**: 
- fail2banは標準でCLF（common log format）を解析できるため、CaddyでもCLFを採用すると流用しやすい
- コンテナのセキュリティログはホストへバインドマウントし、OS側ツールと連携させると管理が単純化する
- SSH/HTTP双方の閾値をAnsible変数化しておくと、リスクレベルに応じた調整が容易

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/templates/fail2ban.local.j2`
- `infrastructure/ansible/templates/fail2ban-filter-caddy-http.conf.j2`
- `infrastructure/docker/Caddyfile*`
- `docs/plans/security-hardening-execplan.md`### [KB-074] Pi5のマルウェアスキャン自動化（ClamAV/Trivy/rkhunter）

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi5にウイルス/ルートキット検知の仕組みがなく、感染を検知できない
- スキャンログが分散し、監視フェーズで再利用しづらかった

**有効だった対策**: 
- ✅ ClamAV/Trivy/rkhunterをAnsibleで導入し、`/usr/local/bin/*-scan.sh`を配置
- ✅ 03:00/03:30/04:00のcronで夜間スキャンを自動化し、ログを`/var/log/{clamav,trivy,rkhunter}`へ集約
- ✅ TrivyはGitHub公式ARM64 `.deb`をダウンロードしてdpkgでインストール（APTリポジトリが無いため）

**学んだこと**: 
- Debian bookworm系ではTrivyのAPTパッケージが提供されていないため、公式リリースを直接導入するのが確実
- `freshclam`デーモンに任せれば手動`freshclam`は不要で、ログロックエラーも避けられる

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/malware.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-075] Pi4キオスクの軽量マルウェア対策

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi4（キオスク）はリソースが限られており、Pi5と同じ対象・頻度でスキャンするとUIレスポンスが低下する

**有効だった対策**: 
- ✅ ClamAVとrkhunterのみを導入し、対象を`/opt/RaspberryPiSystem_002/storage`に限定
- ✅ 週1回（日曜02:00開始）のcronを設定し、低負荷時間帯だけスキャン
- ✅ Pi5と同じスクリプト/ログ命名に揃え、監視・アラートの共通化を容易にした

**学んだこと**: 
- リソースが限られた端末では、対象フォルダと頻度を絞ることでセキュリティとUXの両立が可能
- Pi5を経由したscp→sshの配布フローを整備すると、再デプロイが容易になる

**関連ファイル**: 
- `infrastructure/ansible/roles/kiosk/tasks/security.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-076] fail2ban連携のセキュリティ監視タイマー

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ローカル運用では外部通知サービス（Slack等）が使えず、fail2banログを目視しないと侵入試行に気付けない
- 既存の`alerts/`ファイルベース通知と連携できていなかった

**有効だった対策**: 
- ✅ `/usr/local/bin/security-monitor.sh`を追加し、fail2banログのBan行を15分間隔で走査
- ✅ systemd timer（`security-monitor.timer`）で常時起動し、stateファイルで重複通知を防止
- ✅ Banイベントを検知すると`generate-alert.sh`を呼び、管理コンソールのアラートバナーへ自動表示

**学んだこと**: 
- 初回実行時は既存ログを基準化してから監視を開始しないと、過去のBanが大量通知になる
- `logger`タグを付与しておくと、journalctlでも監視スクリプトの動作状況を追跡しやすい

**関連ファイル**: 
- `infrastructure/ansible/templates/security-monitor.sh.j2`
- `infrastructure/ansible/templates/security-monitor.service.j2`
- `infrastructure/ansible/templates/security-monitor.timer.j2`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-177] `ports-unexpected` が15分おきに発生し続ける（Pi5の不要ポート露出/監視ノイズ）

**EXEC_PLAN.md参照**: 2026-01-18（ポート露出削減 + `security-monitor` 改善）

**事象**:
- 管理コンソール（`/admin`）に **同一内容の `ports-unexpected`** が15分間隔で出続ける
- 例: `許可されていないLISTENポートを検出: 111 25 ... 5353 ... 631 ... 5900 ...` のように、OS/常駐サービス由来のポートが混在してノイズ化

**調査（再現/確認コマンド）**:
- Pi5上でLISTEN/UNCONNの実態を確認:
  - `sudo ss -H -tulpen`
- UFWの許可状況を確認:
  - `sudo ufw status verbose`
- Docker公開の有無を確認（`db`/`api`がホストへpublishされていないこと）:
  - `docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps`
- ベースライン（証跡）: `docs/knowledge-base/infrastructure/ports-baseline-20260118.md`

**根本要因**:
1. **`security-monitor.sh` が「ポート番号だけ」で判定**していたため、
   - `127.0.0.1` だけのサービス（exim4/cups 等）や、
   - Tailscale由来のソケット（`tailscaled`）や、
   - OS標準の常駐（rpcbind/avahi 等）
   まで一律に「危険」と判定し、運用上ノイズになっていた
2. UFWで遮断していても **サービス自体がLISTENしている**ため、監視としては検知され続ける（＝通知が止まらない）

**有効だった対策（恒久化）**:
- ✅ 不要サービスを **stop + disable + mask** して、LISTEN自体を消す（UFW依存を減らす）
  - 対象: `rpcbind.socket` / `rpcbind.service` / `avahi-daemon.service` / `exim4.service` / `cups.service`
  - 実装: `infrastructure/ansible/roles/server/tasks/security.yml`
  - 変数: `infrastructure/ansible/group_vars/all.yml`
    - `server_disable_unused_services: true`
    - `server_unused_systemd_units_to_mask: [...]`
- ✅ `security-monitor.sh` のポート監視を改善（**外部露出 + プロセス込み**）
  - `ss -H -tulpen` を使い `addr:port(process,proto)` をdetailsに含める
  - 監視から除外:
    - `127.0.0.1` / `::1`（ループバックのみ）
    - `tailscaled` および Tailscaleアドレス帯（`100.*`, `fd7a:*`）
    - link-local（`fe80:*`、DHCPv6クライアント等）
  - VNC運用を踏まえ `ALLOWED_LISTEN_PORTS` のデフォルトに `5900` を追加
  - 既存の重複抑止（state比較）は維持
  - 実装: `infrastructure/ansible/templates/security-monitor.sh.j2`

**適用手順（Pi5）**:
- `inventory.yml` の `server` は `ansible_connection: local` のため、**Pi5上でAnsibleを実行**するのが前提。
- 例:
  - `cd /opt/RaspberryPiSystem_002/infrastructure/ansible`
  - `ansible-playbook playbooks/harden-server-ports.yml`

**実機検証結果（2026-01-18）**:
- ✅ デプロイ成功: `feat/ports-hardening-20260118`ブランチをPi5にデプロイし、`harden-server-ports.yml`を実行
- ✅ 設定維持確認: Gmail/Dropboxの設定（`backup.json`）が維持されていることを確認
- ✅ アラート解消: `ports-unexpected`アラートの新規発生なし（ノイズが解消）
- ✅ ポート状態確認: 期待ポート（22/80/443/5900）のみ外部露出、Docker内部ポート（5432/8080）は非公開
- ✅ サービス状態確認: 不要サービス（rpcbind/avahi/exim4/cups）がmask/inactive状態
- ✅ 監視稼働確認: `security-monitor.timer`が有効化・稼働中、環境変数が正しく注入されていることを確認

**トラブルシューティング**:
- `security-monitor` のアラートに `(...unknown,udp)` のようにプロセス名が出ない:
  - `ss -H -tulpen` の `users:(("proc",pid=...))` 抽出が崩れている可能性。
  - `sed` の正規表現は **basic regex** と **グルーピングの `\(...\)`** が必要（`\\1` のエスケープ違いで失敗しやすい）。
- コントローラ（Mac）側から `ansible-playbook` を実行すると `role 'server' not found` になる:
  - `ansible.cfg` の `roles_path = ./roles` は **`infrastructure/ansible` をCWDにして実行**する前提。
- デプロイ時に`harden-server-ports.yml`が未追跡ファイルとして存在すると、git checkoutで上書き警告が出る:
  - エビデンス: `error: The following untracked working tree files would be overwritten by checkout`
  - 対応: Pi5上で未追跡ファイルを削除してから再デプロイ（`rm infrastructure/ansible/playbooks/harden-server-ports.yml`）。次回以降はmainブランチにマージ済みのため発生しない。
- `deploy.sh`のヘルスチェックがタイムアウトしても、実際にはAPIは正常起動していることがある:
  - エビデンス: デプロイスクリプトが10分タイムアウトしたが、手動で`curl`すると`/api/system/health`が`ok`を返す。
  - 対応: Dockerサービス起動に時間がかかる場合があるため、タイムアウト後も手動でヘルスチェックを実施し、必要に応じてコンテナ再起動を確認。

**関連ファイル**:
- `infrastructure/ansible/templates/security-monitor.sh.j2`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/playbooks/harden-server-ports.yml`
- `docs/security/port-security-audit.md`
- `docs/security/port-security-verification-results.md`
- `docs/knowledge-base/infrastructure/ports-baseline-20260118.md`
- `docs/runbooks/ports-unexpected-and-port-exposure.md`

---

---

### [KB-077] マルウェアスキャン結果の自動アラート化

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ClamAV/Trivy/rkhunterが感染や秘密情報を検出しても、ログを開かなければ気づけなかった
- rkhunterの既知警告やTrivyの秘密鍵検出など、誤検知を抑制しつつ通知したかった

**有効だった対策**: 
- ✅ 各スキャンスクリプトで終了コード／警告行を判定し、`generate-alert.sh`に詳細を渡すよう改修
- ✅ Trivyの`--skip-dirs`とignoreパターン、rkhunterの除外リストをAnsible変数にして誤検知を抑制
- ✅ アラート種別（`clamav-detection`、`trivy-detection`、`rkhunter-warning`）を分け、管理画面で原因を特定しやすくした

**学んだこと**: 
- `clamscan`はexit code=1で感染ファイル、2でエラーなので、両ケースを分けて通知する必要がある
- Trivyの秘密鍵検出は証明書ディレクトリを`--skip-dirs`対象にすることでノイズを大幅に減らせる

**関連ファイル**: 
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `infrastructure/ansible/group_vars/all.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-078] 複数ローカルネットワーク環境でのVNC接続設定

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- 会社のネットワーク（192.168.10.0/24）と自宅のネットワーク（192.168.128.0/24）で異なるIPアドレスを使用
- UFWでVNCポート（5900/tcp）が `192.168.10.0/24` からのみ許可されていたため、自宅からRealVNC ViewerでPi5に接続できなかった

**有効だった対策**: 
- ✅ UFWのVNC許可ネットワークに `192.168.128.0/24` を追加（`sudo ufw allow from 192.168.128.0/24 to any port 5900`）
- ✅ Ansibleの `group_vars/all.yml` の `ufw_vnc_allowed_networks` に両方のネットワークを定義し、次回デプロイ時に自動反映されるように設定
- ✅ 複数のローカルネットワークに対応できるよう、リスト形式で管理

**学んだこと**: 
- 異なるネットワーク環境（会社/自宅）で運用する場合、ファイアウォール設定も複数のネットワークを許可する必要がある
- UFWのルールは `ufw_vnc_allowed_networks` のようなリスト変数で管理することで、環境ごとの追加が容易になる
- Tailscale経由での接続は別途設定されているため、ローカルネットワークの追加設定は必要ない

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml` (ufw_vnc_allowed_networks)
- `infrastructure/ansible/roles/server/tasks/security.yml` (VNCポート許可タスク)
- `docs/plans/security-hardening-execplan.md`
- `docs/security/requirements.md`

---

---

### [KB-079] Phase7セキュリティテストの実施結果と検証ポイント

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- Phase1-6で実装したセキュリティ対策が正しく動作するか、包括的なテストが必要だった
- ネットワーク環境の切り替え、Tailscale経路、ファイアウォール、HTTPS強制、fail2ban、バックアップ復元、マルウェアスキャンの各機能を検証する必要があった

**実施した検証**:
- ✅ **IPアドレス管理の切り替え**: `ansible ... -e network_mode={local,tailscale}` で server/kiosk/signage IP が正しく切り替わることを確認
- ✅ **Tailscale接続**: Mac → Pi5 への Tailscale SSH/HTTPS が機能し、インターネット経由でも安全に接続できることを確認
- ✅ **ファイアウォール設定**: UFWで許可されたポート（80/443/22/5900）のみ通過し、その他が遮断されることを確認
- ✅ **HTTPS強制**: HTTPアクセスが301リダイレクトでHTTPSに転送されることを確認
- ✅ **fail2ban動作**: 意図的なBanイベントで `security-monitor.sh` がアラートを生成し、解除後に正常に戻ることを確認
- ✅ **バックアップ暗号化・復元**: GPG暗号化バックアップからテストDBへ復元し、データ整合性（Loan 436件）を確認
- ✅ **マルウェアスキャン**: ClamAV/Trivy/rkhunterの手動スキャンでログとアラート生成を確認

**学んだこと**: 
- ネットワークモードの切り替えは `-e network_mode=` で動的に変更でき、Ansible変数が正しく展開されることを確認
- Tailscale経由での接続はローカルネットワークが変わっても安定して機能する
- fail2banのBanイベントは `security-monitor.sh` で自動的にアラート化され、管理画面で確認可能
- バックアップ復元テストは本番DBとは別のテストDBを使用することで、安全に検証できる
- Trivyの秘密鍵検出は `--skip-dirs` で抑制できるが、ログには過去の検出履歴も残るためタイムスタンプで判断する必要がある
- rkhunterの既知警告（PermitRootLogin等）はアラート経由で把握できるため、運用上問題なし

**残課題**:
- オフラインUSBメディアを実際にマウントした状態でのバックアップコピー/削除テストは未実施（USB接続時に実施予定）
- TrivyのDockerイメージ単位のスキャンは未実装（今後の課題）

**関連ファイル**: 
- `docs/plans/security-hardening-execplan.md` (Phase 7 進捗)
- `docs/security/requirements.md` (テスト状況)
- `scripts/server/backup-encrypted.sh`
- `scripts/server/restore-encrypted.sh`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`

---

---

### [KB-178] ログの機密情報保護実装（x-client-keyの[REDACTED]置換）

**EXEC_PLAN.md参照**: 2026-01-18（セキュリティ評価・緊急対策実装）

**事象**: 
- `x-client-key`（キオスクAPI認証キー）がログに平文で出力されていた
- ログファイルが漏洩した場合、`x-client-key`が悪用され、キオスクAPIへの不正アクセスが可能になる
- セキュリティ評価で中優先度だが影響が大きい脆弱性として特定された

**要因**: 
1. **ログ出力時の機密情報フィルタリング未実装**: リクエストロガーや各ルートハンドラーで、`x-client-key`をそのままログに出力していた
2. **機密情報の定義が不明確**: どの情報が機密情報として扱うべきか、明確な基準がなかった

**有効だった対策**: 
- ✅ **ログ出力時の機密情報フィルタリング実装**（2026-01-18）:
  1. `request-logger.ts`: `x-client-key`を`[REDACTED]`に置換
  2. `kiosk.ts`: `clientKey`、`rawClientKey`、`client.apiKey`を`[REDACTED]`に置換、`headers`から`x-client-key`を除外
  3. `tools/loans/cancel.ts`: `headerKey`と`headers`から`x-client-key`を除外
  4. `tools/loans/return.ts`: `headerKey`と`headers`から`x-client-key`を除外
  5. `webrtc/signaling.ts`: `headers`から`x-client-key`を除外
  6. `tools/loans/delete.ts`: `headers`から`x-client-key`を除外

**実装の詳細**:
- **修正パターン1**: ヘッダーから直接除外
  ```typescript
  // 修正前
  'x-client-key': request.headers['x-client-key'],
  
  // 修正後
  'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
  ```

- **修正パターン2**: ヘッダーオブジェクト全体をサニタイズ
  ```typescript
  // 修正前
  app.log.info({ headers: request.headers }, 'Request received');
  
  // 修正後
  const sanitizedHeaders = { ...request.headers };
  if ('x-client-key' in sanitizedHeaders) {
    sanitizedHeaders['x-client-key'] = '[REDACTED]';
  }
  app.log.info({ headers: sanitizedHeaders }, 'Request received');
  ```

- **修正パターン3**: 変数自体を`[REDACTED]`に置換
  ```typescript
  // 修正前
  app.log.info({ clientKey, rawClientKey }, 'Kiosk config request');
  
  // 修正後
  app.log.info({ 
    clientKey: clientKey ? '[REDACTED]' : undefined, 
    rawClientKey: '[REDACTED]' 
  }, 'Kiosk config request');
  ```

**実機検証結果（2026-01-18）**:
- ✅ CI成功: GitHub Actions CIで全テストが成功（lint-and-test、e2e-smoke、e2e-tests、docker-build）
- ✅ デプロイ成功: `feat/ports-hardening-20260118`ブランチをPi5にデプロイし、正常に動作
- ✅ ログ確認: ログに`x-client-key`が`[REDACTED]`として出力されることを確認
- ✅ 機能確認: キオスクAPIが正常に動作し、認証も正常に機能

**学んだこと**: 
- ログ出力時は機密情報（認証キー、パスワード、トークン等）を必ずフィルタリングする
- `[REDACTED]`という明確なマーカーを使用することで、機密情報が意図的に隠されていることを示す
- ログの可読性は低下するが、セキュリティを優先する
- デバッグ時は必要に応じて、デバッグモードでのみ値を出力する機能を追加することを検討できる

**副作用**: 
- **ログの可読性**: `x-client-key`が`[REDACTED]`に置換されるため、ログの可読性が低下する可能性があるが、セキュリティを優先
- **デバッグ**: `x-client-key`の値がログに出力されないため、デバッグ時に値の確認が困難になる可能性がある

**再発防止**: 
- 新しいAPIエンドポイントを追加する際は、ログ出力時に機密情報をフィルタリングすることを徹底
- コードレビュー時に、ログ出力箇所で機密情報が含まれていないか確認するチェックリストを追加
- CIでログ出力に機密情報が含まれていないか検証するテストを追加することを検討

**関連ファイル**: 
- `apps/api/src/plugins/request-logger.ts`
- `apps/api/src/routes/kiosk.ts`
- `apps/api/src/routes/tools/loans/cancel.ts`
- `apps/api/src/routes/tools/loans/return.ts`
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/api/src/routes/tools/loans/delete.ts`
- `docs/security/log-redaction-implementation.md`
- `docs/security/urgent-security-measures.md`
- `docs/security/evaluation-report.md`

---

### [KB-264] Tailscale ACL grants形式でのポート指定エラー（tag:server:22形式が無効）

**EXEC_PLAN.md参照**: Tailscaleハードニング段階導入（2026-02-16）

**事象**:
- Tailscale管理画面のJSON editorでACLポリシーを設定する際、`"dst": ["tag:server:22"]` のような形式でエラーが発生
- エラーメッセージ: `Error: dst="tag:server:22": tag not found: "tag:server:22"`

**要因**:
- Tailscaleの新しい`grants`形式では、ポート指定を`dst`フィールドに含めることができない
- `grants`形式では、`dst`はタグのみを指定し、ポートは`ip`フィールドで`tcp:22`のように指定する必要がある
- 旧形式の`acls`では`tag:server:22`形式が有効だが、`grants`形式では無効

**有効だった対策**:
- ✅ `grants`形式では`ip`フィールドでポートを指定:
  ```json
  {
    "src": ["tag:admin"],
    "dst": ["tag:server"],
    "ip": ["tcp:22", "tcp:443"]
  }
  ```
- ✅ `dst`フィールドにはタグのみを指定（ポートを含めない）

**実装のポイント**:
- **grants形式**: `"ip": ["tcp:22", "tcp:443"]` のようにプロトコルとポートを明示
- **acls形式（旧）**: `"dst": ["tag:server:22"]` のようにポートを含める形式が可能
- Tailscale管理画面のデフォルトは`grants`形式のため、新しい設定では`grants`形式を使用する

**再発防止**:
- `docs/security/tailscale-policy.md`に`grants`形式の正しい雛形を追加
- ポート指定は`ip`フィールドで行うことを明記

**関連ファイル**:
- `docs/security/tailscale-policy.md`
- Tailscale管理画面のAccess Controls → JSON editor

---

### [KB-265] Tailscaleハードニング段階導入完了（横移動面削減）

**EXEC_PLAN.md参照**: Tailscaleハードニング段階導入（2026-02-16〜2026-02-17）

**事象**:
- Tailscale VPN内で端末間の横移動（lateral movement）が可能な状態だった
- Pi4キオスクのNFC Agent（`0.0.0.0:7071`）がTailnet上でアクセス可能で、認証なしの制御API（`reboot`、`poweroff`）が暴露されていた

**要因**:
1. **NFC Agentの広いバインド**: Pi4のNFC Agentが`0.0.0.0:7071`でバインドされ、Tailnet上の任意の端末からアクセス可能
2. **認証なしの制御API**: `/api/agent/reboot`、`/api/agent/poweroff`が認証なしで公開
3. **ACL未適用**: Tailscaleのデフォルト設定（Allow all）で、端末間の通信が全て許可されていた

**有効だった対策**:
- ✅ **Phase 1: NFC WebSocketのlocalhost優先化**
  - `apps/web/src/hooks/useNfcStream.ts`を修正し、`VITE_AGENT_WS_MODE=local`時に`ws://localhost:7071/stream`を優先
  - 失敗時は従来の`wss://<Pi5>/stream`（Caddy経由）へフォールバック
  - `infrastructure/ansible/templates/web.env.j2`に`VITE_AGENT_WS_MODE`を追加
  - `infrastructure/ansible/inventory.yml`でkiosk端末に`web_agent_ws_mode: "local"`を設定
- ✅ **Phase 2-0: タグ付け**
  - Tailscale管理画面で各端末にタグを付与（`tag:admin`、`tag:server`、`tag:kiosk`、`tag:signage`）
- ✅ **Phase 2-1: ACL最小化（grants形式）**
  - `tag:admin → tag:server: tcp:22, tcp:443`
  - `tag:kiosk/tag:signage → tag:server: tcp:443`
  - `tag:server → tag:kiosk/tag:signage: tcp:22`
  - 互換期間として`tag:server → tag:kiosk: tcp:7071`を一時的に許可
- ✅ **Phase 2-2: kiosk:7071閉塞**
  - `tag:server → tag:kiosk: tcp:7071`のgrantを削除
  - Tailnet上の`kiosk:7071`へのアクセスを遮断

**実装のポイント**:
- **NFC WebSocket**: kiosk端末は`localhost:7071`を優先し、Pi5経由のプロキシはフォールバックのみ
- **ACL形式**: Tailscaleの新しい`grants`形式を使用（`ip`フィールドでポート指定）
- **段階適用**: タグ付け→ACL最小化→7071閉塞の順で段階的に適用し、各段階で動作確認

**検証結果**:
- ✅ Mac→Pi5 SSH: 正常
- ✅ APIヘルスチェック: `status=ok`
- ✅ サイネージ配信: `200 OK`
- ✅ Pi5→Pi4/Pi3（Ansible ping）: 正常
- ✅ Mac→Pi4:7071: タイムアウト（到達不可、期待通り）
- ✅ Pi4 localhost:7071: 正常応答（NFC Agent動作確認）
- ✅ Mac→Pi4 SSH: ブロック（期待通り）
- ✅ NFC読み取り: 正常動作（実機検証）
- ✅ WebRTC通話: 正常動作（実機検証、工場LAN内）

**再発防止**:
- `docs/security/tailscale-policy.md`に`grants`形式の正しい雛形を追加
- `docs/security/system-inventory.md`にTailscale運用（ロールと最小通信）を記録
- 新規端末追加時は、適切なタグを付与し、ACLポリシーに反映

**関連ファイル**:
- `apps/web/src/hooks/useNfcStream.ts`
- `infrastructure/ansible/templates/web.env.j2`
- `infrastructure/ansible/inventory.yml`
- `docs/security/tailscale-policy.md`
- `docs/security/system-inventory.md`
- `docs/guides/deployment.md`

---

### [KB-266] NFCストリーム端末分離の実装完了（ACL維持・横漏れ防止）

**EXEC_PLAN.md参照**: Tailscaleハードニング段階導入 Phase 2-2完了（2026-02-18）

**事象**:
- Tailscale ACLポリシー導入後、Pi4でNFCタグをスキャンすると、Macで開いたキオスク画面でも動作が発動する問題が発生
- NFCイベントが端末間で横漏れし、意図しない画面遷移が発生していた

**要因**:
1. **Pi5経由の共有購読**: Webアプリが`wss://<Pi5>/stream`（Caddy経由）に接続し、Pi5がPi4のNFC Agentをプロキシしていた
2. **NFC Agentの全端末配信**: Pi4のNFC AgentがWebSocket接続している全クライアントにイベントを配信していた
3. **ポリシー未実装**: Webアプリに端末分離ポリシーが実装されておらず、MacでもNFCストリームを購読していた

**有効だった対策**:
- ✅ **NFCストリームポリシーの実装**
  - `apps/web/src/features/nfc/nfcPolicy.ts`を新設し、`resolveNfcStreamPolicy()`でポリシーを解決
  - Mac環境では`disabled`（NFC無効）、Pi4では`localOnly`（localhostのみ）を返す
  - `apps/web/src/features/nfc/nfcEventSource.ts`を新設し、`getNfcWsCandidates()`でWebSocket候補を生成
  - `localOnly`ポリシー時は`ws://localhost:7071/stream`のみ、フォールバックなし
- ✅ **useNfcStreamフックの更新**
  - `apps/web/src/hooks/useNfcStream.ts`を修正し、`resolveNfcStreamPolicy()`と`getNfcWsCandidates()`を使用
  - Pi5経由の`wss://<Pi5>/stream`へのフォールバックを削除
- ✅ **Caddyfileの更新**
  - `infrastructure/docker/Caddyfile.local.template`から`/stream`プロキシ設定を削除
  - Pi5経由のNFCストリームプロキシを廃止
- ✅ **CI設定の更新**
  - `.github/workflows/ci.yml`の`on.push.branches`に`chore/**`パターンを追加

**実装のポイント**:
- **ポリシー解決**: User-AgentとlocalStorageの`kiosk-client-key`から端末種別を判定
- **Mac環境の無効化**: Mac環境ではNFCストリームを`disabled`にし、誤発火を防止
- **Pi4のlocalOnly**: Pi4では`ws://localhost:7071/stream`のみに接続し、端末分離を実現
- **Caddyプロキシ削除**: Pi5経由の`/stream`プロキシを削除し、共有購読面を撤去

**検証結果**:
- ✅ Pi4キオスク画面: NFCスキャンがローカル端末のみで動作（実機検証完了）
- ✅ Macキオスク画面: NFCスキャンが発動しない（実機検証完了）
- ✅ Caddyfile: `/stream`プロキシ設定が削除済み（確認済み）
- ✅ ビルド済みWebアプリ: `wss://.../stream`への参照が存在しない（確認済み）
- ✅ Pi5からPi4のNFC Agent: アクセス不可（正常、端末分離が機能）

**再発防止**:
- `docs/security/tailscale-policy.md`にNFCストリーム分離の実装完了を記録
- `docs/troubleshooting/nfc-reader-issues.md`にNFC WebSocket接続ポリシーの説明を追加
- 新規端末追加時は、適切なポリシーが適用されることを確認

**関連ファイル**:
- `apps/web/src/features/nfc/nfcPolicy.ts`（新規）
- `apps/web/src/features/nfc/nfcEventSource.ts`（新規）
- `apps/web/src/hooks/useNfcStream.ts`（修正）
- `apps/web/src/hooks/useNfcStream.test.ts`（新規、テスト）
- `infrastructure/docker/Caddyfile.local.template`（修正）
- `infrastructure/docker/Caddyfile.local`（修正）
- `.github/workflows/ci.yml`（修正）
- `docs/security/tailscale-policy.md`
- `docs/troubleshooting/nfc-reader-issues.md`

---

### [KB-277] Tailscale経由でのVNC接続問題（ACL設定不足）

**発生日**: 2026-02-28

**事象**: 
- MacからPi5のVNCポート（5900）に接続できない（`nc -zv 100.106.158.2 5900`がタイムアウト）
- Pi5側のwayvncは起動しており、ポート5900で待ち受けている
- Pi5側のUFW設定も正しく設定されている（`100.64.0.0/10`からのアクセスを許可）
- Pi5自身からは`127.0.0.1:5900`と`100.106.158.2:5900`に接続できる

**調査過程**:
1. **UFW設定の確認**: `sudo ufw status verbose`で`5900/tcp ALLOW IN 100.64.0.0/10`が設定されていることを確認
2. **wayvncサービスの確認**: `systemctl status wayvnc`でサービスが起動していることを確認
3. **ポート待ち受けの確認**: `sudo ss -tlnp | grep 5900`で`0.0.0.0:5900`で待ち受けていることを確認
4. **UFW無効化テスト**: UFWを無効化しても接続がタイムアウトすることを確認（UFWが原因ではない）
5. **wayvnc設定の確認**: `/etc/wayvnc/config`で`address=::`（IPv6のみ）になっていることを確認
6. **wayvnc設定の修正**: `address=0.0.0.0`に変更してIPv4でも待ち受けられるように修正
7. **Tailscale ACL設定の確認**: Tailscale管理画面でACL設定を確認し、`tag:admin` → `tag:server`の`tcp:5900`が許可されていないことを確認

**根本原因**: 
- TailscaleのACL（Access Control List）で`tag:admin` → `tag:server`の`tcp:5900`（VNC）が許可されていなかった
- ACLで許可されていない通信はタイムアウトに見える（接続拒否ではなくタイムアウト）
- UFW設定やwayvnc設定は正しかったが、TailscaleのACLが先にブロックしていた

**有効だった対策**: 
- ✅ Tailscale ACLの`grants`配列に`tcp:5900`を追加
  ```json
  {
    "src": ["tag:admin"],
    "dst": ["tag:server"],
    "ip":  ["tcp:22", "tcp:443", "tcp:5900"]
  }
  ```
- ✅ wayvnc設定を`address=0.0.0.0`に変更（IPv4/IPv6両方で待ち受け）
- ✅ UFW設定に`100.64.0.0/10`を追加（既に実施済み）

**学んだこと**: 
- TailscaleのACLは、UFWやアプリケーション設定よりも先に評価される
- ACLで許可されていない通信は接続拒否ではなくタイムアウトに見える
- 複数のネットワーク層（Tailscale ACL → UFW → アプリケーション）を順番に確認する必要がある
- wayvncの`address=::`はIPv6のみを意味し、IPv4接続を受け付けるには`address=0.0.0.0`が必要

**セキュリティ影響**:
- `tag:admin`（管理者のみ）から`tag:server`への接続のみ許可
- 既にSSH（22）とHTTPS（443）が許可されているため、VNC（5900）追加による新規リスクは小さい
- wayvncは認証あり（`enable_auth=true`, `enable_pam=true`）
- Tailscale経由での通信は暗号化されている

**再発防止**:
- 新規ポートを追加する際は、Tailscale ACL設定も確認・更新する
- 接続がタイムアウトする場合は、Tailscale ACL設定を最初に確認する
- `docs/guides/mac-ssh-access.md`にTailscale ACL設定の説明を追加

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml` (ufw_vnc_allowed_networks)
- `infrastructure/ansible/roles/server/tasks/security.yml` (VNCポート許可タスク)
- `/etc/wayvnc/config` (wayvnc設定)
- Tailscale管理画面のACL設定
- `docs/guides/mac-ssh-access.md` (VNC接続手順)
- `docs/security/port-security-audit.md` (ポートセキュリティ監査)

---

### [KB-293] Pi4/Pi3のRealVNC接続復旧（Pi5経由SSHトンネル方式）

**発生日**: 2026-03-06

**事象**: 
- MacからRealVNC ViewerでPi5は接続できるが、Pi4×2とPi3は接続できない
- Pi5のVNCはKB-277で解決済みだが、Pi4/Pi3は別途対応が必要

**調査過程**:
1. Pi5で `tailscale status` を実行し、Pi4/Pi3が `online` であることを確認
2. Pi5から `nc -vz -w 3 <各端末IP> 5900` を実行。ACL未設定時はタイムアウト
3. Tailscale ACLに `tag:server -> tag:kiosk: tcp:5900` と `tag:server -> tag:signage: tcp:5900` を追加後、Pi5からPi4/Pi3の5900に到達可能に
4. MacからはPi5経由のSSHトンネル（`-L 5904:<Pi4_IP>:5900` 等）で `localhost:5904` 等に接続し、RealVNCで表示可能を確認

**根本原因**: 
- Tailscale ACLで `tag:admin -> tag:kiosk/signage` の直接許可は行わない方針のため、MacからPi4/Pi3への5900は直接到達しない
- `tag:server -> tag:kiosk/signage: tcp:5900` も未設定だったため、Pi5からも5900が到達しなかった

**有効だった対策**: 
- ✅ Tailscale ACLの`grants`に `tag:server -> tag:kiosk: tcp:5900` と `tag:server -> tag:signage: tcp:5900` を追加
- ✅ MacからはPi5経由のSSHトンネルで接続（`admin -> kiosk/signage` を直接開けない）
- ✅ 運用: VNC接続するたびにSSHトンネルを張る（永続化しない）

**セキュリティ影響**:
- `tag:admin -> tag:kiosk/signage` を直接開けるより安全（攻撃面をPi5入口に集約）
- Pi5が侵害された場合、Pi4/Pi3のVNC面への横移動が可能になる（微減）

**関連ファイル**: 
- `docs/runbooks/vnc-tailscale-recovery.md` (復旧手順)
- `docs/guides/mac-ssh-access.md` (Pi4/Pi3接続手順)
- `docs/security/tailscale-policy.md` (ACLポリシー)

---

### [KB-278] クライアント端末管理の重複登録（inventory未解決テンプレキー混入）

**発生日**: 2026-02-28

**事象**:
- 管理コンソールの「クライアント端末管理」で、実機台数より多いクライアントが表示される
- `raspberrypi3` / `raspberrypi4` / `raspberrypi5` のAPIキー欄に `{{ vault_status_agent_client_key ... }}` がそのまま登録される
- 同一実機に対応する別名レコードが混在し、運用上の識別が困難になる

**根本原因**:
- `scripts/register-clients.sh` が `inventory.yml` をYAMLとして直接読み、`status_agent_client_key` のJinjaテンプレート（`{{ ... }}`）を解決せず文字列のまま扱っていた
- API側の `ClientDevice` は `apiKey` を一意キーとしてupsertするため、未解決テンプレ文字列が「別キー」として新規登録された

**有効だった対策**:
- ✅ `scripts/register-clients.sh` に未解決テンプレキー検知ガードを追加
  - `{{`, `}}`, `vault_` を含むキーを無効としてスキップ
  - 空値/短すぎるキー（8文字未満）もスキップ
- ✅ `DRY_RUN=1` モードを追加し、API登録前に対象と判定結果を確認可能にした
- ✅ 既存の誤登録レコードは、`Loan` / `Transaction` 参照が0件であることを確認した上でバックアップ後に削除
  - 退避先: `ClientDevice_backup_20260228_dupfix`
  - 削除件数: 3件（`raspberrypi3` / `raspberrypi4` / `raspberrypi5` のテンプレキー行）

**学んだこと**:
- inventoryの未解決テンプレートをそのまま業務キーとして扱うと、upsertでも重複汚染が発生する
- 「再発防止（入力ガード）」を先に適用してから「既存データ是正（削除/統合）」を行うと安全に復旧できる
- 誤登録削除時は参照整合性（取引/貸出の紐づき）確認を必須化するべき

**再発防止**:
- `register-clients.sh` 実行前に `DRY_RUN=1` で判定ログを確認する
- inventoryに固定キーを置けない場合は、将来的にAnsible解決済み変数経由で登録する方式へ移行する

**次のフェーズの検討タイミング（2026-02-28見解）**:
- **現時点では次のフェーズに進まないことを推奨**
- **理由**:
  1. 最小スコープで再発防止は達成済み（未解決テンプレートの検知とスキップにより、重複登録は防止できている）
  2. 現状の運用で十分機能している（`raspi4-robodrill01`は固定キーで正常に登録済み、既存端末は`status-agent`のheartbeatで自動登録）
  3. 次のフェーズの実装コストが高い（Ansible playbook統合には設計・実装・テストが必要、vaultパスワード管理の追加が必要になる可能性）
- **次のフェーズを検討すべきタイミング**:
  1. 新規端末追加が頻繁になる（月1台以上）
  2. vault管理のキーを`register-clients.sh`で直接登録する必要が出る
  3. `status-agent`のheartbeat自動登録では不十分になる

**将来の実装方針（Phase 1-3）**:
- **Phase 1: Ansible経由での変数解決**
  - `ansible`コマンドの`debug`モジュールで変数を解決
  - 例: `ansible all -i inventory.yml -m debug -a "var=status_agent_client_key" --vault-password-file .vault-pass`
  - 解決済み値をJSONで出力し、`register-clients.sh`で読み込む
- **Phase 2: Ansible playbook統合**
  - `register-clients.sh`をAnsible playbookに統合
  - `register-clients.yml`を作成し、変数解決とAPI登録を一括実行
  - vaultパスワード管理を統合
- **Phase 3: 完全自動化**
  - デプロイ時に自動的にクライアント登録を実行
  - `deploy.yml`に`register-clients`タスクを追加

**現時点での運用方針**:
- `DRY_RUN=1`での事前確認を徹底する
- 新規端末追加時は固定キーを使用する（例: `raspi4-robodrill01`の`client-key-raspi4-robodrill01-kiosk1`）
- 既存端末（`raspberrypi3`, `raspberrypi4`, `raspberrypi5`）はvaultで管理されているが、`register-clients.sh`はスキップされ、`status-agent`がheartbeatで自動登録している

**関連ファイル**:
- `scripts/register-clients.sh`
- `apps/api/src/services/clients/client-telemetry.service.ts`
- `apps/api/prisma/schema.prisma`
- `docs/guides/client-initial-setup.md`
- `infrastructure/ansible/inventory.yml`（`status_agent_client_key`の定義）
- `infrastructure/ansible/templates/pi5-power-dispatcher.sh.j2`（`extract_default_value()`関数の実装例）

---

### [KB-280] Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出）

**発生日**: 2026-02-28

**事象**:
- raspi4-robodrill01（Pi4）で`kiosk-browser.service`を起動しようとすると、`chromium-browser: not found`エラーが発生
- エラーログ: `/usr/local/bin/kiosk-launch.sh: line 48: exec: chromium-browser: not found`
- サービス状態: `failed (exit-code)`

**根本原因**:
- Debian Trixie（Debian 13）では`chromium-browser`パッケージが存在せず、`chromium`パッケージのみが利用可能
- `kiosk-launch.sh`は`chromium-browser`コマンドを実行しようとしているが、実際には`/usr/bin/chromium`がインストールされている
- Ansibleロール（`roles/kiosk/tasks/main.yml`）に`chromium-browser`のインストールタスクが存在しない

**有効だった対策**:
- ✅ `/usr/bin/chromium-browser` → `/usr/bin/chromium`のシンボリックリンクを作成
- ✅ `systemctl daemon-reload`でsystemdを再読み込み
- ✅ `systemctl enable kiosk-browser.service`で自動起動を有効化
- ✅ `systemctl start kiosk-browser.service`でサービスを起動

**実装のポイント**:
- Debian Trixieでは`chromium-browser`パッケージ名が`chromium`に変更されている
- シンボリックリンク作成コマンド: `sudo ln -sf /usr/bin/chromium /usr/bin/chromium-browser`
- 既存の`kiosk-launch.sh`テンプレートは`chromium-browser`を想定しているため、シンボリックリンクで互換性を維持

**検証結果**:
- ✅ シンボリックリンク作成後、`chromium-browser --version`が正常に動作
- ✅ `kiosk-browser.service`が正常に起動（`active (running)`）
- ✅ chromiumプロセスが実行中で、キオスクURL（`https://100.106.158.2/kiosk`）を開いている
- ✅ 実機検証でキオスクが正常動作することを確認

**再発防止**:
- ✅ **2026-02-28に恒久化を実装済み**: Ansibleロール（`roles/kiosk/tasks/main.yml`）に`chromium-browser`シンボリックリンク作成タスクを追加し、自動化
- Debian Trixie以降のOSでは`chromium`パッケージ名を前提とした設定を検討
- 新規Pi4追加時は、`kiosk-browser.service`起動前に`chromium-browser`シンボリックリンクの存在を確認

**解決状況**: ✅ **解決済み（2026-02-28）**

**関連ファイル**:
- `/usr/local/bin/kiosk-launch.sh`（`chromium-browser`コマンドを実行）
- `/usr/bin/chromium-browser`（シンボリックリンク）
- `/etc/systemd/system/kiosk-browser.service`（サービス定義）
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`（テンプレート）
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`（Ansibleロール）

**関連ドキュメント**:
- [guides/client-initial-setup.md](../../guides/client-initial-setup.md)（Pi4追加手順）

---

### [KB-281] Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む）

**発生日**: 2026-02-28

**事象**:
- KB-280で手動復旧していた`chromium-browser: not found`対策を、再発しない形で恒久化する必要があった
- 全台デプロイ開始時、`raspberrypi4`（`100.74.144.79`）がSSH到達不可（`port 22 timeout`）でプリフライト停止した

**根本原因**:
- Debian Trixie環境では`chromium-browser`コマンド前提のままだと、端末追加時に再発余地が残る
- 既存Pi4（`raspberrypi4`）はTailscale上で`offline, last seen 19h ago`の状態で、標準スクリプトの到達性チェックに失敗した

**有効だった対策**:
- ✅ `infrastructure/ansible/roles/kiosk/tasks/main.yml` に以下を追加
  - `/usr/bin/chromium` の存在確認（`stat`）
  - 未存在時は明示的に停止（`fail`）
  - `/usr/bin/chromium-browser` 互換シンボリックリンクを自動作成（`file state=link`）
- ✅ ローカル検証でAnsible構文チェックを実施
  - `playbooks/deploy.yml --syntax-check` 成功
  - `playbooks/deploy-staged.yml --syntax-check` 成功
- ✅ CI成功（Run ID: `22513820001`）
- ✅ 標準デプロイスクリプトで実運用検証
  - 初回全台実行で到達不可を検出（fail-fast）
  - `tailscale status`でオフライン端末を切り分け
  - 到達可能ホストへ`--limit "server:raspberrypi3:raspi4-robodrill01"`で継続デプロイ（Run ID: `20260228-141511-7945`、成功）

**実機検証結果**:
- ✅ `raspi4-robodrill01` で `/usr/bin/chromium-browser -> /usr/bin/chromium` を確認
- ✅ `chromium-browser --version` 正常
- ✅ `kiosk-browser.service` は `enabled` かつ `active`
- ✅ `status-agent.timer` は `active`
- ✅ Pi5 APIヘルスチェック `status: ok`

**学んだこと**:
- 端末依存の手動復旧は、Ansibleタスク化して「前提確認 + 自動修復 + fail-fast」を揃えると再発率が下がる
- 標準デプロイのプリフライト停止は不具合ではなく安全機能であり、`tailscale status`で到達不可端末を先に切り分けるのが有効
- オフライン端末がある場合、到達可能端末へ`--limit`で段階展開し、復帰後に追いデプロイする運用が安全

**再発防止**:
- 新規Pi4追加時は`kiosk`ロール適用後に`chromium-browser --version`と`kiosk-browser.service`状態を確認
- 全台デプロイ前にPi5から`tailscale status`を確認し、オフライン端末有無を先に把握する
- オフライン端末復帰後は`--limit <host>`で追いデプロイを実施する

**関連ファイル**:
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`
- `scripts/update-all-clients.sh`
- `docs/guides/deployment.md`
- `docs/guides/client-initial-setup.md`

---
