# キオスク在庫の払い出しで使う加工機を選ぶ

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current. Follow `.agent/PLANS.md`.

## Purpose / Big Picture

キオスク「在庫」(`/kiosk/inventory`, `KioskItemInventoryPage`)で払い出すとき、個数を押す前に「どの加工機で使うか」を選ぶ。選ぶまで個数ボタン、「ほかの数」、数量タグは効かない。選び方は加工機に付けた NFC タグか、ボタン。ボタンは三島工場の加工機だけを出し、並び順は端末ごとに保存する。並び替えは在庫画面のピンボタンでオン/オフし、オンの間はドラッグで並べ替える(その間は加工機の選択と個数は効かない)。補充モードは変えない。

管理コンソールの加工機一覧(`MachinesPage`)には「工場」列(三島工場/仙台工場を資源CDから自動で表示)、「NFCタグ」列(1台に複数、チップの×で外す、＋で UID 入力か「NFCを読み取る」)を足す。

画面の形はユーザー承認済みのモック(Artifact `https://claude.ai/artifact/FKabUXv6Tvktu2rCyiBbdJ` Version 3)に合わせる。

## Decisions (2026-11-02)

- 三島工場の加工機が1台も無いときは加工機欄を出さず、今と同じ動き。端末フラグは使わない。(2026-11-02 修正。当初は端末の拠点で絞る案だった)
- 加工機の選択は払い出し1回ごとに外れる。ボタンは略称(無ければ名称)を `normalizeMachineName` で半角にして出す。並び替えはだれでもできる。
- API の `machineId` は任意。必須にするのはキオスク画面だけ(古い画面、補充、他拠点を壊さない)。
- NFC の UID は全種類で重複させない。加工機タグも `tag-desk.service.ts` の使用先確認と `assertNfcUidAvailable` の両方に入れる。
- 他拠点の加工機タグは在庫画面で受け付けない。

## Plan of Work

1. DB と API(Codex 1回目): `Machine.siteKey`、`MachineNfcTag`、端末ごとの並び順、`InventoryTransaction.machineId`、管理用とキオスク用の API、タグ解決に加工機を追加、テスト。
2. Web(Codex 2回目): キオスク在庫の加工機欄と並び替え、加工機一覧の工場列と NFC タグ列。
3. 確認、PR、反映、三島の加工機に工場を設定して試験端末で確かめる。

## Progress

- [x] (2026-11-02) モック承認、計画作成。
- [x] (2026-11-02) DB と API(migration `20261102090000_add_machine_site_and_nfc_tags`)。
- [x] (2026-11-02) Web。第三者レビューの指摘(タグ受付画面の加工機タグ、加工機一覧の取得失敗、NFC キューの判定、並べ替え後の更新)を修正。
- [x] (2026-11-02) #2483 を本番反映(merge b4d2678c、run 20261102-051357-cb259a)。
- [x] (2026-11-02) 工場の扱いを修正: 加工機の工場は資源マスタのグループCDから三島/仙台を判定し、`Machine.siteKey` を削除。
- [ ] 修正の反映と試験端末での確認。

## Surprises & Discoveries

- タグ受付画面は使用先の種類ごとに表示を持つため、加工機タグを足すと画面が落ちた。表示と「外す」の口に加工機を追加した。

## Decision Log

- (2026-11-02) 「工場」は三島工場/仙台工場の区別で、端末の拠点(`Site`: 第1工場/第2工場/トークプラザ)とは別物だった。#2483 では拠点で絞っていたため誤り。既存の規則(資源マスタのグループCDが `S-` で始まる資源は仙台、`getSendaiResourceCds`)で `Machine.resourceCd` から判定し、それ以外(資源CDが空を含む)は三島とする。キオスクは端末の拠点に関係なく三島の加工機を出す。手で選ぶ `Machine.siteKey` は値が入る前に削除した。

- 加工機一覧を一度も取れないまま失敗したときは「加工機が無い」と同じ扱いにし、払い出しを止めない(ローリング更新中の古い API を考慮)。
- 今回は直さない小さな点: 加工機を初めて登録した直後の再取得までの数件は加工機なしで記録されうる。在庫以外の画面で加工機タグを読むと在庫画面へ移る。ピンをオンのまま放置すると自動リセットが止まる。

## Outcomes & Retrospective
