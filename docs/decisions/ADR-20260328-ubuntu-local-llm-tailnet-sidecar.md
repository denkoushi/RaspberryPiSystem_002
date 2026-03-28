Title: ADR-20260328: Ubuntu LocalLLM を Tailscale sidecar + `tag:llm` で分離公開する
Status: accepted
Context:
  - Ubuntu PC は日常的な実験用途にも使っており、ホストOS全体を tailnet へ参加させたくない。
  - 既存の LocalLLM は `~/llama.cpp` を手動起動し、`--host 0.0.0.0 --port 8081` で LAN に待ち受けていた。
  - 本システムでは Pi5 だけが LocalLLM を利用し、Pi4 や運用 Mac から Ubuntu へ直接到達できない構成にしたい。
  - 文書要約などの内部用途では、クラウドLLMよりも tailnet 内のプライベート推論サーバが望ましい。
Decision:
  - Ubuntu ホストの既存実験環境は残しつつ、本システム専用 LocalLLM は **専用 Docker Compose スタック**へ分離する。
  - Tailnet への参加はホストOSではなく **Tailscale sidecar コンテナ**で行い、`llama-server` と `nginx` は `network_mode: service:tailscale` で同一ネットワーク名前空間を共有する。
  - tailnet 上のノードは `ubuntu-local-llm-system` とし、タグは **`tag:llm`** を使用する。
  - `llama-server` は **`127.0.0.1:38082`** にのみ待ち受け、tailnet 向けの入口は **`nginx:38081`** に限定する。
  - `nginx` は **`X-LLM-Token`** を検査し、正しいトークンがある場合のみ `llama-server` へプロキシする。
  - Tailscale ACL は **`tag:server -> tag:llm: tcp:38081`** のみ許可し、`tag:admin` / `tag:kiosk` / `tag:signage` からの直接到達は許可しない。
  - 本システム専用のモデルは `localllm` 専用ディレクトリへコピーし、既存ユーザーのホーム配下を直接参照しない。
Alternatives:
  - **Ubuntu ホスト全体を tailnet へ参加**: 設定は簡単だが、実験用途のホスト全体が tailnet に露出し、境界が曖昧になるため不採用。
  - **既存の `8081` を共用**: 実験用と本システム用の運用が混ざり、切り分けが難しくなるため不採用。
  - **`llama-server` を直接 tailnet に公開**: ヘッダ認証や入口制御を付けにくいため不採用。
Consequences:
  - **良い影響**:
    - ホストOSの他用途と、本システム専用 LocalLLM のネットワーク面を分離できる。
    - Pi5 のみが LocalLLM へ到達する ACL を設計しやすい。
    - 内部ポート `38082` と外部入口 `38081` を分けることで、認証・監視・切り分けが単純になる。
  - **悪い影響**:
    - Tailscale sidecar / `nginx` / `llama-server` の 3 コンテナ構成となり、構成がやや複雑になる。
    - `docker compose config` や `tailscale up` の扱いを誤ると、auth key がログや端末に露出しやすい。
    - `tag:llm` を一度有効化したら、`TS_EXTRA_ARGS` に `--advertise-tags=tag:llm` を残さないと再起動ループになりうる。
References:
  - `docs/runbooks/local-llm-tailscale-sidecar.md`
  - `docs/security/tailscale-policy.md`
  - `docs/security/system-inventory.md`
  - `docs/knowledge-base/infrastructure/security.md` (KB-317)
