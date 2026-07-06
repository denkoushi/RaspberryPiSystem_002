import { describe, expect, it } from 'vitest';

import {
  KIOSK_ASSEMBLY_HOME_PATH,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH,
  kioskAssemblyProcedureOrderSettingsPath,
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  kioskAssemblyWorkSessionPath,
  kioskAssemblyWorkStartPath,
  parseAssemblyProcedureOrderSettingsSearch,
  parseAssemblyTemplateNewSearch,
  parseAssemblyWorkStartSearch
} from './assemblyRoutes';

describe('assemblyRoutes', () => {
  it('keeps start top and management library paths separate', () => {
    expect(KIOSK_ASSEMBLY_HOME_PATH).toBe('/kiosk/assembly');
    expect(KIOSK_ASSEMBLY_LIBRARY_PATH).toBe('/kiosk/assembly/library');
    expect(KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH).toBe('/kiosk/assembly/procedure-order-settings');
  });

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

  it('builds and parses procedure order settings query params', () => {
    const path = kioskAssemblyProcedureOrderSettingsPath({ machineName: 'MH-AX' });
    expect(path).toBe('/kiosk/assembly/procedure-order-settings?machineName=MH-AX');
    expect(parseAssemblyProcedureOrderSettingsSearch('?machineName=MH-AX')).toEqual({ machineName: 'MH-AX' });
  });
});
