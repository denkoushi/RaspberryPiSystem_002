import { describe, expect, it } from 'vitest';

import {
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  kioskAssemblyWorkSessionPath,
  kioskAssemblyWorkStartPath,
  parseAssemblyTemplateNewSearch,
  parseAssemblyWorkStartSearch
} from './assemblyRoutes';

describe('assemblyRoutes', () => {
  it('builds template and work paths', () => {
    expect(kioskAssemblyTemplateEditPath('template-1')).toBe('/kiosk/assembly/templates/template-1/edit');
    expect(kioskAssemblyWorkStartPath('template-1')).toBe('/kiosk/assembly/work/start?templateId=template-1');
    expect(kioskAssemblyWorkSessionPath('session-1')).toBe('/kiosk/assembly/work-sessions/session-1');
  });

  it('builds and parses new template query params', () => {
    const path = kioskAssemblyTemplateNewPath({
      procedureDocumentId: 'doc-1',
      sourceTemplateId: 'template-1'
    });
    expect(path).toBe('/kiosk/assembly/templates/new?procedureDocumentId=doc-1&sourceTemplateId=template-1');
    expect(parseAssemblyTemplateNewSearch(path.split('?')[1] ? `?${path.split('?')[1]}` : '')).toEqual({
      procedureDocumentId: 'doc-1',
      sourceTemplateId: 'template-1'
    });
  });

  it('parses work start query params', () => {
    expect(parseAssemblyWorkStartSearch('?templateId=template-1')).toEqual({ templateId: 'template-1' });
  });
});
