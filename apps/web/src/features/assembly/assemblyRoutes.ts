export const KIOSK_ASSEMBLY_PATH_PREFIX = '/kiosk/assembly';
export const KIOSK_ASSEMBLY_HOME_PATH = KIOSK_ASSEMBLY_PATH_PREFIX;
export const KIOSK_ASSEMBLY_LIBRARY_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/library`;
export const KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/procedure-order-settings`;
export const KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/record-approvals`;

export function kioskAssemblyRecordApprovalPath(params?: { sessionId?: string | null }): string {
  const query = new URLSearchParams();
  const sessionId = params?.sessionId?.trim();
  if (sessionId) query.set('sessionId', sessionId);
  const suffix = query.toString();
  return suffix ? `${KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH}?${suffix}` : KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH;
}

export function parseAssemblyRecordApprovalSearch(search: string): { sessionId: string | null } {
  return { sessionId: new URLSearchParams(search).get('sessionId') };
}
export const KIOSK_ASSEMBLY_TEMPLATE_NEW_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/templates/new`;

export function kioskAssemblyTemplateEditPath(templateId: string): string {
  return `${KIOSK_ASSEMBLY_PATH_PREFIX}/templates/${encodeURIComponent(templateId)}/edit`;
}

export function kioskAssemblyWorkSessionPath(sessionId: string): string {
  return `${KIOSK_ASSEMBLY_PATH_PREFIX}/work-sessions/${encodeURIComponent(sessionId)}`;
}

export type AssemblyLibraryFocus = 'procedures' | 'templates';

export function kioskAssemblyLibraryPath(params?: { focus?: AssemblyLibraryFocus }): string {
  const query = new URLSearchParams();
  if (params?.focus) query.set('focus', params.focus);
  const suffix = query.toString();
  return suffix ? `${KIOSK_ASSEMBLY_LIBRARY_PATH}?${suffix}` : KIOSK_ASSEMBLY_LIBRARY_PATH;
}

export function parseAssemblyLibrarySearch(search: string): { focus: AssemblyLibraryFocus | null } {
  const focus = new URLSearchParams(search).get('focus');
  if (focus === 'procedures' || focus === 'templates') return { focus };
  return { focus: null };
}

export function kioskAssemblyProcedureOrderSettingsPath(params?: { machineName?: string | null }): string {
  const query = new URLSearchParams();
  const machineName = params?.machineName?.trim();
  if (machineName) query.set('machineName', machineName);
  const suffix = query.toString();
  return suffix ? `${KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH}?${suffix}` : KIOSK_ASSEMBLY_PROCEDURE_ORDER_SETTINGS_PATH;
}

export function kioskAssemblyTemplateNewPath(params?: {
  procedureDocumentId?: string;
  sourceTemplateId?: string;
}): string {
  const query = new URLSearchParams();
  if (params?.procedureDocumentId) query.set('procedureDocumentId', params.procedureDocumentId);
  if (params?.sourceTemplateId) query.set('sourceTemplateId', params.sourceTemplateId);
  const suffix = query.toString();
  return suffix ? `${KIOSK_ASSEMBLY_TEMPLATE_NEW_PATH}?${suffix}` : KIOSK_ASSEMBLY_TEMPLATE_NEW_PATH;
}

export function parseAssemblyTemplateNewSearch(search: string): {
  procedureDocumentId: string | null;
  sourceTemplateId: string | null;
} {
  const query = new URLSearchParams(search);
  return {
    procedureDocumentId: query.get('procedureDocumentId'),
    sourceTemplateId: query.get('sourceTemplateId')
  };
}

export function parseAssemblyProcedureOrderSettingsSearch(search: string): { machineName: string | null } {
  return { machineName: new URLSearchParams(search).get('machineName') };
}
