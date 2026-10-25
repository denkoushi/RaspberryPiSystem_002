# 古いソフトのサポート期限対応(期限の近い順)


本書は `.agent/PLANS.md` に従う実行記録である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を作業に合わせて更新する。

## Purpose / Big Picture


2026-10-21 の「10年持つか」の構造点検で、業務システム(Pi5 サーバーと Raspberry Pi 群)が使うソフトのいくつかがサポート期限に近い、または既に過ぎていると分かった。サポートが切れたソフトには脆弱性の修正が出なくなり、10年使い続ける前提が崩れる。本書は対象ごとに、今の版、上げる先、サポート期限、影響範囲、危険度、戻し方を一覧にし、期限の近い順に1件ずつ更新するための計画である。1つの PR には1つのソフトの更新だけを入れる。

完了の姿は、一覧の各行が「更新済み(main の SHA と本番反映の run ID 付き)」か「次に着手する理由つきで保留」のどちらかになっている状態である。

この計画の範囲外は次のとおり。DGX の管理側(`denkoushi/DGXSparkControlPlane`)、個人用 Pi5(Hermes/Discord)、Raspberry Pi OS 自体の版上げ、外部提供の `nousresearch/hermes-agent` イメージの更新。

## 対象一覧


サポート期限は 2026-10-25 時点で各プロジェクトが公表している終了日である。「影響範囲」は版指定を書き換えるファイルと、動作が変わる機器を指す。危険度は、失敗したときに業務が止まる広さと、戻しの難しさで決めた。

    | # | 対象 | 今の版 | 上げる先 | サポート期限 | 影響範囲 | 危険度 | 戻し方 |
    |---|---|---|---|---|---|---|---|
    | 1 | Node.js(業務Hermesの中継部品 egress 2個) | node:20-alpine(digest固定) | node:24-alpine(digest固定、LTSは2028-04まで) | 2026-04-30 終了済み | infrastructure/docker/docker-compose.phase3.yml、infrastructure/ansible/inventory.yml、roles/release_pi5/defaults/main.yml、templates/docker.env.j2、テスト2本、runbook。Pi5 の business-hermes-egress と business-hermes-chat-egress だけ | 低〜中(Hermes の案内と相談が入れ替え中に数十秒止まる。API/Web と締付業務は止まらない) | digest を元に戻す commit を入れ、同じ入れ替え許可指定つきで標準反映 |
    | 2 | Prisma(DB接続ライブラリ) | 5.22.0 | 7.x(prisma@7 に固定。8 は GA 直後なので見送り) | 5 系は保守終了済み(6 系も 2026-11-19 で終了) | apps/api の全DBアクセス、prisma/schema.prisma、migrate 実行、API イメージ | 中〜高(7 は Rust エンジン廃止で接続設定と生成コードが変わる。全APIに影響) | lockfile と package.json を戻す commit で標準反映。DB スキーマは変えない方針で進め、migration を伴わせない |
    | 3 | Debian 12 bookworm(API・kiosk-sop の node:24-bookworm-slim の土台) | bookworm | trixie(Debian 13) | 通常保守は 2026-06-10 終了、LTS は 2028-06-30 まで | infrastructure/docker/Dockerfile.api、Dockerfile.kiosk-sop-generator | 中(ネイティブ依存のビルドが変わる) | digest を戻して標準反映 |
    | 4 | Python 3.11(NFC・バーコード・トルクの各 agent イメージ、hermes-answer-cache) | python:3.11-slim、pyproject は ^3.11 | python:3.13-slim(サポートは2029-10まで) | 2027-10 | infrastructure/docker/Dockerfile.nfc-agent、Dockerfile.barcode-agent、Dockerfile.torque-agent、services/hermes-answer-cache/Dockerfile、clients/*/pyproject.toml と lock。Pi4 群とキオスク端末 | 中(端末の読取りが止まると貸出・締付の現場作業に響く) | 前のイメージタグへ戻して Pi4 へ再反映 |
    | 5 | PostgreSQL 15(pgvector/pgvector:pg15) | 15 | 18(pgvector/pgvector:pg18、pgvector 0.8 系) | 2027-11-11 | infrastructure/docker/docker-compose.server.yml、docker-compose.mac-local.override.yml、.github/workflows/ci.yml と torque-release.yml、本番DBのデータ領域 | 高(本番データの移行を伴う) | 旧データ領域を消さずに残し、旧 pg15 コンテナへ切り戻す。移行前の pg_dump から復元も可能 |
    | 6 | React 18(apps/web) | 18.2 | 19 | 公式の終了日なし。新機能と修正は 19 系のみ | apps/web 全画面 | 中 | package.json と lockfile を戻す |

点検メモにあった ESLint 8 は、既に 9.39.5 へ更新済みのため対象から外す。TypeScript 5.4、Vite 6、Alpine 3.24、Go 1.27 は現時点で期限が近くないため一覧に入れない。

## 進める順番と理由


期限の近い順は 1(終了済み)、2(保守終了済み)、3(LTS 期間中)、4(2027-10)、5(2027-11)、6(期限なし)となる。PostgreSQL は期限が最後のほうでも準備に時間がかかるので、4 と並行して試し移行だけ早めに始める。

## 各項目の手順


### 1. Node.js 20 の中継部品(egress)

業務 Hermes は、外部への通信を中継部品(egress proxy、`infrastructure/docker/business-hermes-egress/proxy.mjs` を Node で動かすだけのコンテナ)経由でしか行えない作りになっている。組立ガイド用の `business-hermes-egress` と相談チャット用の `business-hermes-chat-egress` の2個があり、どちらも `node:20-alpine` を digest で固定している。proxy.mjs は `node:net` と `node:http` だけを使い、Node 24 で変わる機能に依存しない。

注意点として、標準反映(`infrastructure/ansible/roles/release_pi5/tasks/prepare.yml` の「Refuse to replace an independent business Hermes egress image during API/Web rollback window」と、`business-hermes-chat-prepare.yml` の「Preserve the fixed image boundary for existing consultation containers」)は、動いている中継部品のイメージが今回の指定と違うと、入れ替えを拒否して反映全体を失敗させる。これは API/Web を戻す途中で Hermes 側が勝手に変わらないようにする安全装置で、この digest は導入(#1350)以来一度も更新されていない。digest だけを差し替えると、以後の標準反映がすべてここで止まる。

そこで、入れ替えを明示的に許可する一回限りの指定を標準反映に追加する。既定は「許可しない」のままで、指定したときだけ上の2つの拒否を外し、新しいイメージで中継部品を作り直す。反映が途中で失敗した場合の戻しは既存の rollback(`rollback.yml` と `business-hermes-chat-rollback.yml`)が前のイメージで作り直すことを確認し、足りなければ追加する。

digest は記憶で書かず、公式の multi-arch index の digest と Pi5 向け arm64 manifest の digest をレジストリから取得して両方を runbook に記録する。

受け入れ条件は、関係テスト(`scripts/deploy/tests/` の該当テストと `test_ansible_standard_release.py`)が通り、既定では拒否が働き、許可指定のときだけ外れることがテストで確かめられ、CI が緑であること。本番反映は進行管理役の会話が、許可指定つきで1回だけ行う。

### 2. Prisma 5 → 7

別 PR で行う。prisma と @prisma/client を 7 系に固定し、7 で必要になる接続アダプタ(PostgreSQL 用ドライバアダプタ)と生成先の設定を加える。DB スキーマと migration は変えない。CI の API テスト一式と migration 検証が通ることを受け入れ条件とする。8 系の CLI は schema.prisma を読まないため、`npx prisma` で最新を引かないよう版を固定する。

### 3. Debian bookworm → trixie

別 PR で行う。node:24-trixie-slim の digest に差し替え、API イメージと kiosk-sop 生成イメージのビルド、API テスト、kiosk-sop の生成確認を通す。

### 4. Python 3.11 → 3.13

別 PR で行う。agent ごとの lock を 3.13 で作り直し、各 agent のテストを通す。Pi4 へ配るファイルは、main の最新がその変更の commit である間に全 Pi4 へ反映しないと届かないため、マージ後は他の PR をマージする前に Pi4 全台の反映を終える。端末ごとの文字コード(EUC-JP の端末がある)にも注意する。

### 5. PostgreSQL 15 → 18

本番データに触るため、本番で実行する前にユーザーの明示承認を得る。手順は次の順に進める。まず本番から `pg_dump` を取り、別の場所に保管して復元できることを確かめる。次に、そのダンプを使って手元または検証機で pg18 へ試し移行し、件数、拡張(pgvector)、API テストを確認して所要時間を測る。本番では業務の止まる時間帯を決め、旧データ領域を消さずに残したまま新しいデータ領域へ移す(`pg_upgrade` か、ダンプからの復元)。戻すときは旧 pg15 コンテナと旧データ領域へ切り替える。CI の Postgres も同じ版へそろえる。

### 6. React 18 → 19

別 PR で行う。期限がないため最後に回す。

## Progress


- [x] (2026-10-25) 点検会話の結果を読み、リポジトリの版指定を調べて一覧を作成。
- [x] (2026-10-25) ユーザーが1件目に Node 20 の中継部品を選んだ。
- [x] (2026-10-25) node:24-alpine(index sha256:06d7adf3…、arm64 manifest sha256:398bcf38…、Node v24.22.1)へ差し替え、旧 Node 20 の pin を `release_pi5_business_hermes_egress_replaceable_images` に登録。ガイド用は既存の作り直し経路、相談用は戻し時に旧イメージを指定するよう変更。proxy テスト 7/7、Docker 上の権限テスト成功、deploy テスト 151 件成功。
- [ ] 1件目の PR を作成し CI を通す。
- [ ] 進行管理役へ PR 番号と head SHA を渡す。

## Surprises & Discoveries


- Node 20 は 2026-04-30 でサポートが終わっており、点検時点で既に期限切れだった。
- 業務 Hermes の中継部品は、標準反映がイメージの入れ替えを拒否する作りで、更新の通り道がまだ無い。
- ESLint は既に 9 系へ更新済みだった。

## Decision Log


- 2026-10-25: 期限切れの Node 20 中継部品を1件目のおすすめにした。範囲が Pi5 の2コンテナに限られ、本番データにも Pi4 群にも触れないため。
- 2026-10-25: Prisma の上げる先は 7 系とした。8 系は GA 直後で、CLI が schema.prisma を読まない大きな変更を含むため。
- 2026-10-25: 中継部品の入れ替えは、新しい実行時指定を足さず、「入れ替えてよい旧イメージ」の一覧を role の既定値に置く方式にした。標準反映をそのまま使え、一覧にない違うイメージは従来どおり拒否されるため。戻すときは、その時点の現行 pin を一覧に足してから pin を戻す。
- 2026-10-25: 計画文書は1件目の PR に同梱する。文書は更新そのものではないため「1PR1ソフト」の決まりに反しない。

## Outcomes & Retrospective


未記入。各項目の完了時に、main の SHA、本番反映の run ID、戻しが必要だったかを書く。
