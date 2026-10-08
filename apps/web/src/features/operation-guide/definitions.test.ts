import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import sop from '../assembly/assembly-procedure-template-sop.definition.json';
import { AssemblyProcedureOverlayTypeDialog } from '../assembly/document-editor/AssemblyProcedureOverlayTypeDialog';
import { KioskPinDialog } from '../kiosk/KioskPinDialog';

import { operationGuides, resolveGuideStep } from './definitions';

const sourceRoot = resolve(process.cwd(), 'src');
const implementation = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
  .filter(file => file.isFile() && /\.(tsx?|jsx?)$/u.test(file.name) && !/\.test\./u.test(file.name)
    && !file.parentPath.includes('/generated') && !file.parentPath.includes('/operation-guide'))
  .map(file => readFileSync(`${file.parentPath}/${file.name}`, 'utf8'));

describe('operation guide definitions', () => {
  it('offers exactly the two supported assembly guides', () => {
    expect(operationGuides.map(item => item.id)).toEqual(['assembly-register', 'assembly-edit']);
  });
  for (const guide of operationGuides) {
    for (const [index, reference] of guide.steps.entries()) {
      it(`${guide.id} step ${index + 1} resolves its ${reference.kind} definition and implemented target`, () => {
        const resolved = resolveGuideStep(reference);
        if (reference.kind === 'sop') {
          const sheet = sop.scenarios.flatMap(scenario => scenario.sheets).find(item => item.id === reference.sheetId);
          const source = sheet?.steps.find(item => item.id === reference.stepId);
          expect(source).toBeDefined();
          expect(resolved.title).toBe(source?.title);
          expect(resolved.targetId).toBe(source?.targetId);
        } else {
          expect(resolved).toEqual(reference);
        }
        let targetExists = implementation.some(sourceCode => sourceCode.includes(`data-kiosk-sop-target="${resolved.targetId}"`)
          || ((sourceCode.includes('data-kiosk-sop-target={options.target}') || sourceCode.includes('target={options.target}')) && sourceCode.includes(`target: '${resolved.targetId}'`)));
        if (resolved.targetId.startsWith('assembly-document-editor-type-')) {
          const view = render(createElement(AssemblyProcedureOverlayTypeDialog, { isOpen: true, onClose: () => undefined, onSelect: () => undefined }));
          targetExists = Boolean(document.querySelector(`[data-kiosk-sop-target="${resolved.targetId}"]`));
          view.unmount();
        }
        if (['assembly-document-editor-password', 'assembly-document-editor-authenticate'].includes(resolved.targetId)) {
          const view = render(createElement(KioskPinDialog, { pinTargetId: 'assembly-document-editor-password', submitTargetId: 'assembly-document-editor-authenticate', onSubmit: async () => true, onBack: () => undefined }));
          targetExists = Boolean(document.querySelector(`[data-kiosk-sop-target="${resolved.targetId}"]`));
          view.unmount();
        }
        expect(targetExists, `Implemented target: ${resolved.targetId}`).toBe(true);
        // The kiosk card has room for about 21 full-width characters at 14px.
        const units = [...resolved.description].reduce((count, char) => count + (/^[\x20-\x7e]$/u.test(char) ? .55 : 1), 0);
        expect(units).toBeLessThanOrEqual(21);
        expect(resolved.description).not.toContain('\n');
      });
    }
    it(`${guide.id} never repeats the same target and heading in consecutive steps`, () => {
      const steps = guide.steps.map(resolveGuideStep);
      for (let index = 1; index < steps.length; index++) {
        expect([steps[index].targetId, steps[index].title]).not.toEqual([steps[index - 1].targetId, steps[index - 1].title]);
      }
    });
  }
  it('registers a file through five distinct screen operations', () => {
    const steps = operationGuides[0].steps.map(resolveGuideStep);
    expect(steps.map(step => [step.title, step.targetId])).toEqual([
      ['ファイルから登録', 'assembly-file-register'],
      ['ファイルと先頭ページを確認', 'assembly-procedure-preview-file'],
      ['下書きとして登録', 'assembly-procedure-register-draft'],
      ['内容確認・公開を開く', 'assembly-procedure-preview'],
      ['確認して公開', 'assembly-procedure-publish'],
    ]);
    expect(steps[0].path).toBe('/kiosk/assembly/library');
    expect(steps[3].path).toBe('/kiosk/assembly/library');
  });
  it('aligns editing authentication, text selection and default tag approval with the controls', () => {
    const steps = operationGuides[1].steps.map(resolveGuideStep);
    expect(steps[1]).toMatchObject({ title: '暗証番号を入力', targetId: 'assembly-document-editor-password', description: 'テンキーで暗証番号を入力します。' });
    expect(steps[2]).toMatchObject({ title: 'OK', targetId: 'assembly-document-editor-authenticate', description: '4桁で自動認証。再試行は「OK」。' });
    expect(steps[5]).toMatchObject({ title: '文章を選ぶ', targetId: 'assembly-document-editor-type-text', description: '「文章」を選び、内容を入力します。' });
    expect(steps[8]).toMatchObject({ title: '承認して公開する', targetId: 'assembly-document-editor-publish-confirm', description: '承認者の社員タグをかざして公開します。' });
  });
  it('never exposes synthetic document routes as navigation destinations', () => {
    const steps = operationGuides.flatMap(guide => guide.steps.map(resolveGuideStep));
    expect(steps.filter(step => step.path).every(step => step.path === '/kiosk/assembly/library')).toBe(true);
    expect(steps.some(step => !step.path)).toBe(true);
  });
  it('fails visibly on an invalid reference', () => {
    expect(() => resolveGuideStep({ kind: 'sop', sheetId: 'missing', stepId: 'missing' })).toThrow('Unknown operation guide step');
  });
});
