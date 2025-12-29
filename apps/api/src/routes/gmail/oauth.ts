import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { GmailOAuthService } from '../../services/backup/gmail-oauth.service.js';

/**
 * Gmail OAuth認証ルートを登録
 */
export function registerGmailOAuthRoutes(app: FastifyInstance): void {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // OAuth 2.0認証URL生成
  app.get('/gmail/oauth/authorize', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const clientId = config.storage.options?.clientId as string | undefined;
    const clientSecret = config.storage.options?.clientSecret as string | undefined;

    if (!clientId || !clientSecret) {
      throw new ApiError(400, 'Gmail Client ID and Client Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');
    const redirectUri = `${protocol}://${host}/api/gmail/oauth/callback`;

    const oauthService = new GmailOAuthService({
      clientId,
      clientSecret,
      redirectUri
    });

    // CSRF保護用のstateパラメータを生成
    const state = crypto.randomBytes(32).toString('hex');
    
    // 認証URLを生成
    const authUrl = oauthService.getAuthorizationUrl(state);

    logger?.info({ state }, '[GmailOAuthRoute] Authorization URL generated');

    return reply.status(200).send({
      authorizationUrl: authUrl,
      state
    });
  });

  // OAuth 2.0コールバック（認証コードを受け取る）
  // 注意: コールバックエンドポイントはGoogleからリダイレクトされるため、認証をスキップする
  // CSRF保護は`state`パラメータで行う（簡易実装）
  app.get('/gmail/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    
    if (query.error) {
      logger?.error({ error: query.error }, '[GmailOAuthRoute] OAuth error received');
      throw new ApiError(400, `OAuth error: ${query.error}`);
    }

    if (!query.code) {
      throw new ApiError(400, 'Authorization code is required');
    }

    const config = await BackupConfigLoader.load();
    const clientId = config.storage.options?.clientId as string | undefined;
    const clientSecret = config.storage.options?.clientSecret as string | undefined;

    if (!clientId || !clientSecret) {
      throw new ApiError(400, 'Gmail Client ID and Client Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');
    const redirectUri = `${protocol}://${host}/api/gmail/oauth/callback`;

    const oauthService = new GmailOAuthService({
      clientId,
      clientSecret,
      redirectUri
    });

    try {
      const tokenInfo = await oauthService.exchangeCodeForTokens(query.code);
      
      logger?.info(
        { 
          hasAccessToken: !!tokenInfo.accessToken,
          hasRefreshToken: !!tokenInfo.refreshToken,
          expiresIn: tokenInfo.expiresIn
        },
        '[GmailOAuthRoute] Tokens exchanged successfully'
      );

      // 設定ファイルを更新
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: tokenInfo.accessToken,
            refreshToken: tokenInfo.refreshToken || config.storage.options?.refreshToken,
            clientId,
            clientSecret
          }
        }
      };

      await BackupConfigLoader.save(updatedConfig);

      logger?.info('[GmailOAuthRoute] Config file updated with new tokens');

      // 成功ページを返す（実際の実装では適切なHTMLページを返す）
      return reply.status(200).send({
        success: true,
        message: 'Gmail OAuth authentication completed successfully. You can close this window.'
      });
    } catch (error) {
      logger?.error({ err: error }, '[GmailOAuthRoute] Failed to exchange code for tokens');
      throw new ApiError(
        500,
        `Failed to exchange authorization code for tokens: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // リフレッシュトークンでアクセストークンを更新（手動用）
  app.post('/gmail/oauth/refresh', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const refreshToken = config.storage.options?.refreshToken as string | undefined;
    const clientId = config.storage.options?.clientId as string | undefined;
    const clientSecret = config.storage.options?.clientSecret as string | undefined;

    if (!refreshToken) {
      throw new ApiError(400, 'Refresh token is required in config file');
    }

    if (!clientId || !clientSecret) {
      throw new ApiError(400, 'Gmail Client ID and Client Secret are required in config file');
    }

    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');
    const redirectUri = `${protocol}://${host}/api/gmail/oauth/callback`;

    const oauthService = new GmailOAuthService({
      clientId,
      clientSecret,
      redirectUri
    });

    try {
      const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
      
      logger?.info(
        { 
          hasAccessToken: !!tokenInfo.accessToken,
          expiresIn: tokenInfo.expiresIn
        },
        '[GmailOAuthRoute] Access token refreshed successfully'
      );

      // 設定ファイルを更新
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: tokenInfo.accessToken,
            refreshToken: tokenInfo.refreshToken || refreshToken,
            clientId,
            clientSecret
          }
        }
      };

      await BackupConfigLoader.save(updatedConfig);

      logger?.info('[GmailOAuthRoute] Config file updated with refreshed token');

      return reply.status(200).send({
        success: true,
        message: 'Access token refreshed successfully',
        expiresIn: tokenInfo.expiresIn
      });
    } catch (error) {
      logger?.error({ err: error }, '[GmailOAuthRoute] Failed to refresh access token');
      throw new ApiError(
        500,
        `Failed to refresh access token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

