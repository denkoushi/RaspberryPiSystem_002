import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { AuthRoleAdminService } from '../auth-role-admin.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

describe('AuthRoleAdminService', () => {
  it('対象ユーザーが存在しない場合は404を返す', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 'admin-1', role: UserRole.ADMIN })
          .mockResolvedValueOnce(null),
        update: vi.fn(),
      },
      roleAuditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      roleAuditLog: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
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
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.roleAuditLog.create).not.toHaveBeenCalled();
  });

  it('ロール変更なしの場合は更新・通知を行わない', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 'admin-1', role: UserRole.ADMIN })
          .mockResolvedValueOnce({
            id: 'user-1',
            username: 'target',
            role: UserRole.MANAGER,
            mfaEnabled: true,
          }),
        update: vi.fn(),
      },
      roleAuditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      roleAuditLog: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
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
    expect(tx.user.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'admin-1' } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.roleAuditLog.create).not.toHaveBeenCalled();
    expect(db.roleAuditLog.count).not.toHaveBeenCalled();
    expect(alertService.emitRoleChangeAlert).not.toHaveBeenCalled();
  });

  it.each([
    { actorRole: UserRole.MANAGER, nextRole: UserRole.ADMIN },
    { actorRole: UserRole.VIEWER, nextRole: UserRole.ADMIN },
    { actorRole: null, nextRole: UserRole.ADMIN },
    { actorRole: UserRole.MANAGER, nextRole: UserRole.MANAGER },
    { actorRole: UserRole.VIEWER, nextRole: UserRole.MANAGER },
    { actorRole: null, nextRole: UserRole.MANAGER },
  ])('実行者の現在の権限が $actorRole の場合は $nextRole への要求を403で拒否する', async ({ actorRole, nextRole }) => {
    const actor = actorRole === null ? null : { id: 'admin-1', role: actorRole };
    const target = { id: 'user-1', username: 'target', role: UserRole.MANAGER, mfaEnabled: false };
    const tx = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'admin-1' ? actor : target
        ),
        update: vi.fn(),
      },
      roleAuditLog: { create: vi.fn() },
    };
    const db = {
      roleAuditLog: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(db as never, alertService);

    await expect(service.updateUserRole({
      actorUser: { id: 'admin-1', username: 'admin' },
      targetUserId: 'user-1',
      nextRole,
      logger: { warn: vi.fn() },
    })).rejects.toMatchObject({
      statusCode: 403,
      message: '操作権限がありません',
      code: 'AUTH_INSUFFICIENT_PERMISSIONS',
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 'admin-1' } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.roleAuditLog.create).not.toHaveBeenCalled();
    expect(db.roleAuditLog.count).not.toHaveBeenCalled();
    expect(alertService.emitRoleChangeAlert).not.toHaveBeenCalled();
  });

  it('昇格時は監査ログ作成後に理由付き通知を送る', async () => {
    const tx = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 'admin-1', role: UserRole.ADMIN })
          .mockResolvedValueOnce({ id: 'user-1', username: 'target', role: UserRole.MANAGER, mfaEnabled: false }),
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
      actorUser: { id: 'admin-1', username: 'admin' },
      targetUserId: 'user-1',
      nextRole: UserRole.ADMIN,
      logger,
    });

    expect(result.user.role).toBe(UserRole.ADMIN);
    expect(tx.user.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'admin-1' } });
    expect(tx.user.findUnique).toHaveBeenNthCalledWith(2, { where: { id: 'user-1' } });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { role: UserRole.ADMIN } });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.roleAuditLog.create).toHaveBeenCalledWith({
      data: { actorUserId: 'admin-1', targetUserId: 'user-1', fromRole: UserRole.MANAGER, toRole: UserRole.ADMIN },
    });
    expect(tx.roleAuditLog.create).toHaveBeenCalledTimes(1);
    expect(db.roleAuditLog.count).toHaveBeenCalledTimes(1);
    expect(alertService.emitRoleChangeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: [
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
        findUnique: vi.fn(async () => ({ id: 'user-2', username: 'target', role: UserRole.ADMIN, mfaEnabled: false })),
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
      roleAuditLog: {
        count: vi.fn(async () => 10),
      },
      $transaction: vi.fn(async (handler: (ctx: typeof tx) => Promise<unknown>) => handler(tx)),
    };
    const alertService = { emitRoleChangeAlert: vi.fn(async () => {}) };
    const service = new AuthRoleAdminService(db as never, alertService, () => new Date(2026, 2, 12, 10, 0, 0));

    await service.updateUserRole({
      actorUser: { id: 'user-2', username: 'admin' },
      targetUserId: 'user-2',
      nextRole: UserRole.VIEWER,
      logger: { warn: vi.fn() },
    });

    expect(db.roleAuditLog.count).not.toHaveBeenCalled();
    expect(tx.roleAuditLog.create).toHaveBeenCalledWith({
      data: { actorUserId: 'user-2', targetUserId: 'user-2', fromRole: UserRole.ADMIN, toRole: UserRole.VIEWER },
    });
    expect(alertService.emitRoleChangeAlert).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['self-role-change'] }));
  });
});
