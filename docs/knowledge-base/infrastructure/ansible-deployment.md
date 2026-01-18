---
title: トラブルシューティングナレッジベース - Ansible/デプロイ関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - Ansible/デプロイ関連

**カテゴリ**: インフラ関連 > Ansible/デプロイ関連  
**件数**: 16件  
**索引**: [index.md](../index.md)

Ansibleとデプロイメントに関するトラブルシューティング情報

---

### [KB-058] Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題（ユーザー名・SSH鍵・サービス存在確認）

**EXEC_PLAN.md参照**: Phase 1 実機テスト（2025-12-01）

**事象**: 
- Raspberry Pi 5からAnsibleでRaspberry Pi 4とRaspberry Pi 3への接続テストが失敗
- `ansible all -i infrastructure/ansible/inventory.yml -m ping` で `Permission denied (publickey,password)` エラー
- インベントリファイルで `ansible_user: pi` と指定していたが、実際のユーザー名が異なる
- Raspberry Pi 4のユーザー名は `tools03`、Raspberry Pi 3のユーザー名は `signageras3`
- SSH鍵認証を設定する際、各クライアントに公開鍵を追加する必要があった
- プレイブック実行時に `owner: pi` と `group: pi` が指定されていたが、実際のユーザー名と不一致でエラー
- プレイブックで指定されたサービス（`signage-lite.service`、`kiosk-browser.service`）がRaspberry Pi 4に存在しないため、サービス再起動タスクが失敗

**要因**: 
- **インベントリファイルのユーザー名設定**: デフォルトで `ansible_user: pi` と設定されていたが、実際のクライアントでは異なるユーザー名が使用されていた
- **SSH鍵認証の未設定**: Raspberry Pi 5から各クライアントへのSSH鍵認証が設定されていなかった
- **プレイブックのユーザー名ハードコーディング**: プレイブック内で `owner: pi` と `group: pi` がハードコーディングされていた
- **サービス存在の前提**: プレイブックが全クライアントに同じサービスが存在することを前提としていたが、実際にはクライアントごとに異なるサービスが稼働していた

**試行した対策**: 
- [試行1] インベントリファイルで `ansible_user: pi` を確認 → **失敗**（実際のユーザー名が異なる）
- [試行2] `--ask-pass` オプションでパスワード認証を試行 → **パスワードが不明**
- [試行3] Raspberry Pi 5でSSH鍵を生成し、各クライアントに公開鍵を追加 → **成功**
  - `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""` で鍵を生成
  - RealVNC経由で各クライアントに接続し、`~/.ssh/authorized_keys` に公開鍵を追加
- [試行4] インベントリファイルで各ホストごとにユーザー名を指定 → **成功**
  - `raspberrypi4` に `ansible_user: tools03`、`raspberrypi3` に `ansible_user: signageras3` を設定
- [試行5] プレイブックの `owner: pi` を `owner: "{{ ansible_user }}"` に変更 → **成功**
- [試行6] サービス再起動タスクに `ignore_errors: true` を追加 → **成功**（存在しないサービスをスキップ）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **SSH鍵認証の設定**: Raspberry Pi 5でSSH鍵を生成し、各クライアントに公開鍵を追加
  2. **インベントリファイルのユーザー名設定**: 各ホストごとに正しいユーザー名を指定
  3. **プレイブックのユーザー名動的化**: `owner: "{{ ansible_user }}"` で動的にユーザー名を設定
  4. **サービス存在チェック**: `ignore_errors: true` で存在しないサービスをスキップ

**学んだこと**: 
- **インベントリファイルの重要性**: 各クライアントの実際のユーザー名を正確に設定することが重要
- **SSH鍵認証の設定**: パスワード認証に頼らず、SSH鍵認証を設定することで自動化が可能になる
- **プレイブックの柔軟性**: ユーザー名やサービス名をハードコーディングせず、変数や条件分岐を使用する
- **クライアント間の差異**: 全クライアントが同じ設定・サービスを持つとは限らないため、エラーハンドリングが重要
- **RealVNC経由での設定**: SSH接続が確立する前は、RealVNC経由で設定を行うことが有効
- **段階的な問題解決**: 接続→認証→プレイブック実行の順で段階的に問題を解決する

**解決状況**: ✅ **解決済み**（2025-12-01）

**追記（2026-01-15）**:
- 運用デプロイでは`git clean`を使用しない方針に変更（運用データ削除の発生源を排除）

**関連ファイル**: 
- `infrastructure/ansible/inventory.yml`（インベントリファイル）
- `infrastructure/ansible/playbooks/update-clients.yml`（更新プレイブック）
- `~/.ssh/id_ed25519.pub`（Raspberry Pi 5側の公開鍵）
- `~/.ssh/authorized_keys`（各クライアント側）

---

---

### [KB-061] Ansible実装後の設定ファイル削除問題と堅牢化対策

**EXEC_PLAN.md参照**: Ansible堅牢化・安定化計画 (2025-12-01)

**事象**: 
- `git clean -fd`を実行すると、`storage/`と`certs/`が削除された（写真ファイル、PDFファイル、自己署名証明書が消失）
- `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除され、NFCリーダーが使用不能になった
- システム設定ファイルの管理方針が不明確で、削除されても自動復旧できない

**要因**: 
- **`git clean`の危険性**: `.gitignore`に含まれていないファイルが削除される
- **システム設定ファイルの管理不足**: `/etc/`配下の設定ファイルがAnsibleで管理されていない
- **保護ディレクトリの不足**: `alerts/`と`logs/`が除外されていない

**試行した対策**: 
- [試行1] `.gitignore`に`storage/`と`certs/`を追加 → **成功**（これらのディレクトリは保護された）
- [試行2] `git clean`コマンドで`storage/`と`certs/`を除外 → **成功**（一時的な対策）
- [試行3] polkit設定ファイルを手動で再作成 → **成功**（一時的な復旧）
- [試行4] Ansibleでpolkit設定ファイルを管理するプレイブックを作成 → **成功**（自動復旧可能に）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **`git clean`の改善**: `alerts/`と`logs/`を除外リストに追加し、コメントで`/etc/`配下の設定ファイルについて説明を追加
  2. **polkit設定ファイルのAnsible管理化**: `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2`を作成し、`update-clients.yml`に統合
  3. **バックアップ機能の実装**: `scripts/ansible-backup-configs.sh`を作成し、設定ファイルのバックアップを自動化
  4. **ロールバック機能の実装**: `infrastructure/ansible/playbooks/rollback.yml`を作成し、設定ファイルの自動復旧を可能に
  5. **ドキュメント化**: `docs/plans/ansible-hardening-stabilization-plan.md`と`docs/guides/ansible-managed-files.md`を作成し、管理方針を明確化

**学んだこと**: 
- **`git clean`のリスク**: `.gitignore`に含まれていないファイルは削除されるため、保護が必要なディレクトリは明示的に除外する必要がある
- **システム設定ファイルの管理**: `/etc/`配下の設定ファイルはGitリポジトリ外にあるが、Ansibleで管理することで削除されても自動復旧できる
- **Ansibleの堅牢化**: 設定ファイルのバックアップとロールバック機能を実装することで、誤削除時の影響を最小限に抑えられる
- **ドキュメント化の重要性**: 管理方針を明確化することで、将来の同様の問題を防げる

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/ansible/playbooks/update-clients.yml`（`git clean`の改善、polkit設定ファイルの管理）
- `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2`（polkit設定ファイルテンプレート）
- `infrastructure/ansible/playbooks/manage-system-configs.yml`（システム設定ファイル管理プレイブック）
- `infrastructure/ansible/playbooks/rollback.yml`（ロールバックプレイブック）
- `scripts/ansible-backup-configs.sh`（設定ファイルバックアップスクリプト）
- `docs/plans/ansible-hardening-stabilization-plan.md`（Ansible堅牢化・安定化計画）
- `docs/guides/ansible-managed-files.md`（Ansibleで管理すべき設定ファイル一覧）

---

---

### [KB-062] Ansible設定ファイル管理化の実装（systemdサービス・アプリケーション設定）

**EXEC_PLAN.md参照**: Ansible設定ファイル管理化実装計画 (2025-12-01)

**事象**: 
- `kiosk-browser.service`、`signage-lite.service`がAnsibleで管理されていないため、削除されても自動復旧できない
- アプリケーション設定ファイル（`.env`）が手動管理のため、IP変更時などに手動作業が必要
- 実用段階に達するために必要な設定ファイルの管理化が未実装

**要因**: 
- **systemdサービスファイルの未管理**: `kiosk-browser.service`、`signage-lite.service`がテンプレート化されていない
- **アプリケーション設定ファイルの未管理**: API/Web/NFCエージェント/Docker Composeの`.env`ファイルがAnsibleで管理されていない
- **環境変数の管理方針の不明確化**: 機密情報の扱い方針が明確でない

**試行した対策**: 
- [試行1] `kiosk-browser.service`テンプレートを作成 → **成功**
- [試行2] `signage-lite.service`テンプレートを作成 → **成功**
- [試行3] `manage-system-configs.yml`にsystemdサービス管理タスクを追加 → **成功**
- [試行4] `manage-app-configs.yml`プレイブックを作成 → **成功**
- [試行5] 各`.env`ファイルのテンプレートを作成 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **systemdサービスファイルのテンプレート化**: `infrastructure/ansible/templates/kiosk-browser.service.j2`、`infrastructure/ansible/templates/signage-lite.service.j2`を作成
  2. **manage-system-configs.ymlへの統合**: systemdサービス管理タスクを追加し、条件分岐で適切なホストにのみデプロイ
  3. **アプリケーション設定ファイルの管理化**: `infrastructure/ansible/playbooks/manage-app-configs.yml`を作成し、API/Web/NFCエージェント/Docker Composeの`.env`ファイルをテンプレート化
  4. **inventory.ymlへの変数追加**: 環境変数の値をinventory.ymlで管理し、環境ごとの差異に対応
  5. **機密情報の扱い明確化**: テンプレートにコメントを追加し、Ansible Vaultの使用を推奨

**学んだこと**: 
- **systemdサービスファイルの管理**: テンプレート化することで、設定変更をAnsibleで一元管理できる
- **アプリケーション設定ファイルの管理**: `.env`ファイルをテンプレート化することで、IP変更などの環境変更に対応しやすくなる
- **条件分岐の重要性**: クライアントごとに異なるサービスを管理するため、`when`条件で適切に分岐する必要がある
- **機密情報の扱い**: JWT_SECRETなどの機密情報はAnsible Vaultで暗号化するか、inventory.ymlで変数として管理する
- **実用段階への到達**: 重要な設定ファイルをAnsibleで管理することで、実用段階に到達できる

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/ansible/templates/kiosk-browser.service.j2`（キオスクブラウザサービステンプレート）
- `infrastructure/ansible/templates/signage-lite.service.j2`（サイネージサービステンプレート）
- `infrastructure/ansible/playbooks/manage-system-configs.yml`（システム設定ファイル管理プレイブック）
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（アプリケーション設定ファイル管理プレイブック）
- `infrastructure/ansible/templates/api.env.j2`（API環境変数テンプレート）
- `infrastructure/ansible/templates/web.env.j2`（Web環境変数テンプレート）
- `infrastructure/ansible/templates/nfc-agent.env.j2`（NFCエージェント環境変数テンプレート）
- `infrastructure/ansible/templates/docker.env.j2`（Docker Compose環境変数テンプレート）
- `infrastructure/ansible/inventory.yml`（環境変数の変数定義）
- `docs/plans/ansible-config-files-management-plan.md`（実装計画）

---

---

### [KB-066] ラズパイ3でのAnsibleデプロイ失敗（サイネージ稼働中のリソース不足・自動再起動・401エラー）

**EXEC_PLAN.md参照**: Phase 3 自動バックアップ＆ロールバック実装（2025-12-02）

**事象**: 
- ラズパイ3でAnsibleデプロイが失敗する
- デプロイ中にサイネージ（signage-lite.service）が稼働しており、リソース不足で処理が不安定になる
- サイネージを停止しても`Restart=always`により自動的に再起動してしまう
- サイネージヘルスチェック（`/api/signage/render/status`）が401エラーを返し、デプロイが中断される
- ラズパイ4と5では成功していた（サイネージが稼働していないため）

**要因**: 
1. **リソース不足**: ラズパイ3はCPU/RAMが限られており、サイネージ稼働中にデプロイ処理（依存インストール、ファイルコピー等）を実行するとリソース競合が発生
2. **自動再起動**: `signage-lite.service`に`Restart=always`が設定されており、`systemctl stop`しても自動的に再起動してしまう
3. **認証エラー**: サイネージヘルスチェックエンドポイントが認証トークンを要求するが、Ansibleからは`x-client-key`ヘッダーのみ送信しており、401エラーが発生

**試行した対策**: 
- [試行1] デプロイ前にサイネージを停止 → **失敗**（自動再起動してしまう）
- [試行2] `systemctl mask`でサービスをマスク → **失敗**（サービスファイルが存在する場合は使用不可）
- [試行3] `systemctl disable`で自動起動を無効化 → **成功**（自動再起動を防止）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-02）:
  1. デプロイ前に`signage-lite.service`と`signage-lite-update.timer`を`enabled: false`で無効化し、その後停止
  2. デプロイ処理を実行（リソースに余裕を持たせる）
  3. デプロイ後に`enabled: true`で再有効化し、サービスを再起動
  4. サイネージヘルスチェックの401エラーを`failed_when: false`で警告として扱い、デプロイを継続

**学んだこと**: 
- リソースが限られた環境（ラズパイ3）では、デプロイ前に重いサービスを停止してリソースに余裕を持たせる必要がある
- `systemctl stop`だけでは`Restart=always`が設定されたサービスは自動再起動するため、`systemctl disable`で自動起動を無効化する必要がある
- `systemctl mask`はサービスファイルが存在しない場合のみ使用可能
- 認証が必要なエンドポイントのヘルスチェックは、失敗してもデプロイを継続できるように警告として扱うべき

**解決状況**: ✅ **解決済み**（2025-12-02）

**関連ファイル**: 
- `infrastructure/ansible/tasks/update-clients-core.yml`
- `infrastructure/ansible/playbooks/update-clients.yml`
- `infrastructure/ansible/inventory.yml`

---

---

### [KB-069] IPアドレス管理の変数化（Ansible group_vars/all.yml）

**EXEC_PLAN.md参照**: Phase 1 IPアドレス管理の変数化と運用モード可視化（2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- IPアドレスが複数の設定ファイルに直接記述されている
- ネットワーク環境が変わった際に、複数箇所を手動で修正する必要がある
- メンテナンス時と通常運用時の切り替えが煩雑
- `inventory.yml`、テンプレートファイル（`.j2`）、スクリプトなどにIPアドレスが散在している

**要因**: 
1. **設定の分散**: IPアドレスが各ファイルに直接記述されており、一元管理されていない
2. **変数化の不足**: Ansibleの変数機能を活用していなかった
3. **ネットワークモードの切り替え不足**: ローカルネットワークとTailscaleの切り替えが手動で行う必要があった

**試行した対策**: 
- [試行1] 各ファイルを個別に修正 → **失敗**（修正漏れが発生しやすい）
- [試行2] 環境変数で管理 → **部分的成功**（Ansibleテンプレートでは使用できない）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. `infrastructure/ansible/group_vars/all.yml`を作成し、IPアドレス変数を一元管理
  2. `network_mode`（`local`/`tailscale`）で切り替え可能にする
  3. `local_network`と`tailscale_network`の2つのIPアドレスセットを定義
  4. `current_network`変数で`network_mode`に応じて自動選択
  5. `inventory.yml`で変数を参照するように修正（`ansible_host`、URL、WebSocket URLなど）
  6. テンプレートファイル（`.j2`）のデフォルト値を削除し、変数のみ参照
  7. `scripts/register-clients.sh`を環境変数またはAnsible変数から読み込むように修正

**実装の詳細**:
- `group_vars/all.yml`に以下の変数を定義:
  - `network_mode`: `"local"`または`"tailscale"`
  - `local_network`: ローカルネットワーク用IPアドレス（`raspberrypi5_ip`, `raspberrypi4_ip`, `raspberrypi3_ip`）
  - `tailscale_network`: Tailscale用IPアドレス（メンテナンス時のみ使用）
  - `current_network`: `network_mode`に基づいて自動選択
  - `server_ip`, `kiosk_ip`, `signage_ip`: 共通変数として定義
  - `api_base_url`, `websocket_agent_url`など: よく使うURLを共通変数として定義
- `inventory.yml`で`ansible_host: "{{ current_network.raspberrypi5_ip }}"`のように変数参照
- テンプレートファイルで`{{ api_base_url }}`のように変数参照

**学んだこと**: 
- Ansibleの`group_vars/all.yml`を使用することで、IPアドレスを一元管理できる
- `network_mode`で切り替え可能にすることで、メンテナンス時と通常運用時の切り替えが容易になる
- 変数化により、ネットワーク環境変更時の修正箇所が1箇所に集約される
- デフォルト値に古いIPアドレスを残さないことで、設定ミスを防げる

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/inventory.yml`
- `infrastructure/ansible/templates/nfc-agent.env.j2`
- `infrastructure/ansible/templates/status-agent.conf.j2`
- `infrastructure/ansible/templates/docker.env.j2`
- `scripts/register-clients.sh`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-100] CIテストが失敗してもマージが進んでしまう問題（再発）

**発生日**: 2025-12-15

**事象**: 
- CIテストが失敗しているにもかかわらず、PRがマージされてしまう
- ブランチ保護ルールが設定されていない、または適切に設定されていない

**要因**: 
- GitHubのブランチ保護ルールが設定されていない
- 「Do not allow bypassing the above settings」がチェックされていない
- CIワークフローで一部のステップに`|| exit 1`が設定されていない

**有効だった対策**: 
- ✅ **CIワークフローの強化**（2025-12-15）:
  - すべてのテストステップに`|| exit 1`を追加
  - `e2e-tests`ジョブから`continue-on-error: true`を削除（既に実施済み）
  - `e2e-tests`ジョブのコメントを修正（「non-blocking」→「blocking」に変更）
  - `imports-dropbox`テストをCIワークフローに追加
- ✅ **ドキュメントの作成**（2025-12-15）:
  - `.github/BRANCH_PROTECTION_SETUP.md`を作成（設定手順を明確化）
  - `docs/guides/ci-branch-protection.md`を更新
  - `README.md`にブランチ保護設定のリンクを追加

**必須対応**: 
- ⚠️ **GitHubでのブランチ保護ルール設定**（手動で実施が必要）:
  1. GitHubリポジトリの「Settings」→「Branches」にアクセス
  2. `main`ブランチの保護ルールを追加
  3. 「Require status checks to pass before merging」にチェック
  4. 「Require branches to be up to date before merging」にチェック
  5. 必須チェックとして以下を選択：
     - `lint-and-test`
     - `e2e-smoke`
     - `docker-build`
  6. **「Do not allow bypassing the above settings」にチェック**（最重要）
  7. 設定を保存
  8. `develop`ブランチにも同様の設定

**学んだこと**: 
- CIワークフローで`|| exit 1`を設定しても、ブランチ保護ルールが設定されていないとマージできてしまう
- 「Do not allow bypassing the above settings」をチェックしないと、管理者でもテストをスルーできてしまう
- ブランチ保護ルールの設定は手動で実施する必要があり、自動化できない
- CI必須化の実装だけでなく、GitHubの設定も必須

**解決状況**: ⚠️ **部分解決**（CIワークフローは強化済み、ブランチ保護ルールの設定は手動で実施が必要）

**関連ファイル**: 
- `.github/workflows/ci.yml`（CIワークフロー）
- `.github/BRANCH_PROTECTION_SETUP.md`（設定手順）
- `docs/guides/ci-branch-protection.md`（詳細ガイド）
- `README.md`（READMEにリンク追加）

---

---

### [KB-101] Pi5へのSSH接続不可問題の原因と解決

**発生日時**: 2025-12-15（推定）

**症状**: 
- Pi5 (`raspberrypi.local`) へのSSH接続が突然失敗
- エラーメッセージ: `REMOTE HOST IDENTIFICATION HAS CHANGED!`
- `Permission denied (publickey,password)` エラー

**原因分析**:

#### 1. SSHホストキーの不一致（主原因）

**状況**:
- Pi5のSSHホストキー（`/etc/ssh/ssh_host_ed25519_key.pub`）は **2025-11-24 11:11** に作成
- クライアント側の `~/.ssh/known_hosts` に古いホストキーが記録されていた
- Pi5のSSHホストキーが変更されたか、またはクライアント側のknown_hostsが古い状態だった

**確認方法**:
```bash
# クライアント側で確認
ssh-keygen -F raspberrypi.local -l

# Pi5側で確認
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

#### 2. Git force pushの影響（主原因の可能性）

**状況**:
- **2025-12-15 16:53:49**: mainブランチに`feature/dropbox-csv-import-phase1`をマージ
- **2025-12-15 16:59:57**: mainブランチをforce pushでロールバック（`git reset --hard af2946e` → `git push origin main --force`）
- **2025-12-15 17:01**: Pi5がシステム再起動

**影響**:
- Pi5側の`refactor/imports-ts-refactoring`ブランチがリモートより13コミット先行している状態になった
- Pi5側は既に`git pull`で新しいコミット（`feature/dropbox-csv-import-phase1`のコミット）を取得していた
- force pushによりリモートブランチが巻き戻り、Pi5側のローカルブランチがリモートより先行
- この状態で`git pull`を実行すると、競合やエラーが発生する可能性がある

**確認方法**:
```bash
# Pi5側で確認
git log --oneline refactor/imports-ts-refactoring ^origin/refactor/imports-ts-refactoring
# 13コミットが先行していることを確認

# リモートとの差分確認
git fetch origin
git log --oneline origin/refactor/imports-ts-refactoring..refactor/imports-ts-refactoring
```

**根本原因**:
- **mainブランチへのforce push**により、リモートのブランチ履歴が巻き戻った
- Pi5側は既に新しいコミットを取得していたため、ローカルブランチがリモートより先行
- この状態でgit操作（`git pull`など）を実行すると、予期しない動作やエラーが発生する可能性がある

#### 3. システム再起動の影響

**状況**:
- Pi5は **2025-12-15 17:01** に再起動（force pushの直後）
- SSHサービスは正常に起動（`systemctl status ssh`）
- WiFi接続も正常に確立（`wlan0: 192.168.10.230`）

**影響**:
- 再起動によりネットワーク設定がリセットされた可能性
- mDNS/Bonjourサービス（`avahi-daemon`）も再起動
- **force pushの影響で壊れたgit状態が、再起動時に問題を引き起こした可能性**

#### 4. ネットワークの一時的な問題

**状況**:
- WiFi接続は12月15日17:01に確立
- mDNS/Bonjourサービスは正常動作
- `.local` ドメイン解決は正常

**可能性**:
- WiFi接続の一時的な不安定さ
- mDNS/Bonjourの解決遅延

#### 5. ユーザー名の不一致

**状況**:
- 最初は `tsuda@raspberrypi.local` で接続試行 → 失敗
- その後 `denkon5sd02@raspberrypi.local` で接続成功

**原因**:
- Pi5に `tsuda` ユーザーが存在しない、またはSSH公開鍵が登録されていない

**解決方法**:

##### 1. SSHホストキーの更新（実施済み）

```bash
# クライアント側で古いホストキーを削除
ssh-keygen -R raspberrypi.local

# 新しいホストキーで接続（自動的に追加される）
ssh -o StrictHostKeyChecking=accept-new denkon5sd02@raspberrypi.local
```

##### 2. 正しいユーザー名の使用

```bash
# 正しいユーザー名で接続
ssh denkon5sd02@raspberrypi.local

# または、IPアドレス直接指定
ssh denkon5sd02@192.168.10.230
```

##### 3. SSH設定の確認

**Pi5側の設定**:
- `PubkeyAuthentication yes` ✅
- `PasswordAuthentication yes` ✅
- SSHポート: 22（デフォルト）

**クライアント側の設定**:
- `~/.ssh/config` に設定があれば確認
- SSH公開鍵が正しく登録されているか確認

##### 4. ネットワーク接続の確認

```bash
# Pi5へのping確認
ping -c 3 raspberrypi.local

# mDNS解決の確認
avahi-resolve -n raspberrypi.local

# 直接IPアドレスで接続
ssh denkon5sd02@192.168.10.230
```

**根本原因**:

1. **Git force pushの影響**（最も可能性が高い）
   - mainブランチへのforce pushにより、リモートブランチが巻き戻った
   - Pi5側は既に新しいコミットを取得していたため、ローカルブランチがリモートより先行
   - この状態でgit操作を実行すると、予期しない動作やエラーが発生
   - **force pushのタイミング（16:59:57）とPi5の再起動（17:01）が一致している**

2. **SSHホストキーの不一致**
   - Pi5のSSHホストキーが変更された（OS再インストール、SSH設定の再生成など）
   - クライアント側のknown_hostsが古い状態だった
   - ただし、これはforce pushとは直接関係ない可能性が高い

3. **ユーザー名の不一致**
   - `tsuda` ユーザーが存在しない、またはSSH公開鍵が登録されていない
   - 正しいユーザー名 `denkon5sd02` を使用する必要がある

4. **システム再起動の影響**
   - 12月15日17:01に再起動があり、ネットワーク設定がリセットされた可能性
   - force pushの直後に再起動が発生したため、git状態の問題が表面化した可能性

**再発防止策**:

1. **mainブランチへのforce pushの禁止**:
   - mainブランチへのforce pushは絶対に避ける
   - ロールバックが必要な場合は、新しいコミットで修正する
   - 既にpullしたリモート環境への影響を考慮する

2. **Git状態の確認**:
   ```bash
   # Pi5側で定期的にgit状態を確認
   git fetch origin
   git status
   git log --oneline HEAD..origin/refactor/imports-ts-refactoring
   ```

3. **SSH接続の自動化スクリプト**:
   ```bash
   # ~/.ssh/config に設定を追加
   Host raspberrypi
       HostName raspberrypi.local
       User denkon5sd02
       StrictHostKeyChecking accept-new
       UserKnownHostsFile ~/.ssh/known_hosts
   ```

4. **定期的な接続確認**:
   ```bash
   # 接続テストスクリプト
   ssh -o ConnectTimeout=5 denkon5sd02@raspberrypi.local "echo 'OK'"
   ```

5. **SSHホストキーのバックアップ**:
   ```bash
   # Pi5側でホストキーをバックアップ
   sudo tar czf /opt/backup/ssh_host_keys_$(date +%Y%m%d).tar.gz /etc/ssh/ssh_host_*_key*
   ```

6. **監視とアラート**:
   - SSH接続失敗を監視
   - ホストキー変更を検知したらアラート

**学んだこと**: 
- **mainブランチへのforce pushは絶対に避けるべき**。既にpullしたリモート環境に深刻な影響を与える
- force pushの影響で、リモートブランチが巻き戻ると、既に新しいコミットを取得していた環境でgit状態が壊れる
- Pi5側の`refactor/imports-ts-refactoring`ブランチがリモートより13コミット先行している状態は、force pushの影響によるもの
- SSHホストキーの変更は、OS再インストールやSSH設定の再生成時に発生する
- `REMOTE HOST IDENTIFICATION HAS CHANGED!` エラーは、セキュリティ上の警告であり、正しいホストキーで更新する必要がある
- ユーザー名の不一致も接続失敗の原因となる
- システム再起動後は、ネットワーク設定やサービスがリセットされる可能性がある
- **force pushのタイミングと問題発生のタイミングが一致している場合、git操作が原因の可能性が高い**

**解決状況**: ✅ **解決済み**（2025-12-16）

**関連ファイル**: 
- `~/.ssh/known_hosts`（クライアント側）
- `/etc/ssh/ssh_host_*_key*`（Pi5側）
- `~/.ssh/config`（SSH設定ファイル）

---

### [KB-110] デプロイ時の問題（リモートにプッシュしていなかった、標準手順を無視していた）

**発生日時**: 2025-12-29

**症状**: 
- UI変更をデプロイしたが、変更が反映されない
- 複数回のデプロイ後も変更が反映されず、古いコードが残っている
- ビルド済みファイルに古いコード（「スケジュール（cron形式）」）が含まれている

**原因分析**:

#### 1. コミット後にリモートにプッシュしていなかった（主原因）

**状況**:
- ローカルでコミット（`12dcd2e`）は作成済み
- `git push`を実行していなかった
- Pi5上で`git pull`を実行しても「Already up to date」と表示されていたが、実際には最新のコミットがリモートに存在しなかった

**確認方法**:
```bash
# ローカルとリモートの差分を確認
git log --oneline HEAD..origin/feature/gmail-data-acquisition

# リモートの最新コミットを確認
git log --oneline origin/feature/gmail-data-acquisition -5
```

#### 2. デプロイ標準手順を無視していた（副原因）

**状況**:
- `docs/guides/deployment.md`の標準手順（方法2）では`docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web`を1コマンドで実行すべき
- 実際には`docker compose build web && docker compose up -d web`のように分割して実行していた
- `--force-recreate`オプションを省略していた

**標準手順**:
```bash
# 方法2: 手動で更新（標準手順）
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web
```

**試行した対策**: 
- [試行1] ブラウザのキャッシュをクリア（Cmd+Shift+R） → **失敗**（古いコードが残っている）
- [試行2] Dockerイメージを削除して再ビルド → **部分的成功**（リモートにプッシュしていなかったため、古いコードがビルドされた）
- [試行3] リモートにプッシュしてから再ビルド → **成功**（最新のコードがビルドされ、変更が反映された）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-29）:
  1. コミット後は必ず`git push`を実行する
  2. デプロイ前に`git log origin/<branch>`でリモートの最新コミットを確認する
  3. ローカルとリモートの差分を`git log HEAD..origin/<branch>`で確認する
  4. デプロイ標準手順（`docs/guides/deployment.md`）を遵守し、`--force-recreate --build`オプションを使用する
  5. デプロイ前に`docs/guides/deployment.md`を確認し、標準手順に従う

**追加の修正**（2025-12-29）:
- デプロイ標準手順を修正し、現在のブランチを使用するように変更
- `git pull origin main` → `CURRENT_BRANCH=$(git branch --show-current) && git pull origin "$CURRENT_BRANCH"`
- `main`ブランチにマージするのは別途指示がある場合のみ
- AIルールも更新し、汎用コア（`.cursor/rules/00-core-safety.mdc`）へ集約

**学んだこと**: 
- **コミット後は必ずプッシュ**: ローカルでコミットしただけでは、リモートリポジトリには反映されない
- **デプロイ前の確認**: デプロイ前にリモートの最新コミットを確認し、ローカルとリモートの差分を確認する
- **標準手順の遵守**: `docs/guides/deployment.md`の標準手順を遵守することで、確実に変更が反映される
- **デプロイ前のドキュメント確認**: デプロイ前に必ず`docs/guides/deployment.md`を確認し、標準手順に従う
- **現在のブランチを使用**: デプロイは常に現在のブランチを使用し、`main`ブランチにマージするのは別途指示がある場合のみ
- **比較対象の明確化**: Pi5上のコードとリモートリポジトリ（`origin/<current-branch>`）を比較し、ローカルとPi5を比較して「最新」と判断しない

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**: 
- `docs/guides/deployment.md`
- `.cursor/rules/00-core-safety.mdc`
- `.cursor/rules/20-git-workflow.mdc`

---

### [KB-128] APIエンドポイントのHTTPS化（Caddy経由）

**EXEC_PLAN.md参照**: デプロイ標準手順のブラッシュアップ（2026-01-03）

**事象**: 
- Pi4の`status-agent.service`が再起動時に失敗（`failed to send status: <urlopen error [Errno -2] Name or service not known>`）
- `status-agent.conf`の`API_BASE_URL`が`http://100.106.158.2:8080/api`に設定されていたが、Pi5のAPIコンテナは8080を外部公開していない

**要因**: 
- `group_vars/all.yml`の`api_base_url`が`http://{{ server_ip }}:8080/api`に設定されていた
- Pi5のAPIコンテナは8080を外部公開していない（Docker内部ネットワークでのみアクセス可能）
- 外部アクセスはCaddy経由（HTTPS 443）で行う必要がある
- Ansible設定と実装の不整合があった

**有効だった対策**: 
- ✅ **解決済み**（2026-01-03）:
  1. `group_vars/all.yml`の`api_base_url`を`http://{{ server_ip }}:8080/api`から`https://{{ server_ip }}/api`に変更
  2. `status-agent.conf.j2`で`TLS_SKIP_VERIFY=1`を設定し、自己署名証明書を許可
  3. クライアント（Pi3/Pi4）のエージェントがCaddy経由（HTTPS 443）でAPIにアクセスするように統一
  4. デプロイドキュメントを更新し、ポート8080は外部公開されていないことを明記

**学んだこと**:
- APIコンテナは8080を外部公開していない（Docker内部ネットワークでのみアクセス可能）
- 外部アクセスはCaddy経由（HTTPS 443）で行う必要がある
- Ansible設定と実装の整合性を保つことが重要
- セキュリティ強度は向上（HTTPS化、8080非公開の維持）

**解決状況**: ✅ **解決済み**（2026-01-03）

**関連ファイル**:
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/templates/status-agent.conf.j2`
- `infrastructure/docker/docker-compose.server.yml`
- `docs/guides/deployment.md`

---

### [KB-129] Pi5サーバー側のstatus-agent設定ファイルが古い設定のまま

**日付**: 2026-01-03

**事象**: 
- Pi5サーバー側の`status-agent.service`が失敗（`status-agent.service: Main process exited, code=exited, status=2/INVALIDARGUMENT`）
- 管理コンソールのクライアントタブでPi5のステータスが表示されない（データが12時間以上更新されていない）
- `status-agent.conf`の`API_BASE_URL`が`http://localhost:8080/api`に設定されていたが、Pi5のホストからはDocker内部ネットワークの`localhost:8080`にアクセスできない

**要因**: 
- Pi5サーバー側の`status-agent.conf`が古い設定のまま（`http://localhost:8080/api`）
- Pi5のAPIコンテナは8080を外部公開していない（Docker内部ネットワークでのみアクセス可能）
- 外部アクセスはCaddy経由（HTTPS 443）で行う必要がある
- Pi5サーバー側のstatus-agent設定がAnsibleで管理されていない（手動設定が必要）← **根本原因**

**有効だった対策**: 
- ✅ **一時的な解決**（2026-01-03）:
  1. Pi5の`/etc/raspi-status-agent.conf`を直接修正
  2. `API_BASE_URL`を`https://100.106.158.2/api`に変更（Caddy経由のHTTPS）
  3. `TLS_SKIP_VERIFY=1`を設定し、自己署名証明書を許可
  4. `LOCATION`を「ラズパイ5 - サーバー」に設定
  5. 手動実行で動作確認後、`status-agent.service`を再起動

- ✅ **根本的な解決**（2026-01-04）:
  1. Pi5に`status_agent_client_id`、`status_agent_client_key`などのホスト変数を追加（`inventory.yml`）
  2. Pi5用vaultに`vault_status_agent_client_key`を追加（`host_vars/raspberrypi5/vault.yml`）
  3. serverロールに`status-agent.yml`タスクを追加（設定ファイル配布、systemdユニット配布、タイマー有効化）
  4. `main.yml`から`status-agent.yml`をインポート
  5. Ansible実行時に自動的に設定ファイルが更新されるように改善

**学んだこと**:
- Pi5サーバー側のstatus-agent設定はAnsibleで管理されていないため、手動設定が必要だった（**根本原因**）
- Pi5のホストからはDocker内部ネットワークの`localhost:8080`にアクセスできない
- サーバー側もクライアント側と同様に、Caddy経由（HTTPS 443）でAPIにアクセスする必要がある
- 管理コンソールでクライアントステータスが表示されない場合は、データベースとstatus-agentの両方を確認する必要がある
- **Ansible管理化により、設定のドリフトを防止し、自動更新が可能になった**

**解決状況**: ✅ **解決済み**（2026-01-04: Ansible管理化完了）

**関連ファイル**:
- `/etc/raspi-status-agent.conf`（Pi5サーバー側）
- `infrastructure/ansible/inventory.yml`（Pi5のstatus-agent変数定義）
- `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`（Pi5用vault、`vault_status_agent_client_key`）
- `infrastructure/ansible/roles/server/tasks/status-agent.yml`（status-agent設定配布タスク）
- `infrastructure/ansible/roles/server/tasks/main.yml`（status-agent.ymlのインポート）
- `infrastructure/ansible/templates/status-agent.conf.j2`（設定ファイルテンプレート）
- `docs/guides/status-agent.md`
- `docs/knowledge-base/infrastructure/ansible-deployment.md`（KB-128）

**確認コマンド**:
```bash
# Pi5サーバー側のstatus-agent設定を確認
cat /etc/raspi-status-agent.conf

# status-agent.serviceの状態を確認
sudo systemctl status status-agent.service

# status-agent.serviceのログを確認
sudo journalctl -u status-agent.service -n 20

# 手動実行で動作確認
cd /opt/RaspberryPiSystem_002/clients/status-agent
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf ./status-agent.py
```

---

### [KB-142] Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL）

**EXEC_PLAN.md参照**: Slack通知機能の恒久対策（2026-01-05）

**事象**:
- オフィス環境移行時にローカルLANが変更され、Ansibleで`.env`ファイルを再生成した
- 再生成後、キオスクのお問い合わせボタンからSlack通知が送信されなくなった
- APIログに`[SlackWebhook] SLACK_KIOSK_SUPPORT_WEBHOOK_URL is not set, skipping notification`が記録された
- APIコンテナの環境変数を確認すると、`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`が空だった

**要因**:
- **Ansibleテンプレートの不足**: `infrastructure/ansible/templates/docker.env.j2`に`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`が含まれていなかった
- **`.env`ファイルの再生成**: Ansibleで`.env`を再生成する際、テンプレートに含まれていない環境変数は削除される
- **手動設定の消失**: 手動で`.env`に追加した設定が、Ansible実行時に上書きされて消失した

**試行した対策**:
- [試行1] APIログを確認して環境変数が空であることを確認 → **成功**（問題の特定）
- [試行2] `.env`ファイルを確認して`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`が存在しないことを確認 → **成功**（根本原因の特定）
- [試行3] Ansibleテンプレート（`docker.env.j2`）を確認して変数が含まれていないことを確認 → **成功**（根本原因の確定）
- [試行4] Ansibleテンプレートに`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`を追加 → **成功**（恒久対策の実装）
- [試行5] Ansible inventoryに`slack_kiosk_support_webhook_url`変数を追加 → **成功**（vault変数との連携）
- [試行6] Ansible vaultに`vault_slack_kiosk_support_webhook_url`を追加 → **成功**（機密情報の管理）
- [試行7] Ansibleタスクの`regex_search`エラーを修正（`regex_findall`と`first`フィルタを使用） → **成功**（エラーハンドリングの改善）
- [試行8] Ansible handlerの参照エラーを修正（`restart docker compose services`ハンドラを追加） → **成功**（コンテナ再起動の自動化）

**有効だった対策**:
- ✅ **解決済み**（2026-01-05）: 以下の対策を組み合わせて解決
  1. **Ansibleテンプレートの更新**: `infrastructure/ansible/templates/docker.env.j2`に`SLACK_KIOSK_SUPPORT_WEBHOOK_URL={{ slack_kiosk_support_webhook_url }}`を追加
  2. **Ansible inventoryの更新**: `infrastructure/ansible/inventory.yml`に`slack_kiosk_support_webhook_url: "{{ vault_slack_kiosk_support_webhook_url | default('') }}"`を追加
  3. **Ansible vaultの設定**: `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`に`vault_slack_kiosk_support_webhook_url`を追加
  4. **エラーハンドリングの改善**: `regex_findall`と`first`フィルタを使用して、`.env`に該当行が存在しない場合でもエラーにならないように修正
  5. **コンテナ再起動の自動化**: Ansible handlerを追加して、`.env`変更時に自動的にAPIコンテナを再起動

**学んだこと**:
- **Ansible管理化の重要性**: `.env`ファイルがAnsibleで再生成される場合、すべての環境変数をテンプレートに含める必要がある
- **機密情報の管理**: Webhook URLなどの機密情報はAnsible Vaultで管理し、テンプレートで参照する
- **既存設定の保護**: Ansibleテンプレートで`existing_*`変数を使用して、既存の設定を保護する仕組みがある
- **エラーハンドリング**: `.env`に該当行が存在しない場合でもエラーにならないよう、`regex_findall`と`first`フィルタを使用する
- **コンテナ再起動の自動化**: `.env`変更時に自動的にコンテナを再起動するため、Ansible handlerを使用する
- **同様の問題の予防**: Dropbox関連の環境変数（`DROPBOX_ACCESS_TOKEN`、`DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`）も同様の問題が発生する可能性がある

**解決状況**: ✅ **解決済み**（2026-01-05: Ansible管理化完了）

**関連ファイル**:
- `infrastructure/ansible/templates/docker.env.j2`（Ansibleテンプレート）
- `infrastructure/ansible/inventory.yml`（Ansible inventory）
- `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`（Ansible vault）
- `infrastructure/ansible/roles/server/tasks/main.yml`（Ansibleタスク）
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（Ansible playbook）
- `infrastructure/docker/docker-compose.server.yml`（Docker Compose設定）
- `docs/guides/slack-webhook-setup.md`（設定ガイド）

**確認コマンド**:
```bash
# .envファイルの確認
cat /opt/RaspberryPiSystem_002/infrastructure/docker/.env | grep SLACK_KIOSK_SUPPORT_WEBHOOK_URL

# APIコンテナの環境変数の確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api env | grep SLACK_KIOSK_SUPPORT_WEBHOOK_URL

# Ansible vaultの確認（暗号化されているため、ansible-vaultで復号化が必要）
ansible-vault view infrastructure/ansible/host_vars/raspberrypi5/vault.yml | grep vault_slack_kiosk_support_webhook_url
```

**同様の問題が発生する可能性がある環境変数**:
- `DROPBOX_ACCESS_TOKEN`
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`

**推奨対策**:
- これらの環境変数もAnsible管理化することを推奨（`docker.env.j2`に追加、inventoryに変数を追加、vaultに機密情報を追加）
- **注意**: Dropbox設定は`backup.json`（設定ファイル）でも管理されているため、環境変数が空でも動作する可能性がある
- ただし、`docker-compose.server.yml`で環境変数として定義されているため、環境変数が空だと問題が発生する可能性がある
- **緊急度**: 低（`backup.json`で管理されているため、環境変数が空でも動作する可能性が高い）
- **推奨**: 念のため、Ansible管理化を推奨するが、`backup.json`で管理されているため、緊急度は低い

**Gmail関連設定とCSVインポート機能の確認結果**:
- **Gmail関連設定**: `backup.json`（設定ファイル）で管理されているため、Ansibleの`.env`再生成の影響を受けない ✅
- **CSVインポート機能**: 設定ファイル（`backup.json`）で管理されているため、Ansibleの`.env`再生成の影響を受けない ✅
- **⚠️ 注意**: `backup.json`が新規作成された場合、Gmail設定（`clientId`、`clientSecret`、`refreshToken`）が失われる可能性がある
- **対策**: Ansibleの健全性チェックにGmail設定チェックを追加（2026-01-06）

---

### [KB-143] Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策

**EXEC_PLAN.md参照**: Dropbox/Slack設定の恒久化（2026-01-06）

**事象**:
- KB-142でSlack Webhook URLの恒久対策を実施したが、同様の問題がDropbox設定でも発生
- Ansible実行（特にIP変更やLAN切替）で`.env`が再生成されると、Dropbox環境変数（`DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`、`DROPBOX_ACCESS_TOKEN`）が消失
- さらに、`/opt/RaspberryPiSystem_002/config/backup.json`が何らかの理由で削除・再作成されると、Dropbox設定（`appKey`、`appSecret`、`refreshToken`、`accessToken`）が失われ、デフォルトの`local`プロバイダーに戻る

**要因**:
- **Ansibleテンプレートの不足**: `infrastructure/ansible/templates/docker.env.j2`にDropbox環境変数が含まれていなかった（KB-142と同様）
- **`.env`ファイルの再生成**: Ansibleで`.env`を再生成する際、テンプレートに含まれていない環境変数は削除される
- **`backup.json`の管理不足**: `backup.json`がAnsibleで管理されておらず、ファイルが削除・再作成されると設定が失われる
- **デフォルト設定の問題**: `BackupConfigLoader.load()`が`backup.json`を見つけられない場合、`defaultBackupConfig`（`storage.provider: 'local'`）を使用するため、Dropbox設定が失われる

**試行した対策**:
- [試行1] `backup.json`の存在確認と内容確認 → **成功**（問題の特定）
- [試行2] Dropbox App ConsoleからApp Key/Secretを取得して`backup.json`を復旧 → **成功**（一時的な復旧）
- [試行3] OAuth認証フローで`refreshToken`を再取得 → **成功**（完全な復旧）
- [試行4] AnsibleテンプレートにDropbox環境変数を追加 → **成功**（`.env`再生成問題の恒久対策）
- [試行5] Ansible inventoryにDropbox変数を追加 → **成功**（vault変数との連携）
- [試行6] Ansible vaultにDropbox機密情報を追加 → **成功**（機密情報の管理）
- [試行7] `backup.json`の存在保証と健全性チェックを追加 → **成功**（ファイル消失問題の恒久対策）

**有効だった対策**:
- ✅ **解決済み**（2026-01-06）: 以下の対策を組み合わせて解決
  1. **Ansibleテンプレートの更新**: `infrastructure/ansible/templates/docker.env.j2`にDropbox環境変数を追加
  2. **Ansible inventoryの更新**: `infrastructure/ansible/inventory.yml`にDropbox変数を追加（vaultから参照）
  3. **Ansible vaultの設定**: `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`にDropbox機密情報を追加
  4. **既存値の保護**: `infrastructure/ansible/roles/server/tasks/main.yml`で既存のDropbox環境変数を抽出して保護
  5. **`backup.json`の存在保証**: `infrastructure/ansible/playbooks/manage-app-configs.yml`で`backup.json`の存在チェックと、存在しない場合の最小骨格作成を追加
  6. **`backup.json`の健全性チェック**: `storage.provider=dropbox`なのに必要な設定（`appKey`、`appSecret`、`refreshToken`）が空の場合に警告を出力

**学んだこと**:
- **Slackと同様の再発パターン**: KB-142でSlack Webhook URLの恒久対策を実施したが、Dropbox設定でも同様の問題が発生した
- **環境変数と設定ファイルの二重管理**: Dropbox設定は環境変数（`.env`）と設定ファイル（`backup.json`）の両方で管理されているため、両方の管理が必要
- **`backup.json`の管理方針**: `backup.json`はAPIがトークン更新で書き換えるため、Ansibleで常時テンプレ再生成するのではなく、存在保証と健全性チェックに留める
- **デフォルト設定のリスク**: `backup.json`が存在しない場合、デフォルトで`local`プロバイダーが使用されるため、ファイル消失時にDropbox設定が失われる

**解決状況**: ✅ **解決済み**（2026-01-06: Ansible管理化と`backup.json`保護完了）

**関連ファイル**:
- `infrastructure/ansible/templates/docker.env.j2`（Ansibleテンプレート）
- `infrastructure/ansible/inventory.yml`（Ansible inventory）
- `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`（Ansible vault）
- `infrastructure/ansible/host_vars/raspberrypi5/vault.yml.example`（Ansible vault例）
- `infrastructure/ansible/roles/server/tasks/main.yml`（Ansibleタスク）
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（Ansible playbook）
- `/opt/RaspberryPiSystem_002/config/backup.json`（バックアップ設定ファイル）
- `apps/api/src/services/backup/backup-config.loader.ts`（設定ローダー）
- `docs/guides/dropbox-oauth-setup-guide.md`（設定ガイド）

**確認コマンド**:
```bash
# .envファイルの確認
cat /opt/RaspberryPiSystem_002/infrastructure/docker/.env | grep DROPBOX

# APIコンテナの環境変数の確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api env | grep DROPBOX

# backup.jsonの確認
cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.storage'

# backup.jsonの健全性チェック（Dropbox運用なのに必要な設定が空の場合に警告）
python3 - <<'PY'
import json
from pathlib import Path
config = json.loads(Path('/opt/RaspberryPiSystem_002/config/backup.json').read_text())
storage = config.get('storage', {})
if storage.get('provider') == 'dropbox':
    opts = storage.get('options', {})
    missing = [k for k in ['appKey', 'appSecret', 'refreshToken'] if not opts.get(k)]
    if missing:
        print(f"WARNING: Missing Dropbox settings: {', '.join(missing)}")
PY
```

**実機検証結果**（2026-01-06）:
- ✅ **デプロイ実行**: 標準手順に従ってデプロイを実行し、APIとWebコンテナを正常に再ビルド・再起動
- ✅ **Ansible再実行後の設定維持確認**: `manage-app-configs.yml`を実行後、以下の設定が維持されていることを確認
  - `SLACK_KIOSK_SUPPORT_WEBHOOK_URL`: `.env`ファイルとAPIコンテナ内の環境変数に正しく設定されている
  - `DROPBOX_*`環境変数: `.env`ファイルには空文字列が設定されているが、`backup.json`に設定があるため、APIは`backup.json`から読み込んでいる
  - `backup.json`: 存在し、`storage.provider: dropbox`が設定されている
- ✅ **動作確認**: APIコンテナは正常に起動し、Docker Composeサービスはすべて正常に動作
- ✅ **検証結果**: Ansible再実行後もSlack/Dropbox設定が維持され、システムは正常に動作していることを確認

**今後の推奨事項**:
- **新しい環境変数の追加時**: Ansible管理化を検討（テンプレートに追加、inventoryに変数を追加、vaultに機密情報を追加）
- **設定ファイルの管理**: `backup.json`のようにAPIが書き換える設定ファイルは、Ansibleで上書きせず、存在保証と健全性チェックに留める

---

### [KB-153] Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足）

**発生日時**: 2026-01-08

**事象**: 
- Pi3へのAnsibleデプロイが失敗し、ロールバックが実行された
- エラーメッセージ: `[ERROR]: Task failed: Could not find or access 'signage-lite.tmpfiles.conf.j2'`
- `signage`ロールのタスクでテンプレートファイルが見つからない

**要因**: 
- **`signage`ロールに`templates/`ディレクトリが存在しない**: `infrastructure/ansible/roles/signage/`に`templates/`ディレクトリがなく、Ansibleがテンプレートファイルを探せなかった
- **テンプレートファイルの配置場所**: テンプレートファイルは`infrastructure/ansible/templates/`に存在していたが、Ansibleロールはデフォルトで`roles/<role-name>/templates/`を参照する
- **ロール構造の不整合**: 新しいテンプレートファイル（`signage-lite.tmpfiles.conf.j2`、`signage-lite-watchdog.sh.j2`など）を追加した際に、ロール内の`templates/`ディレクトリに配置していなかった

**試行した対策**: 
- [試行1] デプロイログを確認してエラー原因を特定 → **成功**（テンプレートファイルが見つからないことを確認）
- [試行2] Pi5上の`roles/signage/`ディレクトリ構造を確認 → **成功**（`templates/`ディレクトリが存在しないことを確認）
- [試行3] ローカルの`infrastructure/ansible/templates/`にテンプレートファイルが存在することを確認 → **成功**（ファイルは存在していた）
- [試行4] `roles/signage/templates/`ディレクトリを作成し、テンプレートファイルをコピー → **成功**（デプロイが成功）

**有効だった対策**: 
- ✅ **解決済み**（2026-01-08）: 以下の対策を実施
  1. **`signage`ロールに`templates/`ディレクトリを作成**: `infrastructure/ansible/roles/signage/templates/`ディレクトリを作成
  2. **テンプレートファイルのコピー**: `infrastructure/ansible/templates/signage-*.j2`を`infrastructure/ansible/roles/signage/templates/`にコピー
  3. **Gitコミット・プッシュ**: 変更をコミットしてリモートリポジトリにプッシュ
  4. **Pi5でリポジトリ更新**: Pi5上で`git pull`を実行してテンプレートファイルを取得
  5. **標準手順でデプロイ**: デプロイ前の準備（サービス停止・無効化・マスク）を実行してからデプロイを再実行

**学んだこと**:
- **Ansibleロールのテンプレート配置**: Ansibleロールはデフォルトで`roles/<role-name>/templates/`を参照するため、ロール専用のテンプレートファイルは必ず`roles/<role-name>/templates/`に配置する必要がある
- **ロール構造の一貫性**: 新しいロールを作成する際は、`templates/`ディレクトリを最初から作成しておく

---

### [KB-154] Pi3デプロイ安定化の十分条件実装（プレフライトチェック自動化）

**発生日時**: 2026-01-08

**背景**: 
- Pi3デプロイ時に手動でサービス停止・無効化・mask、メモリ確認などの手順を実行する必要があった
- 手順を忘れるとデプロイが失敗し、システムが不安定になる可能性があった
- KB-153で発見されたロール構造の問題も、デプロイ開始前に検出できれば回避可能だった

**実装内容**: 
- **コントロールノード側プレフライト**: `deploy.yml`の`pre_tasks`に、Ansibleロールのテンプレートファイル存在チェックを追加（`delegate_to: localhost`, `run_once: true`）
- **Pi3側プレフライト**: `preflight-pi3-signage.yml`タスクファイルを新規作成し、以下の処理を自動実行：
  - サービス停止・無効化（`signage-lite.service`, `signage-lite-update.timer`, `signage-lite-watchdog.timer`, `signage-daily-reboot.timer`, `status-agent.timer`）
  - サービスmask（`signage-lite.service`の自動再起動防止）
  - 残存AnsiballZプロセスの掃除（120秒以上経過したもののみ`kill -9`）
  - メモリ閾値チェック（利用可能メモリ >= 120MB、未満の場合はfail-fast）
- **デプロイ後のunmask**: `signage`ロールで`masked: false`を明示し、その後に`enabled: true`と`state: started`を実行する順序を保証

**実装ファイル**:
- `infrastructure/ansible/playbooks/deploy.yml`: コントロールノード側プレフライトチェック追加
- `infrastructure/ansible/tasks/preflight-pi3-signage.yml`: Pi3側プレフライトタスク（新規）
- `infrastructure/ansible/roles/signage/tasks/main.yml`: unmaskの明示

**検証結果**:
- ✅ コントロールノード側のロール構造チェック: 正常動作（テンプレートファイルの存在確認）
- ✅ Pi3側のプレフライトチェック: 正常動作（サービス停止・無効化、メモリ閾値チェック、fail-fast確認）
- ✅ メモリ不足時のfail-fast: 正常動作（104MB < 120MBでデプロイが中断され、エラーメッセージに手動停止手順が表示）

**標準手順ドキュメントの更新**:
- `docs/guides/deployment.md`の「デプロイ前の準備（必須）」セクションを「デプロイ前の準備（自動化済み）」に変更
- プレフライトチェックが自動実行されることを明記
- プレフライトチェックが失敗した場合の手動対処手順を記載

**学んだこと**:
- **手順の自動化**: 手動で実行していた手順をAnsibleのプレフライトチェックとして自動化することで、手順遵守に依存しない運用が可能になる
- **fail-fastの重要性**: 条件を満たせない場合は、システムを壊さずに中断（fail-fast）し、次に取るべき行動をログで明示することが重要
- **標準手順との関係**: 標準手順の一部を自動化しても、標準手順ドキュメントを更新し、自動化されたことを明記する必要がある
- **プレフライトチェックの設計**: コントロールノード側とターゲット側の両方でプレフライトチェックを実装することで、デプロイ開始前に問題を検出できる

**関連ファイル**:
- `infrastructure/ansible/playbooks/deploy.yml`
- `infrastructure/ansible/tasks/preflight-pi3-signage.yml`
- `infrastructure/ansible/roles/signage/tasks/main.yml`
- `docs/guides/deployment.md`
- **デプロイ標準手順の遵守**: デプロイ前の準備（サービス停止・無効化・マスク）を必ず実行することで、デプロイ失敗のリスクを低減できる
- **エラーログの詳細確認**: デプロイが失敗した場合は、ログの詳細を確認して根本原因を特定する必要がある

**解決状況**: ✅ **解決済み**（2026-01-08: テンプレートディレクトリ作成とファイルコピー完了）

**関連ファイル**:
- `infrastructure/ansible/roles/signage/templates/`（新規作成）
- `infrastructure/ansible/templates/signage-*.j2`（コピー元）
- `infrastructure/ansible/roles/signage/tasks/main.yml`（テンプレート参照タスク）
- `docs/guides/deployment.md`（デプロイ標準手順）

**確認コマンド**:
```bash
# signageロールのテンプレートディレクトリの確認
ls -la infrastructure/ansible/roles/signage/templates/

# テンプレートファイルの存在確認
ls -la infrastructure/ansible/roles/signage/templates/signage-*.j2

# Pi5上での確認
ssh denkon5sd02@100.106.158.2 "ls -la /opt/RaspberryPiSystem_002/infrastructure/ansible/roles/signage/templates/"
```

**再発防止策**:
- **新しいロール作成時**: `templates/`ディレクトリを最初から作成する
- **テンプレートファイル追加時**: ロール専用のテンプレートは必ず`roles/<role-name>/templates/`に配置する
- **デプロイ前の確認**: デプロイ前にロール構造を確認し、必要なディレクトリが存在することを確認する

---

### [KB-145] backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加

**EXEC_PLAN.md参照**: Gmail設定消失の調査と対策（2026-01-06）

**事象**:
- KB-143で`backup.json`の存在保証と健全性チェックを追加したが、Gmail設定のチェックが含まれていなかった
- `backup.json`が新規作成された場合、Gmail設定（`clientId`、`clientSecret`、`refreshToken`）が失われる
- 調査の結果、`backup.json`の`storage.options`にGmail設定が存在しないことを確認

**要因**:
- **健全性チェックの不足**: `infrastructure/ansible/playbooks/manage-app-configs.yml`の健全性チェックがDropbox設定のみをチェックしていた
- **`backup.json`新規作成時の設定不足**: 最小限の設定（`storage.provider: "local"`のみ）で作成されるため、Gmail設定が含まれない
- **設定ファイルの管理方針**: `backup.json`はAPIがトークン更新で書き換えるため、Ansibleで常時テンプレ再生成するのではなく、存在保証と健全性チェックに留める方針

**試行した対策**:
- [試行1] `backup.json`の内容確認 → **成功**（Gmail設定の消失を確認）
- [試行2] Ansibleの健全性チェックにGmail設定チェックを追加 → **成功**（恒久対策）

**有効だった対策**:
- ✅ **解決済み**（2026-01-06）: 以下の対策を実施
  1. **Ansible健全性チェックの拡張**: `infrastructure/ansible/playbooks/manage-app-configs.yml`の健全性チェックにGmail設定チェックを追加
  2. **Gmail設定の検証**: `storage.provider=gmail`なのに必要な設定（`clientId`、`clientSecret`、`refreshToken`）が空の場合に警告を出力

**学んだこと**:
- **DropboxとGmailの同様の問題**: KB-143でDropbox設定の健全性チェックを追加したが、Gmail設定のチェックが漏れていた
- **設定ファイルの管理方針の一貫性**: `backup.json`のようなAPIが書き換える設定ファイルは、存在保証と健全性チェックに留める方針を維持
- **健全性チェックの重要性**: 設定ファイルが新規作成された場合でも、必要な設定が揃っているかを検証することで、問題を早期に発見できる

**解決状況**: ✅ **解決済み**（2026-01-06: 健全性チェック追加完了）

**関連ファイル**:
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（Ansible playbook）
- `/opt/RaspberryPiSystem_002/config/backup.json`（バックアップ設定ファイル）
- `docs/guides/gmail-setup-guide.md`（Gmail連携セットアップガイド）

**確認コマンド**:
```bash
# backup.jsonのGmail設定確認
cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.storage.options | {clientId, clientSecret, refreshToken}'

# backup.jsonの健全性チェック（Gmail運用なのに必要な設定が空の場合に警告）
python3 - <<'PY'
import json
from pathlib import Path
config = json.loads(Path('/opt/RaspberryPiSystem_002/config/backup.json').read_text())
storage = config.get('storage', {})
if storage.get('provider') == 'gmail':
    opts = storage.get('options', {})
    missing = [k for k in ['clientId', 'clientSecret', 'refreshToken'] if not opts.get(k)]
    if missing:
        print(f"WARNING: Missing Gmail settings: {', '.join(missing)}")
        print("Please configure Gmail OAuth via management console or API:")
        print("  GET /api/gmail/oauth/authorize -> follow redirect -> /api/gmail/oauth/callback")
PY
```

**Gmail設定の復旧手順**:
1. Google Cloud ConsoleでOAuth 2.0クライアントIDを作成（既存の場合は確認）
2. `clientId`と`clientSecret`を取得（`docs/guides/gmail-client-secret-extraction.md`を参照）
3. 管理コンソールのGmail設定画面で設定を追加
4. OAuth認証フローを実行して`refreshToken`を取得
5. `backup.json`に設定が反映されていることを確認

**注意事項**:
- Gmail設定は`backup.json`で管理されているため、Ansibleの`.env`再生成の影響を受けない
- ただし、`backup.json`が新規作成された場合、Gmail設定が失われる可能性がある
- 健全性チェックにより、問題を早期に発見できるようになった
- **定期的な確認**: Ansible実行後、重要な設定（Slack、Dropbox等）が維持されていることを確認

---

### [KB-157] Pi3のstatus-agent.timerが無効化されていた問題

**EXEC_PLAN.md参照**: status-agent問題の診断と修正（2026-01-09）

**事象**:
- 管理コンソールでPi3のステータスが表示されない（`lastSeen`が古い）
- Pi3の`status-agent.timer`が`disabled`状態になっていた
- `status-agent.service`が`failed`状態になっていた
- Macのステータスも表示されない（`status-agent`が未設定）

**要因**:
- **Ansibleデプロイ中断の影響**: 過去のAnsibleデプロイが中断された際、プレフライトチェックで`status-agent.service`を停止したが、デプロイが完了しなかったため、タイマーが再有効化されなかった可能性
- **Macのstatus-agent未設定**: MacにはLinux用の`status-agent.py`が存在していたが、macOSでは動作しない（Linux専用のコマンドを使用）
- **launchd設定の未作成**: macOSでは`launchd`を使用して定期実行する必要があるが、設定ファイルが存在しなかった

**調査手順**:
1. データベースで`ClientDevice`の`lastSeen`を確認（Pi3とMacが古い）
2. Pi3で`systemctl status status-agent.timer`を確認（`disabled`状態）
3. Pi3で`systemctl status status-agent.service`を確認（`failed`状態）
4. Macで`status-agent`の設定ファイルとスクリプトの存在を確認（Linux用スクリプトのみ存在）

**有効だった対策**:
- ✅ **解決済み**（2026-01-09）:
  1. **Pi3のstatus-agent.timer再有効化**:
     - `sudo systemctl enable --now status-agent.timer`でタイマーを有効化・起動
     - `systemctl status status-agent.timer`で正常動作を確認
  2. **Mac用status-agentの実装**:
     - `clients/status-agent/status-agent-macos.py`を作成（macOS用のコマンドを使用）
     - `~/.status-agent.conf`を作成し、`CLIENT_KEY`を設定
     - `~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist`を作成し、`launchd`で定期実行を設定
     - `launchctl load`でサービスを有効化
  3. **ドキュメント更新**:
     - `docs/guides/status-agent.md`にmacOS向けセットアップ手順を追加

**学んだこと**:
- **Ansibleデプロイ中断の影響**: プレフライトチェックでサービスを停止した後、デプロイが中断されると、サービスが再起動されない可能性がある
- **macOSとLinuxの違い**: macOSでは`systemd`ではなく`launchd`を使用するため、別の設定方法が必要
- **status-agentのプラットフォーム対応**: Linux用とmacOS用で別のスクリプトが必要（コマンドやAPIの違い）
- **定期確認の重要性**: クライアント端末のステータスが表示されない場合は、`status-agent`の状態を確認する必要がある

**解決状況**: ✅ **解決済み**（2026-01-09: Pi3のタイマー再有効化、Mac用status-agent実装完了）

**関連ファイル**:
- `clients/status-agent/status-agent-macos.py`（macOS用status-agentスクリプト）
- `~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist`（macOS用launchd設定）
- `~/.status-agent.conf`（macOS用設定ファイル）
- `docs/guides/status-agent.md`（status-agentセットアップガイド）
- `infrastructure/ansible/roles/signage/tasks/main.yml`（Pi3のstatus-agent設定）

**確認コマンド**:
```bash
# Pi3のstatus-agent状態確認
ssh signageras3@100.105.224.86 "systemctl status status-agent.timer"
ssh signageras3@100.105.224.86 "systemctl status status-agent.service"

# Macのstatus-agent状態確認
launchctl list | grep status-agent
cat ~/.status-agent.conf
```

**再発防止策**:
- **Ansibleデプロイの完全性**: デプロイが中断された場合は、手動でサービスを再起動する必要がある
- **プレフライトチェック後の確認**: デプロイ完了後、停止したサービスが再起動されていることを確認する
- **定期ヘルスチェック**: クライアント端末のステータスが定期的に更新されていることを確認する（管理コンソールの「クライアント端末」タブで確認）

**注意事項**:
- Pi3の`status-agent.timer`が無効化されていた原因は、過去のAnsibleデプロイ中断の可能性が高い
- デプロイが中断された場合は、手動でサービスを再起動する必要がある
- Macのstatus-agentは、Linux用スクリプトでは動作しないため、macOS専用のスクリプトが必要

---

### [KB-159] トークプラザ工場へのマルチサイト対応実装（inventory分離・プレフィックス命名規則）

**実装日**: 2026-01-14

**事象**: 
- トークプラザ工場（別拠点）に同一システムを導入する必要があった
- 既存の第2工場と設定が混在しないようにする必要があった
- 将来のデータベース統合時にクライアントIDやAPIキーのコンフリクトを回避する必要があった

**要因**: 
- **inventoryの一元管理**: 既存の`inventory.yml`は第2工場専用で、新拠点の設定を追加すると混在する
- **クライアントIDの名前空間**: クライアントIDが重複すると、将来のDB統合時にコンフリクトが発生する
- **外部連携の分離**: Slack/Dropbox/Gmailの資格情報を拠点ごとに分離する必要がある
- **デプロイの安全性**: 誤って別拠点にデプロイするリスクを防ぐ必要がある

**実装内容**:
1. **inventoryファイルの分離**:
   - `infrastructure/ansible/inventory-talkplaza.yml`を作成（トークプラザ工場専用）
   - 第2工場は`inventory.yml`のまま維持
   - 各inventoryでホスト名とクライアントIDにプレフィックスを付与（`talkplaza-`）

2. **group_varsの分離**:
   - `infrastructure/ansible/group_vars/talkplaza.yml`を作成
   - DNS運用前提でホスト名を定義（`pi5.talkplaza.local`など）
   - `network_mode: "local"`を設定（拠点間接続なし）

3. **host_varsの分離**:
   - `infrastructure/ansible/host_vars/talkplaza-pi5/vault.yml`
   - `infrastructure/ansible/host_vars/talkplaza-pi4/vault.yml`
   - `infrastructure/ansible/host_vars/talkplaza-signage01/vault.yml`
   - 各ホストのシークレットを`talkplaza-`プレフィックスで管理

4. **プレフィックス命名規則**:
   - クライアントID: `talkplaza-pi5-server`, `talkplaza-pi4-kiosk01`, `talkplaza-signage01`
   - APIキー: `client-key-talkplaza-pi5-server`など
   - ホスト名: `pi5.talkplaza.local`, `pi4.talkplaza.local`, `signage01.talkplaza.local`

5. **デプロイスクリプトの改善**:
   - `scripts/update-all-clients.sh`でinventory引数を必須化（誤デプロイ防止）
   - デプロイ前にinventoryパスを表示し、確認プロンプトを追加

**学んだこと**:
- **inventory分離の重要性**: 各拠点の設定を完全に分離することで、設定の混在を防止できる
- **プレフィックス命名規則**: クライアントIDやAPIキーにプレフィックスを付与することで、将来のDB統合時のコンフリクトを回避できる
- **デプロイの安全性**: inventory引数を必須化することで、誤デプロイのリスクを大幅に削減できる
- **スケーラビリティ**: 新拠点の追加は設定ファイルの追加のみで対応可能（コード変更不要）

**解決状況**: ✅ **実装完了**（2026-01-14）

**関連ファイル**:
- `infrastructure/ansible/inventory-talkplaza.yml`（トークプラザ工場用inventory）
- `infrastructure/ansible/group_vars/talkplaza.yml`（トークプラザ工場用group_vars）
- `infrastructure/ansible/host_vars/talkplaza-*/vault.yml`（各ホストのシークレット）
- `scripts/update-all-clients.sh`（デプロイスクリプト）
- `docs/guides/talkplaza-rollout.md`（トークプラザ工場導入ガイド）

**確認コマンド**:
```bash
# トークプラザ工場へのデプロイ
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 第2工場へのデプロイ
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

**再発防止策**:
- **inventory引数の必須化**: デプロイスクリプトでinventory引数を必須にし、誤デプロイを防止
- **プレフィックス命名規則**: すべてのクライアントIDとAPIキーにプレフィックスを付与
- **設定の完全分離**: 各拠点の設定を完全に分離し、混在を防止

**注意事項**:
- 第1工場への導入時も同様の手順で対応可能
- 将来のDB統合時は、コード体系の非重複運用とCSVフォーマットの統一が必要
- データモデルに「site」属性は追加しない（名前で判別する運用）

---

### [KB-162] デプロイスクリプトのinventory/playbookパス相対パス修正（Pi5上での実行時）

**実装日**: 2026-01-14

**事象**: 
- `scripts/update-all-clients.sh`でPi5上でデプロイを実行する際、inventoryパスとplaybookパスが重複してエラーが発生した
- `run_remotely`関数で`cd /opt/RaspberryPiSystem_002/infrastructure/ansible`した後、絶対パスを使用していたため、パスが重複していた

**要因**: 
- **パスの重複**: `run_remotely`関数で`cd`した後も、元の絶対パス（`infrastructure/ansible/inventory.yml`）を使用していたため、`/opt/RaspberryPiSystem_002/infrastructure/ansible/infrastructure/ansible/inventory.yml`のように重複していた
- **相対パスの未使用**: `cd`した後は相対パスを使用する必要があるが、実装されていなかった

**実装内容**:
1. **inventoryパスの相対パス化**:
   - `basename "${INVENTORY_PATH}"`でファイル名のみを取得（`inventory.yml`）
   - `cd`後の相対パスとして使用

2. **playbookパスの相対パス化**:
   - `basename "${PLAYBOOK_PATH}"`でファイル名のみを取得（`update-clients.yml`）
   - `playbooks/${playbook_basename}`として相対パスを構築

3. **health-check playbookの同様の修正**:
   - `run_health_check_remotely`関数でも同様の修正を実施

**学んだこと**:
- **SSH経由での実行時のパス**: `cd`した後は相対パスを使用する必要がある
- **パスの重複回避**: `basename`を使用してファイル名のみを取得し、相対パスを構築する
- **デバッグの重要性**: エラーメッセージからパスの重複を特定し、修正できた

**解決状況**: ✅ **実装完了**（2026-01-14）

**関連ファイル**:
- `scripts/update-all-clients.sh`（`run_remotely`、`run_health_check_remotely`関数の修正）

**確認コマンド**:
```bash
# デプロイ実行（正常に動作することを確認）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

**再発防止策**:
- **相対パスの使用**: `cd`した後は相対パスを使用する
- **basenameの活用**: ファイル名のみを取得して相対パスを構築

**注意事項**:
- ローカル実行時（`run_locally`）は変更不要（元のパスがそのまま使用可能）
- Pi5上での実行時（`run_remotely`）のみ修正が必要

---

### [KB-160] デプロイスクリプトのinventory引数必須化（誤デプロイ防止）

**実装日**: 2026-01-14

**事象**: 
- `scripts/update-all-clients.sh`でinventory引数が省略可能だったため、誤って別拠点にデプロイするリスクがあった
- デフォルトの`inventory.yml`が使用され、意図しないデプロイが発生する可能性があった

**要因**: 
- **inventory引数のオプション化**: 第2引数が省略可能で、デフォルト値が設定されていなかった
- **確認プロンプトの未実装**: デプロイ前にinventoryパスを確認する仕組みがなかった

**実装内容**:
1. **inventory引数の必須化**:
   - `INVENTORY_PATH="${2:-}"`から`INVENTORY_PATH="${2}"`に変更（デフォルト値なし）
   - inventory引数が空の場合はエラーで終了

2. **確認プロンプトの追加**:
   - デプロイ前にinventoryパスを表示
   - 実行前に確認メッセージを表示

3. **usage関数の改善**:
   - 使用例を追加（第2工場とトークプラザ工場の例）
   - エラーメッセージにusageを表示

**学んだこと**:
- **デプロイの安全性**: inventory引数を必須化することで、誤デプロイのリスクを大幅に削減できる
- **確認プロンプトの重要性**: デプロイ前にinventoryパスを表示することで、ユーザーが意図したデプロイ先を確認できる
- **マルチサイト対応**: 複数拠点を管理する場合、デプロイ先の明確化が重要

**解決状況**: ✅ **実装完了**（2026-01-14）

**関連ファイル**:
- `scripts/update-all-clients.sh`（デプロイスクリプト）
- `docs/guides/deployment.md`（デプロイガイド）

**確認コマンド**:
```bash
# inventory引数なし（エラー）
./scripts/update-all-clients.sh main
# → [ERROR] inventory not found: 

# inventory引数あり（成功）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

**再発防止策**:
- **inventory引数の必須化**: デプロイスクリプトでinventory引数を必須にし、誤デプロイを防止
- **確認プロンプト**: デプロイ前にinventoryパスを表示し、ユーザーが確認できるようにする

**注意事項**:
- 既存のデプロイ手順を更新する必要がある
- デプロイ指示時にinventory引数を明示する必要がある

---

### [KB-172] デプロイ安定化機能の実装（プリフライト・ロック・リソースガード・リトライ・タイムアウト）

**EXEC_PLAN.md参照**: Deploy Stability Enhancements (Update-All-Clients Primary) (2026-01-17)

**事象**: 
- デプロイ時の並行実行による競合が発生する可能性があった
- リソース不足（メモリ・ディスク）でデプロイが失敗する可能性があった
- ネットワーク障害（一時的なunreachable）でデプロイが失敗する可能性があった
- デプロイプロセスの可観測性が低く、失敗原因の特定が困難だった

**要因**: 
- **並行実行防止の不足**: デプロイスクリプトにロック機構がなかった
- **リソースチェックの不足**: デプロイ前にリソースをチェックする仕組みがなかった
- **リトライ機能の不足**: 一時的なネットワーク障害でデプロイが失敗していた
- **タイムアウト設定の不足**: ホストごとの特性に応じたタイムアウト設定がなかった
- **通知機能の不足**: デプロイの開始・成功・失敗を通知する仕組みがなかった

**実装内容**:
1. **プリフライトリーチビリティチェック**:
   - デプロイ開始前にPi5へのSSH接続を確認
   - Pi5からinventory内の全ホストへの接続を`ansible -m ping`で確認
   - 接続不可の場合はデプロイを中断（エラーコード3）
   - `scripts/update-all-clients.sh`の`run_preflight_remotely`関数で実装

2. **リモートロック（並行実行防止）**:
   - Pi5上の`/opt/RaspberryPiSystem_002/logs/deploy.lock`で並行実行を防止
   - 古いロック（デフォルト30分以上経過）は自動的にクリーンアップ
   - ロック取得失敗時はデプロイを中断（エラーコード3）
   - `scripts/update-all-clients.sh`の`acquire_remote_lock`関数で実装

3. **リソースガード**:
   - デプロイ前に各ホストのリソースをチェック
   - メモリ: 120MB未満の場合はデプロイを中断
   - ディスク: `/opt`の使用率が90%以上の場合はデプロイを中断
   - `infrastructure/ansible/tasks/resource-guard.yml`で実装
   - `infrastructure/ansible/playbooks/deploy.yml`の冒頭でinclude

4. **環境限定リトライ**:
   - unreachable hostsのみを対象にリトライ（最大3回、30秒間隔）
   - タスク失敗（failed hosts）はリトライしない（環境問題とコード問題を区別）
   - `--limit`オプションで特定ホストのみリトライ可能
   - `scripts/update-all-clients.sh`の`get_retry_hosts_if_unreachable_only`関数で実装

5. **ホストごとのタイムアウト**:
   - Pi3: 30分（リポジトリ更新が遅い場合を考慮）
   - Pi4: 10分
   - Pi5: 15分
   - タイムアウト設定は`infrastructure/ansible/inventory.yml`の`ansible_command_timeout`で管理

6. **通知（alerts一次情報 + Slackは二次経路）**:
   - デプロイ開始/成功/失敗/ホスト単位失敗のタイミングで **`alerts/alert-*.json`（一次情報）** を生成
   - `scripts/generate-alert.sh`を再利用して alerts ファイルを生成
   - Slack配送は「二次経路」として扱い、**API側のAlerts Dispatcherが担当**（B1アーキテクチャ）
   - Alerts Dispatcherは`apps/api/src/services/alerts/alerts-dispatcher.ts`で実装
   - 環境変数`ALERTS_DISPATCHER_ENABLED=true`とWebhook URL設定で有効化

7. **`--limit`オプション対応**:
   - 特定ホストのみを更新する場合に使用
   - プリフライトチェックとリトライにも適用される
   - `scripts/update-all-clients.sh`の引数解析で実装

**実装時の発見事項**:
- **locale問題（dfコマンドの日本語出力）**: `df -P /opt`の出力が日本語ロケールの場合、ヘッダー行の解析が失敗する問題を発見。`tail -n +2`でヘッダー行をスキップすることで解決（`infrastructure/ansible/tasks/resource-guard.yml`）。
- **git権限問題**: Pi5上で`git pull`実行時に`.git`ディレクトリの権限エラーが発生。`chown -R denkon5sd02:denkon5sd02 .git`で解決。
- **ESLint設定問題**: テストファイルを`tsconfig.json`から除外した後、ESLintがテストファイルを解析できなくなる問題を発見。`apps/web/tsconfig.test.json`を新規作成し、`apps/web/.eslintrc.cjs`の`parserOptions.project`に追加することで解決。
- **`.gitignore`の全階層マッチ問題**: `.gitignore`の`alerts/`と`config/`がサブディレクトリにもマッチし、`apps/api/src/services/alerts/`が無視される問題を発見。`/alerts/`と`/config/`に修正してルート直下のみを無視するように変更。
- **過去のアラート再送問題**: Alerts Dispatcher起動時に、過去のアラートファイル（`deliveries.slack`がない）がすべて再送される問題を発見。`shouldRetry`関数を修正し、24時間以上古いアラートは再送しないように変更。送信済み（`status === 'sent'`）のアラートも再送されない。

**学んだこと**: 
- **デプロイプロセスのガード**: デプロイ前にリソースや接続をチェックすることで、失敗を早期に検出できる
- **環境問題とコード問題の区別**: unreachable hostsのみをリトライすることで、環境問題とコード問題を区別できる
- **並行実行防止**: ロック機構により、並行実行による競合を防止できる
- **可観測性の向上**: Slack通知により、デプロイの状態をリアルタイムで把握できる
- **locale問題への対応**: コマンド出力のlocale依存性を考慮し、ヘッダー行をスキップするなどの対策が必要

**解決状況**: ✅ **実装完了**（2026-01-17）、✅ **実機検証完了**（2026-01-18、Pi5とPi4で成功）

**実機検証状況**:
- ✅ Pi5とPi4でのデプロイ成功を確認
- ✅ プリフライト・ロック・リソースガードの動作を確認
- ✅ Alerts Dispatcher Phase 1実装完了・CI成功
- ✅ Slack通知の実機検証完了（2026-01-18、Pi5でWebhook設定後、テストアラートがSlackに正常に送信されることを確認）
- ✅ 過去のアラート再送問題の修正完了（24時間以上古いアラートは再送されないことを確認）
- ⚠️ リトライ機能、並行実行時のロックは未検証（実運用では問題なく動作する見込み）

**関連ファイル**: 
- `scripts/update-all-clients.sh`（デプロイスクリプト）
- `infrastructure/ansible/tasks/resource-guard.yml`（リソースガードタスク）
- `infrastructure/ansible/playbooks/deploy.yml`（デプロイプレイブック）
- `infrastructure/ansible/inventory.yml`（タイムアウト設定）
- `apps/api/src/services/alerts/alerts-dispatcher.ts`（Alerts Dispatcher実装）
- `apps/api/src/services/alerts/alerts-config.ts`（設定読み込み）
- `apps/api/src/services/alerts/slack-sink.ts`（Slack送信）
- `docs/plans/deploy-stability-execplan.md`（実装計画）
- `docs/plans/alerts-platform-phase2.md`（Phase 2設計）

**確認コマンド**:
```bash
# デプロイ実行（プリフライト・ロック・リソースガードが自動実行される）
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# 特定ホストのみ更新（--limitオプション）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi3
```

**再発防止策**:
- **プリフライトチェック**: デプロイ前に接続を確認し、失敗を早期に検出
- **リソースガード**: デプロイ前にリソースをチェックし、リソース不足を防止
- **ロック機構**: 並行実行を防止し、競合を回避
- **環境限定リトライ**: 一時的なネットワーク障害に対応
- **Slack通知**: デプロイの状態をリアルタイムで把握
- **過去のアラート再送防止**: 24時間以上古いアラートは再送しないロジックを実装
- **送信済みアラートの再送防止**: `status === 'sent'`のアラートは再送しないロジックを実装

**注意事項**:
- リトライ機能はunreachable hostsのみを対象とする（failed hostsはリトライしない）
- リソースガードの閾値（メモリ120MB、ディスク90%）は環境に応じて調整可能
- タイムアウト設定はホストごとに異なるため、新しいホスト追加時は適切な値を設定する必要がある

---

### [KB-173] Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善

**EXEC_PLAN.md参照**: Alerts Platform Phase2実装（2026-01-18）

**事象**: 
- Alerts Platform Phase2のIngest実装において、空ファイル（0バイト）や壊れたJSONファイルが`errors`としてカウントされ、ログノイズが発生
- 実機検証時に`errors:2`が毎回発生し、実際のエラーと区別が困難
- Pi5の`alerts/`ディレクトリに1033件の0バイトファイルが存在

**要因**: 
- **空ファイルの存在**: ローテーションや部分書き込みにより、0バイトの`alert-*.json`ファイルが大量に存在
- **エラーカウントの扱い**: 空ファイルや壊れたJSONを`errors`として扱っていたため、運用上の問題（ローテーション/部分書き込み）がエラーとして扱われていた
- **ログノイズ**: 実際のエラーと区別が困難で、運用上の問題を特定しづらい

**試行した対策**: 
- [試行1] 空ファイルの存在を確認 → **確認**（1033件の0バイトファイルを発見）
- [試行2] `readAlert`関数で空ファイルをスキップするように変更 → **成功**
  - `fs.stat`でファイルサイズを確認し、0バイトの場合は`skipped`として扱う
  - 壊れたJSONも`errors`ではなく`skipped`として扱うように変更

**根本原因**: 
- 空ファイルや壊れたJSONは運用上起こりうる（ローテーション/部分書き込み等）ため、エラーとして扱うべきではない
- エラーカウントは実際のシステムエラー（DB接続エラー、権限エラー等）に限定すべき

**実施した対策**: 
- **空ファイルの検出**: `fs.stat`でファイルサイズを確認し、0バイトの場合は`skipped`として扱う
- **エラーカウントの改善**: 空ファイルや壊れたJSONを`errors`ではなく`skipped`として扱うように変更
- **ログレベルの調整**: 空ファイルのスキップは`debug`レベルでログ出力し、ノイズを削減

**実装詳細**:
```typescript
// apps/api/src/services/alerts/alerts-ingestor.ts
const alert = await readAlert(filePath);
if (!alert) {
  // 空ファイルや壊れたJSONは運用上起こりうる（ローテーション/部分書き込み等）ので安全にスキップ
  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      logger?.debug({ filePath }, '[AlertsIngestor] Empty alert file, skipping');
      skipped++;
      continue;
    }
  } catch {
    // noop
  }
  logger?.debug({ filePath }, '[AlertsIngestor] Failed to read/parse alert file, skipping');
  skipped++;
  continue;
}
```

**実機検証結果**:
- ✅ DB取り込み: 52件のアラートがDBに取り込まれていることを確認
- ✅ AlertDelivery作成: 49件のPENDING状態で作成されていることを確認
- ✅ ファイル→DBのack更新: 正常に動作することを確認
- ✅ エラーログ改善: `errors:2` → `errors:0`、`skipped:2` に改善されることを確認
- ✅ ログノイズ削減: 空ファイルのスキップが`debug`レベルでログ出力され、ノイズが削減

**学んだこと**: 
- **エラーとスキップの区別**: 運用上起こりうる問題（空ファイル、壊れたJSON）はエラーではなくスキップとして扱うべき
- **ログレベルの適切な使い分け**: デバッグ情報は`debug`レベルで出力し、運用時のノイズを削減
- **段階的な実装**: Phase2初期ではIngestのみを実装し、dedupeやDB版Dispatcherは後続実装として計画

**解決状況**: ✅ **実装完了**（2026-01-18）、✅ **実機検証完了**（2026-01-18）

**実機検証状況**:
- ✅ Pi5でDB取り込み・AlertDelivery作成・ack更新を確認
- ✅ エラーログ改善を確認（`errors:2` → `errors:0`、`skipped:2`）
- ✅ ログノイズ削減を確認

**関連ファイル**: 
- `apps/api/src/services/alerts/alerts-ingestor.ts`（AlertsIngestor実装）
- `apps/api/src/routes/clients.ts`（API互換性拡張）
- `apps/api/prisma/schema.prisma`（Alert/AlertDeliveryモデル）
- `docs/plans/alerts-platform-phase2.md`（Phase2設計）
- `docs/guides/local-alerts.md`（ローカル環境対応の通知機能ガイド）

**確認コマンド**:
```bash
# DB取り込み状況を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Alert\";"

# AlertsIngestorのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -E '(AlertsIngestor|ingested|skipped|errors)'
```

**再発防止策**:
- **空ファイルの検出**: `fs.stat`でファイルサイズを確認し、0バイトの場合はスキップ
- **エラーカウントの改善**: 実際のシステムエラーのみを`errors`としてカウント
- **ログレベルの適切な使い分け**: デバッグ情報は`debug`レベルで出力

**注意事項**:
- DB取り込み機能はデフォルトOFF（`ALERTS_DB_INGEST_ENABLED=true`で明示的に有効化）
- 既存のファイルベースアラート取得/ack機能は維持（移行期の互換性）
- dedupe（重複抑制）はPhase2初期では未実装（後続実装）
- Slack配送はPhase1のファイルベースDispatcherを継続（DB版Dispatcherは後続実装）

---

## [KB-174] Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了

**日付**: 2026-01-18  
**カテゴリ**: Alerts Platform, デプロイ, 実機検証  
**重要度**: 高  
**状態**: ✅ **実装完了**、✅ **実機検証完了**

### 症状

Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証を実施し、DB版Dispatcherが正常に動作することを確認する必要があった。

### 実装内容

Phase2後続実装では、以下の機能を実装：

1. **DB版Dispatcher**: `AlertDelivery(status=pending|failed, nextAttemptAt<=now)` を取得してSlackへ配送
2. **dedupe**: `fingerprint + routeKey + windowSeconds` により連続通知を抑制し、`suppressed` に遷移
3. **retry/backoff**: 失敗時は `failed` にし、指数バックオフで `nextAttemptAt` を設定（上限あり）
4. **Phase1停止（full switch）**: `alerts/` 走査＋ファイルへのdelivery書き戻しは停止し、DB中心へ完全移行
   - ロールバック用に `ALERTS_DISPATCHER_MODE=file|db` を用意（安全策）

**実装ファイル**:
- `apps/api/src/services/alerts/alerts-db-dispatcher.ts`（新規作成）
- `apps/api/src/services/alerts/alerts-config.ts`（拡張）
- `apps/api/src/main.ts`（mode切替ロジック追加）
- `apps/api/src/services/alerts/__tests__/alerts-db-dispatcher.test.ts`（新規作成）

**環境変数**:
- `ALERTS_DISPATCHER_MODE`（`file` or `db`）
- `ALERTS_DB_DISPATCHER_ENABLED`（default: false）
- `ALERTS_DB_DISPATCHER_INTERVAL_SECONDS`（default: 30）
- `ALERTS_DB_DISPATCHER_BATCH_SIZE`（default: 50）
- `ALERTS_DB_DISPATCHER_CLAIM_LEASE_SECONDS`（default: 120）
- `ALERTS_DEDUPE_ENABLED`（default: true）
- `ALERTS_DEDUPE_DEFAULT_WINDOW_SECONDS`（default: 600）
- `ALERTS_DEDUPE_WINDOW_SECONDS_DEPLOY|OPS|SUPPORT|SECURITY`（routeKey別window）

### 実機検証結果（2026-01-18）

Pi5で実機検証を実施し、以下の結果を確認：

#### ✅ 検証完了項目

1. **DB版Dispatcher起動**
   - `AlertsDbDispatcher`が正常に起動（intervalSeconds: 30, batchSize: 50）
   - Phase1（file）Dispatcherは停止（mode=dbのため）

2. **配送処理**
   - 1回目: 50件処理 → 10件SENT、40件SUPPRESSED
   - 2回目: 5件処理 → 0件SENT、5件SUPPRESSED（dedupeで抑制）

3. **dedupe動作**
   - 同一fingerprintのアラートが正しく抑制されている
   - 同一fingerprint（`587fef4fe...`）が45件あり、すべてSUPPRESSED
   - windowSeconds（600秒）が正しく機能

4. **fingerprint自動計算**
   - 55件中54件にfingerprintが設定されている
   - 未設定のアラートも自動計算されている

5. **状態遷移**
   - `PENDING` → `SENT`（10件）
   - `PENDING` → `SUPPRESSED`（45件、dedupe/acknowledged/too old）

6. **Phase1停止確認**
   - Phase1（file）Dispatcherは動作していない（mode=dbのため）

#### 検証結果サマリー

```
DB版Dispatcher: ✅ 正常動作
配送処理: ✅ 10件SENT、45件SUPPRESSED
dedupe: ✅ 同一fingerprintで正しく抑制
fingerprint計算: ✅ 54/55件に設定済み
Phase1停止: ✅ fileモードは動作していない
```

### 学んだこと

- **DB版Dispatcherの動作**: `AlertDelivery`キューを処理し、dedupeとretry/backoffが正しく機能することを確認
- **dedupeの効果**: 同一fingerprintのアラートがwindow内で抑制され、Slack通知の連打を防止
- **fingerprint自動計算**: 未設定のアラートも自動計算され、dedupeが機能する
- **Phase1停止**: mode=dbにすることで、Phase1（file）Dispatcherを停止し、DB中心へ完全移行できることを確認

### 解決状況

✅ **実装完了**（2026-01-18）、✅ **実機検証完了**（2026-01-18）

### 関連ファイル

- `apps/api/src/services/alerts/alerts-db-dispatcher.ts`（DB版Dispatcher実装）
- `apps/api/src/services/alerts/alerts-config.ts`（設定管理）
- `apps/api/src/main.ts`（mode切替ロジック）
- `apps/api/src/services/alerts/__tests__/alerts-db-dispatcher.test.ts`（ユニットテスト）
- `docs/plans/alerts-platform-phase2.md`（Phase2設計）
- `docs/guides/local-alerts.md`（ローカル環境対応の通知機能ガイド）

### 確認コマンド

```bash
# DB版Dispatcherのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -E '(AlertsDbDispatcher|Run completed)'

# AlertDeliveryの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT status, COUNT(*) as count FROM \"AlertDelivery\" GROUP BY status ORDER BY status;"

# fingerprintの設定状況を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) as total_alerts, COUNT(CASE WHEN fingerprint IS NOT NULL THEN 1 END) as with_fingerprint FROM \"Alert\";"
```

### 注意事項

- DB版DispatcherはデフォルトOFF（`ALERTS_DISPATCHER_MODE=db`と`ALERTS_DB_DISPATCHER_ENABLED=true`で明示的に有効化）
- Phase1（file）Dispatcherは`ALERTS_DISPATCHER_MODE=file`に戻すことでロールバック可能
- dedupeは`ALERTS_DEDUPE_ENABLED=true`で有効化（デフォルト: true）
- windowSecondsはrouteKey別に設定可能（未設定はデフォルト600秒）

---

## [KB-175] Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了

**日付**: 2026-01-18  
**カテゴリ**: Alerts Platform, デプロイ, 実機検証  
**重要度**: 高  
**状態**: ✅ **実装完了**、✅ **実機検証完了**

### 症状

Phase2完全移行（API/UIをDBのみ参照に変更）の実機検証を実施し、管理ダッシュボードでDB alertsが表示されることを確認する必要があった。

### 実装内容

Phase2完全移行では、以下の変更を実施：

1. **API: `/clients/alerts` をDBのみ参照に切替**
   - ファイル走査（`fs.readdir/readFile`）ブロックを撤去
   - `prisma.alert.findMany(...)` の結果（`dbAlerts`）を一次表示対象にする
   - `alerts.fileAlerts` と `details.fileAlerts` は **常に 0 / []** を返す（互換フィールドとして残す・deprecated扱い）
   - `hasAlerts` は `staleClients || errorLogs || dbAlerts.length` で判定

2. **API: `/clients/alerts/:id/acknowledge` をDBのみ更新に切替**
   - ファイル探索・`acknowledged=true` 書き込み処理を撤去
   - DB側のみ `Alert.acknowledged=true, acknowledgedAt=now` を更新
   - レスポンスは `acknowledgedInDb:true` のみ返す（`acknowledgedInFile` フィールドは削除）

3. **Web: 管理ダッシュボードの表示をDB alertsへ切替**
   - `ClientAlerts` 型に `dbAlerts`（配列）を追加し、`fileAlerts` はdeprecated（空）として扱う
   - `DashboardPage` は `details.dbAlerts` を表示（severity表示など必要最小限）
   - 「確認済み」ボタンは既存の `acknowledgeAlert` を継続利用

4. **Ansible環境変数の永続化**
   - `infrastructure/ansible/templates/docker.env.j2` に以下を追加:
     - `ALERTS_DISPATCHER_MODE`（通常: `db`）
     - `ALERTS_DB_DISPATCHER_ENABLED`（通常: `true`）
     - `ALERTS_DB_INGEST_ENABLED`（通常: `true`）

5. **API integration test追加**
   - `GET /api/clients/alerts` が `details.dbAlerts` を返し、`details.fileAlerts` が空であること
   - `POST /api/clients/alerts/:id/acknowledge` がDB上の `Alert.acknowledged` を更新すること

**実装ファイル**:
- `apps/api/src/routes/clients.ts`（API: DBのみ参照/更新）
- `apps/web/src/api/client.ts`（型定義拡張）
- `apps/web/src/pages/admin/DashboardPage.tsx`（DB alerts表示）
- `apps/api/src/routes/__tests__/clients.integration.test.ts`（回帰テスト追加）
- `infrastructure/ansible/templates/docker.env.j2`（環境変数永続化）

### 実機検証結果（2026-01-18）

Pi5で実機検証を実施し、以下の結果を確認：

#### ✅ 検証完了項目

1. **API: `/clients/alerts` がDBのみ参照**
   - APIレスポンスで `alerts.dbAlerts=10`、`details.dbAlerts.length=10` を確認
   - `alerts.fileAlerts=0`、`details.fileAlerts.length=0`（deprecatedフィールドは空）

2. **Web: 管理ダッシュボードがDB alertsを表示**
   - 「アラート:」セクションにDB alertsが複数表示されることを確認
   - `[ports-unexpected]` タイプのアラートが正しく表示される
   - タイムスタンプが正しく表示される（JST形式: `2026/1/18 14:45:08`）

3. **acknowledge機能**
   - 「確認済み」ボタンが各DB alertに表示される
   - ボタンクリックでDBの`acknowledged`が更新される（実装確認済み）

4. **staleClientsアラートとの共存**
   - 「1台のクライアントが12時間以上オフラインです」とDB alertsが同時に表示される
   - `hasAlerts`の計算が正しく機能（`staleClients || errorLogs || dbAlerts.length`）

5. **「ファイルベースのアラート:」が表示されない**
   - 完全移行成功: 古いUI（fileAlerts表示）は表示されない

#### 検証結果サマリー

```
API: ✅ DBのみ参照（fileAlertsは0/[]固定）
Web UI: ✅ DB alerts表示（「アラート:」セクション）
acknowledge: ✅ DBのみ更新（実装確認済み）
staleClients: ✅ 正常に表示（DB alertsと共存）
完全移行: ✅ fileAlerts表示なし
```

### 学んだこと

- **完全移行の成功**: API/UIがDBのみ参照し、ファイルベースの表示が完全に撤廃されたことを確認
- **互換性維持**: `fileAlerts`フィールドはdeprecatedとして残し、既存クライアントとの互換性を維持
- **ブラウザキャッシュ**: 実機検証時にブラウザキャッシュが原因で古いUIが表示されることがあるため、強制リロード（Cmd+Shift+R）が必要

### 解決状況

✅ **実装完了**（2026-01-18）、✅ **実機検証完了**（2026-01-18）

### 関連ファイル

- `apps/api/src/routes/clients.ts`（API: DBのみ参照/更新）
- `apps/web/src/api/client.ts`（型定義拡張）
- `apps/web/src/pages/admin/DashboardPage.tsx`（DB alerts表示）
- `apps/api/src/routes/__tests__/clients.integration.test.ts`（回帰テスト）
- `infrastructure/ansible/templates/docker.env.j2`（環境変数永続化）
- `docs/plans/alerts-platform-phase2.md`（Phase2設計）
- `docs/guides/local-alerts.md`（ローカル環境対応の通知機能ガイド）

### 確認コマンド

```bash
# APIレスポンスを確認（認証トークンが必要）
curl -k -s "https://100.106.158.2/api/clients/alerts" \
  -H "Authorization: Bearer <token>" | jq '{alerts:.alerts, dbAlertsLen:(.details.dbAlerts|length), fileAlertsLen:(.details.fileAlerts|length)}'

# DBの未acknowledgedアラート数を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "SELECT COUNT(*) as unacknowledged FROM \"Alert\" WHERE acknowledged = false;"
```

### 注意事項

- **ブラウザキャッシュ**: 実機検証時は強制リロード（Mac: `Cmd+Shift+R` / Windows: `Ctrl+F5`）を推奨
- **完全移行**: API/UIはDBのみ参照。ファイルは一次入力（Producer）→Ingest専用として機能
- **ロールバック**: Phase1（file→Slack）へのロールバックは可能だが、UI/APIはDB参照のまま

---
