import { z } from 'zod';

import { prisma } from '../../../lib/prisma.js';
import { resolveSiteKeyForScopeKey } from '../../../lib/site-directory.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { SHARED_LOAD_BALANCING_SITE_KEY } from './load-balancing-settings-merge.js';

const minutes = z.number().finite().min(0).max(100_000_000).nullable();
const orderKey = z.enum(['due', 'minutes', 'vendor']);
export const outsourceSettingsSchema = z.object({
  namedTargets: z.array(z.object({
    kind: z.enum(['machine', 'seiban', 'part']),
    key: z.string().trim().min(1),
    vendorId: z.string().trim().min(1).max(100)
  })).max(5000).default([]),
  mode: z.enum(['process', 'part']),
  order: z.array(orderKey).length(3).refine((keys) => new Set(keys).size === 3, '候補の順番が重複しています'),
  vendors: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    priority: z.number().int().min(1).max(9999),
    monthlyCapacityMinutes: minutes,
    conditions: z.array(z.object({
      resourceCds: z.array(z.string().trim().min(1).max(20).transform((code) => code.toUpperCase())).max(1000),
      partPrefix: z.string().trim().max(200),
      partName: z.string().trim().max(200),
      maxMinutes: minutes
    })).max(1000)
  })).max(1000).refine((vendors) => new Set(vendors.map((vendor) => vendor.id)).size === vendors.length, '業者IDが重複しています')
}).superRefine((settings, ctx) => {
  const vendors = new Set(settings.vendors.map((vendor) => vendor.id));
  const seen = new Set<string>();
  settings.namedTargets.forEach((target, index) => {
    if (!vendors.has(target.vendorId)) ctx.addIssue({ code: 'custom', path: ['namedTargets', index, 'vendorId'], message: '名指しの業者が存在しません' });
    const identity = JSON.stringify([target.kind, target.key]);
    if (seen.has(identity)) ctx.addIssue({ code: 'custom', path: ['namedTargets', index], message: '名指しが重複しています' });
    seen.add(identity);
  });
});

export type LoadBalancingOutsourceSettings = z.infer<typeof outsourceSettingsSchema>;
export const DEFAULT_OUTSOURCE_SETTINGS: LoadBalancingOutsourceSettings = {
  mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [], namedTargets: []
};

/** A saved site snapshot is authoritative, including an intentionally empty vendor list. */
export async function getLoadBalancingOutsourceSettings(siteKeyInput: string): Promise<LoadBalancingOutsourceSettings> {
  const siteKey = resolveSiteKeyForScopeKey(siteKeyInput.trim());
  const read = (key: string) => prisma.productionScheduleOutsourceConfig.findUnique({
    where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: key } },
    include: { namedTargets: { orderBy: { position: 'asc' } }, vendors: { orderBy: [{ priority: 'asc' }, { vendorId: 'asc' }], include: { conditions: { orderBy: { position: 'asc' } } } } }
  });
  const site = await read(siteKey);
  const config = site ?? (siteKey === SHARED_LOAD_BALANCING_SITE_KEY ? null : await read(SHARED_LOAD_BALANCING_SITE_KEY));
  if (!config) return structuredClone(DEFAULT_OUTSOURCE_SETTINGS);
  return outsourceSettingsSchema.parse({
    mode: config.mode, order: config.order,
    namedTargets: config.namedTargets.map(({ kind, key, vendorId }) => ({ kind, key, vendorId })),
    vendors: config.vendors.map((vendor) => ({
      id: vendor.vendorId, name: vendor.name, priority: vendor.priority,
      monthlyCapacityMinutes: vendor.monthlyCapacityMinutes,
      conditions: vendor.conditions.map((condition) => ({
        resourceCds: condition.resourceCds, partPrefix: condition.partPrefix,
        partName: condition.partName, maxMinutes: condition.maxMinutes
      }))
    }))
  });
}

export async function saveLoadBalancingOutsourceSettings(siteKeyInput: string, input: LoadBalancingOutsourceSettings) {
  const settings = outsourceSettingsSchema.parse(input);
  const siteKey = resolveSiteKeyForScopeKey(siteKeyInput.trim());
  await prisma.$transaction(async (tx) => {
    const config = await tx.productionScheduleOutsourceConfig.upsert({
      where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } },
      create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, mode: settings.mode, order: settings.order },
      update: { mode: settings.mode, order: settings.order }
    });
    await tx.productionScheduleOutsourceNamedTarget.deleteMany({ where: { configId: config.id } });
    await tx.productionScheduleOutsourceVendor.deleteMany({ where: { configId: config.id } });
    for (const vendor of settings.vendors) {
      await tx.productionScheduleOutsourceVendor.create({ data: {
        configId: config.id, vendorId: vendor.id, name: vendor.name, priority: vendor.priority,
        monthlyCapacityMinutes: vendor.monthlyCapacityMinutes,
        conditions: { create: vendor.conditions.map((condition, position) => ({ ...condition, position })) }
      } });
    }
    for (const [position, target] of settings.namedTargets.entries()) {
      await tx.productionScheduleOutsourceNamedTarget.create({ data: { ...target, configId: config.id, position } });
    }
  });
  return getLoadBalancingOutsourceSettings(siteKey);
}
