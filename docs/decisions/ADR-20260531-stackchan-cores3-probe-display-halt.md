# ADR-20260531: CoreS3 bring-up probe 停止（表示互換性未解決）

- **Status**: accepted
- **Date**: 2026-05-31

## Context

- 私用 StackChan（M5Stack CoreS3）で `AI_StackChan_Ex` / safe mode / voice overlay 経路の bring-up を進めていた。
- safe mode upload 後に画面真っ黒が発生。voice overlay 以前に **表示経路**の問題を疑い、最小 PlatformIO probe（Step A〜E1）で切り分けた。
- 公式 **StackChan-UserDemo-V1.4.1**（IDF + LVGL + 専用 board 初期化）では full erase + write 後に **画面表示が復旧**した（ハード故障ではない）。

## Decision

1. **StackChan 実機への probe / `AI_StackChan_Ex` 系 firmware の追加 flash を全面停止**する。
2. 実機は **公式 UserDemo-V1.4.1 のまま保持**する（理由のない erase/write 禁止）。
3. 表示問題の再開は、**PlatformIO / M5Unified / board / partition / LCD 初期化**と公式 stack の **ギャップ分析**が完了し、Runbook を更新したうえでのみ検討する。
4. **E2**（Face::draw のみ probe）は **upload しない**（E1 で avatar 無しでも黒画面のため）。

## Alternatives considered

| 選択肢 | 却下理由 |
|--------|----------|
| `avatar.init()` / colorDepth=1 へ寄せる（C1） | assert 再起動ループ。黒画面も解消せず |
| C2 で loop から `fillScreen` 上書きテスト | Avatar drawLoop との **Display 競合で assert**。切り分け不能 |
| vendored m5stack-avatar のみ差し替え（C3） | シリアル安定だが **目視真っ黒**。lib 差分は主因ではない |
| 本体 `AI_StackChan_Ex` / safe mode を再 upload | Step B 再確認でも黒画面。リスクのみ増加 |
| probe 継続（E2 upload） | E1 で **M5Canvas のみ**でも黒。優先度低 |

## Consequences

### 良い点

- 実機を公式安定状態に戻し、ハード正常を確認できた。
- **m5stack-avatar 単体が黒画面の主因ではない**ことを実測で限定した。
- probe ソースと Runbook/KB に再現用の手順・ログ期待値を残した。

### 悪い点 / 未解決

- Arduino/M5Unified 経路の **LCD 表示が CoreS3 実機で機能しない原因は未特定**。
- private Pi5 bridge / LLM 実機 E2E は **別途**（公式ファームまたは将来の互換修正後）再開が必要。

## References

- [stackchan-cores3-bringup-probe.md](../runbooks/stackchan-cores3-bringup-probe.md)
- [KB-stackchan-community-firmware-supply-chain.md](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-31-coreS3-表示--確定結論probe-全面停止)
