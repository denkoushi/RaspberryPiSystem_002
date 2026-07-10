import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateToolbar } from '../InspectionDrawingCreateToolbar';

describe('InspectionDrawingCreateToolbar', () => {
  it('keeps only test, guided trial, and return actions in the right group', () => {
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

    const primary = within(screen.getByTestId('inspection-drawing-create-toolbar-primary-actions'));
    const secondary = within(screen.getByTestId('inspection-drawing-create-toolbar-secondary-actions'));

    expect(primary.getByRole('button', { name: '切削' })).toBeInTheDocument();
    expect(primary.queryByRole('button', { name: '点を配置' })).not.toBeInTheDocument();
    expect(primary.queryByRole('button', { name: '丸数字' })).not.toBeInTheDocument();
    expect(primary.queryByRole('button', { name: '指差し' })).not.toBeInTheDocument();
    expect(primary.queryByRole('button', { name: '矢視' })).not.toBeInTheDocument();
    expect(primary.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(primary.getByText('未保存あり')).toBeInTheDocument();
    expect(primary.getByRole('link', { name: '保存済み帳票' })).toBeInTheDocument();

    expect(secondary.getByRole('button', { name: 'テスト入力' })).toBeInTheDocument();
    expect(secondary.getByRole('button', { name: 'ガイド試行' })).toBeInTheDocument();
    expect(secondary.getByRole('link', { name: '一覧へ戻る' })).toBeInTheDocument();
    expect(secondary.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });
});
