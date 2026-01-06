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

  // Gmail設定の取得（新構造優先、旧構造も読める）
  app.get('/gmail/config', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const opts = config.storage.options;
    const gmailOpts = opts?.gmail;
    
    // 新構造優先: options.gmail.* → 後方互換: 旧キー
    const clientId = gmailOpts?.clientId ?? opts?.clientId as string | undefined;
    const clientSecret = gmailOpts?.clientSecret ?? opts?.clientSecret as string | undefined;
    const subjectPattern = gmailOpts?.subjectPattern ?? opts?.subjectPattern as string | undefined;
    const fromEmail = gmailOpts?.fromEmail ?? opts?.fromEmail as string | undefined;
    const redirectUri = gmailOpts?.redirectUri ?? opts?.redirectUri as string | undefined;
    const accessToken = gmailOpts?.accessToken ?? opts?.gmailAccessToken as string | undefined;
    const refreshToken = gmailOpts?.refreshToken ?? opts?.gmailRefreshToken as string | undefined;
    
    // Gmail設定のみを抽出（機密情報はマスク）
    const gmailConfig = {
      // NOTE: Gmail設定はCSVインポート用に保持され得るため、storage.providerに依存しない
      provider: clientId ? 'gmail' : undefined,
      clientId,
      clientSecret: clientSecret
        ? '***' + String(clientSecret).slice(-4) // 最後の4文字のみ表示
        : undefined,
      subjectPattern,
      fromEmail,
      redirectUri,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken
    };

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
    
    // Gmail設定を更新（新構造: options.gmail.* へ保存）
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        ...config.storage,
        // NOTE: Gmail設定の更新は、バックアップ先（dropbox/local）の切替とは独立に扱う
        provider: config.storage.provider,
        options: {
          ...config.storage.options,
          gmail: {
            ...config.storage.options?.gmail,
            ...(body.clientId !== undefined && { clientId: body.clientId }),
            ...(body.clientSecret !== undefined && { clientSecret: body.clientSecret }),
            ...(body.subjectPattern !== undefined && { subjectPattern: body.subjectPattern }),
            ...(body.fromEmail !== undefined && { 
              fromEmail: body.fromEmail === '' ? undefined : body.fromEmail 
            }),
            ...(body.redirectUri !== undefined && { redirectUri: body.redirectUri }),
            // 既存のトークンは保持
            accessToken: config.storage.options?.gmail?.accessToken ?? config.storage.options?.gmailAccessToken,
            refreshToken: config.storage.options?.gmail?.refreshToken ?? config.storage.options?.gmailRefreshToken
          }
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

    // Gmail設定を削除し、localにフォールバック（新構造: options.gmail を削除）
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        provider: config.storage.provider,
        options: {
          ...config.storage.options,
          gmail: undefined,
          // 旧構造のGmail設定も削除（後方互換のため）
          clientId: undefined,
          clientSecret: undefined,
          subjectPattern: undefined,
          fromEmail: undefined,
          redirectUri: undefined,
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

