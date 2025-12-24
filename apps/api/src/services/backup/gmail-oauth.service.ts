import fetch from 'node-fetch';
import * as https from 'https';
import * as tls from 'tls';
import { logger } from '../../lib/logger.js';
import { verifyGmailCertificate } from './storage/gmail-cert-pinning.js';

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
  private readonly redirectUri: string;

  constructor(options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
  }

  /**
   * OAuth 2.0認証URLを生成
   * @param state CSRF保護用のstateパラメータ（オプション）
   * @returns 認証URL
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
      access_type: 'offline', // リフレッシュトークンを取得するために必須
      prompt: 'consent' // リフレッシュトークンを確実に取得するため
    });

    if (state) {
      params.append('state', state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * HTTPSエージェントを作成（証明書ピニング対応）
   */
  private createHttpsAgent(): https.Agent {
    return new https.Agent({
      rejectUnauthorized: true, // 証明書検証を有効化（必須）
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 5,
      timeout: 30000, // 30秒タイムアウト
      secureProtocol: 'TLSv1_2_method', // TLS 1.2以上を強制
      // 証明書ピニングの検証
      checkServerIdentity: (servername: string, cert: tls.PeerCertificate) => {
        const pinningError = verifyGmailCertificate(servername, cert);
        if (pinningError) {
          return pinningError;
        }
        // デフォルトの検証を継続
        return tls.checkServerIdentity(servername, cert);
      }
    });
  }

  /**
   * 認証コードをアクセストークンとリフレッシュトークンに交換
   * @param code 認証コード
   * @returns トークン情報
   */
  async exchangeCodeForTokens(code: string): Promise<GmailTokenInfo> {
    const httpsAgent = this.createHttpsAgent();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      }).toString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: httpsAgent as any
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
    const httpsAgent = this.createHttpsAgent();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token'
      }).toString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: httpsAgent as any
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
