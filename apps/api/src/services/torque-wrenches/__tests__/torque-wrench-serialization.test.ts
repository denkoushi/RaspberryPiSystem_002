import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  serializeTorqueWrenchConditionTarget,
  serializeTorqueWrenchConfirmation,
  serializeTorqueWrenchModel,
  serializeTorqueWrenchProfile,
} from '../torque-wrench-serialization.js';
import {
  normalizeTorqueWrenchSettingVerificationMode,
  nullableSettingHistoryId,
  usesRegisteredTorqueWrenchSetting,
} from '../torque-wrench-setting-mode.policy.js';

describe('torque-wrench setting verification mode', () => {
  it('BOLT_CONDITION_ONLY 以外(null・未知値・小文字)はすべて REGISTERED_SETTING に倒す', () => {
    expect(normalizeTorqueWrenchSettingVerificationMode('BOLT_CONDITION_ONLY')).toBe('BOLT_CONDITION_ONLY');
    expect(normalizeTorqueWrenchSettingVerificationMode('REGISTERED_SETTING')).toBe('REGISTERED_SETTING');
    expect(normalizeTorqueWrenchSettingVerificationMode(null)).toBe('REGISTERED_SETTING');
    expect(normalizeTorqueWrenchSettingVerificationMode(undefined)).toBe('REGISTERED_SETTING');
    expect(normalizeTorqueWrenchSettingVerificationMode('bolt_condition_only')).toBe('REGISTERED_SETTING');
    expect(normalizeTorqueWrenchSettingVerificationMode('')).toBe('REGISTERED_SETTING');
  });

  it('usesRegisteredTorqueWrenchSetting は BOLT のときだけ false', () => {
    expect(usesRegisteredTorqueWrenchSetting('BOLT_CONDITION_ONLY')).toBe(false);
    expect(usesRegisteredTorqueWrenchSetting(null)).toBe(true);
    expect(usesRegisteredTorqueWrenchSetting('UNKNOWN')).toBe(true);
  });

  it('nullableSettingHistoryId は BOLT では常に null、それ以外は null 正規化して返す', () => {
    expect(nullableSettingHistoryId('BOLT_CONDITION_ONLY', 'hist-1')).toBeNull();
    expect(nullableSettingHistoryId('REGISTERED_SETTING', 'hist-1')).toBe('hist-1');
    expect(nullableSettingHistoryId('REGISTERED_SETTING', undefined)).toBeNull();
  });
});

describe('serializeTorqueWrenchConditionTarget', () => {
  it('Decimal を文字列化し単位を正規形にそろえる', () => {
    expect(serializeTorqueWrenchConditionTarget({
      lowerLimit: new Prisma.Decimal('9.50'),
      nominalTorque: new Prisma.Decimal('10'),
      upperLimit: new Prisma.Decimal('10.5'),
      unit: ' nm ',
    })).toEqual({ lowerLimit: '9.5', nominalTorque: '10', upperLimit: '10.5', unit: 'N·m' });

    expect(serializeTorqueWrenchConditionTarget({
      lowerLimit: 90,
      nominalTorque: 100,
      upperLimit: 110,
      unit: 'ｋｇｆ・ｃｍ',
    } as never).unit).toBe('kgf·cm');
  });

  it('未対応の単位は 422 UNSUPPORTED_TORQUE_UNIT', () => {
    expect(() => serializeTorqueWrenchConditionTarget({
      lowerLimit: 1, nominalTorque: 2, upperLimit: 3, unit: 'lbf·ft',
    } as never)).toThrow(expect.objectContaining({ statusCode: 422, code: 'UNSUPPORTED_TORQUE_UNIT' }));
  });
});

describe('serializeTorqueWrenchModel / Profile', () => {
  it('モードだけ正規化し、他のフィールド(Decimal/Date)はそのまま保持する', () => {
    const createdAt = new Date('2026-11-03T00:00:00Z');
    const maxTorque = new Prisma.Decimal('50');
    const model = { id: 'm1', settingVerificationMode: null, createdAt, maxTorque };
    const serialized = serializeTorqueWrenchModel(model);
    expect(serialized).toEqual({ id: 'm1', settingVerificationMode: 'REGISTERED_SETTING', createdAt, maxTorque });
    expect(serialized.createdAt).toBe(createdAt);
    expect(serialized.maxTorque).toBe(maxTorque);
    expect(model.settingVerificationMode).toBeNull();
  });

  it('プロファイル配下のモデルも正規化し、プロファイル側の Decimal/Date は同一インスタンスで保持する', () => {
    const calibratedAt = new Date('2026-10-01T00:00:00Z');
    const lastTorque = new Prisma.Decimal('12.5');
    const modelCreatedAt = new Date('2026-09-01T00:00:00Z');
    const model = { id: 'm1', settingVerificationMode: null, createdAt: modelCreatedAt };
    const profile = { id: 'p1', serialNumber: 'SN', calibratedAt, lastTorque, model };
    const serialized = serializeTorqueWrenchProfile(profile);
    expect(serialized).toEqual({
      id: 'p1',
      serialNumber: 'SN',
      calibratedAt,
      lastTorque,
      model: { id: 'm1', settingVerificationMode: 'REGISTERED_SETTING', createdAt: modelCreatedAt },
    });
    expect(serialized.calibratedAt).toBe(calibratedAt);
    expect(serialized.lastTorque).toBe(lastTorque);
    expect(serialized.model.createdAt).toBe(modelCreatedAt);
    expect(serialized.model).not.toBe(model);
    expect(profile.model.settingVerificationMode).toBeNull();
  });

  it('プロファイル配下のモデルが未知のモード値なら REGISTERED_SETTING に倒す', () => {
    const profile = { id: 'p2', model: { id: 'm2', settingVerificationMode: 'LEGACY_UNKNOWN' } };
    expect(serializeTorqueWrenchProfile(profile).model.settingVerificationMode).toBe('REGISTERED_SETTING');
  });
});

describe('serializeTorqueWrenchConfirmation', () => {
  const target = { lowerLimit: '9', nominalTorque: '10', upperLimit: '11', unit: 'N·m' };

  it('BOLT モードでは設定履歴IDを隠し、モードと目標値を付与する', () => {
    expect(serializeTorqueWrenchConfirmation(
      { id: 'c1', settingHistoryId: 'hist-1' }, 'BOLT_CONDITION_ONLY', target
    )).toEqual({ id: 'c1', settingHistoryId: null, settingVerificationMode: 'BOLT_CONDITION_ONLY', target });
  });

  it('REGISTERED_SETTING モードでは設定履歴IDを残す', () => {
    expect(serializeTorqueWrenchConfirmation(
      { id: 'c1', settingHistoryId: 'hist-1' }, 'REGISTERED_SETTING', target
    )).toEqual({ id: 'c1', settingHistoryId: 'hist-1', settingVerificationMode: 'REGISTERED_SETTING', target });
  });
});
