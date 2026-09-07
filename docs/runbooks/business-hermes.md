# 業務Hermesの独立運用

業務Hermesは、組立キオスクの案内と管理者向けNG提案だけを処理する、業務Pi5上の専用Dockerサービスです。Private Pi5 Hermes、`LOCAL_LLM_*`、`INFERENCE_PROVIDERS_JSON`、Privateの起動停止API、履歴、記憶、skills、認証情報は共有しません。業務APIの専用設定が揃わない場合は案内を `unavailable` とし、締付操作を継続します。本番mockはありません。

業務相談チャットは `business-hermes-chat` という別の固定digestコンテナで提供します。既存の組立ガイド用 `business-hermes` の設定・volume・APIキー・会話履歴は変更せず、相談チャットは専用のAPI_SERVER_KEY、DGXトークン、MCP APIキー、volumeを使います。業務Pi5では承認済みの相談機能を有効にしています。`vault_business_hermes_chat_enabled` で明示的に上書きできます。専用APIキーとMCPキーは、個別のVault値がなければ既存のVault配信済み業務キーから異なる用途ラベルで導出します。秘密値はGitへ保存しません。

## 構成

`business-hermes` は公式 `nousresearch/hermes-agent` ARM64イメージをdigest固定で起動し、専用volume `/opt/data` に設定と業務セッションを保持します。設定で `memory_enabled`、`user_profile_enabled` を無効化し、`skills`、`memory`、`session_search` toolsetも無効化するため、Private Pi5の記憶・skills・過去会話検索を共有しません。Docker socket、ホストの作業ディレクトリ、Private Pi5のパスはマウントしません。ルートファイルシステムはread-only、capabilityは全drop、CPU 1 core、メモリ1 GiB、PID 128に制限します。

Hermes本体と業務APIは内部Docker networkだけで接続し、Hermesにhost portを公開しません。Hermesは公式CLIをentrypointにして `gateway run --no-supervise` をUID 10000でforeground実行します。新規専用volumeは公式imageの `/opt/data` 所有権をcopy-upしてそのまま使うため、initコンテナや追加capabilityを必要としません。外向き通信は専用egress proxyを経由します。DGX選択時は `100.118.82.72:38081` の `POST /v1/chat/completions` だけをHTTP absolute-formで許可し、`/start`・`/stop`・別host・redirectは拒否します。OpenAI選択時は `api.openai.com:443` のCONNECTだけを許可し、DGX HTTP経路は拒否します。Hermesの設定は `terminal.backend: local` とし、Docker実行ソケットを要求しません。

モデルは公式Hermesの `providers` 設定と `HERMES_INFERENCE_PROVIDER` で明示選択します。初期値は `business-dgx`、`system-prod-primary` です。DGXの推論トークンは既存業務LocalLLMの `vault_api_local_llm_shared_token` を再利用し、Hermesには推論用トークンだけを渡します。OpenAIを選ぶ場合だけ専用 `business_hermes_openai_api_key` を要求します。どちらも選択先が失敗した時にもう一方へfallbackしません。資格情報はAnsible Vault変数から業務Pi5上のroot専用 `/etc/raspi-business-hermes/runtime.env` へ `0600` で生成します。

DGXの起動・ready待ち・leaseは既存APIの`photo_label` provider runtimeを`business_hermes`用途で共有します。業務用途のreleaseでは既存stop抑止ポリシーを使うため、通常の案内ごとにDGXを停止しません。初回cold startや他用途の解放直後の待ち時間をゼロにはせず、専用prewarm loopやPrivate Pi5のkeep-warm timerは業務サービスへ持ち込みません。

初回cold startや他用途の解放後の予熱は、DGX Control PlaneのLease対応中央keep-warm (`dgx-control-keep-warm.timer`) の責務です。中央runnerはDGX側Arbiterのmaintenance LeaseでPrivate Leaseや業務要求を確認し、競合時は延期、状態不明時はfail-closedにします。中央設定・有効状態は `/Users/tsudatakashi/DGXSparkControlPlane` の管理範囲であり、このリポジトリのAPI起動時処理から直接開始しません。中央の既定profile IDと業務APIのmodel alias (`system-prod-primary`) の対応、および実機timerの有効状態は実機受入時に確認します。

## 有効化

Ansibleのserver inventoryで次のVault変数を設定します。秘密値は問い合わせやログに出さず、既存のVault運用へ登録します。

```yaml
vault_business_hermes_enabled: true
vault_business_hermes_api_key: <専用Hermes API server bearer key>
vault_api_local_llm_shared_token: <既存業務DGX推論トークン>
# 初期値はdgx。OpenAIへ切り替える場合だけopenaiを明示する。
# vault_business_hermes_provider: openai
# OpenAIを明示選択する場合だけ必要
# vault_business_hermes_openai_api_key: <業務Hermes専用OpenAI API key>
# OpenAIを明示選択する場合はモデルIDも必須（既定値なし）
# vault_business_hermes_model: <OpenAI APIで利用するモデルID>
```

通常の業務API向け変数はinventoryで内部値へ解決されます。

```yaml
api_business_hermes_base_url: http://business-hermes:8642
api_business_hermes_model: system-prod-primary # DGX選択時は既存photo_labelモデル。OpenAI選択時はVaultで明示したモデルID。
```

相談チャットを有効にする場合は、既存ガイド用とは別に次のVault変数を設定します。`vault_business_hermes_chat_mcp_url` はチャットコンテナから到達できる内部APIのMCPエンドポイントに合わせます。既定値は `http://api:3000/api/internal/business-hermes/mcp` です。

```yaml
vault_business_hermes_chat_enabled: true
vault_business_hermes_chat_api_key: <相談チャット専用API server bearer key>
vault_business_hermes_chat_mcp_api_key: <業務MCP専用API key>
# 必要な環境では内部APIの実サービス名/ポートへ上書きする。
# vault_business_hermes_chat_mcp_url: http://api:3000/api/internal/business-hermes/mcp
```

設定反映後の起動対象は、既存ガイドと別profileです。

```bash
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/docker-compose.phase3.yml --profile business-hermes-chat up -d business-hermes-chat-egress business-hermes-chat
```

このprofileを指定しない通常のCompose起動では相談チャットは起動しません。MCP接続は業務Hermes内部ネットワーク上のAPIだけに向け、DGX推論は専用egress sidecarの許可済み `/v1/chat/completions` 経路を通します。既存ガイド用サービスのprofile、設定、volumeはそのままです。

イメージは `nousresearch/hermes-agent:latest@sha256:23d7fdefc42ef4f874938835dcc9543468b45c3fe082415095ab48056c56c32a`、egress proxyは `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` を使用します。更新時は公式multi-arch indexとPi5上のARM64 manifestを確認し、digestを差し替えてCIを通します。

## ローカル検証

proxyの実socket契約は次で確認します。

```bash
node --test infrastructure/docker/business-hermes-egress/proxy.test.mjs
```

Composeは、通常profile（業務Hermes無効）と `business-hermes` profile（runtime envをテスト用に差し込む）の両方を `docker compose config --quiet` で検証します。固定imageの新規volumeで本体health、未認証APIの401、正常停止とcleanupまで確認し、実OpenAIキーは使いません。

## 標準deployとrollback

Private Pi5へは接続しません。標準の変更分類、CI必須ジョブ、正確なSHAの成功を確認した後、監督レビューを経て業務Pi5だけを対象にします。

```bash
scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi5
scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --detach --limit raspberrypi5
scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --status <RUN_ID>
```

release_pi5は業務Hermesのdigestイメージを先にpullし、proxyとHermesのhealthを待ってから候補APIを切り替えます。Hermesの起動またはhealthが失敗した場合は候補トラフィックを切り替えず、従来のAPI/Webを残します。切替後にAPI/Webまたはスケジューラが失敗した場合は、標準release_pi5の旧slot復旧を使います。Hermesは独立サービスなので、業務案内が停止しても締付業務は継続します。

fresh releaseの開始時には既存の業務Hermesコンテナ状態を取得します。既存コンテナのdigestが今回のreleaseと違う場合は置換せず、API/Webのreleaseを失敗させて旧Hermesを保持します。既存コンテナが停止中だった場合、候補API/Webの検証失敗で新たに起動したHermesを停止して元の停止状態へ戻します。既存コンテナがない状態で新規起動した場合は、同じ失敗経路で新コンテナを削除します。API/Webのrollbackは業務Hermesのrollback済みを意味せず、Hermesの状態復旧はこの専用処理で確認します。

有効化フラグを無効にする場合、既存の業務Hermesは自動削除・停止せず現在状態を保ちます。停止・再開は業務Pi5だけを対象に、同じ標準Compose/release手順で明示的に実施し、Private Pi5へは操作しません。

## 確認項目

実機確認では、管理者がテスト専用作業セッションで締付NGイベントを1件作り、キオスクに提案本文が表示されないこと、管理画面のADMINだけが根拠文書・ページ・対象・短文を確認できることを確認します。業務操作を止めた状態でAIコンテナを停止し、案内が利用不可になって締付操作が成功することも確認します。別端末キー、別作業者、画面revision変更の応答が混ざらないことを確認します。実データのNG履歴を品質記録へ作る手順は使用せず、テスト用データだけを使います。

現時点ではVaultパスワード、Luna/OpenAIキー、Pi5へのdeploy、実OpenAI推論、実端末の複数利用者検証、DGX中央timerの実機有効状態、中央keep-warmのprofile IDと`system-prod-primary`の対応確認は未実施です。ローカル固定imageの本体healthと未認証拒否は検証済みです。


## フェーズ1の相談チャット検証状況（2026-09-07）

既存ガイドと分離した固定Hermes・DGX・実装API・分離DBで、自然文の検索、
訂正、担当者を変えた再開、案件分離、確認ボタン、認証付き写真、停止後の
復帰を検証した。業務データは合成fixtureを使用し、本番反映はまだ行っていない。
最新の検証記録と残条件は[フェーズ1計画](../plans/business-hermes-butler-phase1-execplan.md)を参照する。

対話姿勢はSOUL、項目の意味・正式な根拠はContext、調査方法はSkillで管理する。
API側は構造化応答・案件保存・認証・根拠カードを担う。model.max_tokensは
回答と案件状態の途中切れを避けるため1600。画像能力の合成probeは成功したが、
業務チャットは付随本文と写真カードを利用し、画像の視覚的読取りは行わない。
応答速度の最適化は利用者の実機体感後に判断する。

### 相談用Hermesの標準リリース

`release_pi5` が専用設定と永続candidate envを準備し、新APIへの切替後に
相談用egressとHermesを起動します。安定gatewayは専用bridgeへ `gateway`
のDNS alias付きで接続し、MCPはこのgateway経由で公開中APIへ届きます。
設定は変更前のバックアップを保持し、失敗時は設定・既存コンテナの稼働状態を
復旧します。新規コンテナだけを除去し、相談volumeは削除しません。
復旧処理が失敗した場合も既存APIのrollbackを続け、調査用バックアップを保持します。

実行は通常と同じ `scripts/update-all-clients.sh` の `--print-plan` と
`--limit raspberrypi5 --detach` を使います。独立した手動Compose起動は不要です。
