import { describe, expect, it } from 'vitest';

import {
  assemblyEditorPageName,
  buildAssemblyTemplateGuidePresentation,
  formatAssemblyEditorName
} from './assemblyTemplateGuidePresentation';
import {
  buildAssemblyTemplateSuggestedName,
  buildAssemblyTorqueWrenchPresetCandidates,
  capabilityGroupToAssemblyBoltCondition,
  doesCapabilityGroupMatchAssemblyBoltCondition
} from './assemblyTemplateInputAssistance';

import type {
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchModelApi,
  TorqueWrenchProfileApi,
  TorqueWrenchSettingApi
} from '../../api/domains/torque-wrenches';

function makeModel(overrides: Partial<TorqueWrenchModelApi> = {}): TorqueWrenchModelApi {
  return {
    id: 'model-1',
    manufacturer: 'ACME',
    modelNumber: 'TW-100',
    torqueMinNm: '10',
    torqueMaxNm: '200',
    resolutionNm: '0.1',
    communicationType: 'USB',
    outputProfile: null,
    settingVerificationMode: 'REGISTERED_SETTING',
    isActive: true,
    ...overrides
  };
}

function makeSetting(overrides: Partial<TorqueWrenchSettingApi> = {}): TorqueWrenchSettingApi {
  return {
    id: 'setting-1',
    lowerLimit: '81.25',
    nominalTorque: '90.25',
    upperLimit: '99.25',
    unit: 'N·m',
    lowerLimitNm: '81.25',
    nominalTorqueNm: '90.25',
    upperLimitNm: '99.25',
    effectiveAt: '2026-09-03T01:02:03.000Z',
    reason: null,
    ...overrides
  };
}

function makeProfile(
  model: TorqueWrenchModelApi,
  overrides: Partial<TorqueWrenchProfileApi> = {}
): TorqueWrenchProfileApi {
  return {
    id: `profile-${model.id}`,
    modelId: model.id,
    serialNumber: `SN-${model.id}`,
    measuringInstrument: {
      id: `instrument-${model.id}`,
      name: 'トルクレンチ',
      managementNumber: `MG-${model.id}`,
      storageLocation: null,
      calibrationExpiryDate: null,
      status: 'AVAILABLE'
    },
    model,
    settingHistories: [makeSetting()],
    ...overrides
  };
}

function makeGroup(models: TorqueWrenchModelApi[]): TorqueWrenchCapabilityGroupApi {
  return {
    id: 'group-1',
    name: 'M6 標準',
    nominalDiameter: 'M6',
    boltLengthMm: '30',
    material: 'SCM435',
    strengthClass: '10.9',
    isActive: true,
    models: models.map((model) => ({ modelId: model.id, model }))
  };
}

describe('assembly template input assistance', () => {
  it('suggests a normalized name only after model and pattern are present', () => {
    expect(buildAssemblyTemplateSuggestedName(' L300KP ', ' 標準  手順 ')).toBe(
      'L300KP 標準 手順 組立'
    );
    expect(buildAssemblyTemplateSuggestedName('L300KP', '  ')).toBe('');
  });

  it('converts full-width machine-name characters in the suggested template name', () => {
    expect(buildAssemblyTemplateSuggestedName('Ｌ３００ＫＰ', '標準')).toBe(
      'L300KP 標準 組立'
    );
  });

  it('maps a capability group to the complete stored fastener snapshot', () => {
    const group: TorqueWrenchCapabilityGroupApi = {
      id: 'group-1',
      name: 'M6 標準',
      nominalDiameter: 'M6',
      boltLengthMm: '30',
      material: 'SCM435',
      strengthClass: '10.9',
      isActive: true,
      models: []
    };

    expect(capabilityGroupToAssemblyBoltCondition(group)).toEqual({
      capabilityGroupId: 'group-1',
      nominalDiameter: 'M6',
      boltLengthMm: 30,
      material: 'SCM435',
      strengthClass: '10.9'
    });
    expect(
      doesCapabilityGroupMatchAssemblyBoltCondition(group, {
        nominalDiameter: 'ｍ 6',
        boltLengthMm: 30,
        material: 'scm 435',
        strengthClass: '10.9'
      })
    ).toBe(true);
    expect(
      doesCapabilityGroupMatchAssemblyBoltCondition(group, {
        nominalDiameter: 'M6',
        boltLengthMm: 30,
        material: 'SUS304',
        strengthClass: '10.9'
      })
    ).toBe(false);
  });

  it('uses only active, non-retired matching models and each profile latest setting', () => {
    const activeModel = makeModel();
    const inactiveModel = makeModel({ id: 'model-inactive', modelNumber: 'TW-INACTIVE', isActive: false });
    const boltConditionOnlyModel = makeModel({
      id: 'model-bolt-condition-only',
      modelNumber: 'TW-BOLT-CONDITION-ONLY',
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    });
    const group = makeGroup([activeModel, inactiveModel, boltConditionOnlyModel]);
    const latest = makeSetting({ lowerLimit: '81.250', nominalTorque: '90.250', upperLimit: '99.250' });
    const older = makeSetting({
      id: 'setting-old',
      lowerLimit: '1',
      nominalTorque: '2',
      upperLimit: '3',
      effectiveAt: '2025-01-01T00:00:00.000Z'
    });
    const registered = makeProfile(activeModel, {
      id: 'profile-registered',
      serialNumber: 'SN-REGISTERED',
      settingHistories: [latest, older]
    });
    const sameValue = makeProfile(activeModel, {
      id: 'profile-same-value',
      serialNumber: 'SN-SAME-VALUE',
      settingHistories: [makeSetting({
        id: 'setting-same-value',
        lowerLimit: '81.25',
        nominalTorque: '90.25',
        upperLimit: '99.25'
      })]
    });
    const differentUnit = makeProfile(activeModel, {
      id: 'profile-different-unit',
      serialNumber: 'SN-DIFFERENT-UNIT',
      settingHistories: [makeSetting({
        id: 'setting-different-unit',
        lowerLimit: '828.6',
        nominalTorque: '920.0',
        upperLimit: '1011.4',
        unit: 'kgf·cm'
      })]
    });
    const unregistered = makeProfile(activeModel, {
      id: 'profile-unregistered',
      serialNumber: 'SN-UNREGISTERED',
      settingHistories: []
    });
    const boltConditionOnly = makeProfile(boltConditionOnlyModel, {
      id: 'profile-bolt-condition-only',
      serialNumber: 'SN-BOLT-CONDITION-ONLY'
    });
    const inactive = makeProfile(inactiveModel, { id: 'profile-inactive' });
    const retired = makeProfile(activeModel, {
      id: 'profile-retired',
      serialNumber: 'SN-RETIRED',
      measuringInstrument: {
        ...registered.measuringInstrument,
        id: 'instrument-retired',
        status: 'RETIRED'
      }
    });

    const result = buildAssemblyTorqueWrenchPresetCandidates(group, [
      registered,
      sameValue,
      differentUnit,
      unregistered,
      boltConditionOnly,
      inactive,
      retired
    ]);

    expect(result.matchingProfileCount).toBe(5);
    expect(result.unregisteredProfiles.map(({ id }) => id)).toEqual([
      'profile-unregistered',
      'profile-bolt-condition-only'
    ]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find(({ setting }) => setting.unit === 'N·m')).toMatchObject({
      setting: {
        lowerLimit: '81.250',
        nominalTorque: '90.250',
        upperLimit: '99.250',
        unit: 'N·m'
      },
      profiles: [registered, sameValue]
    });
    expect(result.candidates.find(({ setting }) => setting.unit === 'kgf·cm')?.profiles).toEqual([
      differentUnit
    ]);
    expect(result.candidates.some(({ setting }) => setting.lowerLimit === '1')).toBe(false);
  });
});

describe('assembly template guide presentation', () => {
  it('compacts only full-width alphanumerics and spaces in display names', () => {
    const original = 'ＡＢＣａｂｃ０１２　組立 カタカナ ＋／－ N·m kgf·cm ㎜';
    expect(formatAssemblyEditorName(original)).toBe('ABCabc012 組立 カタカナ ＋／－ N·m kgf·cm ㎜');
    expect(original).toBe('ＡＢＣａｂｃ０１２　組立 カタカナ ＋／－ N·m kgf·cm ㎜');
  });

  it('removes only the generated page suffix, not numbers inside document names', () => {
    expect(assemblyEditorPageName('1. ＡＢＣ 1ページ確認 / 12ページ', 11)).toBe('1. ABC 1ページ確認');
    expect(assemblyEditorPageName('ＡＢＣ / 12ページ', 0)).toBe('ABC / 12ページ');
  });

  it('derives compact stages and a single issue summary from readiness', () => {
    const presentation = buildAssemblyTemplateGuidePresentation({
      isReady: false,
      issues: [
        {
          code: 'basic.template_name.required',
          stage: 'basic',
          message: 'テンプレート名を入力してください。',
          target: { kind: 'basic', field: 'templateName' }
        }
      ],
      stages: {
        basic: 'incomplete',
        procedure: 'complete',
        areas: 'checking',
        review: 'incomplete'
      }
    });

    expect(presentation.summaryLabel).toBe('未完了 1件');
    expect(presentation.liveMessage).toBe('未完了項目が1件あります。');
    expect(presentation.stages.map(({ id, statusLabel }) => [id, statusLabel])).toEqual([
      ['basic', '未完了'],
      ['procedure', '完了'],
      ['areas', '確認中'],
      ['review', '未完了']
    ]);
  });
});
