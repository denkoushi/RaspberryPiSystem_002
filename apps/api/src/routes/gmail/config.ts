import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
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
    
    // Gmail設定のみを抽出（機密情報はマスク）
    const gmailConfig = {
      provider: config.storage.provider === 'gmail' ? 'gmail' : undefined,
      clientId: config.storage.options?.clientId as string | undefined,
      clientSecret: config.storage.options?.clientSecret 
        ? '***' + (config.storage.options.clientSecret as string).slice(-4) // 最後の4文字のみ表示
        : undefined,
      subjectPattern: config.storage.options?.subjectPattern as string | undefined,
      fromEmail: config.storage.options?.fromEmail as string | undefined,
      redirectUri: config.storage.options?.redirectUri as string | undefined,
      hasAccessToken: !!(config.storage.options?.accessToken as string | undefined),
      hasRefreshToken: !!(config.storage.options?.refreshToken as string | undefined)
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
    
    // Gmail設定を更新
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        ...config.storage,
        provider: 'gmail', // Gmail設定を更新する場合はプロバイダーをgmailに設定
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
    
    if (config.storage.provider !== 'gmail') {
      throw new ApiError(400, 'Gmail is not currently configured as the storage provider');
    }

    // Gmail設定を削除し、localにフォールバック
    const updatedConfig: BackupConfig = {
      ...config,
      storage: {
        provider: 'local',
        options: {
          ...config.storage.options,
          // Gmail固有の設定を削除
          clientId: undefined,
          clientSecret: undefined,
          subjectPattern: undefined,
          fromEmail: undefined,
          redirectUri: undefined,
          // アクセストークンとリフレッシュトークンも削除
          accessToken: undefined,
          refreshToken: undefined
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

