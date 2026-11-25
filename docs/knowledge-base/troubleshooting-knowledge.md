# トラブルシューティングナレッジベース（移動済み）

このファイルは 2025-11-27 にカテゴリ別ファイルへ分割済みです。課題の検索は [ナレッジベース索引](./index.md) を使ってください。

## 開発・ビルド時の個別エラー（README から移設）

### Prisma が `libssl.so.1.1` を要求して落ちる

- 症状: `PrismaClientInitializationError: libssl.so.1.1: cannot open shared object file`
- 原因: Alpine ベースの Node.js イメージでビルドしたため、OpenSSL 1.1 が存在しない。
- 対処: `infrastructure/docker/Dockerfile.api` のベースを `node:24-bookworm-slim` に固定し、build と runtime の両ステージで `openssl` を入れる。Prisma の `binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]` を維持して `pnpm prisma generate` を実行し、`build --no-cache api` で作り直す。サーバー用 Dockerfile では Alpine を使わない。

### Docker ビルドキャッシュ破損

- 症状: `parent snapshot ... does not exist` など export 段階で失敗する。
- 対処: `docker builder prune --all --force` の後、`docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api` を実行する。容量逼迫時の運用は [miscellaneous.md](./infrastructure/miscellaneous.md) を参照。

### Web UI の直接 URL アクセスで 404

- 症状: `/admin/employees` などへ直接アクセスすると HTTP 404 になる。
- 原因: SPA のクライアントサイドルーティングに対するフォールバックが Caddy 側にない。
- 対処: `infrastructure/docker/Caddyfile` に `@spa { not file }` と `rewrite @spa /index.html` を設定し、Web イメージを再ビルドして `up -d --build web` で反映する。

### XState の `assign` による TypeScript エラー

[frontend.md](./frontend.md) に記録済みです（`assign(({ event }) => ...)` 形式で書く）。
