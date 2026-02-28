---
title: ADR-20260228: キオスク IBus 設定の多層抑止とモジュール分離
status: accepted
date: 2026-02-28
deciders: [開発チーム]
tags: [kiosk, ibus, ansible, modularity, resilience]
related: [KB-276]
---

# ADR-20260228: キオスク IBus 設定の多層抑止とモジュール分離

## Status

**accepted** (2026-02-28)

## Context

KB-276 で `ibus-daemon` の二重起動と UI 表示は一度解消したが、後日に「キー入力ごとに ibus-ui ウィンドウが出現する」事象が再発した。

再発調査で、以下の運用ギャップが確認された。

- IBus の gsettings 適用は Ansible デプロイ時に実行しているが、`/run/user/${uid}/bus` が存在しないと `skip:no-user-bus` でスキップされる
- デプロイ時にスキップされた設定を、ログイン時に再適用する機構がなかった
- IBus ロジックが `roles/kiosk/tasks/main.yml` に混在し、browser 関連タスクとの境界が曖昧だった

## Decision

以下を採用する。

1. **IBus タスクを `tasks/ibus.yml` へ分離**し、`main.yml` から `import_tasks` する
2. **IBus 設定値を `defaults/main.yml` の `ibus_*` 変数へ集約**し、ハードコードを減らす
3. **ログイン時に gsettings を再適用**するため、`ibus-engine.desktop` の Exec で DBus セッションを明示し、gsettings 適用後に `ibus engine mozc-jp` をリトライする
4. 既存のデプロイ時 gsettings（冪等処理）は残し、**多層防御**（起動フラグ・ログイン時適用・デプロイ時適用）を構成する

## Alternatives Considered

### 1. dconf システムデフォルトへの全面移行

**検討内容**: `/etc/dconf/db/local.d` を使い、ユーザーセッション前に IBus パネル設定を固定する

**却下理由**:
- キオスク以外のユーザー設定へ影響しやすい
- 適用境界の制御が難しく、運用負荷が上がる
- まずはキオスクロール内で閉じた最小変更の方が安全

### 2. デプロイ時 gsettings のみ維持（ログイン時再適用なし）

**検討内容**: 現状構成を維持し、デプロイタイミングに依存して反映する

**却下理由**:
- `no-user-bus` で設定未反映のままになるリスクが残る
- 再起動・初回起動時の自己修復性が不足する

## Consequences

### Positive

- **責務分離の明確化**: IBus 設定の変更を `tasks/ibus.yml` で完結できる
- **再発耐性の向上**: ログイン時に設定を再適用することで、デプロイ時スキップの影響を吸収できる
- **拡張性の向上**: キーボードレイアウトやトリガー変更を `ibus_*` 変数の差し替えで対応できる

### Negative

- **起動時処理の増加**: `ibus-engine.desktop` の Exec が長くなり、可読性が低下する可能性がある
- **デバッグ面の複雑化**: デプロイ時とログイン時の両方で設定が変わるため、障害切り分け時に確認箇所が増える

## Implementation Notes

- `infrastructure/ansible/roles/kiosk/tasks/ibus.yml` を新設
- `infrastructure/ansible/roles/kiosk/tasks/main.yml` は IBus タスクを `import_tasks: ibus.yml` に変更
- `infrastructure/ansible/roles/kiosk/defaults/main.yml` に `ibus_*` 変数を追加
- `infrastructure/ansible/templates/ibus-autostart.desktop.j2` は daemon 引数を変数参照可能に変更

## References

- [KB-276](../knowledge-base/frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善)
- [コア: アーキテクチャ](../../.cursor/rules/02-core-architecture.mdc)
