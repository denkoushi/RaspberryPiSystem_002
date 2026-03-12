import { UserRole } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { RoleChangeAlertService } from './role-change-alert.service.js';
import { buildRoleChangeReasons } from './role-change-policy.js';

type RoleTargetUser = {
  id: string;
  username: string;
  role: UserRole;
  mfaEnabled: boolean;
};

type RoleUpdatedUser = RoleTargetUser;

type RoleActorUser = {
  id: string;
  username?: string;
};

type AuthRoleAdminPrismaPort = {
  user: {
    findUnique: (args: { where: { id: string } }) => Promise<RoleTargetUser | null>;
  };
  roleAuditLog: {
    count: (args: { where: { toRole: UserRole; createdAt: { gte: Date } } }) => Promise<number>;
  };
  $transaction: <T>(fn: (tx: {
    user: {
      update: (args: { where: { id: string }; data: { role: UserRole } }) => Promise<RoleUpdatedUser>;
    };
    roleAuditLog: {
      create: (args: {
        data: { actorUserId: string; targetUserId: string; fromRole: UserRole; toRole: UserRole };
      }) => Promise<unknown>;
    };
  }) => Promise<T>) => Promise<T>;
};

type RoleChangeAlertPort = {
  emitRoleChangeAlert: (input: {
    actorUserId: string;
    actorUsername?: string;
    targetUserId: string;
    targetUsername: string;
    fromRole: UserRole;
    toRole: UserRole;
    reasons: string[];
    logger: { warn: (object: Record<string, unknown>, message: string) => void };
  }) => Promise<void>;
};

type RoleChangeAlertLogger = {
  warn: (object: Record<string, unknown>, message: string) => void;
};

type AuthRoleAdminPolicyConfig = {
  businessHourStart: number;
  businessHourEnd: number;
  bulkPromotionWindowMinutes: number;
  bulkPromotionThreshold: number;
};

const defaultPolicyConfig: AuthRoleAdminPolicyConfig = {
  businessHourStart: Number.parseInt(process.env.BUSINESS_HOUR_START ?? '8', 10),
  businessHourEnd: Number.parseInt(process.env.BUSINESS_HOUR_END ?? '20', 10),
  bulkPromotionWindowMinutes: Number.parseInt(process.env.BULK_PROMOTION_WINDOW_MINUTES ?? '60', 10),
  bulkPromotionThreshold: Number.parseInt(process.env.BULK_PROMOTION_THRESHOLD ?? '3', 10),
};

export type UpdateUserRoleInput = {
  actorUser: RoleActorUser;
  targetUserId: string;
  nextRole: UserRole;
  logger: RoleChangeAlertLogger;
};

export class AuthRoleAdminService {
  constructor(
    private readonly db: AuthRoleAdminPrismaPort = prisma,
    private readonly alertService: RoleChangeAlertPort = new RoleChangeAlertService(),
    private readonly now: () => Date = () => new Date(),
    private readonly policyConfig: AuthRoleAdminPolicyConfig = defaultPolicyConfig
  ) {}

  async updateUserRole(input: UpdateUserRoleInput): Promise<{ user: RoleUpdatedUser }> {
    const target = await this.db.user.findUnique({ where: { id: input.targetUserId } });
    if (!target) {
      throw new ApiError(404, 'ユーザーが見つかりません');
    }

    if (target.role === input.nextRole) {
      return {
        user: {
          id: target.id,
          username: target.username,
          role: target.role,
          mfaEnabled: target.mfaEnabled,
        },
      };
    }

    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: input.targetUserId },
        data: { role: input.nextRole },
      });
      await tx.roleAuditLog.create({
        data: {
          actorUserId: input.actorUser.id,
          targetUserId: input.targetUserId,
          fromRole: target.role,
          toRole: input.nextRole,
        },
      });
      return next;
    });

    const currentTime = this.now();
    const recentAdminPromotionCount = await this.countRecentAdminPromotions(currentTime, input.nextRole);
    const reasons = buildRoleChangeReasons({
      actorUserId: input.actorUser.id,
      targetUserId: input.targetUserId,
      fromRole: target.role,
      toRole: input.nextRole,
      now: currentTime,
      businessHourStart: this.policyConfig.businessHourStart,
      businessHourEnd: this.policyConfig.businessHourEnd,
      bulkPromotionWindowMinutes: this.policyConfig.bulkPromotionWindowMinutes,
      bulkPromotionThreshold: this.policyConfig.bulkPromotionThreshold,
      recentAdminPromotionCount,
    });

    if (reasons.length > 0) {
      void this.alertService.emitRoleChangeAlert({
        actorUserId: input.actorUser.id,
        actorUsername: input.actorUser.username,
        targetUserId: input.targetUserId,
        targetUsername: target.username,
        fromRole: target.role,
        toRole: input.nextRole,
        reasons,
        logger: input.logger,
      });
    }

    return {
      user: {
        id: updated.id,
        username: updated.username,
        role: updated.role,
        mfaEnabled: updated.mfaEnabled,
      },
    };
  }

  private async countRecentAdminPromotions(now: Date, nextRole: UserRole): Promise<number> {
    if (
      nextRole !== UserRole.ADMIN ||
      this.policyConfig.bulkPromotionThreshold <= 0 ||
      this.policyConfig.bulkPromotionWindowMinutes <= 0
    ) {
      return 0;
    }

    const windowStart = new Date(now.getTime() - this.policyConfig.bulkPromotionWindowMinutes * 60 * 1000);
    return this.db.roleAuditLog.count({
      where: {
        toRole: UserRole.ADMIN,
        createdAt: { gte: windowStart },
      },
    });
  }
}
