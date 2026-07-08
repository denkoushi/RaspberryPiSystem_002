import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateToolbar } from '../InspectionDrawingCreateToolbar';

describe('InspectionDrawingCreateToolbar', () => {
  it('renders save status between save and return actions', () => {
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

    expect(screen.getByText('未保存あり')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '保存済み帳票' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeInTheDocument();
    expect(screen.getByText('保存').compareDocumentPosition(screen.getByText('未保存あり'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText('未保存あり').compareDocumentPosition(screen.getByText('一覧へ戻る'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});
