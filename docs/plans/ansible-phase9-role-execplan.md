# Ansible Phase 9 – ロール化リファクタ

このExecPlanは`.agent/PLANS.md`に従い常に最新化する。ここに記載された情報だけで誰でも途中から作業を引き継げる状態を保つ。

## Purpose / Big Picture

現状の`infrastructure/ansible/playbooks/`配下では、各プレイブックが共通前処理（リポジトリ同期、バックアップ、サービス保護）を重複して実行し、サーバー固有およびクライアント固有の処理が1つのファイルに混在している。Phase 9では`common`・`server`・`client`・`kiosk`・`signage`の5ロールを作成し、`ansible-playbook playbooks/deploy.yml`の1コマンドで「全ホスト共通 → サーバー専用 → クライアント共通 → 役割別追加処理」を自動的に適用できるようにする。これにより、10台規模まで増えたラズパイ群でも安全にデプロイを継続できる。

## Progress

- [x] (2025-12-03 02:35Z) ロール化方針をまとめた初版ExecPlanを作成。
- [x] (2025-12-03 03:02Z) 既存タスクを棚卸しし、各ロールへの移設計画を表形式で整理。
- [x] (2025-12-03 04:00Z) `common/server/client/kiosk/signage`ロールのスケルトン（defaults/handlers/tasks/README）を作成。
- [x] (2025-12-03 04:15Z) 共通前処理を`roles/common`へ移設。
- [x] (2025-12-03 04:30Z) サーバー専用処理を`roles/server`へ移設。
- [x] (2025-12-03 04:45Z) クライアント共通処理を`roles/client`へ移設。
- [x] (2025-12-03 04:55Z) キオスク固有処理を`roles/kiosk`へ移設。
- [x] (2025-12-03 05:05Z) サイネージ固有処理を`roles/signage`へ移設。
- [x] (2025-12-03 05:20Z) 新`playbooks/deploy.yml`を作成し、既存プレイブック（`update-clients.yml`）を委譲させる。
- [x] (2025-12-03 12:30Z) テンプレートパスの修正（`playbook_dir`使用、`remote_src`追加）。
- [x] (2025-12-03 12:40Z) `status-agent.conf.j2`を`infrastructure/ansible/templates/`に移動。
- [x] (2025-12-03 13:00Z) Raspberry Pi 4（キオスク）での実機テスト成功。
- [x] (2025-12-03 13:30Z) Raspberry Pi 3（サイネージ）での実機テスト成功。
- [x] (2025-12-03 14:00Z) ロール開発ガイド（`docs/guides/ansible-role-development.md`）を作成。
- [x] (2025-12-03 14:10Z) `docs/INDEX.md`にロール開発ガイドへのリンクを追加。

## Surprises & Discoveries

- **テンプレートパスの問題**: ロール内からテンプレートファイルを参照する際、`{{ repo_path }}/infrastructure/ansible/templates/`では動作しない。`template`モジュールはコントローラー上のファイルを処理するため、`{{ playbook_dir }}/../templates/`を使用する必要がある。また、リモートファイルを参照する場合は`copy`モジュールで`remote_src: true`を指定する必要がある。
- **`status-agent.conf.j2`の配置**: テンプレートファイルは`infrastructure/ansible/templates/`に配置する必要がある。`clients/status-agent/`に配置していたが、Ansibleコントローラーから参照できないため移動した。
- **`role_path`変数の未定義**: ロール内で`include_tasks`を使用する際、`{{ role_path }}`は定義されていない場合がある。`{{ playbook_dir }}/../tasks/`を使用することで、より確実にパスを解決できる。
- **ハンドラの重複実行**: `roles/server`で`.env`ファイルのデプロイ時に`notify`を使用すると、ハンドラが重複実行される可能性がある。明示的な`block/rescue`構造でDocker再起動を制御することで回避できる。

## Decision Log

- 決定: ロールを`common`,`server`,`client`,`kiosk`,`signage`の5種類に分割し、インベントリ変数（例: `manage_kiosk_browser`, `manage_signage_lite`）で適用可否を制御する。  
  理由: 現在の責務分割（サーバー/キオスク/サイネージ）に一致し、ホストごとに必要な処理だけを実行できる。  
  日付/記録者: 2025-12-03 / GPT-5.1 Codex。

## Outcomes & Retrospective

### 検証結果

**実機テスト結果**:
- ✅ **Raspberry Pi 4（キオスク）**: 全タスク成功（Total 1 / Success 1 / Failed 0）
  - `common`ロール: リポジトリ同期、バックアップ作成が正常に動作
  - `client`ロール: status-agent設定、polkitルール配布、サービス再起動が正常に動作
  - `kiosk`ロール: kiosk-launchスクリプト、kiosk-browser.service配布、UI疎通確認が正常に動作
- ✅ **Raspberry Pi 3（サイネージ）**: 全タスク成功（Total 1 / Success 1 / Failed 0）
  - `common`ロール: リポジトリ同期、バックアップ作成が正常に動作
  - `client`ロール: status-agent設定、polkitルール配布、サービス再起動が正常に動作
  - `signage`ロール: signage-lite停止/再有効化、依存インストール、ステータスチェックが正常に動作

**構文チェック・タスク一覧確認**:
- ✅ `ansible-playbook playbooks/deploy.yml --syntax-check`: 成功
- ✅ `ansible-playbook playbooks/deploy.yml --list-tasks`: 成功（全ロールのタスクが正しく表示）

### 達成した効果

1. **コードの再利用性向上**: ロール単位で管理可能になり、他のプレイブックやプロジェクトでも再利用できる
2. **メンテナンスの容易化**: 責務が明確に分離され、修正範囲が明確になった
3. **拡張性の向上**: 新規ロールを追加するだけで新しい機能に対応できる（例: `camera`ロールの追加）
4. **可読性の向上**: `deploy.yml`がシンプルになり、デプロイの流れが一目で理解できる
5. **10台規模への対応準備**: 将来的に端末数が増えても、ロール構造により安全にデプロイを継続できる

### 残課題

- **Phase 8（テストの導入）**: 現状は実機テストで十分な検証ができているが、自動テストの導入により更なる品質向上が期待できる
- **ロールのドキュメント充実**: 各ロールのREADMEをより詳細にすることで、新規参加者の理解が向上する可能性がある

### 学び

1. **ロール化の重要性**: モノリシックなプレイブックをロールに分割することで、保守性と拡張性が大幅に向上した
2. **テンプレートパスの扱い**: Ansibleの`template`モジュールはコントローラー上のファイルを処理するため、パスの指定方法に注意が必要
3. **条件分岐の統一**: `manage_<role-name>`フラグでロールの有効/無効を制御することで、インベントリ管理が容易になる
4. **実機テストの重要性**: 構文チェックやドライランだけでは発見できない問題（テンプレートパス、変数の未定義など）が実機テストで発見された

## Context and Orientation

Ansible関連資産は`infrastructure/ansible/`にあり、メインの`playbooks/update-clients.yml`は共通前処理・サーバー処理・クライアント処理をすべて抱えている。`manage-system-configs.yml`や`manage-app-configs.yml`、`restart-services.yml`も類似ロジックを持ち重複が多い。`inventory.yml`は`server`（raspberrypi5）と`clients`（raspberrypi4キオスク、raspberrypi3サイネージ）を定義しており、将来的に端末数が増えても拡張できる構造が求められる。

## Plan of Work

1. **タスク棚卸しとマッピング（完了済み）。**

    | 元タスク/場所 | 目的・備考 | 移設先ロール |
    | --- | --- | --- |
    | `pre_tasks`（リポジトリディレクトリ作成、git clean、`git clone/fetch`、`docs`削除、バックアップ生成、polkit/systemdユニットバックアップ） | 全ホスト共通。`backup_timestamp`等を下流ロールへ渡す。 | `roles/common` |
    | `tasks/update-clients-core.yml`内のsignage-lite停止/再有効化、`signage-update.sh`の`SERVER_URL`更新、`pnpm install` | サイネージ固有処理。 | `roles/signage` |
    | 同上のstatus-agent設定、systemdサービス/タイマー配置、daemon-reload、timer起動 | クライアント共通処理。 | `roles/client` |
    | 同上のpolkitルール配布 | クライアント共通。 | `roles/client` |
    | 同上のkiosk-launch.sh配布、kioskブラウザ制御 | キオスク固有。 | `roles/kiosk` |
    | 同上の`services_to_restart`構築、`restart-client-service.yml`呼び出し、`systemctl`検証 | クライアント共通のサービス再起動。 | `roles/client` |
    | 同上のDocker Compose再起動、APIヘルス確認、Dockerログ取得 | サーバー専用。 | `roles/server` |
    | `health_info`収集、`kiosk_url`/`signage_status`チェック | 収集は`client`、HTTPチェックは`kiosk`/`signage`。 | `roles/client` + `roles/kiosk` + `roles/signage` |
    | `manage-app-configs.yml`のAPI/Web/NFC/Docker `.env`配布と構文チェック、Docker再起動ハンドラ | サーバー中心（NFC部分はクライアントも関与）。 | `roles/server` / `roles/client` |
    | `manage-system-configs.yml`のpolkit/kiosk-browser/signage-liteテンプレート配布 | システム設定管理。 | `roles/client`, `roles/kiosk`, `roles/signage` |
    | `restart-services.yml`のサービス再起動タスク | `roles/client`から`include_tasks`で再利用。 | `roles/client` |
    | `post_tasks`の失敗/到達不能/サマリ出力 | 全ホスト共通、`run_once`で実行。 | `roles/common` |

2. **ロールスケルトンの作成。** `infrastructure/ansible/roles/<role>/defaults|tasks|handlers/`とREADMEを作り、`repo_path`,`backup_dir`,`manage_kiosk_browser`等のデフォルト、空ハンドラ、利用方法を記述する。
3. **`roles/common`実装。** `pre_tasks`/`post_tasks`を移植し、`backup_timestamp`や`git_result`を`set_fact`で公開。signage停止前の保護処理やデプロイサマリも担当。
4. **`roles/server`実装。** `.env`テンプレート配布、Docker Compose再起動、APIヘルスチェックを集約し、Docker再起動ハンドラを定義。
5. **`roles/client`実装。** status-agent/ polkit/ systemd管理、サービス再起動ループ、ヘルス情報収集を集約し、`tasks/restart-client-service.yml`を`include_tasks`する。
6. **`roles/kiosk`実装。** kiosk-launchスクリプト、kiosk-browserサービス、キオスクUIの疎通確認をまとめ、`manage_kiosk_browser`で制御。
7. **`roles/signage`実装。** signage-lite停止/再開、updateスクリプト置換、依存インストール、ステータスチェックをまとめ、`manage_signage_lite`で制御。
8. **新プレイブックと文書更新。** `playbooks/deploy.yml`を作成し、`all -> common`, `server -> server`, `clients -> client (+ kiosk/signage 条件付き)`の順でロールを適用。既存プレイブックは`import_playbook: deploy.yml`にする。`docs/INDEX.md`、`docs/plans/ansible-improvement-plan.md`、関連ガイドを更新。
9. **テストと検証。** `--syntax-check`/`--list-tasks`/`--check`をホスト種別ごとに実行し、結果を本計画と必要な進捗ドキュメントに記録する。

## Concrete Steps

1. **棚卸し結果の文書化**（完了）。`rg`などで抽出したタスクを手作業で表へ整理済み。
2. **ロールスケルトン作成。**

        cd /Users/tsudatakashi/RaspberryPiSystem_002
        for r in common server client kiosk signage; do \
          mkdir -p infrastructure/ansible/roles/$r/{defaults,tasks,handlers}; \
          touch infrastructure/ansible/roles/$r/{defaults,handlers,tasks}/main.yml; \
          touch infrastructure/ansible/roles/$r/README.md; \
        done

   READMEに「役割」「必要変数」「適用ホスト」を2〜3行で記述する。
3. **`roles/common`へ移設。** `update-clients.yml`の`pre_tasks`/`post_tasks`を移し、`backup_timestamp`等のFactsを`set_fact`で公開。
4. **`roles/server`へ移設。** `.env`テンプレート、Docker Compose再起動、APIヘルスチェックを移し、Docker再起動ハンドラを追加。
5. **`roles/client`へ移設。** status-agent設定、polkit/systemd管理、サービス再起動ループ、ヘルス収集をまとめ、`tasks/restart-client-service.yml`を`include_tasks`する。
6. **`roles/kiosk`/`roles/signage`へ移設。** キオスク・サイネージ固有タスクを分離し、`manage_kiosk_browser`/`manage_signage_lite`で制御。
7. **新プレイブックと文書更新。** `playbooks/deploy.yml`作成、旧プレイブック委譲、ドキュメント更新。
8. **検証。**

        cd /Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible
        ansible-playbook playbooks/deploy.yml --syntax-check
        ansible-playbook playbooks/deploy.yml --list-tasks
        ansible-playbook playbooks/deploy.yml --limit raspberrypi4 --check

   ログを「Surprises」「Outcomes」に追記し、必要なら`docs/progress/`へ報告する。

## Validation and Acceptance

上記3コマンドがエラーなく完走し、`--check`で旧プレイブックと同じ変更セットが表示されることを受け入れ条件とする。実際の適用ではサーバー/キオスク/サイネージのサービス再起動とヘルスチェックが従来通り成功することを人間が確認する。

## Idempotence and Recovery

各ロールは冪等であるべきで、入力が変わらない限り再実行しても追加変更を発生させない。`roles/common`は保護付き`git clean`と`git reset --hard`のため繰り返し実行しても安全。`serial: 1`により障害は1ホストに限定され、修正後に対象ホストのみ再実行できる。`roles/signage`などは`rollback-configs.yml`を利用して復旧可能。

## Artifacts and Notes

ロール実装が進んだら、本節に主要ファイルの抜粋や`playbooks/deploy.yml`の構造例を追記する。現時点では「旧メインは`playbooks/update-clients.yml`で、最終的に退役させる予定」というメモのみ残す。

## Interfaces and Dependencies

- `roles/common`: `repo_path`, `backup_dir`, `backup_service_files`などを`defaults/main.yml`で定義し、インベントリで上書き可能にする。
- `roles/server`: `api_*`, `web_*`, `docker_*`等の変数とテンプレートを使用。Docker再起動ハンドラを備える。
- `roles/client`: status-agent関連変数、`services_to_restart`, `manage_kiosk_browser`などのフラグを受け取る。
- `roles/kiosk`: `kiosk_url`, `manage_kiosk_browser`, `kiosk-browser.service`テンプレートを使用。
- `roles/signage`: `manage_signage_lite`, `signage_server_url`, `signage_client_key`, `signage-lite.service`テンプレートを使用。

すべてのロールは`infrastructure/ansible/templates/`配下の既存テンプレートを相対パスで参照する。

