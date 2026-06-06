# KB-388: Cursor `state.vscdb` 破損・肥大化と外部SSD運用下での復旧（2026-06-06）

- **Status**: reference（2026-06-06 · 復旧完了 · 監視継続中）
- **Related**: [mac-storage-migration](../guides/mac-storage-migration.md) · [KB-212 §チャットログ削除](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除) · [development §Cursor復旧後](../guides/development.md#cursor-状態db復旧後の-agent-作業2026-06-06) · [`EXEC_PLAN` §Cursor復旧](../EXEC_PLAN.md#cursor-state-db-recovery-2026-06-06)

## Context

- **いつ**: 2026-06-06 朝（JST 想定）
- **どこ**: Mac 開発端末（メモリ 16GB）· Cursor の Application Support / `.cursor` を **外部SSD**（`/Volumes/SSD01`）へシンボリックリンク逃がし運用中
- **背景**: Chrome + Cursor + Codex 同時起動で Mac が重く・フリーズすることがあった。内蔵SSD容量圧迫回避のため Cursor データを外部SSDへ移行済（[mac-storage-migration](../guides/mac-storage-migration.md)）

### 外部SSD上の実体パス（当時）

| 論理パス | 実体 |
|----------|------|
| `~/Library/Application Support/Cursor` | `/Volumes/SSD01/MacOffload/Cursor/ApplicationSupport` |
| `~/.cursor` | `/Volumes/SSD01/MacOffload/Cursor/DotCursor` |

**重要**: 本障害は **Raspberry Pi 本番システム・ローカル Git リポジトリ・ソースコードとは無関係**。壊れたのは Cursor IDE 内部の状態DB領域。

## Symptoms

| 症状 | 詳細 |
|------|------|
| Cursor が重い / フリーズ | Chrome・Codex 同時起動時に顕著。起動後の応答遅延 |
| 保存領域が異常に大きい | Cursor 配下 **約 83GB** |
| `state.vscdb` 肥大 | **約 42GB**（`User/globalStorage/state.vscdb`） |
| backup も肥大 | **約 35GB**（`state.vscdb.backup`） |
| ログに SQLite 破損 | 大量の `SQLITE_CORRUPT: database disk image is malformed` |

### ログ例

```text
SQLITE_CORRUPT: database disk image is malformed
```

破損箇所は `cursorDiskKV` 付近。`agentKv:blob` · `bubbleId` など **Agent / Composer / チャット履歴系**の大きな KV が多かった（[KB-212](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除) と同型の保存構造）。

### 調査時のメモリ状況

- Mac メモリ **16GB**
- 調査時点では **スワップはほぼ出ていなかった**
- 常時メモリ不足より、**壊れて肥大化した状態DBの読み書きコスト**が主因と判断

## Investigation

| 仮説 | 検証 | 結果 |
|------|------|------|
| プロジェクト / Git / ソースが破損 | リポジトリ・未コミット変更・`git status` 確認 | **REJECTED** — 正常 |
| 外部SSDそのものの故障 | 退避後の新 DB 作成・integrity_check | **INCONCLUSIVE** — 単独では断定不可。I/O 遅延は再発リスク要因 |
| `state.vscdb` 破損 + 肥大化 | サイズ計測・ログ・退避後の新 DB サイズ | **CONFIRMED** |
| Agent/Composer 履歴の蓄積 | `cursorDiskKV` の blob キー | **CONFIRMED**（KB-212 と整合） |

## Root cause（結論）

**Cursor の SQLite 状態DB（`state.vscdb`）が破損しつつ肥大化**し、Cursor がその DB を頻繁に読み書きするたびに I/O とエラー処理が増え、**起動遅延・フリーズ・高メモリ使用**につながった。

外部SSD運用は容量圧迫回避に有効だが、Cursor は `state.vscdb` へ **細かい高頻度 I/O** を行うため、**外部SSDの遅延・スリープ・一時切断**が再発要因になり得る（今回の直接原因は破損DBと判断）。

## Fix（実施した対策）

### 方針

- **削除せず退避**（ロールバック可能）
- **プロジェクト・設定・拡張機能は触らない**
- Cursor 再起動で **新しい正常な `state.vscdb` を再生成**させる

### 手順（要約）

1. **Cursor を完全終了**
2. 退避スクリプト実行（Codex 側で作成済み）:

   ```text
   /Users/tsudatakashi/Documents/Codex/2026-06-06/mac-chrome-cursor-codex-cursor/outputs/cursor_state_db_recovery.command
   ```

3. 退避対象（`User/globalStorage/` 配下）:
   - `state.vscdb`
   - `state.vscdb.backup`
   - `state.vscdb-shm`
   - `state.vscdb-wal`

4. **退避先**:

   ```text
   /Volumes/SSD01/MacOffload/Cursor/ApplicationSupport/User/globalStorage/recovery-20260606-090149
   ```

5. **退避サイズ**: **76GB**
6. **Cursor 再起動** → ログイン画面から開始（想定内）

### 処置後の確認

| 項目 | 結果 |
|------|------|
| 新 `state.vscdb` サイズ | **約 1–2MB** |
| `state.vscdb-wal` | **約 4–5MB** |
| `sqlite3 … 'PRAGMA integrity_check;'` | **`ok`** |
| リポジトリ再オープン | 構成・技術スタック・未コミット変更・直近開発状況を **読み取り可能** |

## 引き継がれているもの / 失われたもの

### 残る（本プロジェクト開発に必要）

- ローカルリポジトリ（`/Users/tsudatakashi/RaspberryPiSystem_002`）
- ソースコード・`docs/`・Git 履歴
- **未コミット変更（WIP）** — 破棄しない
- `settings.json` 等の通常設定・拡張機能・`workspaceStorage`

### 初期化された可能性が高いもの（想定範囲）

- Cursor 内の **過去チャット履歴**
- **Agent / Composer の過去セッション**
- **ログイン状態**（再ログインが必要）
- 最近開いたプロジェクト一覧・一部 UI 状態

**対策**: 重要な決定・手順は **`docs/`（KB / Runbook / EXEC_PLAN）** に残す。チャット履歴に依存しない運用（[AGENTS.md](../../AGENTS.md) · [01-core-docs-and-knowledge](../../.cursor/rules/01-core-docs-and-knowledge.mdc)）。

## Prevention / 再発監視

### 短期（数日〜数週間）

1. 起動速度・フリーズ・メモリ使用量を通常作業で確認
2. **`state.vscdb` サイズ**を定期確認（急激な肥大化を早期検知）

   ```bash
   du -sh "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"*
   ```

3. Cursor ログで `SQLITE_CORRUPT` の再発有無を確認
4. 安定確認後、退避 **`recovery-20260606-090149`（76GB）** を削除または別保管へ移し、容量回収

### 中期（再発時の検討肢）

| 対策 | 内容 |
|------|------|
| 折衷配置 | **状態DBだけ内蔵SSD**、大容量データは外部SSD |
| インデックス除外 | `node_modules` · `.git` · `dist` · `build` · `.next` · `.venv` · `coverage` · 大きなログ |
| 履歴の定期整理 | 不要な Agent/Composer/チャット履歴（[KB-212](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除) 参照） |
| 外部SSD安定性 | スリープ無効・接続確認・作業前のマウント確認 |
| 同時起動の抑制 | Chrome + Cursor + Codex 同時起動時の負荷を意識 |

### 運用決定（2026-06-06）

**当面は外部SSD運用を継続**する。理由: 内蔵SSD容量圧迫回避が必要で、今回の主因は外部SSDそのものより **破損肥大DB** の可能性が高い。まず現構成で安定するか観測する。

## Cursor Agent への作業ルール（復旧直後）

復旧直後の Agent セッションでは、チャット履歴が無い前提で次を守る。

| ルール | 理由 |
|--------|------|
| **いきなりコード変更しない**（依頼があるまで） | WIP の意図がチャットに無い |
| **未コミット変更は WIP · 破棄しない** | Hermes Discord command sync 等がローカルに残存 |
| **本番デプロイ・Pi 実機操作は明示依頼までしない** | [00-core-safety](../../.cursor/rules/00-core-safety.mdc) |
| **秘密情報・トークンを探したり表示しない** | セキュリティ |
| 作業開始前に **`AGENTS.md` · `.cursor/rules/` · `docs/INDEX.md` · `EXEC_PLAN.md`** を読む | 文脈の再構築 |

### 推奨プロンプト（新規 Agent セッション用）

```text
Cursor の状態DBをリセットしたため、過去チャット/Agent履歴は失われている可能性があります。
ローカルリポジトリと未コミット変更は残っています。

まずコード変更はしないでください。未コミット変更は WIP として破棄しないでください。
本番デプロイや Pi 実機操作は、私が明示するまで行わないでください。

AGENTS.md と .cursor/rules を読んだうえで、
リポジトリ構成・現在の開発状況・未コミット WIP の意図を整理してください。
```

## 本リポジトリ固有の WIP（2026-06-06 時点）

Cursor 復旧時点で **未コミット** の作業（**破棄禁止 · 別 PR 想定**）:

| 種別 | パス | 目的 |
|------|------|------|
| 変更 | `docs/knowledge-base/KB-private-pi5-hermes-daily-pilot.md` | Discord `/daily` Ansible command sync 仕様追記 |
| 変更 | `docs/runbooks/private-pi5-hermes-deploy.md` | 同上 Runbook |
| 変更 | `infrastructure/ansible/playbooks/private-pi5-hermes.yml` | playbook に sync task 追加 |
| 新規 | `infrastructure/ansible/tasks/private-pi5-hermes/sync-discord-daily-command.yml` | Ansible task |
| 新規 | `scripts/private-pi5-hermes/lib/discord_command_sync.py` | Discord API 同期ライブラリ |
| 新規 | `scripts/private-pi5-hermes/sync-discord-commands.py` | CLI |
| 新規 | `scripts/private-pi5-hermes/tests/test_discord_command_sync.py` | unittest |

**状態**: 実装・ドキュメント草案あり · **main 未マージ** · Pi5 実機は D6-pre 検証済みだが **Ansible フル deploy 収束は未完了**（[KB daily pilot](./KB-private-pi5-hermes-daily-pilot.md)）。

## References

- 復旧記録（Codex 出力）: `/Users/tsudatakashi/Documents/Codex/2026-06-06/mac-chrome-cursor-codex-cursor/outputs/cursor_recovery_summary_20260606.md`
- 退避スクリプト: `…/outputs/cursor_state_db_recovery.command`
- [mac-storage-migration](../guides/mac-storage-migration.md)
- [KB-212](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除)
- [KB-026](./ci-cd.md#kb-026-cursor内の編集ツールが大きなyamlファイルで失敗する)
