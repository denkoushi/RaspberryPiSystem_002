import fetch from 'node-fetch';
import { logger } from '../../lib/logger.js';

/**
 * Dropbox OAuth 2.0トークン情報
 */
export interface DropboxTokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  accountId?: string;
  uid?: string;
}

/**
 * Dropbox OAuth 2.0認証フローを管理するサービス
 */
export class DropboxOAuthService {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly redirectUri?: string;

  constructor(options: {
    appKey: string;
    appSecret: string;
    redirectUri?: string;
  }) {
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.redirectUri = options.redirectUri;
  }

  /**
   * OAuth 2.0認証URLを生成
   * @param state CSRF保護用のstateパラメータ（オプション）
   * @returns 認証URL
   */
  getAuthorizationUrl(state?: string): string {
    if (!this.redirectUri) {
      throw new Error('redirectUri is required to generate Dropbox authorization URL');
    }
    const params = new URLSearchParams({
      client_id: this.appKey,
      response_type: 'code',
      token_access_type: 'offline', // リフレッシュトークンを取得するために必須
      redirect_uri: this.redirectUri
    });

    if (state) {
      params.append('state', state);
    }

    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * 認証コードをアクセストークンとリフレッシュトークンに交換
   * @param code 認証コード
   * @returns トークン情報
   */
  async exchangeCodeForTokens(code: string): Promise<DropboxTokenInfo> {
    if (!this.redirectUri) {
      throw new Error('redirectUri is required to exchange Dropbox auth code for tokens');
    }
    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: this.appKey,
        client_secret: this.appSecret,
        redirect_uri: this.redirectUri
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error(
        { status: response.status, error: errorText },
        '[DropboxOAuthService] Failed to exchange code for tokens'
      );
      throw new Error(`Failed to exchange code for tokens: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      account_id?: string;
      uid?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      accountId: data.account_id,
      uid: data.uid
    };
  }

  /**
   * リフレッシュトークンを使用して新しいアクセストークンを取得
   * @param refreshToken リフレッシュトークン
   * @returns 新しいトークン情報
   */
  async refreshAccessToken(refreshToken: string): Promise<DropboxTokenInfo> {
    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: this.appKey,
        client_secret: this.appSecret
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error(
        { status: response.status, error: errorText },
        '[DropboxOAuthService] Failed to refresh access token'
      );
      throw new Error(`Failed to refresh access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in?: number;
      token_type: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken, // リフレッシュトークンは通常変更されないが、念のため保持
      expiresIn: data.expires_in,
      tokenType: data.token_type
    };
  }
}
