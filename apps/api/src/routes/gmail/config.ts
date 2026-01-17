import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { writeDebugLog } from '../../lib/debug-log.js';

type LegacyStorageOptions = NonNullable<BackupConfig['storage']['options']> & {
  clientId?: string;
  clientSecret?: string;
  subjectPattern?: string;
  fromEmail?: string;
  redirectUri?: string;
  gmailAccessToken?: string;
  gmailRefreshToken?: string;
};

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
    // #region agent log
    await writeDebugLog({sessionId:'debug-session',runId:'pre',hypothesisId:'A',location:'gmail/config.ts:get',message:'gmail config fetched',data:{hasClientId:!!clientId,hasSubjectPattern:!!subjectPattern,hasFromEmail:!!fromEmail,hasAccessToken:!!accessToken,hasRefreshToken:!!refreshToken},timestamp:Date.now()});
    // #endregion
    
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
    // NOTE: {...config} で新オブジェクトを作るとフォールバック検知マーカーが落ち得るため、元のconfigを更新する
    (config.storage.options ??= {});
    const legacyOpts = config.storage.options as LegacyStorageOptions;
    const currentGmail = legacyOpts.gmail ?? {};
    legacyOpts.gmail = {
      ...currentGmail,
      ...(body.clientId !== undefined && { clientId: body.clientId }),
      ...(body.clientSecret !== undefined && { clientSecret: body.clientSecret }),
      ...(body.subjectPattern !== undefined && { subjectPattern: body.subjectPattern }),
      ...(body.fromEmail !== undefined && { fromEmail: body.fromEmail === '' ? undefined : body.fromEmail }),
      ...(body.redirectUri !== undefined && { redirectUri: body.redirectUri }),
      // 既存のトークンは保持（後方互換: 旧キーも読む）
      accessToken: currentGmail.accessToken ?? legacyOpts.gmailAccessToken,
      refreshToken: currentGmail.refreshToken ?? legacyOpts.gmailRefreshToken,
    };

    await BackupConfigLoader.save(config);

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

    // Gmail設定を削除（新構造: options.gmail を削除）
    // NOTE: {...config} で新オブジェクトを作るとフォールバック検知マーカーが落ち得るため、元のconfigを更新する
    (config.storage.options ??= {});
    const legacyOpts = config.storage.options as LegacyStorageOptions;
    legacyOpts.gmail = undefined;
    // 旧構造のGmail設定も削除（後方互換のため）
    legacyOpts.clientId = undefined;
    legacyOpts.clientSecret = undefined;
    legacyOpts.subjectPattern = undefined;
    legacyOpts.fromEmail = undefined;
    legacyOpts.redirectUri = undefined;
    legacyOpts.gmailAccessToken = undefined;
    legacyOpts.gmailRefreshToken = undefined;

    await BackupConfigLoader.save(config);

    logger?.info('[GmailConfigRoute] Gmail configuration removed, fallback to local storage');

    return reply.status(200).send({ 
      success: true,
      message: 'Gmail configuration removed successfully'
    });
  });
}

