import { useEffect, useState } from 'react';

import {
  getKioskDocumentDetail,
  listTorqueWrenchCapabilityGroups
} from '../../../api/client';
import { buildProcedureDraftPageOptions } from '../assemblyTemplateProcedureDraft';
import { loadAssemblyTemplateEditorData } from '../loadAssemblyTemplateEditorData';

import type { TorqueWrenchCapabilityGroupApi } from '../../../api/domains/torque-wrenches';
import type { AssemblyEditorPageOption } from '../assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from '../assemblyTemplateProcedureDraft';
import type {
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateDto
} from '../types';

type CapabilityCatalogStatus = 'loading' | 'ready' | 'error';

export function useAssemblyTemplateEditorData(input: {
  sourceTemplateId?: string | null;
  templateId?: string;
}) {
  const { sourceTemplateId, templateId } = input;
  const [documents, setDocuments] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [loadedTemplate, setLoadedTemplate] = useState<AssemblyTemplateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [capabilityGroups, setCapabilityGroups] = useState<TorqueWrenchCapabilityGroupApi[]>([]);
  const [capabilityCatalogStatus, setCapabilityCatalogStatus] =
    useState<CapabilityCatalogStatus>('loading');
  const [capabilityCatalogGeneration, setCapabilityCatalogGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void loadAssemblyTemplateEditorData({ sourceTemplateId, templateId })
      .then((data) => {
        if (cancelled) return;
        setDocuments(data.documents);
        setLoadedTemplate(data.template);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadGeneration, sourceTemplateId, templateId]);

  useEffect(() => {
    let cancelled = false;
    setCapabilityCatalogStatus('loading');
    void listTorqueWrenchCapabilityGroups(false)
      .then((groups) => {
        if (cancelled) return;
        setCapabilityGroups(groups);
        setCapabilityCatalogStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setCapabilityGroups([]);
        setCapabilityCatalogStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityCatalogGeneration]);

  return {
    capabilityCatalog: {
      groups: capabilityGroups,
      status: capabilityCatalogStatus
    },
    documents,
    loadError,
    loadedTemplate,
    loading,
    reload: () => setLoadGeneration((current) => current + 1),
    reloadCapabilityCatalog: () =>
      setCapabilityCatalogGeneration((current) => current + 1)
  };
}

export function useAssemblyTemplateEditorPageOptions(input: {
  documents: AssemblyProcedureDocumentSummaryDto[];
  procedureItems: AssemblyTemplateProcedureDraftItem[];
}) {
  const [pageOptions, setPageOptions] = useState<AssemblyEditorPageOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const buildOptions = async () => {
      const kioskPagesByDocumentId = new Map<string, { title: string; pageUrls: string[] }>();
      const kioskDocumentIds = [
        ...new Set(
          input.procedureItems
            .map((item) => item.kioskDocumentId)
            .filter((id): id is string => id != null)
        )
      ];
      await Promise.all(
        kioskDocumentIds.map(async (documentId) => {
          try {
            const detail = await getKioskDocumentDetail(documentId);
            kioskPagesByDocumentId.set(documentId, {
              title:
                detail.document.displayTitle?.trim() ||
                detail.document.title ||
                input.procedureItems.find((item) => item.kioskDocumentId === documentId)
                  ?.document.title ||
                '要領書',
              pageUrls: detail.pageUrls ?? []
            });
          } catch {
            // Missing legacy documents must not hide other procedure documents.
          }
        })
      );
      if (cancelled) return;
      setPageOptions(
        buildProcedureDraftPageOptions({
          items: input.procedureItems,
          assemblyDocuments: input.documents,
          kioskPagesByDocumentId
        })
      );
    };
    void buildOptions();
    return () => {
      cancelled = true;
    };
  }, [input.documents, input.procedureItems]);

  return pageOptions;
}
