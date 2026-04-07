import { describe, expect, it } from 'vitest';
import { computeLoanGridLayout } from './compute-loan-grid-layout.js';
import type { LoanCardViewModel } from './loan-card-grid.dto.js';
import type { ToolGridConfig } from './tool-grid-config.js';

function card(id: string): LoanCardViewModel {
  return {
    primaryText: id,
    employeeName: 'x',
    clientLocation: '-',
    borrowedDatePart: '',
    borrowedTimePart: '',
    borrowedCompact: '',
    isInstrument: false,
    isRigging: false,
    managementText: '',
    riggingIdNumText: '',
    isExceeded: false,
    thumbnailDataUrl: null,
  };
}

describe('computeLoanGridLayout', () => {
  it('computes columns and overflow for compact24', () => {
    const config: ToolGridConfig = {
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      mode: 'SPLIT',
      showThumbnails: true,
      maxRows: 2,
      maxColumns: 4,
      cardLayout: 'splitCompact24',
      cardHeightPx: 164,
    };
    const items = Array.from({ length: 10 }, (_, i) => card(String(i)));
    const layout = computeLoanGridLayout(1920, config, items);
    expect(layout.columns).toBe(4);
    expect(layout.overflowCount).toBe(2);
    expect(layout.placed).toHaveLength(8);
    expect(layout.isEmpty).toBe(false);
  });

  it('marks empty when no cards', () => {
    const config: ToolGridConfig = {
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      mode: 'FULL',
      showThumbnails: false,
      maxRows: 2,
      maxColumns: 2,
    };
    const layout = computeLoanGridLayout(1920, config, []);
    expect(layout.isEmpty).toBe(true);
    expect(layout.placed).toHaveLength(0);
  });
});
