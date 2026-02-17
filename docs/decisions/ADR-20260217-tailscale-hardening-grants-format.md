Title: ADR-20260217: Tailscale ACL grants形式の採用と横移動面削減
Status: accepted
Context:
  - Tailscale VPN内で端末間の横移動（lateral movement）が可能な状態だった
  - Pi4キオスクのNFC Agent（`0.0.0.0:7071`）がTailnet上でアクセス可能で、認証なしの制御API（`reboot`、`poweroff`）が暴露されていた
  - Tailscaleのデフォルト設定（Allow all）で、端末間の通信が全て許可されていた
  - Tailscale管理画面の新しい形式では`grants`を使用し、`acls`形式（旧形式）とはポート指定の方法が異なる
Decision:
  - **Tailscale ACLの`grants`形式を採用**し、ポート単位の制限を適用する
  - **NFC WebSocketのlocalhost優先化**を実装し、kiosk端末は`ws://localhost:7071/stream`を優先、失敗時は`wss://<Pi5>/stream`へフォールバック
  - **段階的なACL適用**を実施:
    1. Phase 2-0: タグ付け（`tag:admin`、`tag:server`、`tag:kiosk`、`tag:signage`）
    2. Phase 2-1: ACL最小化（`grants`形式でポート単位の制限）
    3. Phase 2-2: `kiosk:7071`閉塞（Tailnet上の横移動面削減）
Alternatives:
  - **ZTNAの新規実装**: Tailscaleの標準機能（ACL/Tags）で十分なため、新規実装は不要と判断
  - **acls形式（旧形式）の継続**: Tailscale管理画面のデフォルトが`grants`形式のため、新しい設定では`grants`形式を使用
  - **NFC Agentの認証追加**: 認証追加も検討したが、localhost優先化によりTailnet上の露出を削減する方がシンプル
Consequences:
  - **良い影響**:
    - Tailnet上の横移動面が削減され、セキュリティが向上
    - 端末台数が増えても、個体名ではなく役割（ロール/タグ）で運用できる
    - NFC WebSocketのlocalhost優先化により、Pi5経由のプロキシ負荷が軽減
  - **悪い影響**:
    - ACL設定の変更時は、各段階で動作確認が必要（段階適用の手間）
    - `grants`形式のポート指定方法（`ip`フィールドで`tcp:22`のように指定）を理解する必要がある
    - WebRTC通話は工場LAN内（`local`モード）でのみ動作（Tailnet上では通話不可）
References:
  - `docs/security/tailscale-policy.md`
  - `docs/security/system-inventory.md`
  - `docs/knowledge-base/infrastructure/security.md` (KB-264, KB-265)
  - `apps/web/src/hooks/useNfcStream.ts`
  - `infrastructure/ansible/templates/web.env.j2`
  - `infrastructure/ansible/inventory.yml`
