import { Prisma, type MeasuringInstrumentStatus } from '@prisma/client';
import { TORQUE_WRENCH_STORAGE_LOCATIONS, type TorqueWrenchStorageLocation } from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { TorqueUnitConverter } from './torque-unit-converter.js';
import { normalizeFastenerText, normalizeTorqueWrenchKey } from './torque-wrench-normalization.js';

const profileInclude = {
  measuringInstrument: true,
  model: true,
  settingHistories: {
    orderBy: [{ effectiveAt: 'desc' as const }, { createdAt: 'desc' as const }]
  }
} satisfies Prisma.TorqueWrenchProfileInclude;

const capabilityGroupInclude = {
  models: {
    include: { model: true },
    orderBy: { createdAt: 'asc' as const }
  }
} satisfies Prisma.TorqueWrenchCapabilityGroupInclude;

export type TorqueWrenchModelInput = {
  manufacturer: string;
  modelNumber: string;
  torqueMinNm: Prisma.Decimal.Value;
  torqueMaxNm: Prisma.Decimal.Value;
  resolutionNm?: Prisma.Decimal.Value | null;
  communicationType?: string;
  outputProfile?: string | null;
  isActive?: boolean;
};

export type TorqueWrenchProfileInput = {
  name: string;
  managementNumber: string;
  modelId: string;
  serialNumber: string;
  storageLocation: TorqueWrenchStorageLocation;
  calibrationExpiryDate?: Date | null;
  status?: MeasuringInstrumentStatus;
};

export type TorqueWrenchCapabilityGroupInput = {
  name: string;
  nominalDiameter: string;
  boltLengthMm: Prisma.Decimal.Value;
  material: string;
  strengthClass: string;
  modelIds: string[];
  isActive?: boolean;
};

export type TorqueWrenchSettingInput = {
  lowerLimit: Prisma.Decimal.Value;
  nominalTorque: Prisma.Decimal.Value;
  upperLimit: Prisma.Decimal.Value;
  unit: string;
  effectiveAt?: Date;
  reason?: string | null;
  actorUserId?: string | null;
  actorUsername?: string | null;
};

function required(value: string, label: string, max: number): string {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) throw new ApiError(400, `${label}が必要です`);
  return normalized.slice(0, max);
}

function assertRange(lower: Prisma.Decimal, nominal: Prisma.Decimal, upper: Prisma.Decimal): void {
  if (lower.gt(nominal) || nominal.gt(upper)) {
    throw new ApiError(400, '下限値 ≤ 規定値 ≤ 上限値となるよう設定してください');
  }
}

function assertStorageLocation(value: string): asserts value is TorqueWrenchStorageLocation {
  if (!(TORQUE_WRENCH_STORAGE_LOCATIONS as readonly string[]).includes(value)) {
    throw new ApiError(400, '保管場所が許可された選択肢ではありません');
  }
}

export class TorqueWrenchMasterService {
  listModels(includeInactive = false) {
    return prisma.torqueWrenchModel.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ manufacturer: 'asc' }, { modelNumber: 'asc' }]
    });
  }

  getModel(id: string) {
    return prisma.torqueWrenchModel.findUnique({ where: { id } });
  }

  async createModel(input: TorqueWrenchModelInput) {
    const manufacturer = required(input.manufacturer, 'メーカー', 120);
    const modelNumber = required(input.modelNumber, '型番', 120);
    const torqueMinNm = new Prisma.Decimal(input.torqueMinNm);
    const torqueMaxNm = new Prisma.Decimal(input.torqueMaxNm);
    if (torqueMinNm.isNegative() || torqueMaxNm.lte(torqueMinNm)) {
      throw new ApiError(400, '測定可能最大トルクは最小トルクより大きい値にしてください');
    }
    return prisma.torqueWrenchModel.create({
      data: {
        manufacturer,
        manufacturerKey: normalizeTorqueWrenchKey(manufacturer),
        modelNumber,
        modelNumberKey: normalizeTorqueWrenchKey(modelNumber),
        torqueMinNm,
        torqueMaxNm,
        resolutionNm: input.resolutionNm == null ? null : new Prisma.Decimal(input.resolutionNm),
        communicationType: required(input.communicationType ?? 'BLUETOOTH_HOGP', '通信方式', 80),
        outputProfile: input.outputProfile?.trim().slice(0, 120) || null,
        isActive: input.isActive ?? true
      }
    });
  }

  async updateModel(id: string, input: Partial<TorqueWrenchModelInput>) {
    const current = await prisma.torqueWrenchModel.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, 'トルクレンチ型番が見つかりません');
    const manufacturer = input.manufacturer == null ? current.manufacturer : required(input.manufacturer, 'メーカー', 120);
    const modelNumber = input.modelNumber == null ? current.modelNumber : required(input.modelNumber, '型番', 120);
    const torqueMinNm = input.torqueMinNm == null ? current.torqueMinNm : new Prisma.Decimal(input.torqueMinNm);
    const torqueMaxNm = input.torqueMaxNm == null ? current.torqueMaxNm : new Prisma.Decimal(input.torqueMaxNm);
    if (torqueMinNm.isNegative() || torqueMaxNm.lte(torqueMinNm)) {
      throw new ApiError(400, '測定可能最大トルクは最小トルクより大きい値にしてください');
    }
    return prisma.torqueWrenchModel.update({
      where: { id },
      data: {
        manufacturer,
        manufacturerKey: normalizeTorqueWrenchKey(manufacturer),
        modelNumber,
        modelNumberKey: normalizeTorqueWrenchKey(modelNumber),
        torqueMinNm,
        torqueMaxNm,
        ...(input.resolutionNm !== undefined
          ? { resolutionNm: input.resolutionNm == null ? null : new Prisma.Decimal(input.resolutionNm) }
          : {}),
        ...(input.communicationType !== undefined
          ? { communicationType: required(input.communicationType, '通信方式', 80) }
          : {}),
        ...(input.outputProfile !== undefined ? { outputProfile: input.outputProfile?.trim().slice(0, 120) || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });
  }

  listProfiles(includeRetired = false) {
    return prisma.torqueWrenchProfile.findMany({
      where: includeRetired ? undefined : { measuringInstrument: { status: { not: 'RETIRED' } } },
      include: profileInclude,
      orderBy: [{ serialNumberKey: 'asc' }]
    });
  }

  getProfile(id: string) {
    return prisma.torqueWrenchProfile.findUnique({ where: { id }, include: profileInclude });
  }

  async createProfile(input: TorqueWrenchProfileInput) {
    assertStorageLocation(input.storageLocation);
    const serialNumber = required(input.serialNumber, '製造番号', 120);
    const model = await prisma.torqueWrenchModel.findFirst({ where: { id: input.modelId, isActive: true } });
    if (!model) throw new ApiError(400, '有効なトルクレンチ型番を指定してください');
    return prisma.$transaction(async (tx) => {
      const instrument = await tx.measuringInstrument.create({
        data: {
          name: required(input.name, '名称', 200),
          managementNumber: required(input.managementNumber, '管理番号', 120),
          storageLocation: input.storageLocation,
          calibrationExpiryDate: input.calibrationExpiryDate ?? null,
          measurementRange: `${model.torqueMinNm.toString()}–${model.torqueMaxNm.toString()} N·m`,
          status: input.status ?? 'AVAILABLE'
        }
      });
      return tx.torqueWrenchProfile.create({
        data: {
          measuringInstrumentId: instrument.id,
          modelId: model.id,
          serialNumber,
          serialNumberKey: normalizeTorqueWrenchKey(serialNumber)
        },
        include: profileInclude
      });
    });
  }

  async updateProfile(id: string, input: Partial<TorqueWrenchProfileInput>) {
    const current = await prisma.torqueWrenchProfile.findUnique({ where: { id }, include: { measuringInstrument: true } });
    if (!current) throw new ApiError(404, '物理トルクレンチが見つかりません');
    if (input.storageLocation !== undefined) assertStorageLocation(input.storageLocation);
    if (input.modelId) {
      const model = await prisma.torqueWrenchModel.findFirst({ where: { id: input.modelId, isActive: true } });
      if (!model) throw new ApiError(400, '有効なトルクレンチ型番を指定してください');
    }
    return prisma.$transaction(async (tx) => {
      await tx.measuringInstrument.update({
        where: { id: current.measuringInstrumentId },
        data: {
          ...(input.name !== undefined ? { name: required(input.name, '名称', 200) } : {}),
          ...(input.managementNumber !== undefined
            ? { managementNumber: required(input.managementNumber, '管理番号', 120) }
            : {}),
          ...(input.storageLocation !== undefined ? { storageLocation: input.storageLocation } : {}),
          ...(input.calibrationExpiryDate !== undefined ? { calibrationExpiryDate: input.calibrationExpiryDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {})
        }
      });
      const serialNumber = input.serialNumber === undefined ? current.serialNumber : required(input.serialNumber, '製造番号', 120);
      return tx.torqueWrenchProfile.update({
        where: { id },
        data: {
          ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
          serialNumber,
          serialNumberKey: normalizeTorqueWrenchKey(serialNumber)
        },
        include: profileInclude
      });
    });
  }

  async addSetting(profileId: string, input: TorqueWrenchSettingInput) {
    const profile = await prisma.torqueWrenchProfile.findUnique({ where: { id: profileId }, include: { model: true } });
    if (!profile) throw new ApiError(404, '物理トルクレンチが見つかりません');
    const lowerLimit = new Prisma.Decimal(input.lowerLimit);
    const nominalTorque = new Prisma.Decimal(input.nominalTorque);
    const upperLimit = new Prisma.Decimal(input.upperLimit);
    assertRange(lowerLimit, nominalTorque, upperLimit);
    const lowerLimitNm = TorqueUnitConverter.toNewtonMetres(lowerLimit, input.unit);
    const nominalTorqueNm = TorqueUnitConverter.toNewtonMetres(nominalTorque, input.unit);
    const upperLimitNm = TorqueUnitConverter.toNewtonMetres(upperLimit, input.unit);
    if (profile.model.torqueMinNm.gt(lowerLimitNm) || profile.model.torqueMaxNm.lt(upperLimitNm)) {
      throw new ApiError(400, '設定値が型番の測定可能範囲外です');
    }
    const effectiveAt = input.effectiveAt ?? new Date();
    if (effectiveAt.getTime() > Date.now()) {
      throw new ApiError(400, '適用日時に未来の日時は指定できません');
    }
    return prisma.torqueWrenchSettingHistory.create({
      data: {
        torqueWrenchProfileId: profileId,
        lowerLimit,
        nominalTorque,
        upperLimit,
        unit: TorqueUnitConverter.canonicalUnit(input.unit),
        lowerLimitNm,
        nominalTorqueNm,
        upperLimitNm,
        effectiveAt,
        actorUserId: input.actorUserId ?? null,
        actorUsername: input.actorUsername?.slice(0, 120) ?? null,
        reason: input.reason?.trim().slice(0, 500) || null
      }
    });
  }

  listCapabilityGroups(includeInactive = false) {
    return prisma.torqueWrenchCapabilityGroup.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: capabilityGroupInclude,
      orderBy: [{ nominalDiameter: 'asc' }, { boltLengthMm: 'asc' }, { name: 'asc' }]
    });
  }

  findCompatibleCapabilityGroups(input: {
    nominalDiameter: string;
    boltLengthMm?: Prisma.Decimal.Value;
    material?: string;
    strengthClass?: string;
  }) {
    return prisma.torqueWrenchCapabilityGroup.findMany({
      where: {
        isActive: true,
        nominalDiameter: normalizeFastenerText(input.nominalDiameter),
        ...(input.boltLengthMm !== undefined ? { boltLengthMm: new Prisma.Decimal(input.boltLengthMm) } : {}),
        ...(input.material ? { material: normalizeFastenerText(input.material) } : {}),
        ...(input.strengthClass ? { strengthClass: normalizeFastenerText(input.strengthClass) } : {})
      },
      include: capabilityGroupInclude,
      orderBy: { name: 'asc' }
    });
  }

  async createCapabilityGroup(input: TorqueWrenchCapabilityGroupInput) {
    const modelIds = [...new Set(input.modelIds)];
    if (modelIds.length === 0) throw new ApiError(400, '適合する型番を1件以上指定してください');
    const modelCount = await prisma.torqueWrenchModel.count({ where: { id: { in: modelIds }, isActive: true } });
    if (modelCount !== modelIds.length) throw new ApiError(400, '無効または存在しない型番が含まれています');
    return prisma.torqueWrenchCapabilityGroup.create({
      data: {
        name: required(input.name, '適合グループ名', 200),
        nominalDiameter: normalizeFastenerText(required(input.nominalDiameter, '呼び径', 40)),
        boltLengthMm: new Prisma.Decimal(input.boltLengthMm),
        material: normalizeFastenerText(required(input.material, '材質', 80)),
        strengthClass: normalizeFastenerText(required(input.strengthClass, '強度区分', 80)),
        isActive: input.isActive ?? true,
        models: { create: modelIds.map((modelId) => ({ modelId })) }
      },
      include: capabilityGroupInclude
    });
  }

  async updateCapabilityGroup(id: string, input: Partial<TorqueWrenchCapabilityGroupInput>) {
    const current = await prisma.torqueWrenchCapabilityGroup.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, '適合グループが見つかりません');
    const modelIds = input.modelIds ? [...new Set(input.modelIds)] : null;
    if (modelIds) {
      if (modelIds.length === 0) throw new ApiError(400, '適合する型番を1件以上指定してください');
      const count = await prisma.torqueWrenchModel.count({ where: { id: { in: modelIds }, isActive: true } });
      if (count !== modelIds.length) throw new ApiError(400, '無効または存在しない型番が含まれています');
    }
    return prisma.$transaction(async (tx) => {
      if (modelIds) {
        await tx.torqueWrenchCapabilityGroupModel.deleteMany({ where: { capabilityGroupId: id } });
      }
      return tx.torqueWrenchCapabilityGroup.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: required(input.name, '適合グループ名', 200) } : {}),
          ...(input.nominalDiameter !== undefined
            ? { nominalDiameter: normalizeFastenerText(required(input.nominalDiameter, '呼び径', 40)) }
            : {}),
          ...(input.boltLengthMm !== undefined ? { boltLengthMm: new Prisma.Decimal(input.boltLengthMm) } : {}),
          ...(input.material !== undefined ? { material: normalizeFastenerText(required(input.material, '材質', 80)) } : {}),
          ...(input.strengthClass !== undefined
            ? { strengthClass: normalizeFastenerText(required(input.strengthClass, '強度区分', 80)) }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(modelIds ? { models: { create: modelIds.map((modelId) => ({ modelId })) } } : {})
        },
        include: capabilityGroupInclude
      });
    });
  }
}
