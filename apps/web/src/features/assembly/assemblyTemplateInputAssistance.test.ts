import { describe, expect, it } from 'vitest';

import { buildAssemblyTemplateGuidePresentation } from './assemblyTemplateGuidePresentation';
import {
  buildAssemblyTemplateSuggestedName,
  capabilityGroupToAssemblyBoltCondition,
  doesCapabilityGroupMatchAssemblyBoltCondition
} from './assemblyTemplateInputAssistance';

import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

describe('assembly template input assistance', () => {
  it('suggests a normalized name only after model and pattern are present', () => {
    expect(buildAssemblyTemplateSuggestedName(' L300KP ', ' 標準  手順 ')).toBe(
      'L300KP 標準 手順 組立'
    );
    expect(buildAssemblyTemplateSuggestedName('L300KP', '  ')).toBe('');
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
});

describe('assembly template guide presentation', () => {
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
