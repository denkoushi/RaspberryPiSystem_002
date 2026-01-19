# ログの機密情報保護実装レポート

最終更新: 2026-01-18

## 概要

本レポートは、ログの機密情報保護機能の実装内容をまとめたものです。`x-client-key`がログに平文で出力されていた問題を修正し、`[REDACTED]`に置換するように実装しました。

**実装日**: 2026-01-18  
**実装者**: AI Assistant

## 実装内容

### 修正したファイル

1. **`apps/api/src/plugins/request-logger.ts`**
   - 17行目: `x-client-key`を`[REDACTED]`に置換
   - 40行目: `x-client-key`を`[REDACTED]`に置換

2. **`apps/api/src/routes/kiosk.ts`**
   - 119行目: `clientKey`と`rawClientKey`を`[REDACTED]`に置換、`headers`から`x-client-key`を除外
   - 131行目: `clientKey`と`client.apiKey`を`[REDACTED]`に置換
   - 152行目: `clientKey`を`[REDACTED]`に置換

3. **`apps/api/src/routes/tools/loans/cancel.ts`**
   - 7行目: `headers`から`x-client-key`を除外
   - 13行目: `headerKey`を`[REDACTED]`に置換

4. **`apps/api/src/routes/tools/loans/return.ts`**
   - 7行目: `headers`から`x-client-key`を除外
   - 13行目: `headerKey`を`[REDACTED]`に置換

5. **`apps/api/src/routes/webrtc/signaling.ts`**
   - 75行目: `headers`から`x-client-key`を除外

6. **`apps/api/src/routes/tools/loans/delete.ts`**
   - 7行目: `headers`から`x-client-key`を除外

### 実装詳細

#### 1. request-logger.ts

**修正前**:
```typescript
'x-client-key': request.headers['x-client-key'],
```

**修正後**:
```typescript
'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
```

#### 2. kiosk.ts

**修正前**:
```typescript
app.log.info({ clientKey, rawClientKey, headers: request.headers }, 'Kiosk config request');
```

**修正後**:
```typescript
// 機密情報保護: x-client-keyをログから除外
const sanitizedHeaders = { ...request.headers };
if ('x-client-key' in sanitizedHeaders) {
  sanitizedHeaders['x-client-key'] = '[REDACTED]';
}
app.log.info({ 
  clientKey: clientKey ? '[REDACTED]' : undefined, 
  rawClientKey: '[REDACTED]', 
  headers: sanitizedHeaders 
}, 'Kiosk config request');
```

**修正前**:
```typescript
app.log.info({ client, clientKey, found: !!client, defaultMode: client?.defaultMode }, 'Client device lookup result');
```

**修正後**:
```typescript
// 機密情報保護: clientKeyとclient.apiKeyをログから除外
const sanitizedClient = client ? { ...client, apiKey: '[REDACTED]' } : null;
app.log.info({ 
  client: sanitizedClient, 
  clientKey: '[REDACTED]', 
  found: !!client, 
  defaultMode: client?.defaultMode 
}, 'Client device lookup result');
```

**修正前**:
```typescript
app.log.info({ defaultMode, clientKey, hasClientStatus: !!clientStatus }, 'Returning kiosk config');
```

**修正後**:
```typescript
// 機密情報保護: clientKeyをログから除外
app.log.info({ 
  defaultMode, 
  clientKey: '[REDACTED]', 
  hasClientStatus: !!clientStatus 
}, 'Returning kiosk config');
```

#### 3. tools/loans/cancel.ts と return.ts

**修正前**:
```typescript
app.log.info({ body: request.body, headers: request.headers }, 'Loan cancel request received');
// ...
app.log.info({ resolvedClientId, headerKey }, 'Client ID resolved');
```

**修正後**:
```typescript
// 機密情報保護: x-client-keyをログから除外
const sanitizedHeaders = { ...request.headers };
if ('x-client-key' in sanitizedHeaders) {
  sanitizedHeaders['x-client-key'] = '[REDACTED]';
}
app.log.info({ body: request.body, headers: sanitizedHeaders }, 'Loan cancel request received');
// ...
// 機密情報保護: headerKeyをログから除外
app.log.info({ resolvedClientId, headerKey: '[REDACTED]' }, 'Client ID resolved');
```

#### 4. webrtc/signaling.ts

**修正前**:
```typescript
app.log.info({ url: req.url, headers: req.headers }, 'WebRTC signaling WebSocket connection attempt');
```

**修正後**:
```typescript
// 機密情報保護: x-client-keyをログから除外
const sanitizedHeaders = { ...req.headers };
if ('x-client-key' in sanitizedHeaders) {
  sanitizedHeaders['x-client-key'] = '[REDACTED]';
}
app.log.info({ url: req.url, headers: sanitizedHeaders }, 'WebRTC signaling WebSocket connection attempt');
```

#### 5. tools/loans/delete.ts

**修正前**:
```typescript
app.log.info({ params: request.params, headers: request.headers }, 'Loan delete request received');
```

**修正後**:
```typescript
// 機密情報保護: x-client-keyをログから除外
const sanitizedHeaders = { ...request.headers };
if ('x-client-key' in sanitizedHeaders) {
  sanitizedHeaders['x-client-key'] = '[REDACTED]';
}
app.log.info({ params: request.params, headers: sanitizedHeaders }, 'Loan delete request received');
```

## 検証方法

### 1. ログ出力の確認

```bash
# Pi5上で実行
# キオスクAPIにアクセス
curl -H "x-client-key: test-key-12345" https://localhost/api/kiosk/config

# ログを確認（x-client-keyが[REDACTED]に置換されていることを確認）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "x-client-key"
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "REDACTED"
```

### 2. ログファイルの確認

```bash
# Pi5上で実行
# ログファイルを確認
sudo tail -100 /var/log/syslog | grep -i "x-client-key"
sudo journalctl -u docker-api-1.service | grep -i "x-client-key"
```

## 実装結果

### ✅ 実装完了項目

1. ✅ `request-logger.ts`: `x-client-key`を`[REDACTED]`に置換
2. ✅ `kiosk.ts`: `clientKey`、`rawClientKey`、`client.apiKey`を`[REDACTED]`に置換
3. ✅ `tools/loans/cancel.ts`: `headerKey`と`headers`から`x-client-key`を除外
4. ✅ `tools/loans/return.ts`: `headerKey`と`headers`から`x-client-key`を除外
5. ✅ `webrtc/signaling.ts`: `headers`から`x-client-key`を除外
6. ✅ `tools/loans/delete.ts`: `headers`から`x-client-key`を除外

### リンターエラー

✅ **エラーなし** - すべてのファイルでリンターエラーは発生していません。

## 影響範囲

### 変更されたファイル

- `apps/api/src/plugins/request-logger.ts`
- `apps/api/src/routes/kiosk.ts`
- `apps/api/src/routes/tools/loans/cancel.ts`
- `apps/api/src/routes/tools/loans/return.ts`
- `apps/api/src/routes/webrtc/signaling.ts`
- `apps/api/src/routes/tools/loans/delete.ts`

### 副作用

- **ログの可読性**: `x-client-key`が`[REDACTED]`に置換されるため、ログの可読性が低下する可能性がありますが、セキュリティを優先します。
- **デバッグ**: `x-client-key`の値がログに出力されないため、デバッグ時に値の確認が困難になる可能性があります。必要に応じて、デバッグモードでのみ値を出力する機能を追加することを検討できます。

## 次のステップ

1. **実機検証**: Pi5上でログを確認し、`x-client-key`が`[REDACTED]`に置換されていることを確認
2. **デプロイ**: 修正をPi5にデプロイ
3. **動作確認**: デプロイ後、ログを確認して動作を検証

## 関連ドキュメント

- [緊急に実装すべき安全対策機能](./urgent-security-measures.md)
- [セキュリティ評価報告書](./evaluation-report.md)
- [外部侵入リスク分析レポート](./external-intrusion-risk-analysis.md)
