import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeProcedureView } from './KnowledgeProcedureView';

import type { KnowledgeProcedureDocument } from '@raspi-system/shared-types';

vi.mock('../../components/ProtectedImage', () => ({
  ProtectedImage: ({ imagePath, alt }: { imagePath: string | null; alt: string }) => <img src={imagePath ?? undefined} alt={alt} />,
}));

const source = { kind: 'note' as const, ref: 'note-1', label: 'メモ 2026/09/20', quote: '受け面を拭いてから' };
const procedure = (overrides: Partial<KnowledgeProcedureDocument> = {}): KnowledgeProcedureDocument => ({
  formatVersion: 1, procedureId: 'proc-1', revisionId: 'rev-3', revisionNumber: 3, title: '部品Aの段取り', category: '段取り手順',
  identifiers: { partNumber: 'SAMPLE-0001', processName: '研削' }, reviewTier: 'approval_required', state: 'published',
  createdAt: '2026-09-27T00:00:00.000Z',
  steps: [
    { id: 's1', title: '治具を準備する', body: '治具Bを出す。', cautions: ['傷のある治具は使わない。'], needsReview: [],
      photos: [{ imageId: 'img-1', caption: '治具B' }], sources: [source] },
    { id: 's2', title: 'ワークを取り付ける', body: '<b>対角</b>の順に締める。', cautions: [], needsReview: ['締付トルクが食い違っています。'],
      photos: [], sources: [source, { kind: 'pdf_page', ref: 'doc-1#1', label: '作業要領書PDF 1ページ' }] },
  ],
  ...overrides,
});

describe('Knowledge procedure template', () => {
  it('shows numbered steps, cautions, review notes, photos and provenance', () => {
    const imagePathFor = vi.fn().mockReturnValue('/api/test-image');
    render(<KnowledgeProcedureView procedure={procedure()} imagePathFor={imagePathFor} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部品Aの段取り');
    expect(screen.getByText('品番 SAMPLE-0001')).toBeInTheDocument();
    expect(screen.getByText('承認済み')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').filter(item => item.closest('ol'));
    expect(within(steps[0]!).getByRole('heading')).toHaveTextContent('手順1');
    expect(screen.getByText('注意：傷のある治具は使わない。')).toBeInTheDocument();
    expect(screen.getByText('要確認：締付トルクが食い違っています。')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '治具B' })).toHaveAttribute('src', '/api/test-image');
    expect(imagePathFor).toHaveBeenCalledWith('img-1');
    expect(screen.getByText('出典（2件）')).toBeInTheDocument();
    expect(screen.getByText('作業要領書PDF 1ページ')).toBeInTheDocument();
  });

  it('renders model text as text, never as markup', () => {
    render(<KnowledgeProcedureView procedure={procedure()} imagePathFor={() => null} />);
    expect(screen.getByText('<b>対角</b>の順に締める。')).toBeInTheDocument();
  });

  it('walks one step at a time with previous and next', () => {
    render(<KnowledgeProcedureView procedure={procedure()} imagePathFor={() => null} />);
    fireEvent.click(screen.getByRole('button', { name: '1手順ずつ' }));
    expect(screen.getByText('手順 1 / 2')).toBeInTheDocument();
    expect(screen.queryByText('ワークを取り付ける')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '◀ 前へ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '次へ ▶' }));
    expect(screen.getByText('手順 2 / 2')).toBeInTheDocument();
    expect(screen.getByText('ワークを取り付ける')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次へ ▶' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '全体を表示' }));
    expect(screen.getByText('治具を準備する')).toBeInTheDocument();
  });

  it('labels AI-created procedures and offers an error report only when wired', () => {
    const onReportError = vi.fn();
    const { rerender } = render(<KnowledgeProcedureView procedure={procedure({ reviewTier: 'auto_publish' })} imagePathFor={() => null} />);
    expect(screen.getByText('AI作成')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '誤りを報告' })).not.toBeInTheDocument();
    rerender(<KnowledgeProcedureView procedure={procedure({ reviewTier: 'auto_publish' })} imagePathFor={() => null} onReportError={onReportError} />);
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    expect(onReportError).toHaveBeenCalledTimes(1);
  });

  it('marks unpublished revisions as awaiting approval', () => {
    render(<KnowledgeProcedureView procedure={procedure({ state: 'pending_approval' })} imagePathFor={() => null} />);
    expect(screen.getByRole('status')).toHaveTextContent('下書き・承認待ち');
  });
});
