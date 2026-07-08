import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateToolbar } from '../InspectionDrawingCreateToolbar';

describe('InspectionDrawingCreateToolbar', () => {
  it('renders save status as plain text and keeps right actions ordered', () => {
    render(
      <MemoryRouter>
        <InspectionDrawingCreateToolbar
          processGroup="cutting"
          onProcessGroupChange={vi.fn()}
          mode="place"
          onModeChange={vi.fn()}
          hasDrawingImage
          hasMeasurementPoints
          onSave={vi.fn()}
          saveStatus="dirty"
          savedPrintPath="/print"
          returnTo="/kiosk/part-measurement/inspection"
          returnLabel="一覧へ戻る"
        />
      </MemoryRouter>
    );

    const saveStatus = screen.getByText('未保存あり');
    expect(saveStatus).toBeInTheDocument();
    expect(saveStatus).not.toHaveClass('rounded');
    expect(saveStatus).not.toHaveClass('border');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '保存済み帳票' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeInTheDocument();
    expect(screen.getByText('テスト入力').parentElement).toHaveClass('ml-auto');
    expect(screen.getByText('保存').compareDocumentPosition(saveStatus)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(saveStatus.compareDocumentPosition(screen.getByText('テスト入力'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText('テスト入力').compareDocumentPosition(screen.getByText('ガイド試行'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText('ガイド試行').compareDocumentPosition(screen.getByText('保存済み帳票'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText('保存済み帳票').compareDocumentPosition(screen.getByText('一覧へ戻る'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});
