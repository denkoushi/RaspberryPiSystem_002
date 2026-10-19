import { Prisma, type MeasuringInstrumentStatus } from '@prisma/client';
import { TORQUE_WRENCH_STORAGE_LOCATIONS, type TorqueWrenchStorageLocation } from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from '../assembly/assembly-transaction.js';
import { lockTorqueWrenchProfile } from './torque-wrench-lock.repository.js';
import { normalizeFastenerText, normalizeTorqueWrenchKey } from './torque-wrench-normalization.js';
import {
  normalizeTorqueWrenchSettingVerificationMode,
  type TorqueWrenchSettingVerificationMode
} from './torque-wrench-setting-mode.policy.js';
import {
  serializeTorqueWrenchModel,
  serializeTorqueWrenchProfile
} from './torque-wrench-serialization.js';
import {
  appendTorqueWrenchSetting,
  type TorqueWrenchSettingInput
} from './torque-wrench-setting-writer.js';

export type { TorqueWrenchSettingInput } from './torque-wrench-setting-writer.js';

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
  settingVerificationMode?: TorqueWrenchSettingVerificationMode | null;
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

function required(value: string, label: string, max: number): string {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) throw new ApiError(400, `${label}が必要です`);
  return normalized.slice(0, max);
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
    }).then((models) => models.map((model) => serializeTorqueWrenchModel(model)));
  }

  getModel(id: string) {
    return prisma.torqueWrenchModel.findUnique({ where: { id } }).then((model) =>
      model ? serializeTorqueWrenchModel(model) : null
    );
  }

  async createModel(input: TorqueWrenchModelInput) {
    const manufacturer = required(input.manufacturer, 'メーカー', 120);
    const modelNumber = required(input.modelNumber, '型番', 120);
    const torqueMinNm = new Prisma.Decimal(input.torqueMinNm);
    const torqueMaxNm = new Prisma.Decimal(input.torqueMaxNm);
    if (torqueMinNm.isNegative() || torqueMaxNm.lte(torqueMinNm)) {
      throw new ApiError(400, '測定可能最大トルクは最小トルクより大きい値にしてください');
    }
    const data = {
        manufacturer,
        manufacturerKey: normalizeTorqueWrenchKey(manufacturer),
        modelNumber,
        modelNumberKey: normalizeTorqueWrenchKey(modelNumber),
        torqueMinNm,
        torqueMaxNm,
        resolutionNm: input.resolutionNm == null ? null : new Prisma.Decimal(input.resolutionNm),
        communicationType: required(input.communicationType ?? 'BLUETOOTH_HOGP', '通信方式', 80),
        outputProfile: input.outputProfile?.trim().slice(0, 120) || null,
        settingVerificationMode: normalizeTorqueWrenchSettingVerificationMode(input.settingVerificationMode),
        isActive: input.isActive ?? true
    };
    return prisma.torqueWrenchModel.create({ data }).then((model) =>
      serializeTorqueWrenchModel(model)
    );
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
        ...(input.settingVerificationMode !== undefined
          ? { settingVerificationMode: normalizeTorqueWrenchSettingVerificationMode(input.settingVerificationMode) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    }).then((model) =>
      serializeTorqueWrenchModel(model)
    );
  }

  listProfiles(includeRetired = false) {
    return prisma.torqueWrenchProfile.findMany({
      where: includeRetired ? undefined : { measuringInstrument: { status: { not: 'RETIRED' } } },
      include: profileInclude,
      orderBy: [{ serialNumberKey: 'asc' }]
    }).then((profiles) => profiles.map((profile) => serializeTorqueWrenchProfile(profile)));
  }

  getProfile(id: string) {
    return prisma.torqueWrenchProfile.findUnique({ where: { id }, include: profileInclude }).then((profile) =>
      profile ? serializeTorqueWrenchProfile(profile) : null
    );
  }

  async createProfile(input: TorqueWrenchProfileInput) {
    assertStorageLocation(input.storageLocation);
    const serialNumber = required(input.serialNumber, '製造番号', 120);
    const model = await prisma.torqueWrenchModel.findFirst({ where: { id: input.modelId, isActive: true } });
    if (!model) throw new ApiError(400, '有効なトルクレンチ型番を指定してください');
    return runAssemblyTransaction(async (tx) => {
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
      }).then((profile) => serializeTorqueWrenchProfile(profile));
    });
  }

  async updateProfile(id: string, input: Partial<TorqueWrenchProfileInput>) {
    if (input.storageLocation !== undefined) assertStorageLocation(input.storageLocation);
    return runAssemblyTransaction(async (tx) => {
      await lockTorqueWrenchProfile(tx, id);
      const current = await tx.torqueWrenchProfile.findUnique({
        where: { id },
        include: { measuringInstrument: true }
      });
      if (!current) throw new ApiError(404, '物理トルクレンチが見つかりません');
      if (input.modelId) {
        const model = await tx.torqueWrenchModel.findFirst({
          where: { id: input.modelId, isActive: true }
        });
        if (!model) throw new ApiError(400, '有効なトルクレンチ型番を指定してください');
      }
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
      }).then((profile) => serializeTorqueWrenchProfile(profile));
    });
  }

  async addSetting(profileId: string, input: TorqueWrenchSettingInput) {
    return runAssemblyTransaction((tx) => appendTorqueWrenchSetting(tx, profileId, input));
  }

  listCapabilityGroups(includeInactive = false) {
    return prisma.torqueWrenchCapabilityGroup.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: capabilityGroupInclude,
      orderBy: [{ nominalDiameter: 'asc' }, { boltLengthMm: 'asc' }, { name: 'asc' }]
    }).then((groups) => groups.map((group) => ({
      ...group,
      models: group.models.map((link) => ({
        ...link,
        model: serializeTorqueWrenchModel(link.model)
      }))
    })));
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
    }).then((groups) => groups.map((group) => ({
      ...group,
      models: group.models.map((link) => ({
        ...link,
        model: serializeTorqueWrenchModel(link.model)
      }))
    })));
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
    }).then((group) => ({
      ...group,
      models: group.models.map((link) => ({
        ...link,
        model: serializeTorqueWrenchModel(link.model)
      }))
    }));
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
    return runAssemblyTransaction(async (tx) => {
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
      }).then((group) => ({
        ...group,
        models: group.models.map((link) => ({
          ...link,
          model: serializeTorqueWrenchModel(link.model)
        }))
      }));
    });
  }
}
