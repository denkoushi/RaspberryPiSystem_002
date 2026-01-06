import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';

const gmailConfigUpdateSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  subjectPattern: z.string().optional(),
  fromEmail: z.string().email().optional().or(z.literal('')),
  redirectUri: z.string().url().optional()
});

/**
 * Gmail設定管理ルートを登録
 */
export function registerGmailConfigRoutes(app: FastifyInstance): void {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // Gmail設定の取得
  app.get('/gmail/config', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const opts = config.storage.options as (NonNullable<BackupConfig['storage']['options']> & {
      gmailAccessToken?: string;
      gmailRefreshToken?: string;
    }) | undefined;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'gmail+dropbox-pre',
        hypothesisId: 'G1',
        location: 'apps/api/src/routes/gmail/config.ts:GET /gmail/config',
        message: 'Loaded backup config for GmailConfig GET',
        data: {
          storageProvider: config.storage.provider,
          hasClientId: !!opts?.clientId,
          hasClientSecret: !!opts?.clientSecret,
          hasAccessToken: !!opts?.gmailAccessToken,
          hasRefreshToken: !!opts?.gmailRefreshToken,
          hasRedirectUri: !!opts?.redirectUri
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    
    // Gmail設定のみを抽出（機密情報はマスク）
    const gmailConfig = {
      // NOTE: Gmail設定はCSVインポート用に保持され得るため、storage.providerに依存しない
      provider: opts?.clientId ? 'gmail' : undefined,
      clientId: opts?.clientId as string | undefined,
      clientSecret: opts?.clientSecret
        ? '***' + String(opts.clientSecret).slice(-4) // 最後の4文字のみ表示
        : undefined,
      subjectPattern: opts?.subjectPattern as string | undefined,
      fromEmail: opts?.fromEmail as string | undefined,
      redirectUri: opts?.redirectUri as string | undefined,
      hasAccessToken: !!opts?.gmailAccessToken,
      hasRefreshToken: !!opts?.gmailRefreshToken
    };

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'gmail+dropbox-pre',
        hypothesisId: 'G1',
        location: 'apps/api/src/routes/gmail/config.ts:GET /gmail/config',
        message: 'Computed GmailConfig response',
        data: {
          providerField: gmailConfig.provider,
          hasClientId: !!gmailConfig.clientId,
          hasClientSecretMasked: !!gmailConfig.clientSecret,
          hasAccessToken: gmailConfig.hasAccessToken,
          hasRefreshToken: gmailConfig.hasRefreshToken,
          hasRedirectUri: !!gmailConfig.redirectUri
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

    return reply.status(200).send(gmailConfig);
  });

  // Gmail設定の更新
  app.put('/gmail/config', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          clientId: { type: 'string' },
          clientSecret: { type: 'string' },
          subjectPattern: { type: 'string' },
          fromEmail: { type: 'string' },
          redirectUri: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const body = gmailConfigUpdateSchema.parse(request.body);
    
    const config = await BackupConfigLoader.load();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'gmail+dropbox-pre',
        hypothesisId: 'G2',
        location: 'apps/api/src/routes/gmail/config.ts:PUT /gmail/config',
        message: 'Updating GmailConfig (masked)',
        data: {
          prevStorageProvider: config.storage.provider,
          hasClientId: !!body.clientId,
          hasClientSecret: !!body.clientSecret,
          hasSubjectPattern: body.subjectPattern !== undefined,
          hasFromEmail: body.fromEmail !== undefined,
          hasRedirectUri: !!body.redirectUri
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    
    // Gmail設定を更新
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        ...config.storage,
        // NOTE: Gmail設定の更新は、バックアップ先（dropbox/local）の切替とは独立に扱う
        provider: config.storage.provider,
        options: {
          ...config.storage.options,
          ...(body.clientId !== undefined && { clientId: body.clientId }),
          ...(body.clientSecret !== undefined && { clientSecret: body.clientSecret }),
          ...(body.subjectPattern !== undefined && { subjectPattern: body.subjectPattern }),
          ...(body.fromEmail !== undefined && { 
            fromEmail: body.fromEmail === '' ? undefined : body.fromEmail 
          }),
          ...(body.redirectUri !== undefined && { redirectUri: body.redirectUri })
        }
      }
    };

    await BackupConfigLoader.save(updatedConfig);

    logger?.info(
      { 
        hasClientId: !!body.clientId,
        hasClientSecret: !!body.clientSecret,
        subjectPattern: body.subjectPattern,
        fromEmail: body.fromEmail
      },
      '[GmailConfigRoute] Gmail configuration updated'
    );

    return reply.status(200).send({ 
      success: true,
      message: 'Gmail configuration updated successfully'
    });
  });

  // Gmail設定の削除（プロバイダーをlocalに戻す）
  app.delete('/gmail/config', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();

    // Gmail設定を削除し、localにフォールバック
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        provider: config.storage.provider,
        options: {
          ...config.storage.options,
          // Gmail固有の設定を削除
          clientId: undefined,
          clientSecret: undefined,
          subjectPattern: undefined,
          fromEmail: undefined,
          redirectUri: undefined,
          // Gmailトークンを削除（Dropbox用トークンは保持する）
          gmailAccessToken: undefined,
          gmailRefreshToken: undefined
        }
      }
    };

    await BackupConfigLoader.save(updatedConfig);

    logger?.info('[GmailConfigRoute] Gmail configuration removed, fallback to local storage');

    return reply.status(200).send({ 
      success: true,
      message: 'Gmail configuration removed successfully'
    });
  });
}

