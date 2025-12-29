---
title: トラブルシューティングナレッジベース - バックアップ・リストア関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - バックアップ・リストア関連

**カテゴリ**: インフラ関連 > バックアップ・リストア関連  
**件数**: 12件  
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

---
