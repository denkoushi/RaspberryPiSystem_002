---
title: トラブルシューティングナレッジベース - バックアップ・リストア関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2026-01-06
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - バックアップ・リストア関連

**カテゴリ**: インフラ関連 > バックアップ・リストア関連  
**件数**: 26件  
**索引**: [index.md](../index.md)

バックアップとリストア機能に関するトラブルシューティング情報

---

### [KB-020] バックアップ・リストア機能の実装

**EXEC_PLAN.md参照**: 次のタスク (行118)

**事象**: 
- バックアップ・リストア機能が実装されていない

**要因**: 
- 機能が実装されていない

**有効だった対策**: 
- ✅ **実装完了**（2025-11-25）: バックアップ・リストアスクリプトを実装し、CIテストを追加

**学んだこと**: 
- バックアップ・リストア機能は、定期的に実行する必要がある
- CIテストを追加することで、機能の動作を確認できる

**解決状況**: ✅ **実装完了**（2025-11-25）

**関連ファイル**: 
- `scripts/server/backup.sh`
- `scripts/server/restore.sh`
- `scripts/test/backup-restore.test.sh`

---

---

## KB-094: バックアップ履歴のファイル存在状態管理機能

**問題**: バックアップファイルが削除された際、履歴レコードも削除されていたため、過去のバックアップ実行記録を追跡できなかった。

**原因**: 
- バックアップ削除時に履歴レコードも削除していた
- ファイルの存在状態を記録する仕組みがなかった

**解決策**:
- `BackupHistory`テーブルに`fileStatus`列（`EXISTS` / `DELETED`）を追加
- ファイル削除時に履歴を削除せず、`fileStatus`を`DELETED`に更新
- UIに「ファイル」列を追加して存在状態を表示

**実装詳細**:
- Prismaスキーマに`BackupFileStatus` enumを追加
- `BackupHistoryService.markHistoryAsDeletedByPath`メソッドを追加
- `BackupHistoryService.markExcessHistoryAsDeleted`メソッドを追加（最大件数超過時の処理）
- バックアップ削除時に`fileStatus`を`DELETED`に更新する処理を追加
- UIに`getFileStatusColor`と`getFileStatusLabel`関数を追加

**学んだこと**:
- 履歴は削除せずに保持することで、監査やトラブルシューティングに有用
- ファイルの存在状態を明示的に記録することで、UIと実際の状態の整合性を保つ
- 削除済みの履歴は視覚的に区別することで、ユーザーの混乱を防ぐ

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**:
- `apps/api/prisma/schema.prisma`（`BackupFileStatus` enum、`BackupHistory.fileStatus`）
- `apps/api/src/services/backup/backup-history.service.ts`（`markHistoryAsDeletedByPath`、`markExcessHistoryAsDeleted`）
- `apps/api/src/routes/backup.ts`（ファイル削除時の`fileStatus`更新）
- `apps/api/src/services/backup/backup-scheduler.ts`（スケジュール実行時の`fileStatus`更新）
- `apps/web/src/pages/admin/BackupHistoryPage.tsx`（「ファイル」列の表示）

**実機検証結果**（2025-12-28）:
- ✅ 履歴ページに「ファイル」列が表示されることを確認
- ✅ バックアップ実行後、削除されたバックアップの履歴で「ファイル」列が「削除済」に更新されることを確認
- ✅ 最大保持数制御が正しく動作し、設定値（`maxBackups: 2`）と実際のファイル数が一致することを確認
- ✅ データベースで`fileStatus: EXISTS`（2件）と`fileStatus: DELETED`（10件）が正しく記録されていることを確認
- ✅ ログで`[BackupRoute] Old backup history marked as DELETED`を確認

---

---

## KB-095: バックアップ履歴のストレージプロバイダー記録の不整合

**問題**: バックアップ履歴に「Dropbox」と表示されているが、実際にはDropboxのトークンが設定されておらず、`local`にフォールバックしていた。履歴と実際の動作が一致していなかった。

**原因**:
- `StorageProviderFactory`が`accessToken`が空の場合に`local`にフォールバックする処理を追加していたが、履歴には元のプロバイダー（`dropbox`）を記録していた
- 実際に使用されたプロバイダーを取得する仕組みがなかった

**解決策**:
- `StorageProviderFactory.createFromConfig`と`createFromTarget`にオーバーロードを追加
- 第4引数に`returnProvider: true`を指定すると、実際に使用されたプロバイダーとストレージプロバイダーのペアを返す
- バックアップ実行時に実際に使用されたプロバイダーを取得し、履歴に記録

**実装詳細**:
- `StorageProviderFactory`にオーバーロードを追加（TypeScriptの関数オーバーロード）
- `backup.ts`と`backup-scheduler.ts`で実際に使用されたプロバイダーを取得
- 履歴作成時に実際に使用されたプロバイダーを記録

**学んだこと**:
- フォールバック処理がある場合、実際に使用された値を記録することが重要
- 履歴と実際の動作が一致することで、ユーザーの混乱を防ぐ
- オーバーロードを使用することで、既存のコードとの互換性を保ちながら新機能を追加可能

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**:
- `apps/api/src/services/backup/storage-provider-factory.ts`（オーバーロード追加）
- `apps/api/src/routes/backup.ts`（実際に使用されたプロバイダーの取得と記録）
- `apps/api/src/services/backup/backup-scheduler.ts`（スケジュール実行時のプロバイダー記録）

**実機検証結果**（2025-12-28）:
- ✅ バックアップ実行後、ストレージプロバイダーが`local`表示に切り替わることを確認
- ✅ ログで`[StorageProviderFactory] Dropbox access token is empty, falling back to local storage`を確認
- ✅ データベースで`storageProvider: local`が正しく記録されていることを確認
- ✅ UIで「ファイル」列が表示され、`fileStatus`が正しく表示されることを確認

---

---

## KB-096: Dropboxバックアップ履歴未記録問題（refreshTokenからaccessToken自動取得機能）

**問題**: Dropboxバックアップが実行されても、履歴に`dropbox`として記録されず、`local`にフォールバックされていた。原因は`accessToken`が空で、`refreshToken`から自動取得する機能が実装されていなかったこと。

**原因**:
1. `DROPBOX_REFRESH_TOKEN`環境変数に**アクセストークン**（`sl.u.`で始まる）が誤って設定されていた
2. `StorageProviderFactory`が`accessToken`が空の場合、即座に`local`にフォールバックしていた
3. `refreshToken`から`accessToken`を自動取得する機能が実装されていなかった
4. `createFromConfig`と`createFromTarget`が同期メソッドだったため、`await oauthService.refreshAccessToken()`が使用できなかった

**解決策**:
1. **OAuth認証フローで正しいrefresh tokenを取得**: `/api/backup/oauth/authorize`エンドポイントを使用してDropbox OAuth認証を実行し、正しい`refreshToken`を取得・保存
2. **refreshTokenからaccessTokenを自動取得**: `StorageProviderFactory.createFromConfig`と`createFromTarget`で、`accessToken`が空でも`refreshToken`、`appKey`、`appSecret`が揃っている場合は、`DropboxOAuthService.refreshAccessToken()`を呼び出して新しい`accessToken`を取得
3. **メソッドをasyncに変更**: `createFromConfig`と`createFromTarget`を`async`メソッドに変更し、呼び出し元（`backup.ts`、`backup-scheduler.ts`）に`await`を追加

**実装詳細**:
- `StorageProviderFactory.createFromConfig`と`createFromTarget`を`async`メソッドに変更
- `accessToken`が空の場合、`refreshToken`から`accessToken`を自動取得する処理を追加
- 取得した`accessToken`は`onTokenUpdate`コールバックを通じて設定ファイルに保存
- 呼び出し元（`backup.ts`、`backup-scheduler.ts`）に`await`を追加

**学んだこと**:
- OAuth認証フローで取得したトークンは、`accessToken`と`refreshToken`の両方が必要
- `refreshToken`は`accessToken`とは異なる形式（`sl.u.`で始まらない）
- 非同期処理（`refreshAccessToken`）を使用する場合は、メソッドを`async`に変更する必要がある
- 環境変数に誤った値が設定されている場合、コード側で検証・修正する仕組みがあると良い

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**:
- `apps/api/src/services/backup/storage-provider-factory.ts`（async化、refreshTokenからaccessToken自動取得）
- `apps/api/src/routes/backup.ts`（await追加）
- `apps/api/src/services/backup/backup-scheduler.ts`（await追加）
- `apps/api/src/routes/backup.ts`（OAuth認証エンドポイント）

**実機検証結果**（2025-12-29）:
- ✅ OAuth認証フローで正しい`refreshToken`を取得・保存することを確認
- ✅ バックアップ実行後、`refreshToken`から`accessToken`が自動取得されることを確認
- ✅ Dropboxへのアップロードが成功することを確認（ログ: `[DropboxStorageProvider] File uploaded`）
- ✅ データベースで`storageProvider: dropbox`が正しく記録されていることを確認
- ✅ UIで「Dropbox」と表示されることを確認

**コミット**:
- `e468445` - fix: refreshTokenからaccessTokenを自動取得する機能を追加（Dropboxバックアップ履歴未記録問題の修正）
- `e503476` - fix: StorageProviderFactoryメソッドをasyncに変更してaccessToken自動リフレッシュを有効化

---

---

## KB-097: CSVリストア時のtargetSource拡張子削除修正とデータベースバックアップのパス問題

**問題**: Dropbox経由のCSVリストア時に、`targetSource`が`employees.csv`のままになり、CSVバックアップターゲットのバリデーションでエラーが発生していた。また、データベースバックアップのリストア時に409エラーが発生していた。

**原因**:
1. CSVリストア時に`targetSource`がパスの最後の要素（`employees.csv`）から取得されていたが、CSVバックアップターゲットは`employees`または`items`のみを受け付ける
2. データベースバックアップの`summary.path`に拡張子（`.sql.gz`）が含まれていないため、実際のファイル名と一致しない可能性がある

**解決策**:
1. **CSVリストア時の拡張子削除**: `/api/backup/restore/from-dropbox`エンドポイントで、CSVの場合はファイル名から拡張子を削除するロジックを追加
2. **データベースバックアップのパス問題**: バックアップ履歴に完全なファイルパスを記録するか、Dropbox上で実際のファイル名を確認する必要がある（未解決）

**実装詳細**:
- `apps/api/src/routes/backup.ts`の`/backup/restore/from-dropbox`エンドポイントで、CSVの場合はファイル名から拡張子を削除する処理を追加
- `targetKind === 'csv'`かつ`targetSource.endsWith('.csv')`の場合、`.csv`を削除

**学んだこと**:
- パスから`targetSource`を推測する際は、ファイル拡張子を考慮する必要がある
- バックアップ履歴に完全なファイルパスを記録することで、リストア時のパス推測を正確にできる
- データベースバックアップのパス形式が異なる場合、パス推測ロジックを拡張する必要がある

**解決状況**: ✅ **解決済み**（2025-12-29）
- CSVリストア時の拡張子削除: ✅ 解決済み
- データベースバックアップのパス問題: ✅ 解決済み（`.sql.gz`拡張子の付与とフォールバック処理）

**実装詳細**（更新）:
- `apps/api/src/routes/backup.ts`の`/backup/restore/from-dropbox`エンドポイントで、CSVの場合はファイル名から拡張子を削除する処理を追加
- `targetKind === 'csv'`かつ`targetSource.endsWith('.csv')`の場合、`.csv`を削除
- **データベースバックアップのパス問題解決**: `DatabaseBackupTarget`のコンストラクタを修正し、データベース名のみが渡された場合に`DATABASE_URL`環境変数からベースURLを取得して完全な接続文字列を構築するように変更。また、`targetSource`から`.sql.gz`または`.sql`拡張子を削除する処理を追加

**関連ファイル**:
- `apps/api/src/routes/backup.ts`（CSVリストア時の拡張子削除処理、データベースバックアップのパス処理）
- `apps/api/src/services/backup/targets/database-backup.target.ts`（データベース名のみの場合の接続文字列構築）

**実機検証結果**（2025-12-29）:
- ✅ CSVリストア時に`targetSource`が`employees`に正しく変換されることを確認
- ✅ リストア履歴に`storageProvider: dropbox`が正しく記録されることを確認
- ⚠️ CSVデータのバリデーションエラーが発生（データの問題、リストア機能自体は正常動作）
- ✅ データベースバックアップのリストア時にパス問題が解決され、正常に動作することを確認（2025-12-29 02:42:32）

**コミット**:
- `4dc4816` - fix: CSVリストア時にtargetSourceから拡張子を削除
- （データベースバックアップのパス問題解決のコミットハッシュを追加）

**関連ドキュメント**:
- [バックアップリストア機能の実機検証結果](../guides/backup-restore-verification-results.md)

---

---

## KB-098: CSVリストア時のバリデーションエラー問題

**問題**: Dropbox経由のCSVリストア時に、バリデーションエラーが発生する。2行目の`employeeCode`が数字4桁の形式（`/^\d{4}$/`）に適合していない。

**原因**:
1. バックアップされたCSVデータに、現在のバリデーションルールに適合しないデータが含まれている
2. `employeeCode`は数字4桁（`/^\d{4}$/`）である必要があるが、バックアップファイルには異なる形式のデータが含まれている可能性がある

**調査結果**:
- リストア機能自体は正常動作（Dropboxからファイルをダウンロードできている）
- CSVデータのパース処理も正常動作
- バリデーションエラーはデータの問題であり、リストア機能の問題ではない

**対応**:
1. **バックアップファイルの内容を確認**: Dropbox上で実際のCSVファイルの内容を確認し、問題のあるデータを特定
2. **バリデーションルールの確認**: 現在のバリデーションルール（`/^\d{4}$/`）が適切か確認
3. **データ形式の整合性確認**: バックアップ時のデータ形式とリストア時のバリデーションルールの整合性を確認

**学んだこと**:
- リストア機能は正常動作しているが、データの整合性チェックで失敗する
- バリデーションエラーの詳細なメッセージが表示されるため、問題のあるデータを特定可能
- バックアップ時のデータ形式とリストア時のバリデーションルールの整合性を保つことが重要

**解決状況**: ⚠️ **調査完了、データの問題として記録**（2025-12-29）

**関連ファイル**:
- `apps/api/src/routes/imports.ts`（CSVバリデーションスキーマ）
- `apps/api/src/services/backup/targets/csv-backup.target.ts`（CSVリストア処理）

**実機検証結果**（2025-12-29）:
- ✅ リストア機能は正常動作（Dropboxからファイルをダウンロード成功）
- ⚠️ CSVデータのバリデーションエラーが発生（2行目の`employeeCode`が数字4桁の形式に適合しない）
- ✅ エラーメッセージが詳細に表示される（問題のあるデータを特定可能）

**追加検証結果**（2025-12-29 02:42:32）:
- ✅ 社員コードを4桁の数字形式（`1234`、`5678`）に変更後、バックアップとリストアが正常に動作することを確認
- ✅ バックアップ実行: `2025-12-29T02:42:07.489Z`に実行され、`COMPLETED`状態、Dropboxに保存成功
- ✅ リストア実行: `2025-12-29T02:42:32.390Z`に実行され、`COMPLETED`状態、エラーなし
- ✅ データベースの状態: 社員コード`1234`（佐藤 花子）、`5678`（山田 太郎）が正しく反映されていることを確認

**結論**:
- バリデーションエラーはデータの問題であり、リストア機能自体は正常動作している
- 社員コードを4桁の数字形式に変更することで、バックアップとリストアが正常に動作することを確認

**次のステップ**:
- バックアップファイルの内容を確認して、問題のあるデータを特定（完了：社員コードを4桁形式に変更）
- 必要に応じてバリデーションルールを調整、またはデータ形式を修正（完了：データ形式を修正）

---

---

### [KB-102] Ansibleによるクライアント端末バックアップ機能実装時のAnsibleとTailscale連携問題

**EXEC_PLAN.md参照**: Phase 6: Ansibleによるクライアント端末バックアップ機能（2025-12-19）

**事象**: 
- クライアント端末（Pi4、Pi3など）のファイルをAnsible経由でバックアップする機能を実装中に、Ansible Playbookの実行が失敗する
- エラーメッセージ: `raspberrypi4({{ kiosk_ip }})`として表示され、変数が展開されていない
- SSH接続エラー: `Permission denied (publickey,password)`
- ファイル不存在エラー: `the remote file does not exist, not transferring, ignored`

**要因**: 

1. **Ansible Playbookの`hosts`指定と変数展開の問題**:
   - 初期実装では`hosts: localhost` + `delegate_to: "{{ client_host }}"`パターンを使用していた
   - `hosts: localhost`で実行すると、`group_vars/all.yml`の変数（`kiosk_ip`など）が読み込まれない
   - 結果として、`ansible_host: "{{ kiosk_ip }}"`が展開されず、`{{ kiosk_ip }}`のままになる
   - Ansibleは`raspberrypi4({{ kiosk_ip }})`というホスト名で接続を試み、失敗する

2. **SSH鍵のマウント問題**:
   - Dockerコンテナ内からSSH接続する際に、Pi5のホスト側のSSH鍵（`/home/denkon5sd02/.ssh/id_ed25519`）がマウントされていない
   - `docker-compose.server.yml`にSSH鍵ディレクトリのマウント設定がなかった
   - 結果として、Dockerコンテナ内からPi4へのSSH接続が失敗する

3. **Tailscale経由の接続と変数展開**:
   - システムはTailscale経由で接続されることが多く、`group_vars/all.yml`の`network_mode`が`tailscale`に設定されている
   - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`（例: `100.74.144.79`）に解決される必要がある
   - `hosts: localhost`では、この変数展開が行われない

4. **エラーハンドリングの不足**:
   - Ansible Playbookのエラーメッセージを解析せず、汎用的な500エラーを返していた
   - ファイルが存在しない場合と、SSH接続エラーの区別ができなかった

**試行した対策**: 

- [試行1] `hosts: localhost` + `ansible_connection: local`を追加 → **部分的に成功**（SSH接続は成功したが、変数展開の問題は解決しない）
- [試行2] SSH鍵をマウント → **成功**（SSH接続エラーは解消）
- [試行3] `hosts: "{{ client_host }}"`に変更 → **成功**（変数展開の問題が解決）

**有効だった対策**: 

1. **Ansible Playbookの`hosts`指定を変更**:
   ```yaml
   # 変更前
   hosts: localhost
   delegate_to: "{{ client_host }}"
   
   # 変更後
   hosts: "{{ client_host }}"
   # delegate_toを削除
   ```
   - `hosts: "{{ client_host }}"`に変更することで、Ansibleは`inventory.yml`から`raspberrypi4`を検索
   - `inventory.yml`の`raspberrypi4`の`ansible_host: "{{ kiosk_ip }}"`が`group_vars/all.yml`の`kiosk_ip`で展開される
   - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`に解決される
   - 結果として、Ansibleは正しいTailscale IPでPi4に接続できる

2. **SSH鍵のマウント追加**:
   ```yaml
   # docker-compose.server.yml
   volumes:
     - /home/denkon5sd02/.ssh:/root/.ssh:ro
   ```
   - Pi5のホスト側のSSH鍵（`/home/denkon5sd02/.ssh/id_ed25519`）をDockerコンテナ内の`/root/.ssh/id_ed25519`にマウント
   - 読み取り専用（`:ro`）でマウントし、セキュリティを確保

3. **エラーハンドリングの改善**:
   ```typescript
   // Ansible Playbookのエラーメッセージを解析
   const errorMessage = stderr || stdout || '';
   const isFileNotFound = 
     errorMessage.includes('the remote file does not exist') ||
     errorMessage.includes('not transferring') ||
     errorMessage.includes('does not exist');
   
   if (isFileNotFound) {
     throw new ApiError(404, `バックアップ対象のファイルが見つかりません: ${this.clientHost}:${this.remotePath}`);
   }
   ```
   - Ansible Playbookのエラーメッセージを解析し、「ファイルが存在しない」場合は404エラーを返す
   - `FileBackupTarget`と同様のエラーハンドリングを実装

**学んだこと**: 

1. **Ansible Playbookの`hosts`指定の重要性**:
   - `hosts: localhost`で実行すると、`group_vars/all.yml`の変数が読み込まれない
   - `hosts: "{{ client_host }}"`のように直接ホストを指定すると、inventoryの変数が正しく展開される
   - `delegate_to`を使う場合でも、`hosts`で直接ホストを指定する方が変数展開が確実

2. **Tailscale経由の接続とAnsible**:
   - Tailscale経由の接続でも、Ansibleのinventoryで正しくIPアドレスが解決されれば問題なく動作する
   - `network_mode: "tailscale"`の場合、`group_vars/all.yml`の`kiosk_ip`は`tailscale_network.raspberrypi4_ip`に解決される
   - `hosts: "{{ client_host }}"`で実行すると、この変数展開が正しく行われる

3. **Dockerコンテナ内からのSSH接続**:
   - Dockerコンテナ内からSSH接続する場合は、SSH鍵をマウントする必要がある
   - 読み取り専用（`:ro`）でマウントし、セキュリティを確保する
   - SSH鍵のパーミッション（`~/.ssh`は700、`id_ed25519`は600）も重要

4. **Ansible Playbookのエラーハンドリング**:
   - Ansible Playbookのエラーメッセージを適切に解析することで、より明確なエラーハンドリングが可能
   - 「ファイルが存在しない」場合は404エラー、「SSH接続エラー」の場合は500エラーを返すなど、エラーの種類に応じた適切なHTTPステータスコードを返す

**解決状況**: ✅ **解決済み**（2025-12-19）

**関連ファイル**: 
- `infrastructure/ansible/playbooks/backup-clients.yml`
- `apps/api/src/services/backup/targets/client-file-backup.target.ts`
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/ansible/inventory.yml`
- `infrastructure/ansible/group_vars/all.yml`

**関連ドキュメント**:
- [Ansible SSH接続アーキテクチャの説明](../guides/ansible-ssh-architecture.md)
- [バックアップ設定ガイド](../guides/backup-configuration.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)

---

---

### [KB-103] バックアップ対象ごとのストレージプロバイダー指定機能実装（Phase 1-2）

**EXEC_PLAN.md参照**: Phase 8: バックアップ対象ごとのストレージプロバイダー指定機能（2025-12-28）

**背景**: 
- バックアップ対象ごとに異なるストレージプロバイダー（ローカル/Dropbox）を指定したい要望があった
- 重要な設定ファイルはローカルとDropboxの両方にバックアップしたい（多重バックアップ）
- 大きなファイル（写真データなど）はローカルのみにバックアップしたい

**実装内容**:

**Phase 1: 単一プロバイダー指定**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.provider`を追加（オプショナル）
- ✅ StorageProviderFactory: `createFromTarget`メソッドを追加
- ✅ BackupScheduler: 対象ごとのストレージプロバイダーを使用
- ✅ UI: バックアップ先選択欄を追加（ドロップダウン）
- ✅ 後方互換性: `storage`未指定時は全体設定を使用

**Phase 2: 多重バックアップ**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.providers`配列を追加
- ✅ BackupScheduler: 複数のプロバイダーに順次バックアップを実行
- ✅ UI: チェックボックスで複数のプロバイダーを選択可能に
- ✅ エラーハンドリング: 1つのプロバイダーで失敗しても他のプロバイダーへのバックアップは継続

**UI変更**:
- スケジュール入力UIを改善（テキスト入力 → 時刻入力フィールド + 曜日選択ボタン）
- バックアップ先選択をチェックボックス形式に変更（複数選択可能）

**技術的な詳細**:

- **スキーマ構造**:
  ```typescript
  {
    storage?: {
      provider?: 'local' | 'dropbox';  // Phase 1: 単一プロバイダー
      providers?: ('local' | 'dropbox')[];  // Phase 2: 複数プロバイダー
    }
  }
  ```

- **優先順位**:
  1. `storage.providers`が指定されている場合 → 配列を使用（多重バックアップ）
  2. `storage.provider`が指定されている場合 → 単一プロバイダーとして扱う
  3. 未指定の場合 → 全体設定（`config.storage.provider`）を使用

- **多重バックアップの動作**:
  - 各プロバイダーに順次バックアップを実行
  - 1つのプロバイダーで失敗しても、他のプロバイダーへのバックアップは継続
  - すべてのプロバイダーで失敗した場合のみエラーをスロー

**学んだこと**: 
- 後方互換性を保ちながら段階的に機能を拡張できる（Phase 1 → Phase 2）
- UIの改善（スケジュール入力）と機能追加（ストレージプロバイダー指定）を同時に実装できる
- E2EテストはUI変更に合わせて修正が必要（`getByLabel` → `locator`）

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**: 
- `apps/api/src/services/backup/backup-config.ts`
- `apps/api/src/services/backup/storage-provider-factory.ts`
- `apps/api/src/services/backup/backup-scheduler.ts`
- `apps/api/src/routes/backup.ts`
- `apps/web/src/components/backup/BackupTargetForm.tsx`
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`
- `e2e/admin.spec.ts`

**関連ドキュメント**: 
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

---

### [KB-104] バックアップ対象ごとの保持期間設定と自動削除機能実装（Phase 3）

**EXEC_PLAN.md参照**: Phase 9: バックアップ対象ごとの保持期間設定と自動削除機能（2025-12-28）

**背景**: 
- バックアップ対象ごとに異なる保持期間を設定したい要望があった
- データベースは30日、写真データは7日など、対象ごとに最適な保持期間を設定したい
- 手動での削除作業を自動化したい

**実装内容**:

**Phase 3: 対象ごとの保持期間設定**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`retention`フィールドを追加（`days`、`maxBackups`）
- ✅ BackupScheduler: `cleanupOldBackups`メソッドを対象ごとの`retention`設定に対応
- ✅ 対象ごとのバックアップのみをクリーンアップ（`prefix`でフィルタ）
- ✅ UI: 保持期間設定欄を追加（保持日数、最大保持数の入力フィールド）
- ✅ UI: テーブルに保持期間列を追加
- ✅ 後方互換性: `retention`未指定時は全体設定を使用

**技術的な詳細**:

- **スキーマ構造**:
  ```typescript
  {
    retention?: {
      days?: number;  // 保持日数（例: 30日）
      maxBackups?: number;  // 最大保持数（例: 10件）
    }
  }
  ```

- **優先順位**:
  1. 対象ごとの`retention`設定（指定されている場合）
  2. 全体設定（`config.retention`）
  3. 未指定の場合はクリーンアップを実行しない

- **自動削除の動作**:
  - バックアップ実行時に自動的に期限切れバックアップを削除
  - 対象ごとのバックアップのみをクリーンアップ（`prefix`でフィルタ）
  - 保持日数を超えたバックアップを削除
  - 最大保持数を超えた場合は古いものから削除

- **クリーンアップの実装**:
  ```typescript
  // 対象ごとのバックアップのみを取得（prefixが指定されている場合）
  const backups = await backupService.listBackups({ prefix });
  const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);
  // 期限切れバックアップを削除
  ```

**UI変更**:
- 保持期間設定欄を追加（保持日数、最大保持数の入力フィールド）
- テーブルに保持期間列を追加（例: "30日 / 最大10件" または "全体設定: 30日 / 最大10件"）

**学んだこと**: 
- 対象ごとの設定を実装する際は、全体設定との優先順位を明確にする必要がある
- バックアップのクリーンアップは対象ごとに実行するため、`prefix`でフィルタすることが重要
- 後方互換性を保つため、未指定時は全体設定を使用する設計が有効

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**: 
- `apps/api/src/services/backup/backup-config.ts`
- `apps/api/src/services/backup/backup-scheduler.ts`
- `apps/api/src/routes/backup.ts`
- `apps/web/src/components/backup/BackupTargetForm.tsx`
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`

**関連ドキュメント**: 
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

---

## KB-105: DropboxリストアUI改善（バックアップパス手動入力からドロップダウン選択へ）

**問題**: Dropbox経由のリストア時に、バックアップパスを手動で入力する必要があり、ユーザーエラーの原因となっていた。また、エラーメッセージが詳細に表示されず、問題の特定が困難だった。

**原因**:
1. バックアップパスを手動で入力する必要があり、パスの形式が分からない場合にエラーが発生しやすい
2. APIエラーレスポンスの詳細な`message`フィールドがUIに表示されず、汎用的なエラーメッセージのみが表示されていた

**解決策**:
1. **UI改善**: バックアップパス手動入力からドロップダウン選択へ変更
   - バックアップ履歴APIから`operationType: BACKUP`、`status: COMPLETED`、`storageProvider: dropbox`の履歴を取得
   - ドロップダウンでバックアップ履歴を選択可能に
   - `fileStatus`（`EXISTS`、`DELETED`）を表示し、`DELETED`の場合は警告を表示
   - `fileStatus=EXISTS`のみを表示するチェックボックスを追加
2. **エラーメッセージの詳細表示**: APIエラーレスポンスの`message`フィールドを抽出して表示
   - `axios.isAxiosError`を使用してエラーレスポンスを解析
   - `error.response?.data?.message`から詳細なエラーメッセージを取得
   - ユーザーフレンドリーなエラーメッセージを表示

**実装詳細**:
- `apps/web/src/pages/admin/BackupRestorePage.tsx`を修正
  - `useBackupHistory`フックを使用してバックアップ履歴を取得
  - `useMemo`で候補リストをフィルタリング（`operationType: BACKUP`、`status: COMPLETED`、`storageProvider: dropbox`）
  - `Listbox`コンポーネントでバックアップ履歴を選択可能に
  - `fileStatus`を表示し、`DELETED`の場合は警告を表示
  - `formatRestoreError`ヘルパー関数を追加してエラーメッセージを詳細に表示

**学んだこと**:
- 手動入力から選択式UIへの変更により、ユーザーエラーを大幅に削減できる
- APIエラーレスポンスの詳細な`message`フィールドを表示することで、問題の特定が容易になる
- `fileStatus`を表示することで、削除されたバックアップファイルを選択することを防止できる

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**:
- `apps/web/src/pages/admin/BackupRestorePage.tsx`（UI改善、エラーメッセージ詳細表示）

**実機検証結果**（2025-12-29）:
- ✅ バックアップ履歴からドロップダウンで選択可能になったことを確認
- ✅ `fileStatus`が正しく表示されることを確認（`EXISTS`、`DELETED`）
- ✅ `DELETED`ファイルを選択した場合に警告が表示されることを確認
- ✅ エラーメッセージが詳細に表示されることを確認（例：「従業員CSVの解析エラー: 従業員CSVの2行目でエラー: 社員コードは数字4桁である必要があります（例: 0001）」）
- ✅ 社員コードを4桁形式に変更後、バックアップとリストアが正常に動作することを確認

**関連ドキュメント**:
- [バックアップリストア機能の実機検証結果](../guides/backup-restore-verification-results.md)
- [バックアップリストア機能の実機検証実行手順](../guides/backup-restore-verification-execution.md)

---

## KB-106: バックアップスクリプトとの整合性確認

**問題**: `scripts/server/backup.sh`スクリプトと管理コンソールのバックアップ機能の整合性が不明確だった。

**原因**:
1. バックアップスクリプトは`/api/backup/internal`エンドポイントを使用しているが、通常のAPIエンドポイント（`/api/backup`）との違いが不明確
2. バックアップスクリプトが使用する`kind`と`source`の組み合わせが管理コンソールと一致しているか確認されていなかった

**解決策**:
1. **エンドポイントの確認**: `/api/backup/internal`エンドポイントが存在し、localhostからのアクセスのみ許可されていることを確認
2. **整合性の確認**: バックアップスクリプトが使用する`kind`と`source`の組み合わせが管理コンソールと一致していることを確認
3. **動作の確認**: 両方の方法で同じ設定ファイル（`backup.json`）が使用され、バックアップ履歴が正しく記録されることを確認

**実装詳細**:
- `/api/backup/internal`エンドポイントは`/api/backup`エンドポイントと同じロジックを使用
- localhostからのアクセスのみ許可（`127.0.0.1`、`::1`、`172.*`）
- レート制限は無効化（`config: { rateLimit: false }`）

**バックアップスクリプトの動作**:
- APIが利用可能な場合、API経由でバックアップを実行（設定ファイルのDropbox設定が自動的に使用される）
- APIが利用できない場合、またはAPI経由のバックアップが失敗した場合、ローカルバックアップにフォールバック
- ローカルバックアップは常に実行される（API経由のバックアップが成功しても、フォールバック用に保持）

**対応関係**:
| `backup.sh`の処理 | APIの`kind` | APIの`source` |
|------------------|------------|--------------|
| データベース（`pg_dump`） | `database` | `postgresql://postgres:...@db:5432/borrow_return` |
| 環境変数ファイル（`.env`） | `file` | `/opt/RaspberryPiSystem_002/apps/api/.env` など |
| 写真ディレクトリ（`tar.gz`） | `image` | `photo-storage` |
| CSVデータ（従業員・アイテム） | `csv` | `employees`, `items` |

**学んだこと**:
- バックアップスクリプトと管理コンソールは同じバックアップロジックを使用しているため、整合性が保たれている
- 設定ファイル（`backup.json`）の設定が両方で有効
- Dropbox設定が両方で自動的に使用される
- バックアップ履歴が両方で正しく記録される

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**:
- `scripts/server/backup.sh`（バックアップスクリプト）
- `apps/api/src/routes/backup.ts`（`/api/backup/internal`エンドポイント）

**関連ドキュメント**:
- [バックアップスクリプトとの整合性確認結果](../guides/backup-script-integration-verification.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

## KB-107: Dropboxストレージプロバイダーのエラーハンドリング改善

**問題**: Dropboxストレージプロバイダーの`download`と`delete`メソッドに、レート制限エラー（429）やネットワークエラー時のリトライ機能が実装されていなかった。

**原因**:
1. `upload`メソッドにはレート制限エラー（429）時のリトライ機能が実装されていたが、`download`と`delete`メソッドには実装されていなかった
2. ネットワークエラー（タイムアウト、接続エラーなど）に対するリトライ機能が実装されていなかった

**解決策**:
1. **`download`メソッドの改善**: レート制限エラー（429）とネットワークエラー時に指数バックオフでリトライ
2. **`delete`メソッドの改善**: レート制限エラー（429）とネットワークエラー時に指数バックオフでリトライ
3. **リトライロジックの統一**: `upload`メソッドと同じリトライロジックを使用

**実装詳細**:
- 最大リトライ回数: 5回
- リトライ待機時間: `Retry-After`ヘッダーが指定されている場合はその値、それ以外は指数バックオフ（2^retryCount秒、最大30秒）
- 検出するネットワークエラー: `ETIMEDOUT`、`ECONNRESET`、`ENOTFOUND`、`ECONNREFUSED`、エラーメッセージに`timeout`、`network`、`ECONN`が含まれる場合

**コード変更**:
- `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`
  - `download`メソッド: リトライロジックを追加（約167行変更）
  - `delete`メソッド: リトライロジックを追加

**学んだこと**:
- レート制限エラーへの対応により、Dropbox APIのレート制限に達した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上
- ネットワークエラーへの対応により、一時的なネットワークエラーが発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上
- ログ出力の改善により、リトライ時に詳細なログを出力することで、問題の特定が容易に

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**:
- `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`（エラーハンドリング改善）

**関連ドキュメント**:
- [バックアップエラーハンドリング改善](../guides/backup-error-handling-improvements.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

### [KB-108] Gmail OAuth認証時のTailscale DNS解決問題と`/etc/hosts`設定

**EXEC_PLAN.md参照**: Gmailデータ取得機能実装（2025-12-29）

**事象**: 
- Gmail OAuth認証時にGoogleからコールバックURI（`https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback`）にリダイレクトされるが、Macのブラウザが`raspberrypi.tail7312a3.ts.net`を解決できない
- Tailscale DNSをONにするとCursorの接続が切れる事象が過去に繰り返し発生したため、オフにしている

**要因**: 
1. **Tailscale DNSがオフ**: Mac側でTailscale DNS（MagicDNS）が無効になっている
2. **DNS解決の失敗**: OAuth認証時のコールバックURI解決にTailscale DNSが必要
3. **Cursor接続の問題**: Tailscale DNSをONにするとCursorの接続が切れる

**試行した対策**: 
- [試行1] Tailscale DNSをONにする → **失敗**（Cursorの接続が切れる）
- [試行2] Google Cloud ConsoleでIPアドレスを直接指定 → **失敗**（Google Cloud Consoleは`https://`のドメイン名を要求）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-29）:
  1. Macの`/etc/hosts`ファイルに固定レコードを追加:
     ```
     100.106.158.2 raspberrypi.tail7312a3.ts.net
     ```
  2. スクリプト（`scripts/mac/setup-etc-hosts-for-gmail-oauth.sh`）を作成して自動化
  3. OAuth認証は最初の1回だけ実行（refresh tokenを取得するため）
  4. 以後は自動リフレッシュで運用可能（Gmailの場合、`OAuth2Client`が自動的にトークンをリフレッシュ）

**学んだこと**: 
- **Tailscale DNSをオフにしても問題ない**: Pi5側はDNS解決に依存していない（IPアドレスで動作）
- **`/etc/hosts`の設定は一度行えば永続的に有効**: Pi5のTailscale IPが変更されない限り
- **OAuth認証は最初の1回だけ**: refresh tokenを取得するため。以後は自動リフレッシュで運用可能
- **GmailとDropboxのトークンリフレッシュの違い**:
  - **Gmail**: `OAuth2Client`が自動的にトークンをリフレッシュするため、手動リフレッシュは通常不要
  - **Dropbox**: SDKに自動リフレッシュ機能がないため、エラー発生時に手動でリフレッシュが必要

**解決状況**: ✅ **解決済み**（2025-12-29）

**関連ファイル**:
- `scripts/mac/setup-etc-hosts-for-gmail-oauth.sh`（`/etc/hosts`設定スクリプト）
- `docs/guides/gmail-setup-guide.md`（Gmail連携セットアップガイド）

**関連ドキュメント**:
- [Gmail連携セットアップガイド](../guides/gmail-setup-guide.md)
- [Gmailデータ取得機能実装計画](../plans/gmail-data-acquisition-execplan.md)

---

## KB-144: バックアップ手動実行時の500エラー（client-directory kind追加とbackup.json正規化）

**問題**: 手動バックアップ実行時に一部の対象で500エラーが発生していた。特に以下の2つの問題があった：
1. Pi5自身のファイルを`client-file`として登録していた（`raspberrypi5:/opt/.../.env`）
2. Pi3/Pi4のディレクトリを`directory`として登録していた（`raspberrypi3:/etc/tailscale`）

**原因**:
1. **Pi5自身のファイルを`client-file`で登録**:
   - `client-file`はAnsible経由で*リモート*クライアント端末のファイルを取得するためのkind
   - Pi5自身をクライアントとして扱うと、Ansibleが自分自身から自分自身へ接続しようとして失敗する
   - エラーメッセージ: `Command failed: ansible-playbook ... Failed to backup client file`

2. **Pi3/Pi4のディレクトリを`directory`で登録**:
   - `directory`はPi5上の*ローカル*ディレクトリを`tar`コマンドでアーカイブするためのkind
   - リモートパス（`raspberrypi3:/etc/tailscale`）を`tar`コマンドに渡すと、存在しないパスとしてエラーになる
   - エラーメッセージ: `tar: raspberrypi3:/etc/tailscale: Cannot open: No such file or directory`

3. **Tailscaleパスの誤り**:
   - `/etc/tailscale`は存在しないパス
   - 正しいパスは`/var/lib/tailscale`（Tailscaleの状態ファイルは`/var/lib/tailscale/tailscaled.state`）

**解決策**:
1. **`client-directory` kindを追加**:
   - クライアント端末のディレクトリをAnsible経由でアーカイブ→取得するための新しいkindを追加
   - `infrastructure/ansible/playbooks/backup-client-directory.yml`を作成
   - `apps/api/src/services/backup/targets/client-directory-backup.target.ts`を実装
   - API/UI/Ansibleに`client-directory`を追加

2. **`backup.json`の正規化**:
   - Pi5自身のファイル: `client-file` → `file`に変更（コンテナ内パスに変換、例: `/app/config/backup.json`）
   - Pi5自身のディレクトリ: `directory`のまま（コンテナ内パスに変換、例: `/app/host/certs`）
   - Pi3/Pi4のディレクトリ: `directory` → `client-directory`に変更（例: `raspberrypi3:/var/lib/tailscale`）

3. **Tailscaleパスの修正**:
   - `/etc/tailscale`（存在しない）→ `/var/lib/tailscale`（実在）に修正

4. **Docker Composeのマウント追加**:
   - Pi5の証明書バックアップ用に`/opt/RaspberryPiSystem_002/certs:/app/host/certs:ro`を追加
   - APIコンテナから証明書ディレクトリにアクセス可能に

**実装詳細**:
- **API変更**:
  - `apps/api/src/routes/backup.ts`: `client-directory`を`kind` enumに追加
  - `apps/api/src/services/backup/backup-types.ts`: `BackupKind`に`client-directory`を追加
  - `apps/api/src/services/backup/backup-config.ts`: Zodスキーマに`client-directory`を追加
  - `apps/api/src/services/backup/backup-target-factory.ts`: `ClientDirectoryBackupTarget`を追加
  - `apps/api/src/services/backup/targets/client-directory-backup.target.ts`: **新規作成**

- **Ansible変更**:
  - `infrastructure/ansible/playbooks/backup-client-directory.yml`: **新規作成**
    - クライアント端末のディレクトリを`tar.gz`でアーカイブ
    - Ansibleの`fetch`モジュールでPi5に取得

- **UI変更**:
  - `apps/web/src/api/backup.ts`: `BackupTarget.kind`と`RunBackupRequest.kind`に`client-directory`を追加
  - `apps/web/src/components/backup/BackupTargetForm.tsx`: `client-directory`をkind選択に追加
  - `apps/web/src/pages/admin/BackupTargetsPage.tsx`: `getKindLabel`に`client-directory`を追加

- **Docker Compose変更**:
  - `infrastructure/docker/docker-compose.server.yml`: APIサービスに`/opt/RaspberryPiSystem_002/certs:/app/host/certs:ro`を追加

**学んだこと**:
- `client-file`と`client-directory`は*リモート*クライアント端末専用。Pi5自身のファイルには使用しない
- `file`と`directory`はPi5上の*ローカル*ファイル/ディレクトリ専用。リモートパスには使用しない
- バックアップ対象のkindとsourceの組み合わせを正しく理解することが重要
- Tailscaleの設定ファイルは`/var/lib/tailscale`に存在する（`/etc/tailscale`ではない）
- Dockerコンテナ内からホストのファイルにアクセスする場合は、適切なマウント設定が必要

**解決状況**: ✅ **解決済み**（2026-01-06）

**関連ファイル**:
- `apps/api/src/services/backup/targets/client-directory-backup.target.ts`（新規作成）
- `infrastructure/ansible/playbooks/backup-client-directory.yml`（新規作成）
- `apps/api/src/routes/backup.ts`（`client-directory`追加）
- `apps/api/src/services/backup/backup-types.ts`（`BackupKind`に`client-directory`追加）
- `apps/api/src/services/backup/backup-config.ts`（Zodスキーマに`client-directory`追加）
- `apps/api/src/services/backup/backup-target-factory.ts`（`ClientDirectoryBackupTarget`追加）
- `apps/web/src/api/backup.ts`（`client-directory`追加）
- `apps/web/src/components/backup/BackupTargetForm.tsx`（`client-directory`追加）
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`（`client-directory`ラベル追加）
- `infrastructure/docker/docker-compose.server.yml`（証明書マウント追加）
- `/opt/RaspberryPiSystem_002/config/backup.json`（正規化）

**実機検証結果**（2026-01-06）:
- ✅ `client-directory raspberrypi3:/var/lib/tailscale` 成功
- ✅ `client-directory raspberrypi4:/var/lib/tailscale` 成功
- ✅ `directory /app/host/certs` 成功
- ✅ `file /app/config/backup.json` 成功
- ✅ その他のバックアップ対象もすべて成功

**コミット**:
- `73853b6` - fix(backup): remove debug instrumentation logs after successful verification

---

## KB-146: Gmail OAuthがDropboxトークンを上書きし、Dropboxバックアップが失敗する（トークン分離で恒久対策）

**EXEC_PLAN.md参照**: Gmail設定復旧＋Dropbox手動バックアップ再失敗の調査（2026-01-06）

**事象**:
- Gmail OAuthを実施/更新した後、**Dropboxへの手動バックアップが大量に失敗**する
- APIログに `refresh token is malformed` / `invalid_grant` 相当のエラーが出る（Dropbox側）

**要因**:
- `backup.json` の `storage.options` が **DropboxとGmailで同じ `accessToken` / `refreshToken` フィールドを共有**しており、
  Gmail OAuthで保存したトークンが **Dropbox用トークンを上書き**していた
- これは **疎結合・モジュール化の方針（provider間で状態を共有しない）に反する設計**で、設定ファイル1つの“便利な共通フィールド”が副作用の温床になった

**有効だった対策**:
- ✅ **解決済み**（2026-01-06）:
  1. **Gmail用トークンを分離**: `storage.options.gmailAccessToken` / `storage.options.gmailRefreshToken` を新設し、Gmailはそちらへ保存する
  2. **Gmail設定の有効判定をstorage.providerから分離**: `GET /api/gmail/config` は `clientId` の存在で「設定済み」を判定（バックアップ先のprovider切替と独立）
  3. **自動処理のトークン更新も分離**: CSVインポート後の自動バックアップ等で、Gmailの場合は `gmailAccessToken` に更新を書き込む
  4. `BackupConfigLoader` で `gmailAccessToken/gmailRefreshToken` の `${ENV}` 参照解決にも対応（将来の運用ドリフトに備える）

**学んだこと**:
- 外部サービス連携（Dropbox/Gmail/Slack等）は「**設定・トークン・状態を別名前空間で管理**」しないと、運用で必ず衝突する
- “共通フィールド”は拡張性を上げるように見えて、実際は**スケール（連携追加）時に事故率を上げる**。最初からprovider別の構造（例: `options.dropbox.*`, `options.gmail.*`）に寄せるのが安全

**解決状況**: ✅ **解決済み**（2026-01-06）

**関連ファイル**:
- `apps/api/src/services/backup/backup-config.ts`（Gmail用トークンの分離）
- `apps/api/src/services/backup/storage-provider-factory.ts`（provider別トークンの参照）
- `apps/api/src/routes/gmail/oauth.ts`（Gmail OAuthトークン保存先）
- `apps/api/src/routes/gmail/config.ts`（Gmail設定の「設定済み」判定）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（自動バックアップ時のトークン更新先）
- `/opt/RaspberryPiSystem_002/config/backup.json`（分離後のキー反映）

---

## KB-147: backup.jsonのprovider別名前空間化（構造的再発防止策）

**EXEC_PLAN.md参照**: P0: Token Config Decouple（2026-01-06）

**事象**:
- KB-146で `gmailAccessToken/gmailRefreshToken` を導入したが、**フラットにキーが増え続ける**と再び衝突・運用ミスが起きやすい
- 将来providerが増えるたびに「分離キー」を追加する運用では、スケーラビリティ・保守性が低下する

**要因**:
- `backup.json` の `storage.options` がフラットな構造で、provider間でキーが衝突しやすい
- 旧構造では `accessToken/refreshToken` がDropbox/Gmailで共有され得て、OAuth更新で他方を上書きする事故が起きた

**有効だった対策**:
- ✅ **解決済み**（2026-01-06）: `backup.json` の `storage.options` を **provider別名前空間**へ移行
  1. **新構造**: `storage.options.dropbox.*` / `storage.options.gmail.*` を追加（推奨）
  2. **後方互換**: 旧キー（`accessToken/refreshToken/appKey/appSecret`、`gmailAccessToken/gmailRefreshToken`）は読み取り可能にし、書き込みは新構造へ寄せる
  3. **自動正規化**: `BackupConfigLoader` でロード時に旧キー → 新構造へ正規化（メモリ上のみ、自動保存はしない）
  4. **ネスト対応の環境変数解決**: `${ENV}` 参照を深いオブジェクト（`options.dropbox.*`, `options.gmail.*`）でも解決可能に
  5. **トークン更新コールバックの統一**: OAuthコールバック/refresh/onTokenUpdate は全てprovider別名前空間へ保存

**新構造の例**:
```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "dropbox": {
        "appKey": "${DROPBOX_APP_KEY}",
        "appSecret": "${DROPBOX_APP_SECRET}",
        "accessToken": "${DROPBOX_ACCESS_TOKEN}",
        "refreshToken": "${DROPBOX_REFRESH_TOKEN}"
      },
      "gmail": {
        "clientId": "...",
        "clientSecret": "...",
        "redirectUri": "...",
        "accessToken": "...",
        "refreshToken": "...",
        "subjectPattern": "...",
        "fromEmail": "..."
      }
    }
  }
}
```

**移行方針**:
- **既存運用**: 旧キーは読み取り可能（後方互換）なので、既存の `backup.json` はそのまま動作する
- **新規設定**: OAuthコールバック/refresh/管理コンソールでの保存は新構造（`options.dropbox.*`, `options.gmail.*`）へ自動的に保存される
- **手動移行**: 必要に応じて `backup.json` を手動で新構造へ移行可能（必須ではない）

**学んだこと**:
- **設定スキーマの疎結合化**: provider間で状態を共有しない構造（名前空間分離）により、将来providerが増えても衝突しない
- **段階的移行**: 後方互換を維持しながら新構造へ移行することで、既存運用を壊さずに改善できる
- **自動正規化**: ロード時の正規化により、旧構造でも新構造でも動作する柔軟性を実現

**解決状況**: ✅ **解決済み**（2026-01-06: 実装完了、2026-01-06: 実機検証完了）

**実機検証結果**（2026-01-06）:
- ✅ **旧構造の後方互換性**: 既存の`backup.json`（旧キー: `accessToken`, `gmailAccessToken`など）が正常に読み込まれ、新構造（`options.dropbox.*`, `options.gmail.*`）へ自動正規化されることを確認
- ✅ **新構造への保存**: Gmail OAuth更新（`POST /api/gmail/oauth/refresh`）が`options.gmail.*`に保存され、`[BackupConfigLoader] Config saved`ログが記録されることを確認
- ✅ **Dropboxバックアップ**: 手動バックアップ（`POST /api/backup`）が正常に動作し、Dropboxへのファイルアップロード（`[DropboxStorageProvider] File uploaded`）が成功することを確認
- ✅ **自動正規化の動作**: APIログに`[BackupConfigLoader] Normalized Dropbox config from legacy keys to options.dropbox`と`[BackupConfigLoader] Normalized Gmail config from legacy keys to options.gmail`が記録され、正規化が正常に動作することを確認
- ✅ **backup.jsonの構造**: 実機検証後、`backup.json`に新構造（`options.dropbox.*`に`appKey`, `appSecret`, `accessToken`, `refreshToken`、`options.gmail.*`に`clientId`, `clientSecret`, `redirectUri`, `accessToken`, `refreshToken`など）が正しく保存されていることを確認
- ✅ **Gmail設定API**: `GET /api/gmail/config`が新構造を優先して読み取り、旧構造も後方互換で読み取れることを確認

**関連ファイル**:
- `apps/api/src/services/backup/backup-config.ts`（Zodスキーマ拡張、provider別名前空間追加）
- `apps/api/src/services/backup/backup-config.loader.ts`（ネスト対応の${ENV}解決、旧キー→新構造への正規化、ヘルスチェック機能）
- `apps/api/src/services/backup/storage-provider-factory.ts`（新構造優先、旧キーは後方互換）
- `apps/api/src/routes/backup.ts`（Dropbox OAuthコールバック/refresh、onTokenUpdate、ヘルスチェックエンドポイント）
- `apps/api/src/routes/gmail/oauth.ts`（Gmail OAuthコールバック/refresh）
- `apps/api/src/routes/gmail/config.ts`（Gmail設定API、新構造で読み書き）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（CSVインポート後の自動バックアップ、onTokenUpdate）
- `apps/api/src/routes/imports.ts`（マスターインポート、onTokenUpdate）
- `apps/api/src/services/backup/backup-scheduler.ts`（スケジュールバックアップ、onTokenUpdate）
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`（ヘルスチェック結果のUI表示）
- `apps/web/src/api/backup.ts`（ヘルスチェックAPIクライアント）
- `apps/web/src/api/hooks.ts`（useBackupConfigHealthフック）

---

## KB-148: バックアップ設定の衝突・ドリフト検出の自動化（P1実装）

**EXEC_PLAN.md参照**: P1: 衝突・ドリフト検出の自動化（2026-01-06）

**目的**:
- `backup.json`の新旧構造間の設定値の衝突や、環境変数と設定ファイル間のドリフトを自動検出する
- 管理コンソールUIで視覚的に確認可能にする

**実装内容**:
- ✅ **解決済み**（2026-01-06）: 以下の対策を実装し、設定の整合性を自動的に検証可能にした。
  1. **BackupConfigLoader.checkHealth()メソッド**: 衝突・ドリフト・欠落を検出するメソッドを追加
     - **衝突検出**: 旧キー（`accessToken`など）と新構造（`options.dropbox.accessToken`など）の両方に異なる値が設定されている場合を検出
     - **ドリフト検出**: 環境変数参照（`${VAR}`）と直接値の両方が設定されている場合を検出
     - **欠落チェック**: 必須設定（`appKey`, `appSecret`, `clientId`, `clientSecret`など）が設定されていない場合を検出
  2. **GET /api/backup/config/healthエンドポイント**: 健全性ステータス（`healthy`/`warning`/`error`）と検出された問題の詳細情報を返却
  3. **管理コンソールUI統合**: `BackupTargetsPage`にヘルスチェック結果を表示するUIを追加
     - ステータスに応じた色分け表示（正常: 緑、警告: 黄、エラー: 赤）
     - 検出された問題の詳細情報を表示
     - 1分ごとに自動更新

**検出項目**:
- **衝突検出**: 旧キーと新構造の両方に値がある場合の警告
- **ドリフト検出**: 環境変数と設定ファイルの値の不一致検出
- **欠落チェック**: 必須設定の欠落チェック

**学んだこと**:
- **設定の整合性検証**: 自動検出により、設定の不整合を早期に発見できる
- **UI統合**: 管理コンソールに統合することで、運用者が視覚的に確認可能になる
- **自動更新**: React Queryの`refetchInterval`により、定期的に最新の状態を確認できる

**解決状況**: ✅ **解決済み**（2026-01-06: 実装完了、2026-01-06: 実機検証完了）

**実機検証結果**（2026-01-06）:
- ✅ **ヘルスチェックエンドポイント**: `GET /api/backup/config/health`が正常に動作し、衝突検出が成功することを確認
- ✅ **UI表示**: 管理コンソールのバックアップ設定ページにヘルスチェック結果が表示されることを確認
- ✅ **自動更新**: 1分ごとに自動更新されることを確認

**関連ファイル**:
- `apps/api/src/services/backup/backup-config.loader.ts`（checkHealth()メソッド）
- `apps/api/src/routes/backup.ts`（GET /api/backup/config/healthエンドポイント）
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`（ヘルスチェック結果のUI表示）
- `apps/web/src/api/backup.ts`（getBackupConfigHealth APIクライアント）
- `apps/web/src/api/hooks.ts`（useBackupConfigHealthフック）

---

## KB-151: backup.jsonの破壊的上書きを防ぐセーフガード実装

**問題**: `backup.json`がフォールバック設定（デフォルト設定）で上書きされ、Gmail設定や多数のバックアップターゲットが消失する問題が再発した。

**原因**:
1. **フォールバック検知マーカーの消失**: `BackupConfigLoader.load()`がフォールバック設定を返した際に`FALLBACK_MARKER`（Symbol）を付与していたが、APIルートで`{...config}`によるスプレッドクローンを作成すると、Symbolプロパティが失われていた
2. **フォールバック設定の保存**: マーカーが失われた状態で`BackupConfigLoader.save()`を呼び出すと、フォールバック設定が有効な設定として保存され、実際の`backup.json`を上書きしてしまう
3. **破壊的上書きの検知不足**: targets数が急激に減る（例: 17件→4件）場合の検知が不十分だった

**解決策**:
1. **フォールバック検知マーカーの保持**: APIルート（`gmail/oauth.ts`, `gmail/config.ts`, `backup.ts`）で`{...config}`によるスプレッドクローンを廃止し、`BackupConfigLoader.load()`で取得したconfigオブジェクトを直接更新するように変更。これにより`FALLBACK_MARKER`が保持される
2. **フォールバック保存の拒否**: `BackupConfigLoader.save()`で、本番パス（`/app/config/backup.json`）の場合のみ、`FALLBACK_MARKER`が付与されている設定の保存を明示的に拒否
3. **破壊的上書き防止ガード**: `BackupConfigLoader.save()`で、前回読み込んだ設定（`lastLoadedConfig`）と比較し、targets数が50%以上減る保存を拒否する「アンチワイプガード」を追加
4. **詳細ログの追加**: ファイル読み込み時にサイズ・要約情報（targets数、Gmail/Dropbox設定の有無）をログ出力し、保存時の検証結果もログ出力

**実装詳細**:
- **フォールバック検知マーカーの保持**:
  - `apps/api/src/routes/gmail/oauth.ts`: `updatedConfig = {...config}`を廃止し、`config`オブジェクトを直接更新
  - `apps/api/src/routes/gmail/config.ts`: 同様に`config`オブジェクトを直接更新
  - `apps/api/src/routes/backup.ts`: `onTokenUpdate`コールバック内で`{...config}`を廃止し、`BackupConfigLoader.load()`で最新を読み直してから更新
- **フォールバック保存の拒否**:
  - `BackupConfigLoader.save()`で、本番パス（`/app/config/backup.json`）の場合のみ、`FALLBACK_MARKER`が付与されている設定の保存を拒否
  - テスト環境（`/tmp/test-backup.json`など）ではこのチェックをスキップ
- **破壊的上書き防止ガード**:
  - `BackupConfigLoader.save()`で、`lastLoadedConfig`と比較し、`config.targets.length < lastLoadedConfig.targets.length * 0.5`の場合に保存を拒否
  - 本番パスの場合のみ有効（テスト環境ではスキップ）
- **詳細ログの追加**:
  - `BackupConfigLoader.load()`: ファイル読み込み時に`bytes`（ファイルサイズ）と`summary`（targets数、Gmail/Dropbox設定の有無）をログ出力
  - `BackupConfigLoader.save()`: 保存時に`targets`数と検証結果をログ出力

**学んだこと**:
- **Symbolプロパティの保持**: JavaScriptの`{...obj}`によるスプレッドクローンは、Symbolプロパティを失う可能性がある。内部状態を保持する必要がある場合は、元のオブジェクトを直接更新する
- **フォールバック検知の重要性**: フォールバック設定が有効な設定として保存されると、実際の設定が失われる。マーカーによる検知と保存拒否が重要
- **段階的な保護**: 複数の保護レイヤー（フォールバック検知、破壊的上書き防止、詳細ログ）を組み合わせることで、設定消失を防ぐ
- **テスト環境との分離**: 本番環境でのみ保護を有効化し、テスト環境では柔軟に動作するようにする

**解決状況**: ✅ **解決済み**（2026-01-07: 実装完了、2026-01-07: CI通過、2026-01-07: デプロイ完了）

**実機検証結果**（2026-01-07）:
- ✅ **CI通過**: GitHub ActionsのCIが正常に通過し、テスト環境での動作を確認
- ✅ **デプロイ完了**: Pi5にデプロイし、APIコンテナが正常に起動することを確認
- ✅ **ログ出力**: `[BackupConfigLoader] Raw config file read`と`[BackupConfigLoader] Config loaded`が正常に出力され、ファイルサイズ（9358 bytes）と要約情報（targetsLen: 17、Gmail/Dropbox設定の有無）が記録されることを確認
- ✅ **再現手順の実行完了**: Gmail設定のトークン更新とバックアップ実行を実施し、以下の結果を確認
  - **ファイルサイズ**: 9358 bytes（検証前後で変化なし）
  - **ターゲット数**: 17（検証前後で変化なし）
  - **Gmail設定**: 維持されている（`hasAccessToken: true`, `hasRefreshToken: true`）
  - **Dropbox設定**: 維持されている（`hasAccessToken: true`, `hasRefreshToken: true`）
  - **APIログ**: `[BackupConfigLoader] Config saved`が正常に記録され、`incomingSummary`に`targetsLen: 17`が記録されていることを確認（破壊的上書きが発生していない）

**関連ファイル**:
- `apps/api/src/services/backup/backup-config.loader.ts`（`FALLBACK_MARKER`、`save()`の保護ロジック、詳細ログ）
- `apps/api/src/routes/gmail/oauth.ts`（`config`オブジェクトの直接更新）
- `apps/api/src/routes/gmail/config.ts`（`config`オブジェクトの直接更新）
- `apps/api/src/routes/backup.ts`（`onTokenUpdate`コールバック内での`config`オブジェクトの直接更新）
- `apps/api/src/routes/__tests__/imports-schedule.integration.test.ts`（テスト環境での`backup.json`事前作成）

---

### [KB-163] git cleanによるbackup.json削除問題（再発）

**発生日**: 2026-01-15

**事象**: 
- デプロイ後に管理コンソールでGmailのCSV取り込み設定が消えていた
- Dropboxバックアップの実行履歴が毎日記録されていなかった

**根本原因**:
- `infrastructure/ansible/roles/common/tasks/main.yml` の `git clean -fd` コマンドで `config/` ディレクトリが除外リストに含まれていなかった
- デプロイ時に `git clean -fd` が実行され、`config/backup.json` が削除されていた
- `config/` ディレクトリは追跡対象外（untracked）であるため、`git clean` で削除される

**なぜKB-151の対策で防げなかったか**:
- KB-151の対策は「フォールバック設定の保存を拒否する」ことで上書きを防ぐものだった
- しかし、`git clean`によるファイル自体の削除は防げない
- Ansibleの`manage-app-configs.yml`に「backup.jsonが存在しない場合に最小限の設定で作成する」処理があるが、それはGmail設定やDropbox設定を含まない最小限の設定

**修正内容**:
1. `.gitignore`に`config/`を追加（根本的解決策の一部）
2. `infrastructure/ansible/roles/common/tasks/main.yml` の `git clean` 除外リストに `config/` を追加（二重保護）
3. **Ansibleデプロイから`git clean`を削除（根本対策）**

**復旧手順**:
1. Dropboxから`backup.json`を復元（[KB-165](#kb-165-dropboxからのbackupjson復元方法)参照）
2. 管理コンソールでGmail設定を再設定（OAuth認証経由）（[KB-166](#kb-166-gmail-oauth設定の復元方法)参照）
3. Dropbox設定を再設定（OAuth認証経由）
4. CSVインポートスケジュールを再設定

**学んだこと**:
- **ファイル削除とファイル上書きは別の問題**: 上書き防止対策だけでは、ファイル削除を防げない
- **git cleanの除外リストは網羅的に**: 運用で生成される全ての設定ファイル・データディレクトリを除外リストに含める必要がある
- **ログ調査の重要性**: 既存のpinoロガー + docker logs + journalctl で十分な証拠が得られる
- **ドキュメント参照の徹底**: 既存のナレッジベースを参照することで、過去の対策の限界を理解できる

**解決状況**: ✅ **修正完了**（2026-01-15）

**関連ファイル**:
- `infrastructure/ansible/roles/common/tasks/main.yml`（git cleanの除外リスト修正）
- `.gitignore`（`config/`を追加）
- `apps/api/src/services/backup/backup-config.loader.ts`（フォールバック検知ロジック）
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（backup.json作成ロジック）

**関連ナレッジ**:
- KB-151: backup.jsonの破壊的上書きを防ぐセーフガード実装（上書き防止）
- 本KB-163: git cleanによる削除防止（削除防止）
- KB-164: git clean設計の根本的改善（`.gitignore`による一元管理）

**再発防止策**:
- **Ansibleデプロイから`git clean`を削除済み**（運用データ削除の発生源を排除）
- `.gitignore`に`config/`を追加済み（ローカル作業時の保護）
- 今後、新しい運用データディレクトリを追加する際は、必ず`.gitignore`にも追加する

---

### [KB-164] git clean設計の根本的改善（.gitignoreによる一元管理）

**発生日**: 2026-01-15

**事象**: 
KB-163（git cleanによるbackup.json削除問題）の根本原因分析により、設計上の問題を特定

**根本原因**:
1. `.gitignore` に `config/` が漏れていた（単純なミス）
2. `git clean -fd` の除外リストを手動でメンテナンスする設計が脆弱（二重メンテナンスが必要）

**問題のある設計（変更前）**:
```bash
git clean -fd \
  -e storage/ -e 'storage/**' \
  -e certs/ -e 'certs/**' \
  -e alerts/ -e 'alerts/**' \
  -e logs/ -e 'logs/**' \
  -e config/ -e 'config/**'
```
- 新しい運用データディレクトリを追加するたびに、`.gitignore` と除外リストの2箇所を更新する必要がある
- 漏れが発生しやすい

**改善した設計（変更後）**:
- **運用（Ansibleデプロイ）では`git clean`を実行しない**方針に変更
- `git reset --hard`のみで追跡ファイルを収束させ、運用データは保持する
- `.gitignore`はローカル作業時の保護として維持する

**git cleanの動作**:
| ファイルの状態 | `git clean -fd` | `git clean -fdX` |
|----------------|-----------------|------------------|
| 追跡されている | 削除しない | 削除しない |
| .gitignore で無視 | **削除しない** | **削除する** |
| 追跡されていない（.gitignoreに無い） | 削除する | 削除しない |

**修正内容**:
1. `.gitignore` に `config/` を追加（ローカル作業時の保護）
2. **Ansibleデプロイから`git clean`を削除**

**学んだこと**:
- **`.gitignore`による一元管理**: `.gitignore`に追加することで、`git clean -fd`は自動的に保護される
- **二重保護の重要性**: 除外リストも残すことで、`.gitignore`の設定漏れがあっても保護される
- **`git clean -fdX`は誤り**: `-X`オプションは`.gitignore`で無視されているファイルを削除するため、逆効果になる

**解決状況**: ✅ **設計改善完了**（2026-01-15）

**関連ファイル**:
- `.gitignore`（`config/` を追加）
- `infrastructure/ansible/roles/common/tasks/main.yml`（`git clean -fd` の除外リストに `config/` を追加）

**関連ナレッジ**:
- KB-151: backup.jsonの破壊的上書きを防ぐセーフガード実装（上書き防止）
- KB-163: git cleanによる削除防止（削除防止）
- 本KB-164: git clean設計の根本的改善（`.gitignore`による一元管理）

**再発防止策**:
- **Ansibleデプロイから`git clean`を削除済み**
- `.gitignore`に`config/`を追加済み（ローカル作業時の保護）
- 今後、新しい運用データディレクトリを追加する際は、必ず`.gitignore`にも追加する

---

### [KB-161] Dropbox basePathの分離対応（拠点別フォルダ分離）

**実装日**: 2026-01-14

**事象**: 
- トークプラザ工場への導入時に、Dropboxバックアップの保存先を拠点別に分離する必要があった
- 既存の第2工場とトークプラザ工場のバックアップが混在しないようにする必要があった

**要因**: 
- **basePathの未対応**: `StorageProviderFactory`で`basePath`が`DropboxStorageProvider`に渡されていなかった
- **環境変数の未実装**: Ansibleテンプレートに`DROPBOX_BASE_PATH`が含まれていなかった

**実装内容**:
1. **StorageProviderFactoryの修正**:
   - `createFromConfig`メソッドで`options.basePath`を`DropboxStorageProvider`に渡すように修正
   - 環境変数`DROPBOX_BASE_PATH`を優先的に使用（運用上の上書き手段）

2. **Ansibleテンプレートの更新**:
   - `infrastructure/ansible/templates/docker.env.j2`に`DROPBOX_BASE_PATH`変数を追加
   - トークプラザ工場では`DROPBOX_BASE_PATH=/backups/talkplaza`を設定

3. **DropboxStorageProviderの対応**:
   - `basePath`が指定されている場合、そのパスを使用
   - 環境変数`DROPBOX_BASE_PATH`が設定されている場合、それを優先

**学んだこと**:
- **拠点別フォルダ分離**: Dropboxの`basePath`を拠点ごとに設定することで、バックアップを分離できる
- **環境変数の優先順位**: 運用上の上書き手段として環境変数を優先することで、柔軟な運用が可能
- **マルチサイト対応**: 外部連携サービス（Dropbox）の設定も拠点ごとに分離する必要がある

**解決状況**: ✅ **実装完了**（2026-01-14）

**関連ファイル**:
- `apps/api/src/services/backup/storage-provider-factory.ts`（`basePath`の渡し方修正）
- `infrastructure/ansible/templates/docker.env.j2`（`DROPBOX_BASE_PATH`変数追加）
- `infrastructure/ansible/inventory-talkplaza.yml`（トークプラザ工場用設定）

**確認コマンド**:
```bash
# トークプラザ工場のDropbox basePath確認
grep DROPBOX_BASE_PATH /opt/RaspberryPiSystem_002/infrastructure/docker/.env
# → DROPBOX_BASE_PATH=/backups/talkplaza

# 第2工場のDropbox basePath確認（デフォルト）
grep DROPBOX_BASE_PATH /opt/RaspberryPiSystem_002/infrastructure/docker/.env
# → （未設定の場合はデフォルトパスを使用）
```

**再発防止策**:
- **basePathの分離**: 各拠点で`DROPBOX_BASE_PATH`を設定し、バックアップを分離
- **環境変数の優先**: 運用上の上書き手段として環境変数を優先

**注意事項**:
- `DROPBOX_BASE_PATH`が空文字の場合はデフォルトパスにフォールバックするため、設定漏れに注意
- 第1工場への導入時も同様に`DROPBOX_BASE_PATH=/backups/factory1`を設定する

---

### [KB-165] Dropboxからのbackup.json復元方法

**発生日**: 2026-01-15

**事象**: 
- KB-163により`backup.json`が削除され、Gmail設定とDropboxバックアップ対象リストが失われた
- Dropboxには過去のバックアップが保存されていたため、そこから復元する必要があった

**復元手順**:
1. **Dropbox APIを使用してバックアップファイルを検索**:
   - 管理コンソールのバックアップタブから、最新の`backup.json`バックアップを特定
   - または、Dropbox APIを使用してバックアップファイルを検索

2. **バックアップファイルをダウンロード**:
   - 管理コンソールのバックアップタブから手動でダウンロード
   - または、Dropbox APIを使用してバックアップファイルをダウンロード

3. **backup.jsonを復元**:
   ```bash
   # Pi5上でbackup.jsonを復元
   ssh denkon5sd02@raspberrypi.local
   sudo nano /opt/RaspberryPiSystem_002/config/backup.json
   # ダウンロードしたバックアップの内容を貼り付け
   ```

4. **APIを再起動**:
   ```bash
   # Dockerコンテナを再起動して設定を読み込み
   cd /opt/RaspberryPiSystem_002
   docker compose restart api
   ```

**学んだこと**:
- **Dropboxバックアップの重要性**: 定期的なバックアップが設定ファイルの復元に不可欠
- **バックアップファイルの命名規則**: タイムスタンプ付きのファイル名で、最新のバックアップを特定しやすい
- **復元の優先順位**: Gmail設定とDropbox設定は手動で再設定が必要な場合がある

**解決状況**: ✅ **復元完了**（2026-01-15）

**関連ファイル**:
- `apps/api/src/services/backup/storage-provider-factory.ts`（Dropbox API呼び出し）
- `/opt/RaspberryPiSystem_002/config/backup.json`（復元対象ファイル）

**関連ナレッジ**:
- KB-163: git cleanによるbackup.json削除問題（再発）
- KB-164: git clean設計の根本的改善（-fd → -fdX）

**再発防止策**:
- KB-164の設計改善により、`git clean`による削除を防止
- 定期的なDropboxバックアップを継続（スケジュール設定済み）

---

### [KB-166] Gmail OAuth設定の復元方法

**発生日**: 2026-01-15

**事象**: 
- KB-163により`backup.json`が削除され、Gmail設定（`clientId`, `clientSecret`, `redirectUri`）が失われた
- Dropboxバックアップから`backup.json`を復元したが、Gmail設定は含まれていなかった

**復元手順**:
1. **client_secret.jsonファイルを取得**:
   - Google Cloud ConsoleからGmail APIの認証情報をダウンロード
   - `client_secret.json`ファイルを取得

2. **backup.jsonにGmail設定を追加**:
   ```json
   {
     "storage": {
       "options": {
         "gmail": {
           "clientId": "993241073118-xxx.apps.googleusercontent.com",
           "clientSecret": "GOCSPX-xxx",
           "redirectUri": "https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback"
         }
       }
     }
   }
   ```

3. **APIを再起動**:
   ```bash
   docker compose restart api
   ```

4. **OAuth認証を実行**:
   - 管理コンソールの「バックアップ」タブ → 「Gmail設定」セクション
   - 「OAuth認証」ボタンをクリック
   - Googleアカウントでログインして認証を完了
   - 認証後、`accessToken`と`refreshToken`が`backup.json`に自動保存される

**学んだこと**:
- **OAuth認証フローの重要性**: `clientId`と`clientSecret`だけでは不十分で、OAuth認証フローを実行してトークンを取得する必要がある
- **設定の段階的復元**: `backup.json`の復元 → Gmail設定の追加 → OAuth認証の実行という段階的な手順が必要
- **トークンの自動保存**: OAuth認証完了後、APIが自動的に`accessToken`と`refreshToken`を`backup.json`に保存する

**解決状況**: ✅ **復元完了**（2026-01-15）

**関連ファイル**:
- `apps/api/src/routes/gmail/oauth.ts`（OAuth認証フロー）
- `apps/api/src/routes/gmail/config.ts`（Gmail設定管理）
- `/opt/RaspberryPiSystem_002/config/backup.json`（Gmail設定保存先）

**関連ナレッジ**:
- KB-163: git cleanによるbackup.json削除問題（再発）
- KB-165: Dropboxからのbackup.json復元方法

**再発防止策**:
- KB-164の設計改善により、`git clean`による削除を防止
- Gmail設定も`backup.json`に含まれるため、定期的なDropboxバックアップで保護される

---

### [KB-167] Gmail OAuthルートの新構造対応修正

**発生日**: 2026-01-15

**事象**: 
- KB-166でGmail設定を復元し、OAuth認証を実行しようとしたが、`400 Bad Request`エラーが発生
- APIログに「Gmail Client ID and Client Secret are required in config file」というエラーが記録された
- `backup.json`には`clientId`と`clientSecret`が存在していたが、APIが読み取れていなかった

**根本原因**:
- `apps/api/src/routes/gmail/oauth.ts`が旧構造（`config.storage.options.clientId`）を参照していた
- 新構造（`config.storage.options.gmail.clientId`）に対応していなかった

**修正内容**:
`apps/api/src/routes/gmail/oauth.ts`の以下の3つのエンドポイントを修正:

1. **`/gmail/oauth/authorize`**:
   ```typescript
   // 変更前
   const clientId = config.storage.options?.clientId as string | undefined;
   const clientSecret = config.storage.options?.clientSecret as string | undefined;
   const configuredRedirectUri = config.storage.options?.redirectUri as string | undefined;

   // 変更後（新構造を優先、旧構造にフォールバック）
   const clientId = config.storage.options?.gmail?.clientId || config.storage.options?.clientId;
   const clientSecret = config.storage.options?.gmail?.clientSecret || config.storage.options?.clientSecret;
   const configuredRedirectUri = config.storage.options?.gmail?.redirectUri || config.storage.options?.redirectUri;
   ```

2. **`/gmail/oauth/callback`**: 同様の修正を適用

3. **`/gmail/oauth/refresh`**: 同様の修正を適用

**学んだこと**:
- **後方互換性の重要性**: 旧構造へのフォールバックを実装することで、既存の設定でも動作する
- **設定構造の移行**: 新構造への移行は段階的に行い、旧構造との互換性を維持する必要がある
- **エラーメッセージの重要性**: 明確なエラーメッセージにより、問題の原因を特定しやすい

**解決状況**: ✅ **修正完了**（2026-01-15）

**関連ファイル**:
- `apps/api/src/routes/gmail/oauth.ts`（OAuth認証フロー修正）
- `/opt/RaspberryPiSystem_002/config/backup.json`（Gmail設定保存先）

**関連ナレッジ**:
- KB-166: Gmail OAuth設定の復元方法
- KB-148: backup.jsonの衝突・ドリフト検出の自動化（新構造の導入）

**再発防止策**:
- 新構造への移行を完了し、旧構造へのフォールバックを実装済み
- 今後は新構造（`options.gmail.*`）のみを使用する

---

### [KB-168] 旧キーと新構造の衝突問題と解決方法

**発生日**: 2026-01-15

**事象**: 
- Gmail OAuth認証完了後、管理コンソールのバックアップタブで黄色背景の警告が表示された
- 警告内容: 「設定ファイルに旧形式のキーが検出されました。新形式への移行を推奨します」

**根本原因**:
- `backup.json`の`storage.options`直下に旧キー（`accessToken`, `refreshToken`, `appKey`, `appSecret`）が残っていた
- 新構造（`options.dropbox.*`, `options.gmail.*`）と旧構造が混在していた
- KB-148のヘルスチェック機能が旧キーの存在を検出し、警告を表示していた

**解決方法**:
`backup.json`から旧キーを削除し、新構造のみに統一:

```json
{
  "storage": {
    "options": {
      // ❌ 削除: 旧キー（直下に配置）
      // "accessToken": "...",
      // "refreshToken": "...",
      // "appKey": "...",
      // "appSecret": "...",
      
      // ✅ 保持: 新構造（名前空間化）
      "dropbox": {
        "appKey": "...",
        "appSecret": "...",
        "accessToken": "...",
        "refreshToken": "..."
      },
      "gmail": {
        "clientId": "...",
        "clientSecret": "...",
        "redirectUri": "...",
        "accessToken": "...",
        "refreshToken": "..."
      }
    }
  }
}
```

**学んだこと**:
- **設定構造の統一**: 旧構造と新構造の混在は、設定の複雑さと混乱を招く
- **ヘルスチェック機能の重要性**: KB-148のヘルスチェック機能により、設定の問題を早期に検出できる
- **段階的な移行**: 新構造への移行は段階的に行い、旧構造を完全に削除する必要がある

**解決状況**: ✅ **解決完了**（2026-01-15）

**関連ファイル**:
- `/opt/RaspberryPiSystem_002/config/backup.json`（設定ファイル）
- `apps/api/src/routes/backup/health.ts`（ヘルスチェック機能）

**関連ナレッジ**:
- KB-148: backup.jsonの衝突・ドリフト検出の自動化（新構造の導入）
- KB-166: Gmail OAuth設定の復元方法
- KB-167: Gmail OAuthルートの新構造対応修正

**再発防止策**:
- 新構造への移行を完了し、旧構造のキーを削除済み
- 今後は新構造（`options.dropbox.*`, `options.gmail.*`）のみを使用する
- ヘルスチェック機能により、設定の問題を早期に検出できる

---

## KB-194: スケジュール自動実行時にバックアップ履歴が記録されない問題

**発生日**: 2026-01-23

**事象**: 
- 管理コンソールのバックアップタブの履歴ボタンから履歴を見ると、スケジュールの数と履歴の数が一致しない
- スケジュールに登録されている25個のターゲットのうち、過去7日間で8個のターゲットのみが実行されている
- 手動実行のバックアップは履歴に記録されるが、スケジュール自動実行のバックアップが履歴に記録されていない

**根本原因**:
- `BackupScheduler.executeBackup`メソッドに履歴作成・更新処理が実装されていなかった
- 手動実行（`/api/backup`エンドポイント）では`BackupHistoryService.createHistory()`、`completeHistory()`、`failHistory()`を呼び出していたが、スケジュール自動実行ではこれらの処理が呼ばれていなかった

**調査過程**:
1. **仮説1**: スケジュール実行が正常に動作していない → REJECTED（バックアップは実行されていた）
2. **仮説2**: 履歴作成処理が条件分岐でスキップされている → REJECTED（コード確認で処理自体が存在しないことを確認）
3. **仮説3**: 履歴作成処理がエラーで失敗している → REJECTED（ログにエラーが記録されていない）
4. **仮説4**: `BackupScheduler.executeBackup`に履歴作成処理がない → CONFIRMED（コード確認で確認）

**解決方法**:
`BackupScheduler.executeBackup`メソッドに履歴作成・更新処理を追加:

```typescript
// 各プロバイダーに順次バックアップを実行（多重バックアップ）
const historyService = new BackupHistoryService();
const results: Array<{ provider: 'local' | 'dropbox'; success: boolean; path?: string; sizeBytes?: number; error?: string }> = [];
for (const requestedProvider of providers) {
  let historyId: string | null = null;
  try {
    // ... ストレージプロバイダーの作成 ...
    
    // バックアップ履歴を作成（実際に使用されたプロバイダーを記録）
    historyId = await historyService.createHistory({
      operationType: BackupOperationType.BACKUP,
      targetKind: target.kind,
      targetSource: target.source,
      storageProvider: safeProvider
    });

    // バックアップを実行
    const result = await backupService.backup(backupTarget, {
      label: target.metadata?.label as string
    });

    if (!result.success) {
      results.push({ provider: safeProvider, success: false, error: result.error });
      // 履歴を失敗として更新
      if (historyId) {
        await historyService.failHistory(historyId, result.error || 'Unknown error');
      }
    } else {
      results.push({ provider: safeProvider, success: true, path: result.path, sizeBytes: result.sizeBytes });
      // 履歴を完了として更新
      if (historyId) {
        await historyService.completeHistory(historyId, {
          targetKind: target.kind,
          targetSource: target.source,
          sizeBytes: result.sizeBytes,
          path: result.path
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.push({ provider: requestedProvider, success: false, error: errorMessage });
    // 履歴を失敗として更新
    if (historyId) {
      await historyService.failHistory(historyId, errorMessage);
    }
  }
}
```

**修正内容**:
- `BackupHistoryService`のインスタンスを作成
- 各プロバイダーのバックアップ実行前に`createHistory()`を呼び出し
- 成功時に`completeHistory()`を呼び出し
- 失敗時に`failHistory()`を呼び出し
- 手動実行（`/api/backup`）と同じロジックを適用

**学んだこと**:
- **コードの重複**: 手動実行とスケジュール実行で同じロジックを実装する必要があるが、実装漏れが発生していた
- **テストの重要性**: スケジュール実行のテストが不足していたため、履歴記録の不備に気づけなかった
- **履歴の重要性**: バックアップ履歴は監査証跡として重要であり、すべての実行（手動・自動）を記録する必要がある
- **デバッグログの活用**: ログに「Starting scheduled backup」が記録されていないことから、手動実行である可能性を特定できた

**解決状況**: ✅ **解決完了**（2026-01-23）

**関連ファイル**:
- `apps/api/src/services/backup/backup-scheduler.ts`（`executeBackup`メソッドに履歴作成処理を追加）
- `apps/api/src/routes/backup.ts`（手動実行の履歴作成処理を参考）

**検証結果**:
- ✅ CIテスト成功（lint、ビルド、テストすべて通過）
- ✅ デプロイ完了（Pi5にデプロイ済み）
- ⏳ 次回のスケジュール実行（毎日4時、5時、6時、毎週日曜2時）で履歴が記録されることを確認予定

**関連ナレッジ**:
- KB-095: バックアップ履歴のストレージプロバイダー記録の不整合（実際に使用されたプロバイダーを記録する重要性）
- KB-096: Dropboxバックアップ履歴未記録問題（refreshTokenからaccessToken自動取得機能）

**再発防止策**:
- スケジュール実行のテストを追加して、履歴記録が正しく動作することを確認する
- 手動実行とスケジュール実行で同じロジックを使用することを明示的にドキュメント化する
- デプロイ後の検証チェックリストに「スケジュール実行の履歴記録確認」を追加する

---