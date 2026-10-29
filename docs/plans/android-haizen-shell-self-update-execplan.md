# 配膳アプリが業務用 Pi5 から自分で新しい版を取り込む

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

配膳の Android アプリ(`apps/android-haizen-shell`、パッケージ `jp.raspisystem.haizen.shell`)は、今は Mac から adb で入れ直さないと更新できない。この変更の後は、Mac で新しい版を作って業務用 Pi5 に置くだけで、スマホのアプリが起動時にそれを見つけ、画面の上に「新しい版があります」と出す。押すと Pi5 から APK を取り込み、Android の「インストール」を押せば上書きで更新される。外部サービスは使わない。取り込み元は業務用 Pi5 の API だけ。

確かめ方: 版 0.3 を adb で入れた後、版 0.4 を作って Pi5 に置き、アプリを開くと「新しい版があります」が出る。押して「インストール」を押すと、設定 → アプリ → 配膳 で版が 0.4 になる。

## Progress

- [x] (2026-10-29) 現状を調べ、設計を決めた(下の Decision Log)。
- [x] (2026-10-29) API: 版情報と APK を返す2つの経路と、そのテスト。
- [x] (2026-10-29) Compose と Ansible: Pi5 の置き場をつくり、API に読み取り専用でつなぐ。
- [x] (2026-10-29) Android: 起動時の確認、「新しい版があります」、取り込み、インストーラへの受け渡し。versionCode 3 / 0.3。
- [x] (2026-10-29) 置き場へ載せる Mac 用スクリプトと手順書。
- [x] (2026-10-29) API の対象12テストと変更ファイルの ESLint、シェル構文検査、Pi5 runtime boundary の11テスト。
- [x] (2026-10-29) Mac で Gradle の単体テスト・ビルド・lint（ユーザー実施）。API の型検査は既存 tsconfig の TS6059 で未完了。
- [ ] PR、マージ、反映(進捗追跡の会話が担当)。
- [ ] 0.3 を adb で入れ、Pi5 に置き、次の版(0.4)で端末確認。

## Surprises & Discoveries

- Observation: API コンテナは読み取り専用のルートファイルシステムで、書ける場所は Compose のマウントだけ。
  Evidence: `infrastructure/docker/docker-compose.server.yml` の derivatives 用マウントのコメント。
- Observation: Pi5 のホスト側ディレクトリは `roles/server/tasks/main.yml` が運用ユーザー所有で作る。無いままバインドすると Docker が root 所有で作ってしまう。

- Observation: CI の container-runtime-rehearsal は API の `/app/storage/` 配下のマウント先を決まった一覧と照らす。`/app/storage/haizen-app` を足すと「production storage targets differ」で落ちた。
  Evidence: `scripts/ci/rehearse-release-runtime.sh` の required 一覧。対処としてコンテナ側のマウント先を `/app/haizen-app` に移した(ホスト側は `storage/haizen-app` のまま)。

## Decision Log

- Decision: 署名は今と同じ Mac の `~/.android/debug.keystore`(debug ビルド)のまま。CI では作らない。
  Rationale: ユーザーの指示「署名は今の APK と同じ鍵を使い、上書きで入るように」。鍵を変えると上書きできない。鍵をリポジトリや GitHub に置かない。
  Date/Author: 2026-10-29 / Claude
- Decision: この鍵は今後の更新に欠かせない。失うと上書き更新ができなくなるので、手順書に「鍵をバックアップしておく」と書く。この PR では鍵を変えない。
  Date/Author: 2026-10-29 / Claude
- Decision: Pi5 の置き場はホストの `${PI5_PROJECT_DIR}/storage/haizen-app`。API には `/app/haizen-app` に `:ro` でつなぐ。ディレクトリは `roles/server/tasks/main.yml` の既存の一覧に足して運用ユーザー所有で作る。
  Rationale: 既存の `storage/` 配下と同じ扱いで、Blue/Green のどちらの API からも同じファイルが見える。API は読むだけ。
  Date/Author: 2026-10-29 / Claude
- Decision: 版情報は APK の横の `version.json` (`{versionCode, versionName, fileName, sha256, size}`)。Node で APK を解析しない。`version.json` は手で書かず、Mac のスクリプトが `aapt2 dump badging` から作る。スクリプトは APK を先に、`version.json` を後に置く(途中で API が無いファイルを案内しないように)。どちらも一時名で送ってから mv で置き換える。
  Date/Author: 2026-10-29 / Claude
- Decision: API は `GET /api/kiosk/mobile-app/version` と `GET /api/kiosk/mobile-app/apk`。どちらも `x-client-key` で端末を確かめる(`requireClientDevice`)。返す APK は `version.json` の `fileName` だけで、名前は `^[A-Za-z0-9._-]+\.apk$` に合うものに限る。置き場や `version.json` が無いときは 404。
  Date/Author: 2026-10-29 / Claude
- Decision: 知らせは Android の通知ではなく、アプリ画面の上に出す1行の帯。文言は「新しい版があります」だけで、説明は足さない。
  Rationale: ユーザーの指示「画面に説明の文章は足さないでください」。通知にすると targetSdk 34 で通知の許可がもう1つ増える。
  Date/Author: 2026-10-29 / Claude
- Decision: 確認はアプリ起動時(と前面に戻ったとき)だけ。裏の定期ダウンロードでは APK を取りに行かない。
  Date/Author: 2026-10-29 / Claude
- Decision: インストールは `FileProvider` + `ACTION_VIEW`(`application/vnd.android.package-archive`)。その前に `canRequestPackageInstalls()` が false なら `ACTION_MANAGE_UNKNOWN_APP_SOURCES` を開く(初回だけ「この提供元のアプリを許可」)。取り込んだ APK は sha256 を `version.json` と照らし、違えば捨てる。
  Date/Author: 2026-10-29 / Claude
- Decision: 更新の仕組みは、それを含む版(0.3)から先でしか動かない。0.3 は adb(ワイヤレス デバッグ)で1回だけ入れる。
  Date/Author: 2026-10-29 / Claude

- Decision: 配る APK は今と同じ debug ビルドのまま(第三者レビューで「debuggable なので adb で端末の鍵を読める」と指摘)。release ビルドを同じ鍵で署名する案は別の作業にする。
  Rationale: この PR は今の配り方を自動にするだけで、debug ビルドであることは以前から同じ。
  Date/Author: 2026-10-29 / Claude

## Outcomes & Retrospective

2026-10-29: ローカル実装を完了。API は端末認証後に版情報を検証し、APK を読み取り専用の置き場からストリームで返す。Android は保存済みの端末キーで起動・復帰時に確認し、取得した APK のサイズと SHA-256 が一致したときだけインストーラへ渡す。JSON の抽出は Android 側、フィールド検証・版比較・ハッシュ照合は Android/JSON に依存しない関数として JUnit テストを追加した。

実行結果: `pnpm install --offline --frozen-lockfile --ignore-scripts` 成功後、`pnpm --filter @raspi-system/api exec vitest run src/routes/kiosk/__tests__/mobile-app.test.ts` は12テスト成功。変更した API 3ファイルへの ESLint は成功。`python3 -m unittest scripts.ci.tests.test_pi5_container_runtime_boundaries` は11テスト成功。`bash -n apps/android-haizen-shell/scripts/publish-to-pi5.sh` は成功。shellcheck は未導入。公開スクリプトは一時ディレクトリの模擬 Gradle/SDK/SSH/SCP で、証明書未登録・不一致、同じ版の拒否、APK → JSON の配置順を確認した（実ビルド・通信なし）。

`pnpm --filter @raspi-system/api exec tsc --noEmit` は TS6059: `rootDir: src` の外にある `prisma/seed.ts`、`scripts/*.ts`、`vitest.config.ts` が既存の include に含まれるため失敗。設定は今回変更していない。Gradle、実機確認、公開、commit/push/PR/merge/deploy は未実施。`signing-cert.sha256` はユーザーが既存署名を確認して作成する。

## Context and Orientation

- Android アプリ: `apps/android-haizen-shell/app/src/main/java/jp/raspisystem/haizen/shell/`。`MainActivity.kt` が WebView で `https://raspberrypi.tail7312a3.ts.net:8443/kiosk/mobile-placement` を開く。`LocalDataPrefetchWorker.kt` の `setClientKey` が端末の鍵を SharedPreferences `local-data` に保存しており、更新の確認もこれを使う。鍵が無い間(ページが一度も鍵を渡していない間)は確認しない。
- Pi5 の API: `apps/api/src/routes/kiosk/mobile-local-data.ts` が同じ `x-client-key` 方式の経路の見本。登録は `apps/api/src/routes/kiosk.ts`。
- Compose: `infrastructure/docker/docker-compose.server.yml` の api の `volumes:`。
- Ansible: `infrastructure/ansible/roles/server/tasks/main.yml` の運用ユーザー所有ディレクトリ一覧。
- 関連計画: `docs/plans/mobile-local-first-sync-execplan.md`(Milestone 7 でこのアプリに裏ダウンロードを入れた)。

## Plan of Work

1. API に `apps/api/src/routes/kiosk/mobile-app.ts` を足し、`apps/api/src/routes/kiosk.ts` で登録する。置き場のパスは環境変数 `HAIZEN_APP_DIR`(既定 `/app/haizen-app`)。`version` は JSON をそのまま検証して返し、`apk` はファイルをストリームで返す(`compress: false`、`Content-Type: application/vnd.android.package-archive`、`Content-Length`)。どちらも `Cache-Control: private, no-store`、件数制限は version 60/分、apk 5/分。
2. Compose に `${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/storage/haizen-app:/app/haizen-app:ro` を足し、Ansible の一覧に `{{ repo_path }}/storage/haizen-app` を足す。
3. Android に更新の部品を足す(版情報の解析と比較は Android に依存しない小さな関数にして JUnit で試す)。`MainActivity` に帯を重ね、押したら取り込み→sha256 照合→インストーラ。マニフェストに `REQUEST_INSTALL_PACKAGES` と `FileProvider`。versionCode 3 / versionName "0.3"。
4. `apps/android-haizen-shell/scripts/publish-to-pi5.sh`: `./gradlew assembleDebug` → `aapt2 dump badging` で版を読む → 署名証明書が今の鍵と同じかを `apksigner verify --print-certs` で確かめる → sha256 → `raspi5-tailscale`(既定、引数で変えられる)へ APK、次に `version.json` を送る。
5. 手順書: `apps/android-haizen-shell/README.md` に「新しい版を出す」と「鍵のバックアップ」を書く。

## Concrete Steps

作業ディレクトリは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--haizen-app-self-update`。

    cd apps/android-haizen-shell && ./gradlew testDebugUnitTest assembleDebug lintDebug
    pnpm --filter @raspi-system/api exec vitest run src/routes/kiosk/__tests__/mobile-app.test.ts
    pnpm --filter @raspi-system/api exec tsc --noEmit

## Validation and Acceptance

- API のテスト: 鍵なしは拒否、置き場が無いと 404、`version.json` の内容を返す、`fileName` が規則に合わないと 404、APK を返す。
- Android の JUnit: 版情報の解析、新しいときだけ知らせる、sha256 の一致。
- 端末: 0.3 を adb で入れ、0.4 を Pi5 に置くと「新しい版があります」が出て、押して「インストール」で 0.4 になる。0.4 を開き直すと帯は出ない。

## Idempotence and Recovery

- 置き場のスクリプトは何度実行してもよい。途中で切れても `version.json` は前のままなので、アプリは古い案内のまま。
- 案内を止めたいときは Pi5 の `storage/haizen-app/version.json` を消す(アプリは 404 を「更新なし」として扱う)。
- 新しい版に問題があれば、versionCode を上げた直した版を置く(Android は下げる上書きを受けない)。

## Artifacts and Notes

(端末確認の結果をここに書く)

## Interfaces and Dependencies

- `GET /api/kiosk/mobile-app/version` → `200 {versionCode:number, versionName:string, sha256:string, size:number}` / `404`。
- `GET /api/kiosk/mobile-app/apk` → `200` APK 本体 / `404`。
- Android: `REQUEST_INSTALL_PACKAGES`、`androidx.core.content.FileProvider`。

2026-10-29 implementation note: 実装と実行済み検証を Progress / Outcomes に反映。Decision Log と Plan of Work の設計は変更していない。
