import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const virtualizerMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn()
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 118,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 118
      })),
    measureElement: vi.fn(),
    scrollToIndex: virtualizerMocks.scrollToIndex
  })
}));

import { createFullPageStepDraft } from './assemblyProcedureStepDraft';
import { AssemblyProcedureStoryboard } from './AssemblyProcedureStoryboard';

import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';

const pages: AssemblyEditorPageOption[] = [
  {
    key: 'document:0',
    label: '文書 / 1ページ',
    source: 'assembly_procedure_document',
    documentId: 'document',
    pageIndex: 0,
    imageRelativePath: '/api/document-1.png'
  },
  {
    key: 'document:1',
    label: '文書 / 2ページ',
    source: 'assembly_procedure_document',
    documentId: 'document',
    pageIndex: 1,
    imageRelativePath: '/api/document-2.png'
  }
];

const steps = [
  { ...createFullPageStepDraft(pages[0]!), title: '対象' },
  { ...createFullPageStepDraft(pages[1]!), title: '別の対象' }
];

function renderStoryboard(
  selectedLocalId = steps[0]!.localId
) {
  return render(
    <AssemblyProcedureStoryboard
      steps={steps}
      pages={pages}
      selectedLocalId={selectedLocalId}
      onSelect={vi.fn()}
      onMove={vi.fn()}
      onMoveTo={vi.fn()}
      onDuplicate={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe('AssemblyProcedureStoryboard focus behavior', () => {
  it('scrolls the selected newly added step into view', async () => {
    virtualizerMocks.scrollToIndex.mockClear();
    const view = renderStoryboard();

    view.rerender(
      <AssemblyProcedureStoryboard
        steps={steps}
        pages={pages}
        selectedLocalId={steps[1]!.localId}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onMoveTo={vi.fn()}
        onDuplicate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    await waitFor(() => expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(1));
  });

  it('keeps thumbnails in the dedicated steps view', () => {
    renderStoryboard();

    expect(screen.getAllByTestId('assembly-step-thumbnail')).toHaveLength(2);
  });

});
