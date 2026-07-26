import { describe, expect, it } from 'vitest';

import {
  appendAssemblyProcedureDocument,
  assemblyTemplateProcedureDraftToInput,
  assemblyTemplateProcedureDraftReducer,
  buildProcedureDraftPageOptions,
  canRemoveAssemblyTemplateProcedureItem,
  getPrimaryAssemblyProcedureDocumentId,
  moveAssemblyTemplateProcedureItem
} from './assemblyTemplateProcedureDraft';

import type { AssemblyProcedureDocumentSummaryDto } from './types';

function procedureDocument(id: string, name: string): AssemblyProcedureDocumentSummaryDto {
  return {
    id,
    name,
    imageRelativePath: `/api/${id}/page-1.png`,
    status: 'published',
    publishedAt: '2026-07-26T00:00:00.000Z',
    isActive: true,
    pages: [
      { pageIndex: 0, imageRelativePath: `/api/${id}/page-1.png` },
      { pageIndex: 1, imageRelativePath: `/api/${id}/page-2.png` }
    ],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    activeTemplateCount: 0,
    totalTemplateCount: 0
  };
}

describe('assembly template procedure draft', () => {
  it('adds, reorders and determines the first assembly document as primary', () => {
    const first = procedureDocument('doc-1', '手順書1');
    const second = procedureDocument('doc-2', '手順書2');
    const initial = appendAssemblyProcedureDocument([], first);
    const appended = appendAssemblyProcedureDocument(initial, second);
    const moved = moveAssemblyTemplateProcedureItem(appended, 1, -1);

    expect(getPrimaryAssemblyProcedureDocumentId(moved)).toBe('doc-2');
    expect(assemblyTemplateProcedureDraftToInput(moved)).toEqual([
      {
        kioskDocumentId: null,
        assemblyProcedureDocumentId: 'doc-2',
        label: null
      },
      {
        kioskDocumentId: null,
        assemblyProcedureDocumentId: 'doc-1',
        label: null
      }
    ]);
  });

  it('does not newly append a duplicate assembly document', () => {
    const document = procedureDocument('doc-1', '手順書1');
    const initial = appendAssemblyProcedureDocument([], document);
    expect(appendAssemblyProcedureDocument(initial, document)).toBe(initial);
  });

  it('reduces replace, append, reorder, label and remove actions without UI coupling', () => {
    const first = procedureDocument('doc-1', '手順書1');
    const second = procedureDocument('doc-2', '手順書2');
    const replaced = assemblyTemplateProcedureDraftReducer([], {
      type: 'replace',
      items: appendAssemblyProcedureDocument([], first)
    });
    const appended = assemblyTemplateProcedureDraftReducer(replaced, {
      type: 'append_assembly_document',
      document: second
    });
    const moved = assemblyTemplateProcedureDraftReducer(appended, {
      type: 'move',
      index: 1,
      delta: -1
    });
    const labeled = assemblyTemplateProcedureDraftReducer(moved, {
      type: 'set_label',
      localId: moved[0]!.localId,
      label: '先行工程'
    });
    const removed = assemblyTemplateProcedureDraftReducer(labeled, {
      type: 'remove',
      index: 1
    });

    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      assemblyProcedureDocumentId: 'doc-2',
      label: '先行工程'
    });
  });

  it('blocks removal of the last occurrence referenced by a marker', () => {
    const first = appendAssemblyProcedureDocument([], procedureDocument('doc-1', '手順書1'));
    const second = appendAssemblyProcedureDocument(first, procedureDocument('doc-2', '手順書2'));
    expect(
      canRemoveAssemblyTemplateProcedureItem({
        items: second,
        index: 1,
        markerRefs: [{ assemblyProcedureDocumentId: 'doc-2' }]
      })
    ).toEqual({
      allowed: false,
      message: 'この文書を参照するマーカーが残っています。先にマーカーを削除または移動してください。'
    });
  });

  it('keeps duplicate occurrences as distinct page choices', () => {
    const document = procedureDocument('doc-1', '手順書1');
    const one = appendAssemblyProcedureDocument([], document)[0]!;
    const duplicate = { ...one, localId: `${one.localId}:duplicate`, label: '再確認' };
    const options = buildProcedureDraftPageOptions({
      items: [one, duplicate],
      assemblyDocuments: [document],
      kioskPagesByDocumentId: new Map()
    });

    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.key)).size).toBe(4);
    expect(options[2]?.label).toContain('再確認');
  });
});
