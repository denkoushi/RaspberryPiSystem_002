import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProcedureManualFullscreenPreview, procedureDocumentToSequence } from './ProcedureManualFullscreenPreview';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';

import type { AssemblyProcedureDocumentDto } from '../types';

vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ layout, className, showCurrentMarkerButton, ...props }: { layout: string; className: string; showCurrentMarkerButton: boolean; onClose?: () => void; twoPages?: boolean; onToggleTwoPages?: () => void }) => <div data-testid="viewer" data-layout={layout} data-markers={showCurrentMarkerButton} className={className}><ProcedureManualPageRail {...props} total={2} /></div>
}));

const documentFixture: AssemblyProcedureDocumentDto = {
  id: 'draft-1', name: '下書き', status: 'draft', publishedAt: null, isActive: true,
  imageRelativePath: '/fallback.png', createdAt: '2026-10-01', updatedAt: '2026-10-13',
  assets: { image: { assetId: 'image', storageKey: 'image.png', contentType: 'image/png', byteSize: 100 } },
  pages: [
    { pageIndex: 1, imageRelativePath: '/second.png', overlays: [{ id: 'text-1', pageIndex: 1, kind: 'TEXT', bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.1 }, text: '注釈', fontSize: 16, fontWeight: 'normal', color: '#000000', align: 'left', zIndex: 1 }] },
    { pageIndex: 0, imageRelativePath: '/first.png', overlays: [] }
  ]
};

describe('procedureDocumentToSequence', () => {
  it('sorts pages and preserves overlays and assets without supplying steps', () => {
    const sequence = procedureDocumentToSequence(documentFixture);
    expect(sequence).toMatchObject({ mode: 'configured', source: 'primary_fallback', reason: null, fallbackProcedureDocument: null, stepSource: 'document_expansion' });
    expect(sequence.steps).toBeUndefined();
    expect(sequence.documents).toHaveLength(1);
    expect(sequence.documents[0]).toMatchObject({ documentType: 'assembly_procedure_document', assemblyProcedureDocumentId: 'draft-1', kioskDocumentId: null, title: '下書き', displayTitle: '下書き', pageCount: 2, pageUrls: ['/first.png', '/second.png'] });
    expect(sequence.documents[0].assets).toBe(documentFixture.assets);
    expect(sequence.documents[0].pages).toEqual([0, 1].map(pageIndex => ({ source: 'assembly_procedure_document', documentId: 'draft-1', pageIndex, pageUrl: pageIndex === 0 ? '/first.png' : '/second.png', overlays: documentFixture.pages.find(page => page.pageIndex === pageIndex)?.overlays })));
    expect(documentFixture.pages.map(page => page.pageIndex)).toEqual([1, 0]);
  });

  it('uses the image fallback when there are no page entries', () => {
    expect(procedureDocumentToSequence({ ...documentFixture, pages: [] }).documents[0].pages).toEqual([{ source: 'assembly_procedure_document', documentId: 'draft-1', pageIndex: 0, pageUrl: '/fallback.png', overlays: undefined }]);
  });
});

describe('ProcedureManualPageRail', () => {
  it('puts close first and hides the list toggle when onClose is provided', () => {
    const onClose = vi.fn();
    render(<ProcedureManualPageRail onClose={onClose} />);
    const close = screen.getByRole('button', { name: '閉じる' });
    expect(screen.getAllByRole('button')[0]).toBe(close);
    expect(close).toHaveAttribute('title', '閉じる');
    expect(close).toHaveClass('h-12', 'w-12');
    expect(screen.queryByRole('button', { name: '一覧を開閉' })).not.toBeInTheDocument();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the list toggle first without onClose', () => {
    const onToggleList = vi.fn();
    render(<ProcedureManualPageRail listOpen onToggleList={onToggleList} />);
    const toggle = screen.getByRole('button', { name: '一覧を開閉' });
    expect(screen.getAllByRole('button')[0]).toBe(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggleList).toHaveBeenCalledOnce();
  });
});

it('uses the fullscreen manuals viewer, toggles two pages, and restores focus and scrolling', () => {
  const onClose = vi.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'auto';
  const view = render(<ProcedureManualFullscreenPreview sequence={procedureDocumentToSequence(documentFixture)} title="確認" onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: '確認' });
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog).toHaveClass('fixed', 'inset-0', 'h-dvh', 'w-full');
  expect(dialog).toHaveFocus();
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-layout', 'manuals');
  expect(screen.getByTestId('viewer')).toHaveAttribute('data-markers', 'false');
  expect(screen.getByTestId('viewer')).toHaveClass('h-full', 'w-full');
  const twoPages = screen.getByRole('button', { name: '2 ページ表示' });
  expect(twoPages).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(twoPages);
  expect(twoPages).toHaveAttribute('aria-pressed', 'true');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = originalOverflow;
  trigger.remove();
});
