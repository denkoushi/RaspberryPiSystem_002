import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ManualOrderLowerPaneCollapsibleToolbar } from './ManualOrderLowerPaneCollapsibleToolbar';

describe('ManualOrderLowerPaneCollapsibleToolbar', () => {
  it('reflects expanded=false on the collapsible region', () => {
    render(
      <ManualOrderLowerPaneCollapsibleToolbar
        title="生産スケジュール（既存UI）"
        statusMessage={null}
        expanded={false}
        onTriggerEnter={() => {}}
        onPanelMouseEnter={() => {}}
        onPanelMouseLeave={() => {}}
      >
        <span>toolbar-body</span>
      </ManualOrderLowerPaneCollapsibleToolbar>
    );

    const region = screen.getByRole('region', { name: '生産スケジュールの検索と資源フィルタ' });
    expect(region).toHaveAttribute('aria-expanded', 'false');
    expect(region.className).toContain('max-h-0');
  });

  it('reflects expanded=true on the collapsible region', () => {
    render(
      <ManualOrderLowerPaneCollapsibleToolbar
        title="生産スケジュール（既存UI）"
        statusMessage="status"
        expanded
        onTriggerEnter={() => {}}
        onPanelMouseEnter={() => {}}
        onPanelMouseLeave={() => {}}
      >
        <span>toolbar-body</span>
      </ManualOrderLowerPaneCollapsibleToolbar>
    );

    const region = screen.getByRole('region', { name: '生産スケジュールの検索と資源フィルタ' });
    expect(region).toHaveAttribute('aria-expanded', 'true');
    expect(region.className).toContain('max-h-[');
    expect(screen.getByText('status')).toBeInTheDocument();
  });
});
