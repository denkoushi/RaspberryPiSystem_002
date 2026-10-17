# API の 1 台構成の前提（プロセスのメモリに持つ状態）

API サーバーは Pi5 上で 1 プロセスだけ動かす前提で作られている。いくつかの状態を DB ではなくプロセスのメモリに持っているため、API を 2 台以上（ロードバランサーの後ろに複数インスタンス）にすると、ログイン連携や通話が失敗し、試行回数の制限が弱まる。再起動するとこれらの状態は消える。

この文書は、複数台構成を検討するときに、先に直す必要がある箇所の一覧である。現状は 1 台構成なので、コードは変えていない（[コード保守性の改善計画](../plans/code-health-refactor-execplan.md) の段階8）。

- 調べた日: 2026-10-17（main 53fe3ea9 時点、`apps/api/src` のテスト以外）
- パスは `apps/api/src/` からの相対パス。行番号は調べた時点のもの。

## 定期処理（スケジューラー）

`bootstrap/scheduler-leader.ts` は、PostgreSQL の advisory lock を取れた 1 プロセスだけで定期処理（バックアップ、CSV 取込、Gmail 取込、OCR、アラート、サイネージ描画、ナレッジ処理など。一覧は `bootstrap/start-post-listen-schedulers.ts`）を動かす。ただし有効になるのは `PI5_SCHEDULER_LEADER_ENABLED=1` のときだけで、`infrastructure/docker/docker-compose.server.yml` の既定は `false`。無効のまま複数台にすると、すべての定期処理が台数分動く。

リーダー制御の外で動くもの:

| 場所 | 内容 | 複数台での影響 |
| --- | --- | --- |
| `services/business-hermes/hermes-search-trial.service.ts`（`onReady` から起動） | 業務 Hermes 検索の索引更新と夜間処理の `setInterval` | 全台で動く |
| `services/imports/import-schedule-admin.service.ts` の `backgroundRuns` | 管理画面の「今すぐ実行」の二重起動防止 | 別の台の定期実行と重なり得る |

## 複数台で正しく動かなくなるもの（先に DB か Redis へ移す必要がある）

| 場所 | メモリに持つもの | 複数台での影響 |
| --- | --- | --- |
| `services/oauth-state.store.ts` | Dropbox・Gmail 連携の OAuth state（10 分） | 戻り先が別の台に当たると「Invalid or expired OAuth state」で失敗する |
| `lib/kiosk-settings-pin.ts` | キオスク設定 PIN の失敗回数 | 台数分だけ多く試せる |
| `routes/item-inventory/index.ts` | 在庫設定パスワードの失敗回数 | 同上 |
| `plugins/rate-limit.ts` | `@fastify/rate-limit` の回数（保存先を指定していないのでメモリ）。`/auth/login` などの制限も含む | 制限が台数倍に緩む |
| `routes/webrtc/signaling.ts`、`routes/webrtc/call-store.ts` | 通話の接続先と通話状態 | 発信側と着信側が別の台につながると通話できない |
| `services/inference/runtime/local-llm-runtime-command-queue.ts` | DGX の LLM 起動・停止の直列化キュー | 台ごとに矛盾する起動・停止を送り得る |
| `services/system/dgx-resource/dgx-resource.policy-store.ts` | DGX の利用方針（`business_first` など）と履歴 | 台ごとに方針が食い違う。再起動で既定値に戻る |
| `services/business-hermes/hermes-search-trial.service.ts` | 検索試行の会話（10 分）、作業用子プロセスと待ち行列 | 続きの質問が別の台に行くと文脈が消える |

`services/security/rate-limiter-store.ts`（キオスクの電源・サポート操作の回数制限）は、`RATE_LIMIT_REDIS_URL` を設定すれば Redis を使う。未設定ならメモリ。

## 重複や表示の欠けで済むもの

業務 Hermes の相談の取消・二重実行防止（`business-hermes-consultation.service.ts`）、LLM 実行枠の貸し出し（`provider-local-llm-runtime.controller.ts`）、作業要領 Gmail 取込の処理中一覧、図面・サムネイル生成の二重実行防止、CSV ダッシュボード取込のロック（DB 側でも保護あり）、サイネージ端末の最終取得時刻（管理画面の受信状況表示）。

## 古いデータが残るだけのキャッシュ

生産スケジュール（順位ボード、負荷調整、研削計画ボード、検索）、拠点一覧、ネットワークモード、メトリクス集計、稼働信号の日次集計などのキャッシュ。別の台で書き込むと、期限が切れるまで古い値が見える。

## 確認済みで問題ないもの

- 組立手順書の編集リースは DB に保存している（`services/assembly/assembly-procedure-document-edit-lease.service.ts`）。
- 業務データの同時更新の保護は DB の制約と行ロックで行っている（[競合制御](./concurrency-control.md)）。

## 複数台にするときの順番（案）

1. `PI5_SCHEDULER_LEADER_ENABLED=1` にし、業務 Hermes の定期処理もリーダー制御の内側へ移す。
2. OAuth state、PIN とパスワードの失敗回数、回数制限を DB か Redis へ移す。
3. 通話、DGX の方針とキュー、検索試行の会話を、共有できる保存先へ移すか、同じ台へ振り分ける（sticky session）。
