export const KIOSK_ASSEMBLY_PATH_PREFIX = '/kiosk/assembly';
export const KIOSK_ASSEMBLY_HOME_PATH = KIOSK_ASSEMBLY_PATH_PREFIX;
export const KIOSK_ASSEMBLY_LIBRARY_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/library`;
export const KIOSK_ASSEMBLY_TEMPLATE_NEW_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/templates/new`;
export const KIOSK_ASSEMBLY_WORK_START_PATH = `${KIOSK_ASSEMBLY_PATH_PREFIX}/work/start`;

export function kioskAssemblyTemplateEditPath(templateId: string): string {
  return `${KIOSK_ASSEMBLY_PATH_PREFIX}/templates/${encodeURIComponent(templateId)}/edit`;
}

export function kioskAssemblyWorkSessionPath(sessionId: string): string {
  return `${KIOSK_ASSEMBLY_PATH_PREFIX}/work-sessions/${encodeURIComponent(sessionId)}`;
}

export function kioskAssemblyWorkStartPath(templateId: string): string {
  const query = new URLSearchParams({ templateId });
  return `${KIOSK_ASSEMBLY_WORK_START_PATH}?${query.toString()}`;
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

export function parseAssemblyWorkStartSearch(search: string): { templateId: string | null } {
  return { templateId: new URLSearchParams(search).get('templateId') };
}
