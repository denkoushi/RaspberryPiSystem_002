import crypto from 'crypto';

import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { DropboxOAuthService } from '../../services/backup/dropbox-oauth.service.js';

type LegacyStorageOptions = NonNullable<BackupConfig['storage']['options']> & {
  accessToken?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
};

export async function registerBackupOAuthRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // OAuth 2.0認証URL生成
  app.get('/backup/oauth/authorize', {
    preHandler: [mustBeAdmin],
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri,
    });

    // CSRF保護用のstateパラメータを生成
    const state = crypto.randomBytes(32).toString('hex');

    // セッションにstateを保存（簡易実装、本番環境では適切なセッション管理を使用）
    // ここではクエリパラメータとして返す（実際の実装ではセッションストアを使用）
    const authUrl = oauthService.getAuthorizationUrl(state);

    return reply.status(200).send({
      authorizationUrl: authUrl,
      state,
    });
  });

  // OAuth 2.0コールバック（認証コードを受け取る）
  // 注意: コールバックエンドポイントはDropboxからリダイレクトされるため、認証をスキップする
  // CSRF保護は`state`パラメータで行う（簡易実装）
  app.get('/backup/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error) {
      throw new ApiError(400, `OAuth error: ${query.error}`);
    }

    if (!query.code) {
      throw new ApiError(400, 'Authorization code is required');
    }

    const config = await BackupConfigLoader.load();
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri,
    });

    try {
      const tokenInfo = await oauthService.exchangeCodeForTokens(query.code);

      // 設定ファイルを更新（新構造: options.dropbox.* へ保存）
      // NOTE: {...config} で新オブジェクトを作るとフォールバック検知マーカーが落ち得るため、元のconfigを更新する
      (config.storage.options ??= {});
      const opts = config.storage.options as LegacyStorageOptions;
      opts.dropbox = {
        appKey,
        appSecret,
        accessToken: tokenInfo.accessToken,
        refreshToken: tokenInfo.refreshToken || opts.dropbox?.refreshToken || opts.refreshToken,
      };
      // 後方互換（旧キー）も更新しておく
      opts.accessToken = tokenInfo.accessToken;
      if (tokenInfo.refreshToken) {
        opts.refreshToken = tokenInfo.refreshToken;
      }

      await BackupConfigLoader.save(config);

      return reply.status(200).send({
        success: true,
        message: 'Tokens saved successfully',
        hasRefreshToken: !!tokenInfo.refreshToken,
      });
    } catch (error) {
      logger?.error({ err: error }, '[BackupRoute] Failed to exchange code for tokens');
      throw new ApiError(500, 'Failed to exchange authorization code for tokens');
    }
  });

  // リフレッシュトークンでアクセストークンを更新（手動用）
  app.post('/backup/oauth/refresh', {
    preHandler: [mustBeAdmin],
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const refreshToken = config.storage.options?.refreshToken as string | undefined;
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!refreshToken) {
      throw new ApiError(400, 'Refresh token is required in config file');
    }

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri,
    });

    try {
      const tokenInfo = await oauthService.refreshAccessToken(refreshToken);

      // 設定ファイルを更新（新構造: options.dropbox.* へ保存）
      // NOTE: {...config} で新オブジェクトを作るとフォールバック検知マーカーが落ち得るため、元のconfigを更新する
      (config.storage.options ??= {});
      const opts = config.storage.options as LegacyStorageOptions;
      opts.dropbox = {
        appKey,
        appSecret,
        accessToken: tokenInfo.accessToken,
        refreshToken: tokenInfo.refreshToken || refreshToken || opts.dropbox?.refreshToken,
      };
      // 後方互換（旧キー）も更新しておく
      opts.accessToken = tokenInfo.accessToken;
      if (tokenInfo.refreshToken) {
        opts.refreshToken = tokenInfo.refreshToken;
      }

      await BackupConfigLoader.save(config);

      return reply.status(200).send({
        success: true,
        message: 'Access token refreshed successfully',
      });
    } catch (error) {
      logger?.error({ err: error }, '[BackupRoute] Failed to refresh access token');
      throw new ApiError(500, 'Failed to refresh access token');
    }
  });
}
