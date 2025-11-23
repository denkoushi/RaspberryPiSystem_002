/**
 * 認証関連の型定義
 */

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    role: 'ADMIN' | 'MANAGER' | 'VIEWER';
  };
}


