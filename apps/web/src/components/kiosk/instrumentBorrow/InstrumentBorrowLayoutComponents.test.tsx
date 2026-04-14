import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InstrumentBorrowInspectionItemCard } from './InstrumentBorrowInspectionItemCard';
import { InstrumentBorrowInspectionItemsGrid } from './InstrumentBorrowInspectionItemsGrid';
import { InstrumentBorrowTagUidFields } from './InstrumentBorrowTagUidFields';

import type { InspectionItem } from '../../../api/types';

const inspectionItem = {
  id: 'inspection-1',
  name: '外観確認',
  content: 'ひび割れがないこと',
  criteria: '異常なし',
  method: '目視'
} as InspectionItem;

describe('InstrumentBorrow layout components', () => {
  it('OK時は点検カードのフッターを表示しない', () => {
    render(<InstrumentBorrowInspectionItemCard item={inspectionItem} isNg={false} />);

    expect(screen.queryByText('❌ NG')).not.toBeInTheDocument();
    expect(screen.queryByText(/OK（氏名タグスキャンで自動送信）/)).not.toBeInTheDocument();
  });

  it('NG時は点検カードにNG表示を出す', () => {
    render(<InstrumentBorrowInspectionItemCard item={inspectionItem} isNg />);

    expect(screen.getByText('❌ NG')).toBeInTheDocument();
  });

  it('点検項目グリッドは2列レイアウト用クラスを持つ', () => {
    const { container } = render(
      <InstrumentBorrowInspectionItemsGrid>
        <div>left</div>
        <div>right</div>
      </InstrumentBorrowInspectionItemsGrid>
    );

    expect(container.firstChild).toHaveClass('grid', 'sm:grid-cols-2');
  });

  it('タグUID入力欄を横並び用のレイアウトで表示する', () => {
    render(
      <InstrumentBorrowTagUidFields
        instrumentTagUid="inst-001"
        onInstrumentTagUidChange={vi.fn()}
        instrumentInputDisabled={false}
        instrumentRequired
        employeeTagUid="emp-001"
        onEmployeeTagUidChange={vi.fn()}
        onEmployeeKeyDown={vi.fn()}
        employeeInputRef={createRef<HTMLInputElement>()}
        employeeInputDisabled
      />
    );

    expect(screen.getByLabelText('計測機器タグUID')).toHaveValue('inst-001');
    expect(screen.getByLabelText('氏名タグUID')).toHaveValue('emp-001');
    expect(screen.getByLabelText('氏名タグUID')).toBeDisabled();
  });
});
