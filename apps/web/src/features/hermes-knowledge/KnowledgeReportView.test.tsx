import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeReportView } from './KnowledgeReportView';

import type { KnowledgeReport } from '@raspi-system/shared-types';


vi.mock('../../components/ProtectedImage', () => ({
  ProtectedImage: ({ imagePath, alt }: { imagePath: string | null; alt: string }) => <img src={imagePath ?? undefined} alt={alt} />,
}));

const report: KnowledgeReport = {
  formatVersion: 1, topicId: 'painting', title: '金属塗装の実技準備',
  sections: [{
    sourceId: 'source-1', capturedAt: '2026-09-15T00:00:00.000Z', title: '練習の準備', category: '実技準備',
    summary: 'マスキングを練習する。', originalText: '先にマスキングを練習した。',
    photos: [{ imageId: 'image-1', description: '練習用の板' }],
    pdf: { assetId: 'pdf-1', filename: '準備資料.pdf', pageNumber: 2, extraction: 'ocr' },
  }],
};

describe('Knowledge report template', () => {
  it('shows headings, photographs, original text and PDF page provenance', () => {
    const imagePathFor = vi.fn().mockReturnValue('/api/test-protected-image');
    render(<KnowledgeReportView report={report} imagePathFor={imagePathFor} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('金属塗装');
    expect(screen.getByRole('img', { name: '練習用の板' })).toHaveAttribute('src', '/api/test-protected-image');
    expect(imagePathFor).toHaveBeenCalledWith('source-1', 'image-1');
    expect(screen.getByText(/準備資料.pdf — 2ページ/)).toBeInTheDocument();
    expect(screen.getByText(/文字はOCR/)).toBeInTheDocument();
    expect(screen.getByText('先にマスキングを練習した。')).toBeInTheDocument();
  });

  it('renders model HTML as text and exposes unreadable pages explicitly', () => {
    const unsafe = '<img src=x onerror=alert(1)><script>evil()</script>';
    const changed: KnowledgeReport = { ...report, sections: [{ ...report.sections[0]!, summary: unsafe, photos: [], pdf: { ...report.sections[0]!.pdf!, extraction: 'unreadable' } }] };
    const { container } = render(<KnowledgeReportView report={changed} imagePathFor={() => null} />);
    expect(screen.getByText(unsafe)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('文字を読み取れませんでした');
  });
});
