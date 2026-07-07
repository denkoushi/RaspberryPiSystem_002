import { describe, expect, it } from 'vitest';

import {
  KIOSK_ASSEMBLY_HOME_PATH,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH,
  kioskAssemblyLibraryPath,
  kioskAssemblyProcedureOrderSettingsPath,
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  kioskAssemblyWorkSessionPath,
  parseAssemblyLibrarySearch,
  parseAssemblyProcedureOrderSettingsSearch,
  parseAssemblyTemplateNewSearch
} from './assemblyRoutes';

describe('assemblyRoutes', () => {
  it('keeps start top and management library paths separate', () => {
    expect(KIOSK_ASSEMBLY_HOME_PATH).toBe('/kiosk/assembly');
    expect(KIOSK_ASSEMBLY_LIBRARY_PATH).toBe('/kiosk/assembly/library');
    expect(KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH).toBe('/kiosk/assembly/procedure-order-settings');
  });

  it('builds template and session paths', () => {
    expect(kioskAssemblyTemplateEditPath('template-1')).toBe('/kiosk/assembly/templates/template-1/edit');
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

  it('builds and parses library focus query params', () => {
    expect(kioskAssemblyLibraryPath({ focus: 'procedures' })).toBe('/kiosk/assembly/library?focus=procedures');
    expect(kioskAssemblyLibraryPath({ focus: 'templates' })).toBe('/kiosk/assembly/library?focus=templates');
    expect(kioskAssemblyLibraryPath()).toBe(KIOSK_ASSEMBLY_LIBRARY_PATH);
    expect(parseAssemblyLibrarySearch('?focus=procedures')).toEqual({ focus: 'procedures' });
    expect(parseAssemblyLibrarySearch('?focus=templates')).toEqual({ focus: 'templates' });
    expect(parseAssemblyLibrarySearch('?focus=unknown')).toEqual({ focus: null });
  });

  it('builds and parses procedure order settings query params', () => {
    const path = kioskAssemblyProcedureOrderSettingsPath({ machineName: 'MH-AX' });
    expect(path).toBe('/kiosk/assembly/procedure-order-settings?machineName=MH-AX');
    expect(parseAssemblyProcedureOrderSettingsSearch('?machineName=MH-AX')).toEqual({ machineName: 'MH-AX' });
  });
});
