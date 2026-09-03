import { describe, expect, it } from 'vitest';

import {
  assemblyEditorPageName,
  buildAssemblyTemplateGuidePresentation,
  formatAssemblyEditorName
} from './assemblyTemplateGuidePresentation';
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
