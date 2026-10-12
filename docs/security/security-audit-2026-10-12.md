# セキュリティ監査レポート(2026-10-12)

> 保管場所について: このレポートは未修正の脆弱性を場所つきで列挙しているため、公開リポジトリ RaspberryPiSystem_002 ではなく非公開のこのリポジトリに置く。公開側には修正済み項目の要約だけを、修正後に載せる。

対象: `RaspberryPiSystem_002`(業務システム)と `DGXSparkControlPlane`(DGX Spark 調停・Private Pi)
実施者: Claude(オーケストレーション・検証)、Codex `gpt-6.1-sol` / reasoning `high`(静的コードレビュー 5 本)
状態: **未コミットの作業ファイル。** 本レポートはリポジトリの読み取りと公開情報の照合のみで作成した。

## 1. 実施内容と限界

| 項目 | 内容 |
|---|---|
| 静的コードレビュー | Codex 5 本(RPi API / RPi web・clients / RPi infra / DGX code / DGX infra)。指摘は Claude が該当行を読んで真偽を確認した |
| 依存関係 | `pnpm audit`(両リポジトリ)、`trivy fs`(vuln/secret/misconfig)、GitHub Dependabot・CodeQL アラート(RPi) |
| サービス・イメージの最新性 | Dockerfile / compose / Ansible のピン止めを収集し、公式リリース・endoflife.date と照合 |
| **未実施** | **ライブホスト(Pi5 / Private Pi5 / DGX)への SSH 接続による実機バージョン確認。** 今回のセッション権限で拒否されたため、実機の OS・Docker・Tailscale・稼働イメージの実バージョンは未確認。`docs/security/system-inventory.md` の記載と差異がある可能性がある |
| 除外 | `.env`・証明書・Vault の値は読んでいない(ファイル名と暗号化ヘッダーの有無のみ確認)。`.claude/worktrees/` 配下は対象外 |

## 2. 最優先で対応すべき事項(両リポジトリ横断)

1. **[Critical 相当] TalkPlaza 拠点の認証情報が平文で公開リポジトリに含まれている可能性**
   `infrastructure/ansible/host_vars/talkplaza-{pi4,pi5,signage01}/vault.yml` は git 管理下にあり、先頭が `$ANSIBLE_VAULT` ではなくコメント行(= 暗号化されていない)。`security/production-secret-baseline.json` で JWT access/refresh secret・クライアントキーとして期限なしの検査例外に登録されている。RPi リポジトリは GitHub 上で公開。値は読んでいないが、有効な本番値なら **即ローテーションし、Vault 暗号化へ移行**すること。
2. **[Critical] DGX `fastify@5.11.0` の認証バイパス(CVE-2026-76169)ほか** → `apps/control-api` を fastify 5.12.5 以上へ。あわせて `fast-uri`(SSRF)・`sharp` 0.35.5 へ。
3. **[Critical] DGX `hermes_inference` の Python 依存に RCE**: `sentence-transformers 5.1.1`(CVE-2026-68770 → 5.6.0)、`transformers 4.57.1 / 4.48.3`(CVE-2026-4372 ほか)、`diffusers 0.35.1`(→ 0.38.0)、`simple-git 3.36.0`(qmd 経由、CVE-2026-102826〜102829)。モデル/ワークフローを外部から受け取る経路があるため優先度高。
4. **[High] Open WebUI 0.11.0 → 0.12.0**: session token 窃取・認証バイパス(CVE-2026-87015)、SSRF(CVE-2026-87996)など 20 件超が固定 digest 以降に修正されている。
5. **[High] RPi API の MFA 設計不備(2 件)**: access token だけで MFA を上書き可能(`auth.service.ts:180`)、MFA 有効化前の refresh token が有効化後も MFA を迂回(`auth.service.ts:143`)。
6. **[High] RPi Gmail 取り込みの HTML→PDF 変換が JS 有効・ネットワーク無制限の Chromium(`--no-sandbox`)で実行**(`playwright-html-to-pdf.adapter.ts:21`)。メール送信だけで API コンテナからの SSRF が可能。
7. **[High] DGX 業務互換プロキシが認証前に無制限の body を読む**(`business_proxy.py:470`、`server.py:1078`)。`infra/examples/agent.env.example` では待受が Tailscale IP なので tailnet から無認証で DoS 可能。
8. **[High] RPi Pi4 エージェント 3 種が `privileged: true` + `network_mode: host` + root** で稼働(`docker-compose.client.yml`、`release_kiosk` テンプレート)。
9. **[High] Private Pi の Hermes ユーザーが `docker` グループ**(= ホスト root 相当)で gateway を実行(`tasks/private-pi5-hermes/install.yml:26`)。
10. **[High] Node 20(RPi API ランタイム)と Python 3.10(DGX alexandria)は EOL**。nginx 1.28 系は legacy で 2026 年の CVE 14 件が未修正扱い。
11. **[High] pnpm 9.15.9(RPi)は EOL で HIGH 25 件が 10.x のみ修正**。DGX の vitest 3.2.7 は tinypool の CRITICAL RCE を抱えたまま修正版に到達できないため vitest 4 以上へ。DGX の vite 解決版 7.3.6 は CVE-2026-53571 / 39363(HIGH)の修正前。

## 3. RaspberryPiSystem_002

### 3.1 コード所見(Codex 指摘を Claude が該当行で確認済み)

| 深刻度 | 所見 | 場所 | 対策 |
|---|---|---|---|
| High | 既存 MFA を access token だけで上書き可能。再認証なしに `totpSecret` を差し替え、新トークンも返す | `apps/api/src/services/auth/auth.service.ts:180-195` | 再登録にはパスワード+既存 OTP を要求。変更後は既存セッション失効 |
| High | refresh が DB の現在の `mfaEnabled` を載せ直すため、MFA 設定前の refresh token で MFA 済みトークンを取得できる | `auth.service.ts:143-151` | MFA 変更時に refresh token を失効。「セッションが MFA 通過済み」をトークンに持たせる |
| High | Gmail 添付 HTML を `page.setContent` で描画。JS 無効化・request 遮断なし、Chromium は `--no-sandbox` | `playwright-html-to-pdf.adapter.ts:21`、`playwright-browser-pool.ts:23` | `javaScriptEnabled:false`、`route('**', abort)`、送信元制限を必須化 |
| High | TalkPlaza 構成で TLS 検証を全面無効化(kiosk `--ignore-certificate-errors`、signage `curl -k`、status-agent `TLS_SKIP_VERIFY=1`) | `templates/kiosk-launch.sh.j2:61`、`signage-update.sh.j2:18`、`group_vars/talkplaza.yml` | 内部 CA 配布。SPKI 未設定時は起動拒否 |
| High | Pi4 エージェント(nfc/barcode/torque)が privileged+host network+root | `docker-compose.client.yml:8,28,40` | 必要デバイスのみ `devices:` で付与、`USER` 指定、`no-new-privileges` |
| High | Hermes ユーザーを docker グループへ追加し同ユーザーで gateway 実行 | `tasks/private-pi5-hermes/install.yml:26`、`private-pi5-hermes-gateway.service.j2:10` | rootless Docker か、限定された起動専用経路へ |
| Medium | haizen-agent は TLS 検証モード未指定時に `insecure`(検証なし)で `x-client-key` を送信 | `clients/haizen-agent/haizen_agent/config.py:63-80` | 既定を `system` に。不正値は起動エラー |
| Medium | StackChan bridge はトークン未設定時に全要求を許可、既定 bind `0.0.0.0:18080`。ヘッダー読取前のタイムアウトなし(単一スレッド HTTPServer) | `scripts/private-pi5-stackchan-bridge/bridge_server.py:32-40,142,178` | トークン必須化、bind 限定、読取期限 |
| Medium | NFC/barcode エージェントの WS `/stream` が無認証・`allow_origins=["*"]`。接続直後に保存イベントを送って削除する | `clients/nfc-agent/nfc_agent/main.py:83-102` | Origin allowlist と接続認証、消費確認後に削除 |
| Medium | torque-agent `/heartbeat` が所有確認なしに現在のリースを解除できる | `clients/torque-agent/torque_agent/main.py:99`、`connection_lease.py:466` | ルート認証、disarm 前に session/profile 照合 |
| Medium | 共有 4 桁 PIN のレート制限キーが `ip:URL` のため UUID を変えて総当たり可能 | `plugins/rate-limit.ts:43-48`、`routes/torque-training/index.ts:125` | ルートパターン単位+端末単位の失敗カウンター |
| Medium | ロール降格後も旧 JWT の権限が有効期限まで残る | `lib/auth.ts:84-109` | ロール変更でセッション失効、重要操作は DB ロール確認 |
| Medium | `/clients/status` `/clients/logs` が本文の `clientId` を信頼し、他端末の状態・ログを偽装可能 | `routes/clients/core.ts:63-78` | 書込み先を認証済みキーの登録端末に固定 |
| Medium | WebRTC signaling が reject/cancel/hangup/offer/answer/ice で通話参加者を検証しない。未応答通話が無制限に蓄積 | `routes/webrtc/signaling.ts:287-354,167-180` | 参加者検証、端末あたり上限と期限 |
| Medium | Redis 障害時に端末 API キーを含む rate-limit キーを warn ログへ出力。サービス用 pino に redact なし | `kiosk-rate-limit.service.ts:25-31`、`lib/logger.ts:14` | キーをダイジェスト化、pino redact 設定 |
| Medium | `/api/signage/content` と thumbnail/PDF ページが無認証で従業員名・持出情報を返す | `routes/signage/content.ts:18` | サイネージにも端末キー必須、項目限定 |
| Medium | Hermes 境界 policy の `regex:` と `/` を含む deny ルールが Hermes 設定へ変換時に落ちる | `scripts/private-pi5-hermes/lib/hermes_security_adapter.py:61` | 変換不能 policy は生成失敗に。egress をネットワーク側でも制限 |
| Medium | Ansible `host_key_checking = False`、サイネージ転送は `UserKnownHostsFile=/dev/null` | `infrastructure/ansible/ansible.cfg:4`、`signage_artifact_stage.py:2002` | 管理済み known_hosts か SSH host CA |
| Medium | 復元テストが `restore-encrypted.sh` の第 2 引数を無視し本番 DB `borrow_return` へ復元する | `scripts/server/restore-encrypted.sh:61`、`verify-production-security.sh:146,205` | 復元先引数を必須化、本番 DB を拒否 |
| Medium | Tailscale `curl \| sh`(root)と Hermes `install.sh` を checksum なしで実行 | `roles/common/tasks/tailscale.yml:23`、`tasks/private-pi5-hermes/install.yml:54` | 署名付きパッケージ、revision+checksum 固定 |
| Medium | PR でも動く `hermes-answer-cache` job に `packages: write` / `id-token: write` / `attestations: write` | `.github/workflows/ci.yml:687-699` | PR 検証を read-only job に分離 |
| Medium | DGX gateway helper: embedding key 未設定時に `/embed` が無認証、認証前に body を無制限に読む、`0.0.0.0:38081` | `scripts/dgx-local-llm-system/gateway-server.py:188,730` | キー必須化、認証先行、サイズ・時間制限 |
| Medium | mac ローカル override の PostgreSQL が既定パスワードで `5432:5432` 公開 | `docker-compose.mac-local.override.yml:11-15` | `127.0.0.1:5432:5432`、パスワード必須 |
| Medium | 端末バックアップを root の tar で共有 `/tmp` に生成、失敗時に残存 | `playbooks/backup-client-directory.yml:22-60` | 0700 の一時ディレクトリ、`block/always` で削除 |
| Low | ベースイメージ(`node:20-bookworm-slim`、`pgvector/pgvector:pg15`)と Actions(`@v7`、`@v4`)が digest / SHA 固定でない | `Dockerfile.api:65`、`docker-compose.server.yml:5`、`ci.yml:1751-1799` | digest / full SHA 固定 |
| Low | `.trivyignore` が ID のみで全イメージ共通に適用される | `.trivyignore`、`ci.yml:586,733,896` | イメージ別の抑止 |

CodeQL(GitHub)の open アラートも未解決: `services/hermes-answer-cache/runtime.py` / `maintenance.py` の path-injection 多数、`scripts/deploy/render-postgres-role-bootstrap.py:80` と `scripts/private-pi5-hermes/validate_boundary_policy.py:191` の秘密情報の平文ログ出力、`config_contract.py:88,102` の ReDoS、`apps/web/src/api/domains/measuring-instruments.ts:115` の request-forgery、loans return/cancel/delete と `part-measurement/sheets.ts:133` の rate-limit 欠落。

問題なしと確認した点: Pi5 API/Web コンテナは非 root・read-only・`cap_drop: ALL`、DB/API はホスト非公開、sudoers は限定+`visudo` 検証、OpenSSH はパスワード認証無効、UFW incoming deny、通常工場のキオスクは SPKI 固定、Hermes egress proxy は転送先・メソッド制限あり、`$queryRaw` 系はパラメータ化、本番フロントに `dangerouslySetInnerHTML` なし。

### 3.2 依存関係(pnpm audit / trivy / Dependabot)

| 区分 | パッケージ | 現状 | 修正版 | 備考 |
|---|---|---|---|---|
| 実行時 High | `csv-parse` | 5.6.0 | 7.0.2 | CVE-2026-85063 |
| 実行時 High | `uuid` | 8.3.2(exceljs / node-cron 経由) | 最新 | CVE-2026-41907 |
| 実行時 Moderate | `yaml` | 2.8.1(@fastify/swagger 経由) | 最新 | |
| 実行時 Moderate | `ajv` | 8.17.1(fastify 経由) | 最新 | ReDoS |
| web | `react-router` | 6.30.x | 7.18.0 | CVE-2026-53669 / 53666 |
| dev | postcss / nanoid / browserslist / js-yaml / vitest / eslint 8 系 | 多数 | | ビルド・CI 環境のみ |
| Python | gptcache 0.1.44 | | | CVE-2026-10812(Dependabot) |
| Python | pytest / setuptools / idna(uv.lock) | | | Dependabot |
| その他 | braces(`scripts/hermes-search/package-lock.json`)、sprintf-js | | | |

pnpm audit 合計: High 15 / Moderate 19 / Low 2。trivy の秘密情報検出はなし。`.trivyignore` と `security/dependency-exceptions.json` の抑止期限は **2026-10-31** で、Caddy 更新(下記)と同時に見直すこと。

### 3.3 サービス・ランタイムの最新性

| コンポーネント | 現状(リポジトリ上のピン) | 最新 / 状態 | 判定 |
|---|---|---|---|
| Node(API ランタイム) | `node:20-bookworm-slim` | Node 20 は **2026-04-30 EOL**。24 は 2026-10-20 に Maintenance LTS | **要更新**(24 へ) |
| Caddy(Dockerfile.web でソースビルド) | v2.11.4 / Go 1.26.9 | **v2.11.7**(2026-10-03)。2.11.5/6 で forward_auth 誤 upstream(GHSA-6365-7ppr-5r92)、path 正規化、Slowloris 修正。2.11.6 は H2 回帰あり | **要更新**(2.11.7) |
| Alpine(web ランタイム) | 3.23 | 3.24.2。3.23 は 2027-11 までサポート | 可 |
| PostgreSQL | `pgvector/pgvector:pg15`(rolling) | PG15 EOL 2027-11-11。pg17/pg18 タグあり。pgvector 0.8.2 で CVE-2026-3172 修正済(再 pull 要) | 計画的に pg17 へ |
| Prisma | 5.x | 6 系 / 7 系あり | 保守対象外になる前に更新計画 |
| hermes-agent(phase3) | `latest@sha256:23d7fdef…`(commit f58fcc81、2026-09-05) | v0.21.6(2026-10-08) | 更新推奨。`latest` タグ併記は digest が実効なので可 |
| Playwright | 1.56.1(API Dockerfile)、^1.51.1(package.json) | 1.64.0 | 更新推奨(同梱 Chromium) |
| Python agents | fastapi ^0.139、uvicorn ^0.29、websockets ^12、httpx ^0.27 | uvicorn/websockets は古い系統 | 更新推奨 |
| ESLint | 8 系 | EOL | dev のみ |
| Tailscale / Docker | install.sh / apt 最新 | Tailscale 1.104.1、Docker 29.9.0。TS-2026-011 → 1.102.3、Docker 29.5.1/29.6.1/29.7.0 に権限系修正 | **実機で確認が必要** |

### 3.4 パッケージ保守状況(npm / PyPI 照合)

| パッケージ | 現状 | 最新 | 要点 |
|---|---|---|---|
| **pnpm** | 9.15.9 | 10.34.6 | **9.x は 2026-04-30 EOL。** HIGH 多数(CVE-2025-69262/69263、CVE-2026-50015/50016/55487/55697/55698/59194〜59196/82392/82393 など 25 件)が 10.x でのみ修正。CI・開発機のインストール時挙動が対象 |
| prisma / @prisma/client | ^5.14.0 | 7.10.0 | 5.x は 5.22.0(2024-11)以降更新なし。6.x のセキュリティ修正も 2026-11-19 で終了 |
| csv-parse | 5.6.0 | 7.0.3 | CVE-2026-85063 は 7.0.2 のみ修正、5.x/6.x へのバックポートなし。即時更新できなければ `columns` と `group_columns_by_name` を無効化 |
| react-router-dom | ^6.30.6 | 7.18.4 | CVE-2026-53669(open redirect)は 6.x 未修正。移行まで `<Link>` / `useNavigate` へ渡す外部入力を検証 |
| playwright | ^1.51.1(lockfile 解決 1.56.1) | 1.64.0 | CVE-2025-59288(HIGH)は 1.55.1 で修正済みのため該当なし。8 マイナー遅れ |
| uuid(exceljs / node-cron 経由) | 8.3.2 | 14.0.3 | CVE-2026-41907 は 11.1.1 / 12.0.1 / 13.0.1 で修正、8〜10 系はバックポートなし。exceljs は 2023 年以降更新なし |
| @fastify/multipart / rate-limit | ^9.4.0 / ^10.3.0 | 10.1.3 / 11.2.1 | 旧メジャーは更新停止 |
| bcryptjs / otplib / node-cron / node-fetch / tesseract.js / ioredis / pino | 2.x / 12.x / 3.x / 2.7.0 / 5.1.1 / 5.x / 9.x | 3.0.3 / 13.5.0 / 4.6.0 / 3.3.2 / 7.0.0 / 6.0.0 / 10.4.0 | 既知 CVE なし。旧メジャーは保守終了 |
| eslint(dev) | ^8.57.0 | 10.12.0 | 8.x(2024-10)・9.x(2026-08)とも EOL |
| vitest(dev) | ^4.1.8 | 4.1.11 | CVE-2026-84373(mocker 経由の任意ファイル読取)は 4.1.11 で修正 |
| vite(dev) | 6.4.3 | 6.4.4 / 8.3.4 | 6.4 系はセキュリティ修正のみの枠 |
| React | ^18.2.0 | 19.3.0 | React 18 は 2024-12 にサポート終了(機能面の課題、緊急性なし) |
| Python: websockets / uvicorn / httpx | 12.0 / ^0.29 / ^0.27 | 17.2 / 0.54.0 / 0.28.1 | 既知 CVE なし。websockets は 5 メジャー遅れ |
| Python: python-dotenv | ^1.0.1 | 1.2.4 | CVE-2026-28684(symlink 追従で任意ファイル上書き)は 1.2.2 で修正 |
| Python: gptcache | 0.1.44 | 0.1.44 | 2024-08 以降更新なし。CVE-2026-10812(LOW)は未修正のまま |
| Python: SQLAlchemy / fastembed / faiss-cpu | 2.0.52 / 0.8.0 / 1.15.0 | 2.0.54 / 0.9.0 / 1.15.1 | 可 |

## 4. DGXSparkControlPlane

### 4.1 コード所見(確認済み)

| 深刻度 | 所見 | 場所 | 対策 |
|---|---|---|---|
| High | 業務互換プロキシが `Content-Length` を検証せず認証前に `rfile.read()`。負数も通る。Hermes search パスのみ 1MB 制限 | `agents/dgx/dgx_control/business_proxy.py:470-475`、`server.py:258,1078` | 認証先行、全経路で上限・読取期限・接続数制限 |
| Medium | Control API の identity が固定ヘッダー `x-control-proxy: private-pi-dashboard` と `tailscale-user-login` / `tailscale-app-capabilities` の値だけで決まる | `apps/control-api/src/app.ts:221-243` | proxy と API を Unix socket か専用認証情報で結び、利用者由来ヘッダーは proxy で除去 |
| Medium | private 互換起動がリース失効と競合(drain 後の再確認なし) | `business_proxy.py:418`、`arbiter.py:234`、`executor.py:127` | JobExecutor 経路へ集約、lease generation を確認 |
| Medium | `docker ps` 失敗を空結果=「inactive」と解釈し、業務コンテナ稼働中でも private lease を許可 | `probe.py:18,129`、`arbiter.py:197,479` | 失敗は `unknown` とし private plan を拒否 |
| Medium | SQLite 障害時に `due_private_stops()` が失敗し続け、既存 private workload が止まらない | `executor.py:167`、`server.py:1538` | DB 非依存の watchdog |
| Medium | Private Pi 向け Ansible play が `become: true` のまま hermes 所有 venv の python で guard を実行 | `playbooks/converge_private_pi_hermes.yml:5,34,235` | root 管理の `/usr/bin/python3 -I`、venv 呼び出しは `runuser -u hermes` |
| Medium | XiaoZhi OTA 応答に device token を平文で含み、HTTP/WS に TLS なし、host network | `integrations/private-hermes-voice/ota.py:25,78`、`server.py:1004` | HTTPS/WSS、専用ネットワーク隔離 |
| Medium | OTA の `ThreadingHTTPServer` がヘッダー解析前タイムアウトなし、`pids_limit: 128` を無認証で枯渇可能 | `ota.py:49-53,78` | 接続直後に期限、接続数上限、OTA を別プロセスへ |
| Medium | 通常の Hermes Discord セッションで外部記事読取と `life_context` / memory 書込みが同居(プロンプトインジェクション → 私的情報流出) | `hermes_karakeep_tool_config.py:17,201`、`private-karakeep-readonly/__init__.py:399-640` | 外部本文処理を権限分離した推論へ |
| Low | `/api/v1/overview` `/stream` `/events` `/jobs/:id` が無認証で lease・jobs(payload/result/error 含む)・監査情報を返す | `apps/control-api/src/app.ts:329-395` | 認証必須化か DTO で項目限定 |
| Low | Alexandria が `ALEXANDRIA_LLM_API_KEY` を設定 JSON(永続 volume)へ書き戻す | `integrations/alexandria/application-irodori.patch:29` | 永続化対象から除外 |
| Low | `apps/control-api/Dockerfile` が `node:24-bookworm-slim` タグ参照。GHCR 発行 workflow の Actions も `@v4` / `@v6` | `apps/control-api/Dockerfile:1,9`、`.github/workflows/images.yml:31-40` | digest / full SHA 固定 |

問題なしと確認した点: DGX 管理入口は `/healthz` 以外で principal 検証、SQL はパラメータ化、subprocess は argv 配列、PostgreSQL/Meilisearch/browserless はホスト非公開、他は 127.0.0.1 公開、VOICEVOX は mutable API 無効、SillyTavern は Basic 認証+CSRF 維持、polkit/sudoers は限定、CI に `pull_request_target` なし、モデルダウンロードは revision+SHA-256 固定。

### 4.2 依存関係(pnpm audit / trivy)

| 区分 | パッケージ | 現状 | 修正版 | CVE |
|---|---|---|---|---|
| **実行時 Critical** | `fastify` | 5.11.0 | **5.12.5 以上** | CVE-2026-76169(認証バイパス)、84428 / 84469 / 84504(検証バイパス)、18504 / 16732 / 92081 |
| 実行時 High | `fast-uri` | 3.1.5 / 4.1.2 | 3.1.8 / 4.1.5 | SSRF 系 |
| 実行時 High | `sharp` | 0.35.3 | 0.35.5 | |
| **Python Critical** | `sentence-transformers` | 5.1.1 | 5.6.0 | CVE-2026-68770 RCE |
| Python High | `transformers` | 4.57.1 / 4.48.3 | 最新 | CVE-2026-4372, 5241, 80047, 9856 RCE |
| Python High | `diffusers` | 0.35.1 | 0.38.0 | CVE-2026-44513, 45804 RCE |
| **npm Critical** | `simple-git` | 3.36.0(`@tobilu/qmd` git 依存経由) | 最新 | CVE-2026-102826〜102829 RCE |
| dev Critical | `tinypool` | 1.1.1(vitest 3.2.7 経由) | 最新 | RCE(dev のみ) |
| dev | nanoid、source-map-js | | | |

pnpm audit 合計: Critical 2 / High 18 / Moderate 7。control-api / dashboard / hermes_inference / comfyui 系 / alexandria の Dockerfile は root 実行(trivy DS002)。

### 4.3 サービス・ランタイムの最新性

| コンポーネント | 現状(ピン) | 最新 / 状態 | 判定 |
|---|---|---|---|
| Open WebUI | 0.11.0-slim(2026-07-27、digest 固定) | **0.12.0**(2026-10-10)。0.11.1 / 0.11.4 で session cookie 漏えい・認証バイパス(CVE-2026-87015)、SSRF(CVE-2026-87996)、権限昇格など 20 件超 | **最優先で更新** |
| nginx(portal) | `1.28-alpine`(legacy 系) | stable 1.30.5 / mainline 1.31.6。CVE-2026-42533(map+regex overflow)ほか 14 件は 1.30.4+ のみ修正 | **要更新**(1.30 系) |
| Meilisearch | v1.41.0(2026-03-30) | v1.54.3。API key 権限昇格 CVE-2026-57824 / tenant token 漏えい 57823 が 1.48.2 で修正(二次情報) | 要更新 |
| SillyTavern | 1.18.0(2026-05-03) | 1.19.0。1.18.0 で CVE-2026-44649(SSO ヘッダー認証バイパス)等 6 件修正済み | 更新推奨 |
| Karakeep | 0.33.1 | 0.33.2 | ほぼ最新 |
| browserless/chromium | ≈ v2.55.3(2026-08-04) | v2.57.0 | 更新推奨(Chromium 本体) |
| VOICEVOX engine | ≈ 0.25.2 | 0.25.2 | 最新 |
| PostgreSQL | `postgres:17-bookworm`(rolling) | 17.11。EOL 2029-11 | 可(再 pull で minor 追従) |
| Node(control-api / dashboard) | 24 | 24.21.0 | 可(Maintenance LTS) |
| Python(alexandria) | `python:3.10-slim-bookworm` | **3.10 は EOL(3.10.22 が最終)** | **要更新**(3.12 以上) |
| CUDA | 13.0.1-devel-ubuntu24.04 | 13.4.2 | 更新推奨 |
| ComfyUI | 0.37.0 / 0.31.0(commit 43cb4fff) | v0.39.0。0.28 以前の CVE-2026-56670〜56673 は両方で修正済み | 0.31 系は更新推奨 |
| llama.cpp | `9d34231`(2026-04-25)/ `4df29be4`(2026-08-16) | b11559。Cyera 系 CVE-2026-43622〜43632(b9058 以前対象)に `9d34231` が該当する可能性 | `9d34231` 側は更新推奨。RPC を公開していないか確認 |
| Playwright | 1.62.0 | 1.64.0 | 可 |
| hermes_inference Python | FlagEmbedding 1.3.5、peft 0.17.1、accelerate 1.10.1 | | 上記 CVE 群と合わせて更新 |

### 4.4 パッケージ保守状況(npm / PyPI 照合)

| パッケージ | 現状 | 最新 | 要点 |
|---|---|---|---|
| fastify | 5.11.0 | 5.12.5 | 7 件の advisory(HIGH 4 件は 5.12.2、残りは 5.12.1 / 5.12.5)。同一メジャーで更新可 |
| sharp | 0.35.3 | 0.35.5 | GHSA-rgj7-g3m4-5g8c(0.35.4)、GHSA-wq5f-xc86-pv6w(0.35.5)、いずれも HIGH |
| **vitest(dev)** | 3.2.7 | 4.1.11 / 5.0.3 | **3.x は保守終了。tinypool 1.1.1 の CRITICAL RCE(CVE-2026-104848 / 104849)は vitest 3 では修正版に到達できない。vitest 4 以上は tinypool 依存自体を削除済み** → 4.1.11 以上へ移行が解 |
| vite(dev) | ^7.0.0(lockfile 解決 7.3.6) | 7.3.7 | **解決版 7.3.6 は CVE-2026-53571 / 39363(HIGH)の修正前。** 7.3.7 へ更新 |
| pnpm | 10.14.0 | 10.34.6 | HIGH 26 件が 10.34.5 までに修正(CI・開発機) |
| transformers | 4.57.1 / 4.48.3 | 5.19.0 | **4.x は 4.57.6(2026-01)で終了、バックポートなし。** CVE-2026-4372(5.3.0)、5241(5.5.0)、9856(5.10.0)、80047(5.17.0 以降)。4.48.3 はさらに約 13 件。FlagEmbedding 1.4.2 / peft 0.21.2 と同時に上げる(API 破壊変更あり) |
| sentence-transformers | 5.1.1 | 6.1.0 | CVE-2026-68770(CRITICAL)は 5.6.0 で修正 |
| diffusers | 0.35.1 | 0.41.0 | CVE-2026-45804 / 44513 / 44827 は 0.38.0 で修正 |
| accelerate | 1.10.1 | 1.15.0 | CVE-2026-69112(path traversal、MODERATE)は **最新でも未修正**(PR 未マージ)。更新しても残る |
| @tobilu/qmd(git 依存) | 04e4dbd8(2026-09-09) | HEAD 93d211f9 | 89 コミット遅れ。タグ・リリースなしで更新追従が難しい。simple-git CVE はこの経由 |
| faster-whisper / opuslib / websockets | 1.1.1 / 3.0.1 / 12.0 | 1.2.1 / 3.0.1(2018)/ 17.2 | opuslib は停滞 |

## 5. GitHub リポジトリ設定

| 項目 | RaspberryPiSystem_002(公開) | DGXSparkControlPlane(非公開) |
|---|---|---|
| Dependabot alerts | 有効(上記と一致) | **無効** |
| Code scanning(CodeQL) | 有効、open アラートあり | **無効** |
| Secret scanning | 有効 | **無効** |
| ブランチ保護(main) | **未設定**(API 404) | 未設定(GitHub Pro 必要、README に記載) |

DGX 側は少なくとも Dependabot alerts と secret scanning を有効化すること(非公開リポジトリでも無料で有効化できる)。

## 6. 推奨する対応順序

1. TalkPlaza 認証情報のローテーションと Vault 暗号化(当日)
2. DGX `fastify` / `fast-uri` / `sharp` 更新、Open WebUI 0.12.0 へ(今週)
3. DGX Python 依存(sentence-transformers / transformers / diffusers)と `@tobilu/qmd` の simple-git 更新(今週)
4. RPi MFA 2 件と Gmail HTML→PDF の JS 無効化・ネットワーク遮断(今週)
5. DGX 業務プロキシの認証先行・body 上限、Control API の proxy 認証(2 週間)
6. Node 20 → 24、pnpm 10.34.6、Caddy 2.11.7、nginx 1.30、python 3.12、vitest 4(DGX)、`.trivyignore` 期限(2026-10-31)の見直し(2 週間)
7. Pi4 エージェントの privileged 解除、Hermes ユーザーの docker グループ解除(設計変更が必要、1 か月)
8. 残りの Medium(TLS 検証、レート制限、WebRTC、ログ redact、無認証ルート)を順次
9. 実機で `tailscale version` / `docker version` / 稼働イメージ digest を確認し、本レポートと突き合わせる

## 7. 付録: 使用ツールと出力

- Codex: `gpt-6.1-sol` / reasoning `high` / `-s read-only` / `service_tier=fast`(5 本とも fast 警告なし)
- `trivy fs --scanners vuln,secret,misconfig`、`pnpm audit`(DGX は `corepack pnpm audit`)
- `gh api repos/.../dependabot/alerts`、`code-scanning/alerts`、`branches/main/protection`
- 最新版照合: GitHub Releases、Docker Hub、npm registry、PyPI、osv.dev / GitHub Advisory、endoflife.date、各プロジェクトの security advisories(2026-10-12 時点)
