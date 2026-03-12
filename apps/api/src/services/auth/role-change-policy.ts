import { UserRole } from '@prisma/client';

export type RoleChangeReasonContext = {
  actorUserId: string;
  targetUserId: string;
  fromRole: UserRole;
  toRole: UserRole;
  now: Date;
  businessHourStart: number;
  businessHourEnd: number;
  bulkPromotionWindowMinutes: number;
  bulkPromotionThreshold: number;
  recentAdminPromotionCount: number;
};

export function isOutsideBusinessHours(now: Date, businessHourStart: number, businessHourEnd: number): boolean {
  const hour = now.getHours();
  return hour < businessHourStart || hour >= businessHourEnd;
}

export function buildRoleChangeReasons(context: RoleChangeReasonContext): string[] {
  const reasons: string[] = [];

  if (context.actorUserId === context.targetUserId) {
    reasons.push('self-role-change');
  }

  if (context.fromRole !== UserRole.ADMIN && context.toRole === UserRole.ADMIN) {
    reasons.push('promotion-to-admin');
  }

  if (isOutsideBusinessHours(context.now, context.businessHourStart, context.businessHourEnd)) {
    reasons.push('outside-business-hours');
  }

  if (
    context.toRole === UserRole.ADMIN &&
    context.bulkPromotionThreshold > 0 &&
    context.bulkPromotionWindowMinutes > 0 &&
    context.recentAdminPromotionCount >= context.bulkPromotionThreshold
  ) {
    reasons.push(
      `bulk-promotion-${context.recentAdminPromotionCount}-within-${context.bulkPromotionWindowMinutes}m`
    );
  }

  return reasons;
}
