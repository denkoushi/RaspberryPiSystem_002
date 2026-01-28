# 動的テスト実施メモ（ZAP/ポート検査/悪用シナリオ）

最終更新: 2026-01-28

本ファイルは、**検証環境で包括的に実施し、本番は縮小版を安全に実施**するための手順メモです。
本ワークスペースから実機へ直接実行できないため、実行結果は別途証跡として保存してください。

## 1. OWASP ZAP（検証環境）

### 事前準備
- 低レートで実施（認証10 req/min、全体120 req/minに収まる設定）
- 対象URLは必要最小限

### 非認証エンドポイント（例）
```bash
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://<staging-host>/api/system/health \
  -J -j -r zap-staging-health.html
```

### 認証済み管理画面（JWT付与）
```bash
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://<staging-host>/admin \
  -J -j -r zap-staging-admin.html \
  -I -a \
  -z "-config replacer.full_list(0).description=Authorization" \
  -z "-config replacer.full_list(0).enabled=true" \
  -z "-config replacer.full_list(0).matchtype=REQ_HEADER" \
  -z "-config replacer.full_list(0).matchstr=Authorization" \
  -z "-config replacer.full_list(0).regex=false" \
  -z "-config replacer.full_list(0).replacement=Bearer <access-token>"
```

## 2. ポート検査（検証/本番）

```bash
nmap -p 22,80,443,5900,5432,8080 <host>
```

期待値:
- 22/80/443/5900: 許可範囲のみ
- 5432/8080: 接続拒否（内部のみ）

## 3. 悪用シナリオ（検証環境で包括的に）

- 認証回避
- 権限昇格（RBACの穴）
- IDOR（他ユーザー/他リソース参照）
- 列挙（`x-client-key`系API）
- SSRF（外部URL入力）
- アップロード/パストラバーサル
- Webhook悪用/ログ注入

**保存先**: `docs/security/evidence/` に証跡を保存
```
YYYYMMDD-HHMM_staging_zap_*.html
YYYYMMDD-HHMM_staging_ports_nmap.txt
```
