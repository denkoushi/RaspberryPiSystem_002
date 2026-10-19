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

本ガイドでは、Raspberry Pi System 002のAnsibleロールを修正するときに確認すべき境界を説明します。
標準release routeの実行順序と受入条件は、`deploy-release-standard.yml` と各profile roleを正本とします。

標準routeが実行するprofile roleは次の3つです。

- **`release_pi5`**: Pi5のprepare、switch、health、失敗時rollback
- **`release_kiosk`**: Pi4のprepare、switch、health、失敗時rollback
- **`release_signage`**: Pi3のprepare、switch、health、失敗時rollback

`common`、`server`、`client`、`kiosk`、`signage` は標準playbookが直接実行するroleではありません。
それらの既存callerを修正する場合は、標準routeの実行対象だと仮定せず、実際のcallerと受入契約を先に確認します。

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
    └── deploy-release-standard.yml # 標準release playbook
```

### ロールの実行順序

`playbooks/deploy-release-standard.yml`はhost profileごとにserial 1で次の3 playを実行します。

1. **`release_pi5`**: Pi5のprepare → switch → health。失敗時はroleのrollback境界を確認する。
2. **`release_kiosk`**: Pi4のprepare → switch → health。失敗時はroleのrollback境界を確認する。
3. **`release_signage`**: Pi3のprepare → switch → health。失敗時はroleのrollback境界を確認する。

標準playbookに `common`、`server`、`client`、`kiosk`、`signage` をimportする前提や、
それらへ新しいroleを直接追加する前提は置きません。

## 新規ロールの追加手順（標準routeへの追加ではない）

以下は、標準routeとは別に実在するcallerがある場合の一般的なrole構造例です。
inventory変数を追加するだけで標準playbookにroleが接続されるわけではなく、
この `camera` 例を標準routeの実行結果として扱ってはいけません。

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
  - 実在するcallerが `manage_camera` を読む場合だけ、そのcallerの契約に従って設定する。
```

### ステップ6: 標準release playbookへの追加

標準playbookへ `camera` のような新しいroleを直接追加する手順はありません。
標準routeの実行境界は `release_pi5`、`release_kiosk`、`release_signage` に固定されています。
新しい処理が必要な場合は、まず既存profile roleのprepare、switch、health、rollbackのどこが所有するかを確認し、
その判断と実装を別の明示的な変更として扱います。このガイドの例だけで標準routeへ処理が追加されるとはみなしません。

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
ansible-playbook -i inventory.yml playbooks/deploy-release-standard.yml --syntax-check

# タスク一覧の確認
ansible-playbook -i inventory.yml playbooks/deploy-release-standard.yml --list-tasks

# ドライラン（変更内容の確認）
ansible-playbook -i inventory.yml playbooks/deploy-release-standard.yml --list-tasks --limit raspberrypi4

# 必須の事前確認
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi4
```

`--print-plan`では、選択host、profile、role、対象SHAとCI成功を確認する。
その確認、対象branch/SHAのCI成功、明示承認がそろった後だけ、同じscopeで実際の実行を行う。

```bash
# 実際の実行（文書例。明示承認後のみ）
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi4
```

明示承認前はmutationコマンドを実行しない。標準route確認だけでは、callerのない `camera` roleやinventory変数は適用されません。

## 既存ロールの修正手順

### ステップ1: 修正対象の特定

どのprofile roleを修正するか決定します：

- **Pi5**: `release_pi5`
- **Pi4**: `release_kiosk`
- **Pi3**: `release_signage`

`common`、`server`、`client`、`kiosk`、`signage` の修正は、標準routeがそれらを直接実行するとは仮定せず、
そのファイルを実際に呼ぶcallerの契約を確認してから行います。

### ステップ2: タスクの追加・修正

`roles/release_<profile>/tasks/` の既存prepare、switch、health、rollback taskを確認してから編集します。
標準routeの新しい処理を別roleへ移して、呼出しを推測で増やしてはいけません。

```yaml
# roles/release_kiosk/tasks/health.yml
---
# 既存のhealth契約とrollback境界を壊さない範囲で修正する
```

### ステップ3: 変数の追加

必要に応じて`defaults/main.yml`に変数を追加します。

```yaml
# roles/release_kiosk/defaults/main.yml
---
# 既存profileが所有する変数だけを追加・修正する
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

標準routeでサービス再起動を伴う変更は、対象 `release_*` roleの既存taskとrollback境界に合わせます。
`roles/client`を標準playbookが直接実行する前提で処理を追加しません。
`release_*` roleの `switch.yml` が必要なserviceをrestartし、失敗時は同じprofileの `rollback.yml` が
復元後のservice再起動とhealth再確認を担当する。共有restart helperをこのガイドから追加しない。

### 6. バックアップの考慮

システム設定ファイルを変更する場合は、対象 `release_*` roleが持つ既存のprepare/rollback境界を確認します。
`roles/common`の処理が標準routeで自動実行されるとは仮定しません。
たとえば `release_kiosk` は `switch.yml` の `copy: backup: true` でinstall結果をregisterし、
`rollback.yml` がそのbackup fileを復元する。このprofile契約を使い、未使用のbackup変数リストを追加しない。

## 標準routeのprofile roleを確認する

標準playbookへ既存の `kiosk` roleを追加する例はありません。変更前に、対象profileのroleと実行境界を確認します。

- Pi5: `release_pi5` のprepare、switch、health、rollback
- Pi4: `release_kiosk` のprepare、switch、health、rollback
- Pi3: `release_signage` のprepare、switch、health、rollback

タスク一覧と対象hostは、標準playbookに対するAnsibleのsyntax/list-hosts/list-tasksで確認します。
実行時は標準launcherの選択scopeを使い、個別の旧playbookや未確認のrole呼出しを追加しません。

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
- `deploy-release-standard.yml`の対象profile roleが意図したhostに含まれるか
- profile roleのprepare、switch、health、rollback taskが対象をカバーするか
- `--list-hosts` / `--list-tasks` とinventory変数が一致しているか

## 関連ドキュメント

- **ロール化実装計画**: [ansible-phase9-role-execplan.md](../plans/ansible-phase9-role-execplan.md)
- **クイックスタートガイド**: [quick-start-deployment.md](./quick-start-deployment.md)
- **Ansibleベストプラクティス**: [ansible-best-practices.md](./ansible-best-practices.md)
- **Ansibleエラーハンドリング**: [ansible-error-handling.md](./ansible-error-handling.md)

## 次のステップ

1. **callerの確認**: 対象profile roleと標準playbookの実行境界を確認
2. **テストと検証**: 構文チェック、list-hosts、list-tasks、CI契約を実施
3. **ドキュメント更新**: 実際の標準routeと一致する範囲だけを更新
4. **コミットとプッシュ**: 差分境界を確認してリモートにプッシュ
