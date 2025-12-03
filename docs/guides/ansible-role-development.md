---
title: Ansibleロール開発ガイド
tags: [Ansible, ロール, 開発, デプロイ]
audience: [開発者]
last-verified: 2025-12-03
related: [ansible-phase9-role-execplan.md, quick-start-deployment.md, ansible-best-practices.md]
category: guides
update-frequency: medium
---

# Ansibleロール開発ガイド

最終更新: 2025-12-03

## 概要

本ガイドでは、Raspberry Pi System 002のAnsibleロール構造に沿って、新規ロールの追加や既存ロールの修正を行う方法を説明します。

Phase 9（ロール化）により、システムは以下の5つのロールに分割されています：

- **`common`**: 全ホスト共通処理（リポジトリ同期、バックアップ）
- **`server`**: サーバー専用処理（Docker Compose、API/Web環境変数）
- **`client`**: クライアント共通処理（status-agent、polkit、サービス再起動）
- **`kiosk`**: キオスク固有処理（kiosk-launch、kiosk-browser）
- **`signage`**: サイネージ固有処理（signage-lite管理、依存インストール）

## ロール構造の理解

### ディレクトリ構造

```
infrastructure/ansible/
├── roles/
│   ├── <role-name>/
│   │   ├── defaults/
│   │   │   └── main.yml      # デフォルト変数
│   │   ├── handlers/
│   │   │   └── main.yml      # ハンドラ（通知で実行されるタスク）
│   │   ├── tasks/
│   │   │   └── main.yml      # メインタスク
│   │   └── README.md         # ロールの説明
├── templates/                # テンプレートファイル（.j2）
├── tasks/                    # 再利用可能なタスクファイル
└── playbooks/
    └── deploy.yml           # メインプレイブック
```

### ロールの実行順序

`playbooks/deploy.yml`では、以下の順序でロールが実行されます：

1. **`common`** (pre_tasks): 全ホスト共通の前処理
2. **`server`** (tasks): サーバーホストのみ
3. **`client`** (tasks): クライアントホストのみ
4. **`kiosk`** (tasks): クライアントホストで`manage_kiosk_browser=true`の場合
5. **`signage`** (tasks): クライアントホストで`manage_signage_lite=true`の場合

## 新規ロールの追加手順

### ステップ1: ロールスケルトンの作成

```bash
cd infrastructure/ansible/roles

# ロールディレクトリ構造を作成
mkdir -p <role-name>/{defaults,handlers,tasks}
touch <role-name>/{defaults,handlers,tasks}/main.yml
touch <role-name>/README.md
```

**例: `camera`ロールを作成する場合**

```bash
mkdir -p camera/{defaults,handlers,tasks}
touch camera/{defaults,handlers,tasks}/main.yml
touch camera/README.md
```

### ステップ2: デフォルト変数の定義

`defaults/main.yml`に、ロールで使用するデフォルト変数を定義します。

```yaml
# roles/camera/defaults/main.yml
---
# カメラ管理を有効にするフラグ
manage_camera: false

# カメラ設定ファイルのパス
camera_config_path: /etc/camera.conf

# カメラサービスの名前
camera_service_name: camera-agent.service
```

### ステップ3: タスクの実装

`tasks/main.yml`に、ロールのメイン処理を実装します。

```yaml
# roles/camera/tasks/main.yml
---
- name: Deploy camera configuration file
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/camera.conf.j2"
    dest: "{{ camera_config_path }}"
    owner: root
    group: root
    mode: '0644'
  when: manage_camera | default(false) | bool
  register: camera_config_result

- name: Deploy camera service file
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/camera-agent.service.j2"
    dest: /etc/systemd/system/{{ camera_service_name }}
    owner: root
    group: root
    mode: '0644'
  when: manage_camera | default(false) | bool
  register: camera_service_result

- name: Reload systemd daemon
  ansible.builtin.systemd:
    daemon_reload: true
  when: camera_service_result.changed | default(false)

- name: Enable and start camera service
  ansible.builtin.systemd:
    name: "{{ camera_service_name }}"
    enabled: true
    state: started
  when: manage_camera | default(false) | bool
```

**重要なポイント**:

- **テンプレートパス**: `{{ playbook_dir }}/../templates/`を使用（ロール内から参照する場合）
- **条件分岐**: `when: manage_camera | default(false) | bool`でロールの有効/無効を制御
- **冪等性**: 同じ状態で再実行しても変更が発生しないようにする

### ステップ4: テンプレートファイルの作成

テンプレートファイルは`infrastructure/ansible/templates/`に配置します。

```bash
# テンプレートファイルを作成
touch infrastructure/ansible/templates/camera.conf.j2
touch infrastructure/ansible/templates/camera-agent.service.j2
```

**例: `camera.conf.j2`**

```ini
# Camera configuration
CAMERA_DEVICE="{{ camera_device | default('/dev/video0') }}"
RESOLUTION="{{ camera_resolution | default('1920x1080') }}"
FRAME_RATE="{{ camera_frame_rate | default('30') }}"
```

### ステップ5: READMEの作成

`README.md`に、ロールの目的、必要変数、適用条件を記載します。

```markdown
# role: camera

用途:
  - カメラ端末でのみ必要な処理（カメラ設定ファイル配布、カメラサービス管理）を行う。

適用条件:
  - `manage_camera | bool` が真の場合にのみこのロールを適用する。

必要変数:
  - `camera_device`（デフォルト: `/dev/video0`）
  - `camera_resolution`（デフォルト: `1920x1080`）
  - `repo_path`（テンプレート配置元）

使用例:
  - `inventory.yml`で`manage_camera: true`を設定すると、このロールが適用される。
```

### ステップ6: `deploy.yml`への追加

`playbooks/deploy.yml`の`tasks`セクションに、新しいロールを追加します。

```yaml
# playbooks/deploy.yml
tasks:
  - name: Execute deployment with automatic rollback
    block:
      # ... 既存のロール ...
      
      - name: Apply camera-specific deployment tasks
        ansible.builtin.import_role:
          name: camera
        when:
          - '"server" not in group_names'
          - manage_camera | default(false) | bool
```

### ステップ7: インベントリ変数の設定

`inventory.yml`または`host_vars/<hostname>/`に、ロールを有効にする変数を設定します。

```yaml
# inventory.yml
clients:
  hosts:
    raspberrypi4:
      # ... 既存の変数 ...
      manage_camera: true
      camera_device: "/dev/video0"
      camera_resolution: "1920x1080"
```

### ステップ8: テストと検証

```bash
# 構文チェック
ansible-playbook -i inventory.yml playbooks/deploy.yml --syntax-check

# タスク一覧の確認
ansible-playbook -i inventory.yml playbooks/deploy.yml --list-tasks

# ドライラン（変更内容の確認）
ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi4 --check

# 実際の実行
ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi4
```

## 既存ロールの修正手順

### ステップ1: 修正対象の特定

どのロールを修正するか決定します：

- **共通処理**: `common`ロール
- **サーバー処理**: `server`ロール
- **クライアント共通処理**: `client`ロール
- **キオスク固有処理**: `kiosk`ロール
- **サイネージ固有処理**: `signage`ロール

### ステップ2: タスクの追加・修正

`roles/<role-name>/tasks/main.yml`を編集します。

**例: `client`ロールに新しいサービスを追加する場合**

```yaml
# roles/client/tasks/main.yml
---
# ... 既存のタスク ...

- name: Deploy new service configuration
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/new-service.conf.j2"
    dest: /etc/new-service.conf
    owner: root
    group: root
    mode: '0644'
  when: manage_new_service | default(false) | bool
```

### ステップ3: 変数の追加

必要に応じて`defaults/main.yml`に変数を追加します。

```yaml
# roles/client/defaults/main.yml
---
# ... 既存の変数 ...

# 新サービスの管理フラグ
manage_new_service: false
```

### ステップ4: テストと検証

新規ロールと同様に、構文チェック、ドライラン、実機テストを実施します。

## ベストプラクティス

### 1. テンプレートパスの指定

ロール内からテンプレートを参照する場合は、`{{ playbook_dir }}/../templates/`を使用します。

```yaml
# ✅ 正しい
src: "{{ playbook_dir }}/../templates/config.conf.j2"

# ❌ 間違い（リモートパスを指定してしまう）
src: "{{ repo_path }}/infrastructure/ansible/templates/config.conf.j2"
```

### 2. 条件分岐の統一

ロールの有効/無効は、`manage_<role-name>`フラグで制御します。

```yaml
# ✅ 推奨
when: manage_camera | default(false) | bool

# ❌ 非推奨（デフォルト値がない）
when: manage_camera | bool
```

### 3. 冪等性の確保

同じ状態で再実行しても変更が発生しないようにします。

```yaml
# ✅ 冪等性がある（ファイルが存在し、内容が同じなら変更なし）
- name: Deploy configuration
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/config.conf.j2"
    dest: /etc/config.conf

# ❌ 冪等性がない（常に変更が発生する）
- name: Create timestamp file
  ansible.builtin.shell: date > /tmp/timestamp.txt
```

### 4. エラーハンドリング

重要な処理には`block/rescue`を使用してエラーハンドリングを実装します。

```yaml
- name: Deploy service with error handling
  block:
    - name: Deploy service configuration
      ansible.builtin.template:
        src: "{{ playbook_dir }}/../templates/service.conf.j2"
        dest: /etc/service.conf
    
    - name: Restart service
      ansible.builtin.systemd:
        name: service-name
        state: restarted
  rescue:
    - name: Log error
      ansible.builtin.debug:
        msg: "Failed to deploy service on {{ inventory_hostname }}"
    
    - name: Fail deployment
      ansible.builtin.fail:
        msg: "Service deployment failed"
```

### 5. サービス再起動の統一

クライアントのサービス再起動は、`roles/client`の`restart-client-service.yml`を使用します。

```yaml
# roles/client/tasks/main.yml
- name: Restart required services
  ansible.builtin.include_tasks: "{{ playbook_dir }}/../tasks/restart-client-service.yml"
  loop: "{{ services_to_restart }}"
  loop_control:
    loop_var: service_name
```

### 6. バックアップの考慮

システム設定ファイルを変更する場合は、`roles/common`のバックアップ機能を活用します。

```yaml
# roles/common/tasks/main.yml で自動的にバックアップされる
backup_service_files:
  - status-agent.service
  - kiosk-browser.service
  - signage-lite.service
  - new-service.service  # 追加
```

## 実例: `kiosk`ロールの追加

Phase 9で実装された`kiosk`ロールを例に、ロール追加の流れを説明します。

### 1. ロールスケルトンの作成

```bash
mkdir -p infrastructure/ansible/roles/kiosk/{defaults,handlers,tasks}
touch infrastructure/ansible/roles/kiosk/{defaults,handlers,tasks}/main.yml
touch infrastructure/ansible/roles/kiosk/README.md
```

### 2. デフォルト変数の定義

```yaml
# roles/kiosk/defaults/main.yml
---
# キオスクブラウザ管理を有効にするフラグ
manage_kiosk_browser: false
```

### 3. タスクの実装

```yaml
# roles/kiosk/tasks/main.yml
---
- name: Deploy kiosk-launch script
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/kiosk-launch.sh.j2"
    dest: /usr/local/bin/kiosk-launch.sh
    owner: root
    group: root
    mode: '0755'
  when: manage_kiosk_browser | default(false) | bool

- name: Deploy kiosk-browser.service
  ansible.builtin.template:
    src: "{{ playbook_dir }}/../templates/kiosk-browser.service.j2"
    dest: /etc/systemd/system/kiosk-browser.service
    owner: root
    group: root
    mode: '0644'
  when: manage_kiosk_browser | default(false) | bool

- name: Verify kiosk UI is reachable
  ansible.builtin.uri:
    url: "{{ kiosk_url }}"
    method: GET
    validate_certs: false
    status_code: 200
  when:
    - kiosk_url is defined
    - manage_kiosk_browser | default(false) | bool
```

### 4. `deploy.yml`への追加

```yaml
# playbooks/deploy.yml
tasks:
  - name: Apply kiosk-specific deployment tasks
    ansible.builtin.import_role:
      name: kiosk
    when:
      - '"server" not in group_names'
      - manage_kiosk_browser | default(false) | bool
```

### 5. インベントリ変数の設定

```yaml
# inventory.yml
clients:
  hosts:
    raspberrypi4:
      manage_kiosk_browser: true
      kiosk_url: "https://192.168.10.230/kiosk"
```

## トラブルシューティング

### テンプレートファイルが見つからない

**エラー**:
```
Could not find or access '/path/to/template.j2'
```

**解決方法**:
- テンプレートパスを`{{ playbook_dir }}/../templates/`に修正
- テンプレートファイルが`infrastructure/ansible/templates/`に存在することを確認

### 変数が未定義エラー

**エラー**:
```
The task includes an option with an undefined variable
```

**解決方法**:
- `defaults/main.yml`にデフォルト値を定義
- `inventory.yml`または`host_vars/`で変数を設定
- `when`条件で`default(false)`を使用

### ロールが実行されない

**確認事項**:
- `deploy.yml`にロールが追加されているか
- `when`条件が正しいか（`manage_<role-name>`が`true`になっているか）
- インベントリ変数が正しく設定されているか

## 関連ドキュメント

- **ロール化実装計画**: [ansible-phase9-role-execplan.md](../plans/ansible-phase9-role-execplan.md)
- **クイックスタートガイド**: [quick-start-deployment.md](./quick-start-deployment.md)
- **Ansibleベストプラクティス**: [ansible-best-practices.md](./ansible-best-practices.md)
- **Ansibleエラーハンドリング**: [ansible-error-handling.md](./ansible-error-handling.md)

## 次のステップ

1. **ロールの実装**: 上記の手順に従って新規ロールを追加
2. **テストと検証**: 構文チェック、ドライラン、実機テストを実施
3. **ドキュメント更新**: `README.md`と`INDEX.md`を更新
4. **コミットとプッシュ**: 変更をコミットしてリモートにプッシュ

