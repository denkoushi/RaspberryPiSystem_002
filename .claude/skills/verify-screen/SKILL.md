---
name: verify-screen
description: このリポジトリの画面(管理画面・キオスク)を変えたとき、コミット前に Mac のローカルで API・Web・DB を立ち上げて実際の画面を開いて確かめる手順。ユニットテストの合格だけで画面の変更を完了にしない。
---

# ローカルで画面を確かめる

ユニットテストが通っても画面が壊れていることがある。画面の見た目や操作を変えたら、コミット前にこの手順で実際の画面を開いて確かめる。

## してはいけないこと

- 稼働中のキオスク端末や本番の Pi5 で試さない。確かめるのは Mac のローカルだけ。
- 本番のデータ、`.env`、vault の値を使わない。ここで使うのは開発用のシードの値だけ。
- 全体の E2E を手元で流さない(CI に任せる)。画面確認は変えた画面に絞る。

## 起動(作業中の worktree の直下で)

1. 依存: `pnpm install --offline --frozen-lockfile` と `pnpm -r --filter './packages/*' build`
2. DB: `pnpm test:postgres:start`(コンテナ `postgres-test-local`、ポート 5432)
3. テーブルとシード(初回と、migration を変えたとき):
   ```bash
   cd apps/api
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return NODE_ENV=development
   pnpm exec prisma generate
   pnpm exec prisma migrate deploy
   pnpm exec prisma db seed
   ```
   `prisma generate` を飛ばすと、シードが「'@prisma/client' does not provide an export named 'PrismaClient'」で止まる。
4. API(バックグラウンドで。ポート 8080):
   ```bash
   mkdir -p /tmp/e2e-file-storage /tmp/e2e-backups
   env NODE_ENV=development DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return \
     JWT_ACCESS_SECRET=local-access-secret-1234567890 JWT_REFRESH_SECRET=local-refresh-secret-1234567890 \
     BACKUP_CONFIG_PATH=/tmp/e2e-backup.json BACKUP_STORAGE_DIR=/tmp/e2e-backups \
     FILE_STORAGE_ROOT=/tmp/e2e-file-storage PDF_STORAGE_DIR=/tmp/e2e-file-storage PHOTO_STORAGE_DIR=/tmp/e2e-file-storage \
     pnpm --filter @raspi-system/api dev
   ```
   `curl -s http://localhost:8080/api/system/health` で `"database":{"status":"ok"}` が出れば使える(メモリの警告で全体が `degraded` でも画面確認には差し支えない)。
5. Web(バックグラウンドで): `pnpm --filter @raspi-system/web dev`。開く先は `http://localhost:4173`(`/api` は 8080 へ中継される)。

## 画面を開く

- 管理画面: `http://localhost:4173/login` で、シードが作る開発用の管理者(`apps/api/src/config/seed-credentials.ts` の開発用の既定値)でログインする。
- キオスク: `http://localhost:4173/kiosk/...?clientKey=client-key-raspberrypi4-kiosk1` のように端末キーを URL に付けて開く。付けないと Mac 用の既定キーになり、シードに無いため API が 401 になって「読み込み中」のまま止まる。一度開けばキーはブラウザに残る。
- Claude の内蔵ブラウザなら `preview_start` に上の URL を渡す。中身は `get_page_text` や `read_page` で読み、通信は `read_network_requests` で 4xx/5xx が無いかを見る。ペインが隠れていると画面の大きさが 0 になるので、見た目を確かめるときはユーザーにペインを表示してもらう。

## 確かめること

1. 変えた画面を開き、変えた操作を実際に行う(押す、入力する、保存する、開き直す)。
2. 画面の表示が期待どおりか、通信に 4xx/5xx が無いか、コンソールにエラーが無いかを見る。
3. 結果を作業報告に1行で書く(どの URL で何をして何を見たか)。確かめられなかったときは、その理由を書く。
4. `ui-review` スキル(Mac の `~/.claude/skills/ui-review/`)が使えるときは、その範囲(画面幅、データ量、アクセシビリティなど)も見る。キオスクは、その端末の画面の実寸も加える。

## 後片付け

- API と Web のバックグラウンド処理を止める。
- `pnpm test:postgres:stop` で DB のコンテナを止める。
