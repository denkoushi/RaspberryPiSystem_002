# KB-217: Gmail API 429エラー - クールダウン解除直後の再発

**日付**: 2026-02-24

**事象**:
- CSVインポート実行時に `gmail.users.messages.list` が **429** を返し、処理が defer（後回し）になる
- **429の詳細（reason / Gmail側メッセージ / Retry-Afterヘッダ）をログに出していないため**、この時点では「どの制限に当たっているか」を断言できない

**症状**:
- `GmailRequestGateService` が 429 を検知すると `cooldownUntil` をDBへ永続化し、以後はクールダウン中は実リクエストを投げず defer する
- 実測（Pi5 / DB `borrow_return` の `GmailRateLimitState`）:
  - `last429At`: `2026-02-24 03:51:01.883+00`
  - `cooldownUntil`: `2026-02-24 04:51:02.268+00`
  - `lastRetryAfterMs`: `3600000`（60分）
- 実測（APIログ / ゲートの429検知）:
  - `2026-02-24T03:35:01.854Z`: 429検知 → `effectiveRetryAfterMs=900000`（15分）
  - `2026-02-24T03:51:01.888Z`: 再429検知 → `effectiveRetryAfterMs=3600000`（60分）

**調査結果**:

1. **確定していること（事実）**:
   - 429は `gmail.users.messages.list` で発生している
   - 429を契機にクールダウンが設定され、スケジュール実行は defer される（DBとログで一致）

2. **未確定のこと（追加の証拠が必要）**:
   - Gmailが返した 429 の **reason**（例: `userRateLimitExceeded` / `rateLimitExceeded` 等）
   - `Retry-After` がヘッダ由来なのか、本文の “Retry after <timestamp>” 由来なのか
   - CSVインポート以外の処理（例: ゴミ箱クリーンアップ等）が同時間帯に Gmail API を叩いているか

3. **原因を断言可能にするための計測（必要条件）**:
   - 429検知地点（`GmailRequestGateService`）で、PII/トークンを出さずに
     - `apiErrorReason`
     - `apiErrorMessage`
     - `retry-after` ヘッダ（秒）
     - `status`
     をログ出しする（最小変更）

4. **段階的クールダウン延長（事実）**:
   - 429が短時間で再発すると、待機が 15分 → 60分 → 180分 → 720分 と引き上がる

**根本原因**:
- **未確定**（reason等が取れていないため断言不可）

**解決方法（検討中）**:
1. **マージン時間の追加**: `cooldownUntil` の時間が過ぎた後、追加のマージン時間（例: 1-2分）を設けてから実行を開始する
2. **プローブリクエスト**: クールダウン解除後、軽量なAPI呼び出し（例: `users.getProfile`）でレート制限が解除されているか確認してから実行を開始する
3. **段階的再開**: クールダウン解除後、最初は少量のリクエストから開始し、成功を確認してから通常のバッチサイズに戻す

**現在の対処**:
- `GmailCooldownStateMachine` が段階的にクールダウン時間を延長することで、再429のリスクを低減
- ただし、根本的な解決には、上記の解決方法のいずれかを実装する必要がある

**参照**:
- [KB-216（Gmail API 429）](./api.md#kb-216-gmail-apiレート制限エラー429の対処方法)
- [Gmail自動運用プロトコル進捗](../plans/gmail-auto-protocol-progress.md)
- [gmail-cooldown-state-machine.ts](../../apps/api/src/services/backup/gmail-cooldown-state-machine.ts)
- [gmail-request-gate.service.ts](../../apps/api/src/services/backup/gmail-request-gate.service.ts)
