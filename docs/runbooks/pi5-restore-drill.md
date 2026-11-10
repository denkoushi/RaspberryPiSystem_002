---
title: Pi5 復旧訓練 Runbook
tags: [operations, backup, restore, drill, Google Drive, restic, Raspberry Pi 5]
audience: [operators, recovery operators]
last-verified: 2026-11-02
related: [./google-drive-disaster-recovery.md, ../plans/fleet-100-scale-gap-execplan.md]
category: runbooks
update-frequency: medium
---

# Pi5 復旧訓練 Runbook

## 目的

「Pi5 が死んだ」と宣言してから、代替機の API health が応答し、代表的な業務画面が表示されるまでを測る。
予備の Pi5 または予備 SSD を付けた別の Pi5 で、本番のスナップショットから作り直す。
本番 Pi5 は稼働させたまま触らない。本番への切り替えはしない。
これは [M1 の訓練](../plans/fleet-100-scale-gap-execplan.md#progress)用の記録表である。実行手順の正本は以下のリンク先とする。

## 安全ルール

- 訓練機は本番の名前・識別情報を引き継がない。古い `.ssh` や Tailscale の状態をコピーしない。
- 本番名で tailnet に参加しない。キオスクの接続先、Caddy、サーバー名を切り替えない。
- [全損復旧 step 6](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)は実施しない。
- 本番の DB・コンテナ・ボリューム・ネットワークを訓練対象にしない。本番 SSD を抜き差ししない。
- [新規 Pi5 の規則](./google-drive-disaster-recovery.md#preconditions-and-safety-boundaries)どおり、毎回 `-e google_drive_dr_timer_enabled=false` を付ける。訓練中も終了時も DR タイマーは無効のままにする。
- [別承認の境界](./google-drive-disaster-recovery.md#initial-provisioning-separate-approval)をまとめない。初回導入、資格情報配置、初回手動バックアップ、タイマー初回有効化、本番変更の承認はそれぞれ別とする。
- この文書は承認を代行しない。訓練で本番変更・切り替え・タイマー有効化は行わない。
- パスワード、OAuth トークン、秘密設定、業務データの内容を記録・ログに残さない。

## 先に用意するもの

- 予備 Pi5／予備 SSD と接続する別の Pi5、電源、空き容量：＿＿＿＿
- 承認済みの OS と、使用するマージ済み不変 SHA・CI 成功の証拠：＿＿＿＿
- 承認済みパスワードマネージャーから restic パスワードと OAuth を使える担当者：＿＿＿＿
- 訓練機だけを選ぶ Ansible 対象と、隔離した DB・アプリ・閲覧経路：＿＿＿＿
- 作業担当（OS／Ansible／資格情報／DB・アプリ）：＿＿＿＿
- 計時・記録担当／結果確認者／必要な別承認の状況：＿＿＿＿
- 代表画面・行数・クエリ・一次ファイルの比較対象と、秘密を含まない比較証拠：＿＿＿＿

空欄と末尾の「足りないもの」を解決してから開始する。値や保管場所は推測しない。
既に準備済みの作業と所要時間も記す。準備済み部分を復旧できた実績と混同しない。

## 訓練と区間計時

時刻には日付とタイムゾーンを付ける。待ち時間も止めずに測り、理由を残す。

### 1. 障害を宣言する（既存 step 1）

[全損復旧 step 1](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)に沿って、障害を仮定し、最後の成功スナップショットと SHA を記録する。
開始時刻を「Pi5 が死んだ」時刻とする。本番の故障を実際に起こさない。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（宣言・対象確認）

### 2. OS と Ansible 前提を用意する（既存 step 2）

[全損復旧 step 2](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)を、訓練機にだけ適用する。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（OS・Docker・ストレージ・新しい識別情報）
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（Ansible 前提・訓練機だけが対象である確認）

### 3. DR runner を入れる（既存 step 3）

[全損復旧 step 3](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)と[初回導入](./google-drive-disaster-recovery.md#initial-provisioning-separate-approval)を参照する。
承認済み SHA と資格情報を使う。本番を選ばないこととタイマー無効を確認する。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（DR runner 導入・資格情報配置・確認）

### 4. 容量と隔離復元を確かめる（既存 step 4）

[全損復旧 step 4](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)の[容量確認](./google-drive-disaster-recovery.md#capacity-check)を行う。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（容量確認）
[隔離復元確認](./google-drive-disaster-recovery.md#isolated-restore-check)に従い、新しい未使用ディレクトリへダウンロードして検証する。
実際に選ばれたスナップショット ID・日時を記す。manifest・Git bundle・dump 形式・一次ファイルのハッシュを確認する。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（restore-check のダウンロード＋検証）

### 5. DB とアプリを戻す（既存 step 5、step 4 の DB 検証も含む）

[全損復旧 step 5](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)と[隔離 DB の検証条件](./google-drive-disaster-recovery.md#isolated-restore-check)に従う。
隔離証拠の確認後、レビュー済みの明示操作で訓練機へファイルを戻す。同じ SHA・リリース設定を使う。
訓練 DB へロードし、承認済み migration、スキーマ・migration 台帳・代表行数・クエリを確認する。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（ファイル配置・DB ロード＋migration・比較）
訓練アプリを起動する。訓練用の閲覧経路で API health と合意した代表業務画面を確認する。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（アプリ起動＋health＋画面確認）
この終了時刻で総時間を確定する。既存 step 6 は飛ばす。

### 6. 結果を残す（既存 step 7）

[全損復旧 step 7](./google-drive-disaster-recovery.md#total-loss-recovery-procedure)の証拠を、下の記録表へ残す。
切り替え承認欄に相当する記録は「訓練のため切り替えなし」とする。失敗時は成功扱いにしない。
開始時刻：＿＿＿＿ ／ 終了時刻：＿＿＿＿（結果整理。復旧総時間には含めない）

## 記録表

```text
実施日・タイムゾーン：
作業者／計時担当／確認者：
使用機材（Pi5・SD/SSD）／準備済みの範囲と所要時間：
スナップショット ID／日時：
使用 SHA／承認・CI 成功の証拠：
障害宣言・対象確認 開始／終了／所要：
OS 準備 開始／終了／所要：
Ansible 前提 開始／終了／所要：
DR runner 導入 開始／終了／所要：
容量確認 開始／終了／所要：
restore-check ダウンロード＋検証 開始／終了／所要：
ファイル配置・DB ロード＋migration・比較 開始／終了／所要：
アプリ起動＋health＋代表画面 開始／終了／所要：
総時間（障害宣言から health・画面確認まで。待ちも含む）：
想定障害日時／スナップショット時点からのデータの古さ：
dump・migration・行数・クエリ・ハッシュの確認結果：
health・代表画面の確認結果（データ内容は転記しない）：
問題・待ち時間と理由／未完了部分：
結果整理 開始／終了：
後片付け結果（隔離先の正確なパス・所有者確認／削除／停止・消去）：
切り替え：訓練のため実施なし
```

データの古さは想定障害日時からスナップショット日時を引いて読む。
毎日23:00の次回実行直前に壊れた想定では、失う可能性のある記録は最大で約24時間分となる。欠測・失敗があればさらに古くなる。
夜間コピーは約3.5 GB・約6分という実測前提だが、6分は復旧時間ではない。

## 決めてもらうこと

訓練後に、許容停止時間（RTO）と許容損失（RPO）をユーザーが決める。ここでは数値を決めない。
測った総時間を許容停止時間と比べる。準備済みの範囲や未測定部分も併記する。
データの古さを許容損失と比べる。復旧が速くても、戻せる記録はスナップショット時点までである。
総時間が長すぎる場合の計画上の対応は [M2：予備 Pi5 とストリーミング複製](../plans/fleet-100-scale-gap-execplan.md#progress)である。

## 後片付け

証拠を確認後、[隔離復元確認の削除条件](./google-drive-disaster-recovery.md#isolated-restore-check)どおり、正確なパスと所有者を確認してから隔離復元先だけを削除する。
訓練機のデータを消去するか、停止して管理下に置く。未検証の消去コマンドは使わない。
失敗調査で隔離先を残す場合も停止・保管責任者を記す。本番データ入りの2台目を無人で通電したままにしない。

## 足りないもの

- 既存 DR 文書には、本番名を使わず訓練機だけを選ぶ Ansible 対象・接続設定の具体手順がない。
- 隔離 DB の検証条件はあるが、実データを使う訓練機の DB・アプリ構築、health の接続先、画面の閲覧・認証・外部連携の隔離手順は具体化されていない。
- 代表画面・比較対象と、訓練機の媒体消去・安全な保管の具体手順は、開始前に担当者が確定する必要がある。
- [ローカル Docker 復元テスト](../../scripts/deploy/tests/test-google-drive-dr-postgres-restic-integration.sh)は任意の結合テストであり、実機の OS 準備や業務画面までの復旧時間の測定を代替しない。
