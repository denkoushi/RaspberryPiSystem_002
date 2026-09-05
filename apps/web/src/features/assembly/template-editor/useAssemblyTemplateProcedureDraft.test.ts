import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createFullPageStepDraft } from '../assemblyProcedureStepDraft';

import { useAssemblyTemplateProcedureDraft } from './useAssemblyTemplateProcedureDraft';

import type { AssemblyEditorPageOption } from '../assemblyTemplateDraft';
import type { AssemblyProcedureDocumentSummaryDto } from '../types';

const NOW = '2026-09-03T00:00:00.000Z';

function documentFixture(
  id: string,
  name: string,
  pageCount = 2,
  imageRelativePath = `/api/${id}.png`
): AssemblyProcedureDocumentSummaryDto {
  return {
    id,
    name,
    imageRelativePath,
    status: 'published',
    publishedAt: NOW,
    isActive: true,
    pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
      pageIndex,
      imageRelativePath: `/api/${id}-${pageIndex + 1}.png`
    })),
    createdAt: NOW,
    updatedAt: NOW,
    activeTemplateCount: 0,
    totalTemplateCount: 0
  };
}

function renderProcedureDraft(
  documents: AssemblyProcedureDocumentSummaryDto[],
  initialDocumentId?: string
) {
  return renderHook(() =>
    useAssemblyTemplateProcedureDraft({
      documents,
      initialDocumentId,
      loadedTemplate: null,
      loading: false,
      onMessage: vi.fn(),
      onStepFocused: vi.fn()
    })
  );
}

describe('useAssemblyTemplateProcedureDraft document additions', () => {
  it('keeps document-only additions free of implicit steps and focuses the first page', async () => {
    const document = documentFixture('document-only', '文書だけ');
    const hook = renderProcedureDraft([document]);

    await waitFor(() => expect(hook.result.current.initialized).toBe(true));
    act(() => hook.result.current.addDocument(document, 'document_only'));

    await waitFor(() =>
      expect(hook.result.current.selectedPage?.documentId).toBe(document.id)
    );
    expect(hook.result.current.procedureItems).toHaveLength(1);
    expect(hook.result.current.procedureSteps).toHaveLength(0);
    expect(hook.result.current.leftPaneTab).toBe('documents');
    expect(hook.result.current.addingDocumentId).toBeNull();
  });

  it('focuses the first newly generated step after an all-pages addition', async () => {
    const document = documentFixture('all-pages', '全ページ');
    const hook = renderProcedureDraft([document]);

    await waitFor(() => expect(hook.result.current.initialized).toBe(true));
    act(() => hook.result.current.addDocument(document, 'all_pages'));

    await waitFor(() =>
      expect(hook.result.current.selectedStep?.assemblyProcedureDocumentId).toBe(document.id)
    );
    expect(hook.result.current.procedureSteps).toHaveLength(2);
    expect(hook.result.current.selectedStep?.pageIndex).toBe(0);
    expect(hook.result.current.leftPaneTab).toBe('steps');
  });

  it('keeps the current pane tab while selecting or adding a step', async () => {
    const document = documentFixture('selection', '選択');
    const hook = renderProcedureDraft([document], document.id);

    await waitFor(() => expect(hook.result.current.procedureSteps).toHaveLength(2));
    expect(hook.result.current.leftPaneTab).toBe('documents');
    const step = hook.result.current.procedureSteps[1]!;
    act(() => hook.result.current.focusStep(step));
    expect(hook.result.current.leftPaneTab).toBe('documents');
    expect(hook.result.current.selectedPage?.pageIndex).toBe(1);
    act(() => hook.result.current.addCurrentCropStep({
      xRatio: 0.1,
      yRatio: 0.1,
      widthRatio: 0.5,
      heightRatio: 0.5
    }));
    await waitFor(() => expect(hook.result.current.selectedStep?.viewMode).toBe('crop'));
    expect(hook.result.current.leftPaneTab).toBe('documents');
  });

  it('rejects a duplicate all-pages click before it can append duplicate steps', async () => {
    const document = documentFixture('double-click', '二重クリック');
    const hook = renderProcedureDraft([document]);

    await waitFor(() => expect(hook.result.current.initialized).toBe(true));
    act(() => {
      hook.result.current.addDocument(document, 'all_pages');
      hook.result.current.addDocument(document, 'all_pages');
    });

    await waitFor(() => expect(hook.result.current.procedureSteps).toHaveLength(2));
    expect(hook.result.current.procedureItems).toHaveLength(1);
  });

  it('rejects zero-effective-page documents without changing the draft', async () => {
    const document = documentFixture('no-pages', 'ページなし', 0, '');
    const hook = renderProcedureDraft([document]);

    await waitFor(() => expect(hook.result.current.initialized).toBe(true));
    act(() => hook.result.current.addDocument(document, 'document_only'));

    expect(hook.result.current.procedureItems).toHaveLength(0);
    expect(hook.result.current.procedureSteps).toHaveLength(0);
    expect(hook.result.current.addingDocumentId).toBeNull();
  });

  it('rejects an all-pages addition that would exceed 300 steps atomically', async () => {
    const document = documentFixture('too-many', '上限超過');
    const seedPage: AssemblyEditorPageOption = {
      key: 'seed:0',
      label: 'seed / 1ページ',
      source: 'assembly_procedure_document',
      documentId: 'seed-document',
      pageIndex: 0,
      imageRelativePath: '/api/seed.png'
    };
    const hook = renderProcedureDraft([document]);

    await waitFor(() => expect(hook.result.current.initialized).toBe(true));
    act(() => {
      hook.result.current.dispatchSteps({
        type: 'replace',
        steps: Array.from({ length: 299 }, (_, pageIndex) =>
          createFullPageStepDraft({
            ...seedPage,
            key: `seed:${pageIndex}`,
            pageIndex
          })
        )
      });
    });
    act(() => hook.result.current.addDocument(document, 'all_pages'));

    expect(hook.result.current.procedureItems).toHaveLength(0);
    expect(hook.result.current.procedureSteps).toHaveLength(299);
  });

  it('does not revive auto-hydration after a restored zero-step draft', async () => {
    const initialDocument = documentFixture('initial', '初期文書');
    const addedDocument = documentFixture('added', '追加文書');
    const hook = renderProcedureDraft([initialDocument, addedDocument], initialDocument.id);

    await waitFor(() => expect(hook.result.current.procedureSteps).toHaveLength(2));
    act(() => hook.result.current.dispatchSteps({ type: 'replace', steps: [] }));
    act(() => hook.result.current.addDocument(addedDocument, 'document_only'));

    await waitFor(() => expect(hook.result.current.procedureItems).toHaveLength(2));
    expect(hook.result.current.procedureSteps).toHaveLength(0);
  });
});
