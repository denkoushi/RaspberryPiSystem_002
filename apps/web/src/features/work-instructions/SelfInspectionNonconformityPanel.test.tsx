import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionNonconformityPanel } from './SelfInspectionNonconformityPanel';

import type { SelfInspectionNonconformity } from '../../api/domains/self-inspection-nonconformities';

const item: SelfInspectionNonconformity = {
  id: 'nonconformity-1',
  discoveredOn: '2026-09-02',
  originDepartmentName: '製造一課',
  remarks: '寸法不良',
  nonconformityContent: '加工面に傷',
  dispositionContent: '再加工',
  correctiveContent1: '工具交換',
  correctiveContent2: '初品確認を追加',
  partName: '部品A',
  machineName: 'FJV50/80'
};

describe('SelfInspectionNonconformityPanel', () => {
  it('is collapsed by default and exposes each field after expansion', () => {
    render(<SelfInspectionNonconformityPanel items={[item]} />);

    const toggle = screen.getByRole('button', { name: '不適合情報（1件）' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '不適合情報' })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: '不適合情報' });
    for (const value of [
      '発見日',
      '2026-09-02',
      '起因部署',
      '製造一課',
      '備考',
      '寸法不良',
      '不適合内容',
      '加工面に傷',
      '処置内容',
      '再加工',
      '是正内容1',
      '工具交換',
      '是正内容2',
      '初品確認を追加',
      '部品名',
      '部品A',
      '機種名',
      'FJV50/80'
    ]) {
      expect(region).toHaveTextContent(value);
    }

    fireEvent.click(screen.getByRole('button', { name: '不適合情報を閉じる' }));
    expect(screen.queryByRole('region', { name: '不適合情報' })).not.toBeInTheDocument();
  });

  it('keeps all current rows in the scrollable list', () => {
    render(
      <SelfInspectionNonconformityPanel
        items={[item, { ...item, id: 'nonconformity-2', remarks: '別の不適合' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '不適合情報（2件）' }));

    expect(screen.getByRole('list', { name: '不適合情報一覧' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('別の不適合')).toBeInTheDocument();
  });

  it('shows unregistered fallback only for part and machine names', () => {
    render(
      <SelfInspectionNonconformityPanel
        items={[{ ...item, remarks: null, partName: null, machineName: '' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '不適合情報（1件）' }));

    expect(screen.getAllByText('未登録')).toHaveLength(2);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps request failures local and offers retry', () => {
    const onRetry = vi.fn();
    render(
      <SelfInspectionNonconformityPanel
        isLoading={false}
        errorMessage="不適合情報を取得できませんでした。"
        onRetry={onRetry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '不適合情報' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不適合情報を取得できませんでした。');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render a header control for a successful empty response', () => {
    render(<SelfInspectionNonconformityPanel />);
    expect(screen.queryByRole('button', { name: '不適合情報' })).not.toBeInTheDocument();
  });
});
