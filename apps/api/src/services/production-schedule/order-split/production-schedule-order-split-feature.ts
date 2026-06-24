import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';

const ORDER_SPLIT_PILOT_CONFIG_KEY = 'production_schedule_order_split';

let orderSplitPilotRuntimeEnabled = false;
let orderSplitPilotRuntimeLoaded = false;
let orderSplitPilotRuntimeEnabledForTest = true;

export type ProductionScheduleOrderSplitPilotStatus = {
  deploymentEnabled: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
};

function readOrderSplitEnabledFromProcessEnv(): boolean | undefined {
  const raw = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
  if (raw == null) {
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return undefined;
}

export function isProductionScheduleOrderSplitDeploymentEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') {
    const runtime = readOrderSplitEnabledFromProcessEnv();
    if (runtime !== undefined) {
      return runtime;
    }
  }
  return env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
}

function buildOrderSplitPilotStatus(params: {
  deploymentEnabled?: boolean;
  runtimeEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}): ProductionScheduleOrderSplitPilotStatus {
  const deploymentEnabled = params.deploymentEnabled ?? isProductionScheduleOrderSplitDeploymentEnabled();
  return {
    deploymentEnabled,
    runtimeEnabled: params.runtimeEnabled,
    effectiveEnabled: deploymentEnabled && params.runtimeEnabled,
    updatedAt: params.updatedAt,
    updatedBy: params.updatedBy
  };
}

function applyOrderSplitPilotRuntimeCache(enabled: boolean): void {
  orderSplitPilotRuntimeEnabled = enabled;
  orderSplitPilotRuntimeLoaded = true;
}

export async function getProductionScheduleOrderSplitPilotStatus(): Promise<ProductionScheduleOrderSplitPilotStatus> {
  if (process.env.NODE_ENV === 'test') {
    return buildOrderSplitPilotStatus({
      runtimeEnabled: orderSplitPilotRuntimeEnabledForTest,
      updatedAt: null,
      updatedBy: null
    });
  }

  const config = await prisma.productionScheduleOrderSplitPilotConfig.findUnique({
    where: { key: ORDER_SPLIT_PILOT_CONFIG_KEY },
    select: { enabled: true, updatedAt: true, updatedBy: true }
  });
  const runtimeEnabled = config?.enabled ?? false;
  applyOrderSplitPilotRuntimeCache(runtimeEnabled);
  return buildOrderSplitPilotStatus({
    runtimeEnabled,
    updatedAt: config?.updatedAt ?? null,
    updatedBy: config?.updatedBy ?? null
  });
}

export async function updateProductionScheduleOrderSplitPilotStatus(params: {
  enabled: boolean;
  updatedBy?: string | null;
}): Promise<ProductionScheduleOrderSplitPilotStatus> {
  const updated = await prisma.productionScheduleOrderSplitPilotConfig.upsert({
    where: { key: ORDER_SPLIT_PILOT_CONFIG_KEY },
    create: {
      key: ORDER_SPLIT_PILOT_CONFIG_KEY,
      enabled: params.enabled,
      updatedBy: params.updatedBy?.trim() || null
    },
    update: {
      enabled: params.enabled,
      updatedBy: params.updatedBy?.trim() || null
    },
    select: { enabled: true, updatedAt: true, updatedBy: true }
  });
  applyOrderSplitPilotRuntimeCache(updated.enabled);
  return buildOrderSplitPilotStatus({
    runtimeEnabled: updated.enabled,
    updatedAt: updated.updatedAt,
    updatedBy: updated.updatedBy
  });
}

export async function refreshProductionScheduleOrderSplitPilotGateCache(): Promise<ProductionScheduleOrderSplitPilotStatus> {
  return getProductionScheduleOrderSplitPilotStatus();
}

export function setProductionScheduleOrderSplitPilotRuntimeEnabledForTest(enabled: boolean): void {
  orderSplitPilotRuntimeEnabledForTest = enabled;
}

export function resetProductionScheduleOrderSplitPilotRuntimeEnabledForTest(): void {
  orderSplitPilotRuntimeEnabledForTest = true;
}

/** 順位ボードの分割表示・分割操作が有効か。OFF では親行のみ・分割 API は 403。 */
export function isProductionScheduleOrderSplitEnabled(): boolean {
  if (!isProductionScheduleOrderSplitDeploymentEnabled()) {
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return orderSplitPilotRuntimeEnabledForTest;
  }
  return orderSplitPilotRuntimeLoaded && orderSplitPilotRuntimeEnabled;
}
