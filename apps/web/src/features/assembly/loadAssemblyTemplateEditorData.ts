import {
  getAssemblyTemplate,
  listAssemblyProcedureDocumentSummaries
} from '../../api/client';

import type {
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateDto
} from './types';

export type AssemblyTemplateEditorData = {
  documents: AssemblyProcedureDocumentSummaryDto[];
  template: AssemblyTemplateDto | null;
};

export async function loadAssemblyTemplateEditorData(input: {
  templateId?: string;
  sourceTemplateId?: string | null;
}): Promise<AssemblyTemplateEditorData> {
  const resolvedTemplateId = input.templateId ?? input.sourceTemplateId ?? null;
  const [documents, template] = await Promise.all([
    listAssemblyProcedureDocumentSummaries({ includeInactive: true, limit: 200 }),
    resolvedTemplateId ? getAssemblyTemplate(resolvedTemplateId) : Promise.resolve(null)
  ]);
  return { documents, template };
}
