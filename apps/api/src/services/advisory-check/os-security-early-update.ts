import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { OsSecurityUpdateRequest, OsSecurityUpdateTarget, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { logger } from '../../lib/logger.js';
import { loadHeartbeatAlertConfig } from '../clients/client-heartbeat-alert-policy.js';
import { loadMonitoredHeartbeatClients } from '../clients/client-heartbeat-monitor.js';
import { deliverSystemNotice } from '../kiosk-inquiry/system-notice.service.js';
import { allInstalledVersionsFixed } from './advisory-versions.js';

const packageName = z.string().regex(/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?$/);
const measurement = z.object({
  state: z.enum(['installed', 'absent', 'unmeasured']),
  version: z.string().nullable(),
});
const finishedMeasurement = measurement.extend({ candidateRemaining: z.boolean().nullable() });
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const requestId = z.string().min(1);
export const osSecurityUpdateReportSchema = z.object({
  earlyEnabled: z.boolean(),
  requests: z.array(z.object({
    id: requestId,
    receivedAt: timestamp,
    baseline: z.record(packageName, measurement),
  })),
  check: z.object({
    requestIds: z.array(requestId),
    result: z.enum(['applied', 'no_candidates', 'failed']),
    finishedAt: timestamp,
    packages: z.record(packageName, finishedMeasurement),
  }).nullable(),
});
export type OsSecurityUpdateReport = z.infer<typeof osSecurityUpdateReportSchema>;

const productsSchema = z.record(z.string(), z.object({
  packages: z.array(packageName).min(1),
  comparable: z.boolean(),
  fixedVersion: z.string().nullable(),
}));
export type OsSecurityUpdateProduct = z.infer<typeof productsSchema>[string];

const REQUEST_DURATION_MS = 14 * 24 * 60 * 60_000;

export async function createOsSecurityUpdateRequest(input: {
  noticeKey: string;
  title: string;
  url: string;
  products: Record<string, OsSecurityUpdateProduct>;
}, now: Date) {
  const advisoryKey = input.noticeKey;
  const existing = await prisma.osSecurityUpdateRequest.findUnique({ where: { advisoryKey }, select: { mode: true } });
  if (existing) return existing.mode;

  const heartbeatConfig = loadHeartbeatAlertConfig();
  const reports = await prisma.osSecurityUpdateClientReport.findMany({
    where: { earlyEnabled: true, receivedAt: { gte: new Date(now.getTime() - heartbeatConfig.staleAfterMs) } },
    select: { clientId: true },
  });
  if (reports.length === 0) return undefined;
  const { monitored } = await loadMonitoredHeartbeatClients(now, heartbeatConfig);
  const clients = reports.map(row => row.clientId).filter(clientId => monitored.has(clientId));
  if (clients.length === 0) return undefined;

  const products = productsSchema.parse(input.products);
  const packages = [...new Set(Object.values(products).flatMap(product => product.packages))];
  const id = randomUUID();
  const mode = clients.length === monitored.size ? 'auto' : 'trial';
  return prisma.$transaction(async tx => {
    const created = await tx.osSecurityUpdateRequest.createMany({
      data: { ...input, products, id, advisoryKey, packages, mode, createdAt: now,
        expiresAt: new Date(now.getTime() + REQUEST_DURATION_MS) },
      skipDuplicates: true,
    });
    if (created.count === 0) {
      const winner = await tx.osSecurityUpdateRequest.findUniqueOrThrow({ where: { advisoryKey }, select: { mode: true } });
      return winner.mode;
    }
    await tx.osSecurityUpdateTarget.createMany({
      data: clients.map(clientId => ({ requestId: id, clientId, detail: { reason: 'awaiting_check' } })),
    });
    return mode;
  });
}

function evaluateTarget(target: OsSecurityUpdateTarget, products: Prisma.JsonValue, report: OsSecurityUpdateReport) {
  const { check } = report;
  if (!check || !target.deliveredAt || !check.requestIds.includes(target.requestId)
    || Date.parse(check.finishedAt) < target.deliveredAt.getTime()) return;
  if (check.result === 'failed') return { state: 'failed', detail: { reason: 'update_failed' } } as const;

  const baseline = report.requests.find(request => request.id === target.requestId)?.baseline;
  const entries = Object.entries(productsSchema.parse(products));
  if (entries.length === 0) return;
  for (const [product, { packages, fixedVersion, comparable }] of entries) {
    for (const name of packages) {
      const after = check.packages[name];
      const before = baseline?.[name];
      if (after?.state === 'absent') continue;
      if (after?.state !== 'installed' || !after.version) {
        return { state: 'pending', detail: { reason: 'unmeasured', product, package: name } } as const;
      }
      if (comparable && fixedVersion !== null) {
        if (allInstalledVersionsFixed([`${name}=${after.version}`], [fixedVersion])) continue;
        return { state: 'pending', detail: { reason: 'fixed_version_not_confirmed', product, package: name } } as const;
      }
      if (before?.state === 'installed' && before.version && before.version !== after.version
        && after.candidateRemaining === false) continue;
      return { state: 'pending', detail: { reason: 'changed_version_not_confirmed', product, package: name } } as const;
    }
  }
  return { state: 'verified', detail: { reason: 'packages_verified' } } as const;
}

export async function recordOsSecurityUpdateReport(clientId: string, report: OsSecurityUpdateReport, receivedAt: Date) {
  return prisma.$transaction(async tx => {
    const saved = { clientId, earlyEnabled: report.earlyEnabled, report, receivedAt };
    const inserted = await tx.osSecurityUpdateClientReport.createMany({ data: saved, skipDuplicates: true });
    if (inserted.count === 0) {
      const updated = await tx.osSecurityUpdateClientReport.updateMany({
        where: { clientId, receivedAt: { lte: receivedAt } }, data: saved,
      });
      if (updated.count === 0) return;
    }

    const targets = await tx.osSecurityUpdateTarget.findMany({
      where: { clientId, request: { status: 'open', expiresAt: { gte: receivedAt } } },
      include: { request: true },
    });
    const unresolved = [];
    for (const target of targets) {
      if (target.state !== 'pending' && target.state !== 'failed') continue;
      const evaluation = evaluateTarget(target, target.request.products, report);
      if (evaluation && (evaluation.state !== target.state || !isDeepStrictEqual(evaluation.detail, target.detail))) {
        const updated = await tx.osSecurityUpdateTarget.updateMany({
          where: { clientId, requestId: target.requestId, state: target.state, request: { status: 'open' } },
          data: { ...evaluation, ...(evaluation.state === 'verified' ? { verifiedAt: receivedAt } : {}) },
        });
        if (updated.count === 0 || evaluation.state === 'verified') continue;
      }
      unresolved.push(target);
    }

    if (!report.earlyEnabled) return;
    const deliveredAt = new Date();
    const deliverable = unresolved.filter(({ request }) => request.expiresAt >= deliveredAt);
    const firstDelivery = deliverable.filter(target => target.deliveredAt === null);
    if (firstDelivery.length > 0) {
      await tx.osSecurityUpdateTarget.updateMany({
        where: { clientId, deliveredAt: null, requestId: { in: firstDelivery.map(target => target.requestId) } },
        data: { deliveredAt },
      });
    }
    return deliverable.map(({ request }) => ({
      id: request.id, packages: request.packages, expiresAt: request.expiresAt.toISOString(),
    }));
  });
}

function describeClientNames(targets: OsSecurityUpdateTarget[], names: Map<string | null, string>) {
  return targets.map(({ clientId }) => names.get(clientId) ?? clientId).join('、');
}

async function notifyUnverifiedRequest(
  tx: Prisma.TransactionClient,
  request: OsSecurityUpdateRequest,
  targets: OsSecurityUpdateTarget[],
  now: Date,
  deliver: typeof deliverSystemNotice,
) {
  const devices = await tx.clientDevice.findMany({
    where: { statusClientId: { in: targets.map(target => target.clientId) } },
    select: { statusClientId: true, name: true },
  });
  const names = new Map(devices.map(device => [device.statusClientId, device.name]));
  const failed = targets.filter(target => target.state === 'failed');
  const reason = failed.length > 0
    ? `更新に失敗した端末: ${describeClientNames(failed, names)}`
    : `期限までに確かめられなかった端末: ${describeClientNames(targets, names)}。修正版の配布待ちの可能性があります。`;
  await deliver({
    key: request.noticeKey, state: 'open', title: 'JPCERT 注意喚起: OS セキュリティ更新',
    body: `要対応: OS セキュリティ更新を確認してください。\n${reason}\n${request.title}\n${request.url}`,
    once: true,
  }, now, tx);
}

export async function sweepOsSecurityUpdateRequests(now: Date, deliver: typeof deliverSystemNotice, log: Pick<typeof logger, 'warn'>) {
  try {
    const requests = await prisma.osSecurityUpdateRequest.findMany({
      where: { status: 'open' }, include: { targets: true },
    });
    for (const request of requests) {
      const unverified = request.targets.filter(target => target.state !== 'verified');
      const verified = request.targets.length > 0 && unverified.length === 0;
      const expired = now > request.expiresAt;
      const failed = request.mode === 'auto' && unverified.some(target => target.state === 'failed');
      if (!verified && !expired && !failed) continue;

      try {
        await prisma.$transaction(async tx => {
          const changed = await tx.osSecurityUpdateRequest.updateMany({
            where: { id: request.id, status: 'open',
              ...(verified ? { targets: { every: { state: 'verified' } } } : {
                targets: { some: { state: failed ? 'failed' : { not: 'verified' } } },
              }) },
            data: { status: verified ? 'verified' : 'notified', resolvedAt: now },
          });
          if (changed.count === 1 && request.mode === 'auto' && !verified) {
            await notifyUnverifiedRequest(tx, request, unverified, now, deliver);
          }
        });
      } catch (error) {
        log.warn({ requestId: request.id, error: error instanceof Error ? error.name : 'unknown' },
          'OS security update request resolution failed');
      }
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'OS security update request sweep failed');
  }
}
