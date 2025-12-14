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
    mfaEnabled: boolean;
  };
}

export interface MfaInitiateResponse {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export interface MfaActivateResponse {
  backupCodes: string[];
}

export interface RoleAuditLog {
  id: string;
  actorUserId: string;
  targetUserId: string;
  fromRole: 'ADMIN' | 'MANAGER' | 'VIEWER';
  toRole: 'ADMIN' | 'MANAGER' | 'VIEWER';
  createdAt: string;
  actorUser?: { id: string; username: string };
  targetUser?: { id: string; username: string };
}



