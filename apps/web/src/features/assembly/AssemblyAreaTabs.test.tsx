import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyAreaTabs } from './AssemblyAreaTabs';
import { createAssemblyBoltAt, emptyAssemblyArea } from './assemblyTemplateDraft';

describe('AssemblyAreaTabs', () => {
  it('shows each process with its bolt count and switches the placement target', () => {
    const first = { ...emptyAssemblyArea(0), processNo: '10', areaCode: 'A', areaName: 'ベース' };
    const second = { ...emptyAssemblyArea(1), areaName: 'カバー' };
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    render(
      <AssemblyAreaTabs
        areas={[{ ...first, bolts: [createAssemblyBoltAt(first, 0.1, 0.1)] }, second]}
        selectedAreaId={first.id}
        incompleteAreaIds={new Set([second.id])}
        readOnly={false}
        onSelect={onSelect}
        onAdd={onAdd}
      />
    );

    expect(screen.getByRole('tab', { name: '10-A（締付 1か所）' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'カバー（締付 0か所・未完了）' }));
    expect(onSelect).toHaveBeenCalledWith(second.id);
    fireEvent.click(screen.getByRole('button', { name: '工程を追加' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
