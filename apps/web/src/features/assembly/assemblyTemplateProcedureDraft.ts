import {
  assemblyProcedureDocumentPages,
  resolveAssemblyDocumentStatus
} from './assemblyTemplateDraft';

import type {
  AssemblyEditorPageOption,
  AssemblyPageRef
} from './assemblyTemplateDraft';
import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblyProcedureSequenceDocumentSummaryDto,
  AssemblyProcedureSequenceItemDto,
  AssemblyTemplateDto
} from './types';

export type AssemblyTemplateProcedureDraftItem = {
  localId: string;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  label: string;
  document: AssemblyProcedureSequenceDocumentSummaryDto;
};

export type AssemblyTemplateMarkerDocumentRef = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
};

export type AssemblyTemplateProcedureDraftAction =
  | { type: 'replace'; items: AssemblyTemplateProcedureDraftItem[] }
  | {
      type: 'append_assembly_document';
      document: AssemblyProcedureDocumentDto | AssemblyProcedureDocumentSummaryDto;
    }
  | { type: 'move'; index: number; delta: -1 | 1 }
  | { type: 'remove'; index: number }
  | { type: 'set_label'; localId: string; label: string };

function createLocalId(seed?: string): string {
  return seed ? `${seed}:${crypto.randomUUID()}` : crypto.randomUUID();
}

export function assemblyProcedureDocumentToDraftItem(
  document: AssemblyProcedureDocumentDto | AssemblyProcedureDocumentSummaryDto
): AssemblyTemplateProcedureDraftItem {
  return {
    localId: createLocalId(document.id),
    documentType: 'assembly_procedure_document',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: document.id,
    label: '',
    document: {
      id: document.id,
      documentType: 'assembly_procedure_document',
      title: document.name,
      displayTitle: null,
      filename: document.name,
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: document.pages.length || 1,
      enabled: document.isActive,
      updatedAt: document.updatedAt,
      imageRelativePath: document.imageRelativePath
    }
  };
}

function sequenceItemToDraft(
  item: AssemblyProcedureSequenceItemDto
): AssemblyTemplateProcedureDraftItem {
  return {
    localId: createLocalId(item.id),
    documentType: item.documentType,
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
    label: item.label ?? '',
    document: item.document
  };
}

export function templateToProcedureDraftItems(
  template: AssemblyTemplateDto
): AssemblyTemplateProcedureDraftItem[] {
  const effectiveItems = template.procedureSequence?.items ?? [];
  if (effectiveItems.length > 0) return effectiveItems.map(sequenceItemToDraft);
  return [assemblyProcedureDocumentToDraftItem(template.procedureDocument)];
}

export function getPrimaryAssemblyProcedureDocumentId(
  items: AssemblyTemplateProcedureDraftItem[]
): string | null {
  return items.find((item) => item.assemblyProcedureDocumentId)?.assemblyProcedureDocumentId ?? null;
}

export function hasAssemblyProcedureDocument(
  items: AssemblyTemplateProcedureDraftItem[],
  documentId: string
): boolean {
  return items.some((item) => item.assemblyProcedureDocumentId === documentId);
}

export function appendAssemblyProcedureDocument(
  items: AssemblyTemplateProcedureDraftItem[],
  document: AssemblyProcedureDocumentDto | AssemblyProcedureDocumentSummaryDto
): AssemblyTemplateProcedureDraftItem[] {
  if (items.length >= 50 || hasAssemblyProcedureDocument(items, document.id)) return items;
  return [...items, assemblyProcedureDocumentToDraftItem(document)];
}

export function moveAssemblyTemplateProcedureItem(
  items: AssemblyTemplateProcedureDraftItem[],
  index: number,
  delta: -1 | 1
): AssemblyTemplateProcedureDraftItem[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function assemblyTemplateProcedureDraftReducer(
  items: AssemblyTemplateProcedureDraftItem[],
  action: AssemblyTemplateProcedureDraftAction
): AssemblyTemplateProcedureDraftItem[] {
  switch (action.type) {
    case 'replace':
      return action.items;
    case 'append_assembly_document':
      return appendAssemblyProcedureDocument(items, action.document);
    case 'move':
      return moveAssemblyTemplateProcedureItem(items, action.index, action.delta);
    case 'remove':
      return items.filter((_, index) => index !== action.index);
    case 'set_label':
      return items.map((item) =>
        item.localId === action.localId
          ? { ...item, label: action.label.slice(0, 120) }
          : item
      );
  }
}

function documentRefKey(ref: AssemblyTemplateMarkerDocumentRef): string | null {
  if (ref.kioskDocumentId) return `kiosk_document:${ref.kioskDocumentId}`;
  if (ref.assemblyProcedureDocumentId) {
    return `assembly_procedure_document:${ref.assemblyProcedureDocumentId}`;
  }
  return null;
}

export function canRemoveAssemblyTemplateProcedureItem(input: {
  items: AssemblyTemplateProcedureDraftItem[];
  index: number;
  markerRefs: AssemblyTemplateMarkerDocumentRef[];
}): { allowed: true } | { allowed: false; message: string } {
  if (input.items.length <= 1) {
    return { allowed: false, message: '文書は1件以上必要です。' };
  }
  const item = input.items[input.index];
  if (!item) return { allowed: false, message: '削除する文書が見つかりません。' };
  const key = documentRefKey(item);
  const remainingOccurrenceCount = input.items.filter(
    (candidate, index) => index !== input.index && documentRefKey(candidate) === key
  ).length;
  const markerExists = key != null && input.markerRefs.some((ref) => documentRefKey(ref) === key);
  if (remainingOccurrenceCount === 0 && markerExists) {
    return {
      allowed: false,
      message: 'この文書を参照するマーカーが残っています。先にマーカーを削除または移動してください。'
    };
  }
  const remainingAssemblyCount = input.items.filter(
    (candidate, index) => index !== input.index && candidate.assemblyProcedureDocumentId
  ).length;
  if (remainingAssemblyCount === 0) {
    return { allowed: false, message: '主手順書となる組立手順書を1件以上残してください。' };
  }
  return { allowed: true };
}

export function assemblyTemplateProcedureDraftToInput(
  items: AssemblyTemplateProcedureDraftItem[]
) {
  return items.map((item) => ({
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
    label: item.label.trim() || null
  }));
}

export function buildProcedureDraftPageOptions(input: {
  items: AssemblyTemplateProcedureDraftItem[];
  assemblyDocuments: Array<AssemblyProcedureDocumentDto | AssemblyProcedureDocumentSummaryDto>;
  kioskPagesByDocumentId: Map<string, { title: string; pageUrls: string[] }>;
}): AssemblyEditorPageOption[] {
  const assemblyDocumentById = new Map(input.assemblyDocuments.map((document) => [document.id, document]));
  const options: AssemblyEditorPageOption[] = [];
  input.items.forEach((item, itemIndex) => {
    if (item.documentType === 'assembly_procedure_document' && item.assemblyProcedureDocumentId) {
      const document = assemblyDocumentById.get(item.assemblyProcedureDocumentId);
      if (!document || resolveAssemblyDocumentStatus(document) !== 'published') return;
      assemblyProcedureDocumentPages(document).forEach((page) => {
        const ref: AssemblyPageRef = {
          source: 'assembly_procedure_document',
          documentId: document.id,
          pageIndex: page.pageIndex
        };
        options.push({
          key: `${item.localId}:${page.pageIndex}`,
          label: `${itemIndex + 1}. ${item.label.trim() || document.name} / ${page.pageIndex + 1}ページ`,
          source: ref.source,
          documentId: ref.documentId,
          pageIndex: ref.pageIndex,
          imageRelativePath: page.imageRelativePath
        });
      });
      return;
    }
    if (item.documentType === 'kiosk_document' && item.kioskDocumentId) {
      const preview = input.kioskPagesByDocumentId.get(item.kioskDocumentId);
      preview?.pageUrls.forEach((pageUrl, pageIndex) => {
        options.push({
          key: `${item.localId}:${pageIndex}`,
          label: `${itemIndex + 1}. ${item.label.trim() || preview.title} / ${pageIndex + 1}ページ`,
          source: 'kiosk_document',
          documentId: item.kioskDocumentId!,
          pageIndex,
          imageRelativePath: pageUrl
        });
      });
    }
  });
  return options;
}
