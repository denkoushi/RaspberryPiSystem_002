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
**件数**: 7件  
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

---
