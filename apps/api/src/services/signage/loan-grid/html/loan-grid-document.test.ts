import { describe, expect, it } from 'vitest';
import { buildLoanGridHtmlDocument } from './loan-grid-document.js';
import type { LoanGridRenderRequest } from '../loan-grid-rasterizer.port.js';

describe('buildLoanGridHtmlDocument', () => {
  it('emits empty-state markup when isEmpty', () => {
    const request: LoanGridRenderRequest = {
      canvasWidth: 1920,
      config: {
        x: 0,
        y: 0,
        width: 400,
        height: 120,
        mode: 'FULL',
        showThumbnails: false,
      },
      layout: {
        gap: 14,
        columns: 2,
        cardWidth: 180,
        cardHeight: 140,
        overflowCount: 0,
        scale: 1,
        placed: [],
        isEmpty: true,
      },
    };
    const html = buildLoanGridHtmlDocument(request);
    expect(html).toContain('表示するアイテムがありません');
    expect(html).toContain('<!DOCTYPE html>');
  });

  /**
   * Playwright での実描画は Chromium 依存のため CI では省略する。
   * 手元検証: SIGNAGE_LOAN_GRID_ENGINE=playwright_html と chromium install 後に design:preview 等で確認。
   */
  it('includes grid wrapper when cards exist', () => {
    const request: LoanGridRenderRequest = {
      canvasWidth: 1920,
      config: {
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        mode: 'FULL',
        showThumbnails: false,
        cardLayout: 'default',
      },
      layout: {
        gap: 14,
        columns: 1,
        cardWidth: 300,
        cardHeight: 140,
        overflowCount: 0,
        scale: 1,
        placed: [
          {
            x: 0,
            y: 0,
            width: 300,
            height: 140,
            view: {
              primaryText: 'Tool A',
              employeeName: '太郎',
              clientLocation: 'Area',
              borrowedDatePart: '01/01',
              borrowedTimePart: '10:00',
              borrowedCompact: '',
              isInstrument: false,
              isRigging: false,
              managementText: 'M1',
              riggingIdNumText: '',
              isExceeded: false,
              thumbnailDataUrl: null,
            },
          },
        ],
        isEmpty: false,
      },
    };
    const html = buildLoanGridHtmlDocument(request);
    expect(html).toContain('class="grid"');
    expect(html).toContain('Tool A');
  });

  it('compact24 kiosk rigging omits footer monospace code and empty thumb column', () => {
    const request: LoanGridRenderRequest = {
      canvasWidth: 1920,
      config: {
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        mode: 'SPLIT',
        showThumbnails: true,
        cardLayout: 'splitCompact24',
      },
      layout: {
        gap: 14,
        columns: 1,
        cardWidth: 220,
        cardHeight: 154,
        overflowCount: 0,
        scale: 1,
        placed: [
          {
            x: 0,
            y: 0,
            width: 220,
            height: 154,
            view: {
              primaryText: 'てこ式',
              employeeName: '山田',
              clientLocation: '第2工場',
              borrowedDatePart: '',
              borrowedTimePart: '',
              borrowedCompact: '04/03・12:02',
              isInstrument: false,
              isRigging: true,
              managementText: 'RG-22',
              riggingIdNumText: '旧:101',
              isExceeded: false,
              thumbnailDataUrl: null,
              compactKioskLines: {
                headLine: 'RG-22',
                nameLine: 'てこ式',
                idNumValue: '101',
              },
            },
          },
        ],
        isEmpty: false,
      },
    };
    const html = buildLoanGridHtmlDocument(request);
    expect(html).toContain('RG-22');
    expect(html).toContain('101');
    expect(html).not.toContain('font-family:monospace');
    expect(html).not.toContain('旧:');
  });
});
