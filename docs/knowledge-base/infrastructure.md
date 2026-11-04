---
title: トラブルシューティングナレッジベース - インフラ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2026-01-25
related: [index.md, ../guides/deployment.md, ../guides/monitoring.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - インフラ関連

> **索引のみ**: インフラ関連 KB の本文は下表のサブカテゴリファイルにあります。件数は [index.md](./index.md) を正とします。

**カテゴリ**: インフラ関連  
**索引**: [index.md](./index.md)

## 📁 サブカテゴリ別ファイル

インフラ関連のKBは以下のサブカテゴリに分割されています：

| サブカテゴリ | ファイル | 説明 |
|------------|---------|------|
| **Docker/Caddy関連** | [docker-caddy.md](./infrastructure/docker-caddy.md) | Docker ComposeとCaddyリバースプロキシに関するトラブルシューティング情報 |
| **バックアップ・リストア関連** | [backup-restore.md](./infrastructure/backup-restore.md) | バックアップとリストア機能に関するトラブルシューティング情報 |
| **Ansible/デプロイ関連** | [ansible-deployment.md](./infrastructure/ansible-deployment.md) | Ansibleとデプロイメントに関するトラブルシューティング情報 |
| **セキュリティ関連** | [security.md](./infrastructure/security.md) | セキュリティ対策と監視に関するトラブルシューティング情報 |
| **サイネージ関連** | [signage.md](./infrastructure/signage.md) | デジタルサイネージ機能に関するトラブルシューティング情報（**`splitCompact24`・KB-325** 含む） |
| **NFC/ハードウェア関連** | [hardware-nfc.md](./infrastructure/hardware-nfc.md) | NFCリーダーとハードウェアに関するトラブルシューティング情報 |
| **その他** | [miscellaneous.md](./infrastructure/miscellaneous.md) | その他のインフラ関連トラブルシューティング情報 |

## 📋 課題を探す

1. **索引から探す**: [index.md](./index.md) で全課題の一覧を確認
2. **サブカテゴリから探す**: 上記のサブカテゴリ別ファイルから問題に関連するカテゴリを選択
3. **IDで探す**: KB-XXXのIDが分かっている場合は、索引から該当するサブカテゴリファイルを特定

## 🔍 よくある質問

### なぜ分割したのか？

元の`infrastructure.md`が3,217行と大きくなり、以下の問題が発生していました：
- Cursorなどのエディタでクラッシュする可能性
- ファイル編集時のパフォーマンス低下
- 特定のKBを探すのが困難

### どのファイルを見ればよいか？

- **DockerやCaddyの問題**: [docker-caddy.md](./infrastructure/docker-caddy.md)
- **バックアップ・リストアの問題**: [backup-restore.md](./infrastructure/backup-restore.md)
- **Ansibleやデプロイの問題**: [ansible-deployment.md](./infrastructure/ansible-deployment.md)
- **セキュリティ関連の問題**: [security.md](./infrastructure/security.md)
- **サイネージの問題**: [signage.md](./infrastructure/signage.md)
- **NFCリーダーの問題**: [hardware-nfc.md](./infrastructure/hardware-nfc.md)
- **その他の問題**: [miscellaneous.md](./infrastructure/miscellaneous.md)

---

**更新履歴**:
- 2025-12-29: 機能別にサブカテゴリファイルに分割（ドキュメント肥大化対策）
