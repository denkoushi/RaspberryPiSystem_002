---
title: キオスクお問い合わせ受信箱 Runbook
tags: [kiosk, support, inquiry, nfc, admin, slack]
audience: [operators, developers, ai-agent]
last-verified: 2026-10-09
related: [../guides/slack-webhook-setup.md, ./kiosk-device-initial-route.md]
category: runbooks
update-frequency: medium
---

# キオスクお問い合わせ受信箱 Runbook

キオスクの「お問い合わせ」は Slack に通知されるが、着信を見落としやすい。そこで、指定した端末のフローティングChat(画面右下の丸ボタン)で着信を受け、その場で読んで返信できるようにした。Slack 通知と `ClientLog` への保存は今までどおり残る。

## 動き

| 端末 | 丸ボタン | 開き方 |
| --- | --- | --- |
| 受信端末(管理コンソールで指定) | 未読のお問い合わせがあるとオレンジ＋件数 | 押して社員証をタッチ。登録済みの社員番号だけ開ける |
| 送った端末 | 返信が届くとオレンジ＋件数 | 押すだけ。その端末から送った分だけ読める |

- 未読があるときに丸ボタンを押すと「お問い合わせ」表示で開く。未読が無いときは今までどおり開き、「お問い合わせ」はタブから選ぶ。
- 受信端末は、パネルを閉じるか別のタブへ移ると鍵がかかった状態へ戻る。社員証の UID は画面を開いている間だけメモリに持ち、保存しない。
- 登録されていない社員証、未登録のタグ、在籍していない社員は、区別せず「この社員証では開けません」になる。
- 返信すると相手側が未読になる。送った端末からの追記は Slack にも届く。受信端末からの返信は Slack に送らない。
- 件数は 30 秒ごとに更新する。問い合わせるのは `/kiosk` 配下の画面だけで、管理画面やサイネージでは丸ボタンは今までどおり。
- 一覧は受信端末で新しい順に 50 件、送った端末で 20 件まで。それより古い分は画面に出ない(DB には残る)。
- この機能を入れる前のお問い合わせ(`ClientLog` だけの行)は受信箱に出ない。
- 送信フォームの送信者は、先に部署を選んで絞る。開いたときは名前に「機械課」を含む部署が選ばれている(無ければ先頭の部署)。部署が空の社員は「部署なし」にまとまる。

## 設定(管理コンソール)

`/admin/kiosk-settings` の「お問い合わせの受信」で設定する。権限は ADMIN または MANAGER。

1. 「受け取る端末」で受信端末にチェックを入れる。
2. 「開ける人(社員番号)」に社員番号を入れて「追加」。社員マスタにある番号だけ追加でき、氏名が横に出る。
3. 「保存」を押す。保存は全置換で、端末は次の件数更新(30 秒以内)から切り替わる。

受信端末を 1 台も指定しないと、どの端末もオレンジにならない(送った端末への返信も発生しない)。社員番号を 1 つも登録しないと、受信端末でも誰も開けない。

## 確認手順(実機)

1. 現場のキオスクから「お問い合わせ」を送る。
2. 受信端末の丸ボタンが 30 秒以内にオレンジになり、件数が出る。
3. 押して、登録した社員の社員証をタッチすると一覧が出る。登録していない社員証では開けない。
4. スレッドを開いて「行きます」などを送ると、受信端末の件数が減り、送った端末が 30 秒以内にオレンジになる。
5. 送った端末で押すと、社員証なしで返信が読め、追記できる。

## 実装の場所

- DB: `ClientDevice.inquiryReceiverEnabled`、`KioskInquiryReceiverEmployee`、`KioskInquiryThread`、`KioskInquiryMessage`(migration `20261009090100_add_kiosk_inquiry_inbox`。追加だけで既存の列と行は変えない)
- API: `apps/api/src/routes/kiosk/inquiries.ts`、`apps/api/src/routes/kiosk-settings.ts`、`apps/api/src/services/kiosk-inquiry/`。スレッドは `POST /kiosk/support` の `ClientLog` 保存と同じトランザクションで作る
- Web: `apps/web/src/features/kiosk/inquiry/`、入口は `apps/web/src/components/hermes/HermesFloatingChat.tsx`。送信フォームは `apps/web/src/components/kiosk/KioskSupportModal.tsx`

## うまくいかないとき

- オレンジにならない: その端末が「受け取る端末」に入っているか、画面が `/kiosk` 配下かを確認する。API は `GET /api/kiosk/inquiries/summary`(`x-client-key` 付き)で `isReceiver` と `unreadCount` を返す。
- 社員証で開けない: 社員番号が「開ける人」にあるか、その社員が在籍(ACTIVE)か、社員証のタグがその社員に登録されているかを確認する。
- 元へ戻す: Web と API を前の版へ戻せば受信箱は消える。追加したテーブルと列は残しても既存の動作に影響しない。
