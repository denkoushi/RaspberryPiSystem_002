import fetch from 'node-fetch';
import { logger } from '../../lib/logger.js';

/**
 * Gmail OAuth 2.0トークン情報
 */
export interface GmailTokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
}

/**
 * Gmail OAuth 2.0認証フローを管理するサービス
 */
export class GmailOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri?: string;
  private readonly scopes: string[];

  constructor(options: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
    scopes?: string[];
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    // デフォルトスコープ: Gmail読み取り専用
    // デフォルトスコープ: Gmail読み取りとメール操作（アーカイブ用）
    this.scopes = options.scopes || [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ];
  }

  /**
   * OAuth 2.0認証URLを生成
   * @param state CSRF保護用のstateパラメータ（オプション）
   * @returns 認証URL
   */
  getAuthorizationUrl(state?: string): string {
    if (!this.redirectUri) {
      throw new Error('redirectUri is required to generate Gmail authorization URL');
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(' '),
      access_type: 'offline', // リフレッシュトークンを取得するために必須
      prompt: 'consent' // リフレッシュトークンを確実に取得するためにconsentを要求
    });

    if (state) {
      params.append('state', state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * 認証コードをアクセストークンとリフレッシュトークンに交換
   * @param code 認証コード
   * @returns トークン情報
   */
  async exchangeCodeForTokens(code: string): Promise<GmailTokenInfo> {
    if (!this.redirectUri) {
      throw new Error('redirectUri is required to exchange Gmail auth code for tokens');
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error(
        { status: response.status, error: errorText },
        '[GmailOAuthService] Failed to exchange code for tokens'
      );
      throw new Error(`Failed to exchange code for tokens: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope
    };
  }

  /**
   * リフレッシュトークンを使用して新しいアクセストークンを取得
   * @param refreshToken リフレッシュトークン
   * @returns 新しいトークン情報
   */
  async refreshAccessToken(refreshToken: string): Promise<GmailTokenInfo> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error(
        { status: response.status, error: errorText },
        '[GmailOAuthService] Failed to refresh access token'
      );
      throw new Error(`Failed to refresh access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken, // リフレッシュトークンは通常変更されないが、念のため保持
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope
    };
  }
}

