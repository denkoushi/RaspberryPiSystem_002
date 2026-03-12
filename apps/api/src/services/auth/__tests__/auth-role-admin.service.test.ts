import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { AuthRoleAdminService } from '../auth-role-admin.service.js';

describe('AuthRoleAdminService', () => {
  it('対象ユーザーが存在しない場合は404を返す', async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => null),
      },
      roleAuditLog: {
        count: vi.fn(async () => 0),
      },
      $transaction: vi.fn(),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(db as never, alertService);

    await expect(
      service.updateUserRole({
        actorUser: { id: 'admin-1', username: 'admin' },
        targetUserId: 'missing-user',
        nextRole: UserRole.MANAGER,
        logger: { warn: vi.fn() },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('ロール変更なしの場合は更新・通知を行わない', async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => ({
          id: 'user-1',
          username: 'target',
          role: UserRole.MANAGER,
          mfaEnabled: true,
        })),
      },
      roleAuditLog: {
        count: vi.fn(async () => 0),
      },
      $transaction: vi.fn(),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(db as never, alertService);

    const result = await service.updateUserRole({
      actorUser: { id: 'admin-1', username: 'admin' },
      targetUserId: 'user-1',
      nextRole: UserRole.MANAGER,
      logger: { warn: vi.fn() },
    });

    expect(result.user).toEqual({
      id: 'user-1',
      username: 'target',
      role: UserRole.MANAGER,
      mfaEnabled: true,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(alertService.emitRoleChangeAlert).not.toHaveBeenCalled();
  });

  it('昇格時は監査ログ作成後に理由付き通知を送る', async () => {
    const tx = {
      user: {
        update: vi.fn(async () => ({
          id: 'user-1',
          username: 'target',
          role: UserRole.ADMIN,
          mfaEnabled: false,
        })),
      },
      roleAuditLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const db = {
      user: {
        findUnique: vi.fn(async () => ({
          id: 'user-1',
          username: 'target',
          role: UserRole.MANAGER,
          mfaEnabled: false,
        })),
      },
      roleAuditLog: {
        count: vi.fn(async () => 3),
      },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(
      db as never,
      alertService,
      () => new Date(2026, 2, 12, 21, 0, 0),
      {
        businessHourStart: 8,
        businessHourEnd: 20,
        bulkPromotionThreshold: 3,
        bulkPromotionWindowMinutes: 60,
      }
    );
    const logger = { warn: vi.fn() };

    const result = await service.updateUserRole({
      actorUser: { id: 'user-1', username: 'admin' },
      targetUserId: 'user-1',
      nextRole: UserRole.ADMIN,
      logger,
    });

    expect(result.user.role).toBe(UserRole.ADMIN);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.roleAuditLog.create).toHaveBeenCalledTimes(1);
    expect(db.roleAuditLog.count).toHaveBeenCalledTimes(1);
    expect(alertService.emitRoleChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: [
          'self-role-change',
          'promotion-to-admin',
          'outside-business-hours',
          'bulk-promotion-3-within-60m',
        ],
        logger,
      })
    );
  });

  it('ADMIN以外への変更では昇格集中カウントを行わない', async () => {
    const tx = {
      user: {
        update: vi.fn(async () => ({
          id: 'user-2',
          username: 'target',
          role: UserRole.VIEWER,
          mfaEnabled: false,
        })),
      },
      roleAuditLog: {
        create: vi.fn(async () => ({})),
      },
    };
    const db = {
      user: {
        findUnique: vi.fn(async () => ({
          id: 'user-2',
          username: 'target',
          role: UserRole.MANAGER,
          mfaEnabled: false,
        })),
      },
      roleAuditLog: {
        count: vi.fn(async () => 10),
      },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(db as never, alertService, () => new Date(2026, 2, 12, 10, 0, 0));

    await service.updateUserRole({
      actorUser: { id: 'admin-1', username: 'admin' },
      targetUserId: 'user-2',
      nextRole: UserRole.VIEWER,
      logger: { warn: vi.fn() },
    });

    expect(db.roleAuditLog.count).not.toHaveBeenCalled();
  });
});
