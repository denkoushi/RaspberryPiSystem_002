import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { buildRoleChangeReasons, isOutsideBusinessHours } from '../role-change-policy.js';

describe('role-change-policy', () => {
  it('境界時刻で営業時間内/外を判定できる', () => {
    expect(isOutsideBusinessHours(new Date(2026, 2, 12, 7, 59, 59), 8, 20)).toBe(true);
    expect(isOutsideBusinessHours(new Date(2026, 2, 12, 8, 0, 0), 8, 20)).toBe(false);
    expect(isOutsideBusinessHours(new Date(2026, 2, 12, 19, 59, 59), 8, 20)).toBe(false);
    expect(isOutsideBusinessHours(new Date(2026, 2, 12, 20, 0, 0), 8, 20)).toBe(true);
  });

  it('自己変更・管理者昇格・時間外・短時間集中昇格の理由を返す', () => {
    const reasons = buildRoleChangeReasons({
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      fromRole: UserRole.MANAGER,
      toRole: UserRole.ADMIN,
      now: new Date(2026, 2, 12, 21, 0, 0),
      businessHourStart: 8,
      businessHourEnd: 20,
      bulkPromotionThreshold: 3,
      bulkPromotionWindowMinutes: 60,
      recentAdminPromotionCount: 3,
    });

    expect(reasons).toEqual([
      'self-role-change',
      'promotion-to-admin',
      'outside-business-hours',
      'bulk-promotion-3-within-60m',
    ]);
  });

  it('昇格閾値未満ならbulk理由を返さない', () => {
    const reasons = buildRoleChangeReasons({
      actorUserId: 'admin-1',
      targetUserId: 'user-2',
      fromRole: UserRole.VIEWER,
      toRole: UserRole.ADMIN,
      now: new Date(2026, 2, 12, 10, 0, 0),
      businessHourStart: 8,
      businessHourEnd: 20,
      bulkPromotionThreshold: 3,
      bulkPromotionWindowMinutes: 60,
      recentAdminPromotionCount: 2,
    });

    expect(reasons).toEqual(['promotion-to-admin']);
  });
});
