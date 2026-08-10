import { describe, expect, it } from 'vitest';

import {
  ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_TTL_MS,
  buildAssemblyTemplateEditorRecoveryKey,
  createAssemblyTemplateEditorRecoveryRecord,
  isAssemblyTemplateEditorRecoveryCompatible,
  parseAssemblyTemplateEditorRecovery,
  serializeAssemblyTemplateEditorRecovery
} from './assemblyTemplateEditorRecovery';

const draft = {
  templateName: 'テンプレート',
  modelCode: 'MODEL-1',
  procedurePattern: '標準',
  procedureItems: [],
  procedureSteps: [],
  areas: [],
  checkItems: []
};

describe('assembly template editor recovery', () => {
  it('builds stable keys for new and revise modes', () => {
    expect(buildAssemblyTemplateEditorRecoveryKey({ mode: 'new', procedureDocumentId: 'doc-1' }))
      .toContain('new:document:doc-1');
    expect(buildAssemblyTemplateEditorRecoveryKey({ mode: 'revise', templateId: 'template-1' }))
      .toContain('revise:template-1');
  });

  it('rejects malformed, incompatible, stale, and old-version records', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const record = createAssemblyTemplateEditorRecoveryRecord({
      mode: 'revise',
      targetKey: 'assembly-template-editor-recovery:v1:revise:template-1',
      baseTemplateId: 'template-1',
      baseUpdatedAt: '2026-08-09T00:00:00.000Z',
      draft,
      savedAt: new Date(now.getTime() - 1000)
    });
    expect(parseAssemblyTemplateEditorRecovery(serializeAssemblyTemplateEditorRecovery(record), now)).toEqual(record);
    expect(parseAssemblyTemplateEditorRecovery('{broken', now)).toBeNull();
    expect(parseAssemblyTemplateEditorRecovery(JSON.stringify({ ...record, schemaVersion: 2 }), now)).toBeNull();
    expect(
      parseAssemblyTemplateEditorRecovery(
        serializeAssemblyTemplateEditorRecovery({
          ...record,
          savedAt: new Date(now.getTime() - ASSEMBLY_TEMPLATE_EDITOR_RECOVERY_TTL_MS - 1).toISOString()
        }),
        now
      )
    ).toBeNull();
    expect(
      isAssemblyTemplateEditorRecoveryCompatible(record, {
        mode: 'revise',
        targetKey: record.targetKey,
        templateId: 'template-1',
        updatedAt: '2026-08-09T00:00:00.000Z',
        isActive: true,
        currentModelCode: 'MODEL-1',
        currentProcedurePattern: '標準'
      })
    ).toBe(true);
    expect(
      isAssemblyTemplateEditorRecoveryCompatible(record, {
        mode: 'revise',
        targetKey: record.targetKey,
        templateId: 'template-1',
        updatedAt: '2026-08-09T00:00:00.000Z',
        isActive: false,
        currentModelCode: 'MODEL-1',
        currentProcedurePattern: '標準'
      })
    ).toBe(false);
    expect(
      isAssemblyTemplateEditorRecoveryCompatible(record, {
        mode: 'revise',
        targetKey: record.targetKey,
        templateId: 'template-1',
        updatedAt: '2026-08-09T00:00:00.000Z',
        isActive: true,
        currentModelCode: 'MODEL-2',
        currentProcedurePattern: '標準'
      })
    ).toBe(false);
  });
});
