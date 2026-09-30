import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { summarizeTrainingAttempts } from './torque-training.policy.js';

/** Number of completed sessions, across every operator, in the "recent" window. */
export const TEAM_RECENT_SESSION_LIMIT = 10;

export type TorqueTrainingTeamSummary = {
  sessionCount: number;
  operatorCount: number;
  attemptCount: number;
  /** Null while no accepted attempt exists, so the kiosk can show "no data". */
  passRate: number | null;
  meanAbsoluteErrorPercent: number | null;
  meanDeviationPercent: number | null;
};

export type TorqueTrainingTeamRecentSession = {
  sessionId: string;
  completedAt: string | null;
  employeeName: string;
  trainingName: string;
  targetBolt: string;
  material: string;
  judgements: Array<'OK' | 'UNDER' | 'OVER'>;
};

type AllTimeRow = {
  sessionCount: number;
  operatorCount: number;
  attemptCount: number;
  okCount: number;
  meanAbsoluteErrorPercent: number | null;
  meanDeviationPercent: number | null;
};

/**
 * Kiosk-wide training KPIs that do not depend on the operator who tapped a
 * tag. Excluded and unfinished sessions never count, matching operator metrics.
 */
export class TorqueTrainingTeamSummaryService {
  async summary() {
    const [recentRows, allTimeRows] = await Promise.all([
      prisma.torqueTrainingSession.findMany({
        where: { status: 'COMPLETED', excludedAt: null },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: TEAM_RECENT_SESSION_LIMIT,
        include: {
          attempts: { orderBy: [{ attemptNo: 'asc' }, { recordedAt: 'asc' }] },
          programVersion: { select: { displayName: true, nominalDiameter: true, material: true } }
        }
      }),
      // All-time figures stay in PostgreSQL so the kiosk never loads every attempt.
      prisma.$queryRaw<AllTimeRow[]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT s."id")::int AS "sessionCount",
          COUNT(DISTINCT s."employeeId")::int AS "operatorCount",
          COUNT(a."id")::int AS "attemptCount",
          (COUNT(a."id") FILTER (WHERE a."judgement" = 'OK'))::int AS "okCount",
          AVG(a."absoluteDeviationPercent")::float8 AS "meanAbsoluteErrorPercent",
          AVG(a."deviationPercent")::float8 AS "meanDeviationPercent"
        FROM "TorqueTrainingSession" s
        LEFT JOIN "TorqueTrainingAttempt" a
          ON a."sessionId" = s."id"
          AND a."accepted" = true
          AND a."deviationPercent" IS NOT NULL
        WHERE s."status" = 'COMPLETED'
          AND s."excludedAt" IS NULL
      `)
    ]);

    const recentAttempts = recentRows.flatMap((session) => session.attempts);
    const recentMetric = summarizeTrainingAttempts(recentAttempts);
    const recent: TorqueTrainingTeamSummary = {
      sessionCount: recentRows.length,
      operatorCount: new Set(recentRows.map((session) => session.employeeId)).size,
      attemptCount: recentMetric.attemptCount,
      passRate: recentMetric.attemptCount > 0 ? recentMetric.passRate : null,
      meanAbsoluteErrorPercent: recentMetric.attemptCount > 0 ? recentMetric.meanAbsoluteErrorPercent : null,
      meanDeviationPercent: recentMetric.attemptCount > 0 ? recentMetric.meanDeviationPercent : null
    };

    const row = allTimeRows[0];
    const allTime: TorqueTrainingTeamSummary = {
      sessionCount: row?.sessionCount ?? 0,
      operatorCount: row?.operatorCount ?? 0,
      attemptCount: row?.attemptCount ?? 0,
      passRate: row && row.attemptCount > 0 ? row.okCount / row.attemptCount : null,
      meanAbsoluteErrorPercent: row?.meanAbsoluteErrorPercent ?? null,
      meanDeviationPercent: row?.meanDeviationPercent ?? null
    };

    const recentSessions: TorqueTrainingTeamRecentSession[] = recentRows.map((session) => ({
      sessionId: session.id,
      completedAt: session.completedAt?.toISOString() ?? null,
      employeeName: session.employeeNameSnapshot,
      trainingName: session.programVersion.displayName,
      targetBolt: session.programVersion.nominalDiameter,
      material: session.programVersion.material,
      judgements: session.attempts
        .filter((attempt) => attempt.accepted && attempt.judgement !== 'IGNORED')
        .map((attempt) => attempt.judgement as 'OK' | 'UNDER' | 'OVER')
    }));

    return { recent, allTime, recentSessions };
  }
}
