import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { emptyShelfFilters, filterShelfMaterials, filterShelfWorkInstructions, ShelfFilterChips, ShelfHighlight, shelfPeriodMatches } from './procedure-material-shelf-search';

import type { ProcedureMaterialDto } from './procedure-material-types';

const candidate = { candidateKey: 'work:1', partNumber: 'MH-1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset', alreadyImported: false };

describe('material shelf search boundaries', () => {
  it('marks all normalized case-insensitive matches and skips text whose normalization changes its length', () => {
    const { container } = render(<><ShelfHighlight text="MH-1 / mh-1" query="ＭＨ－１" /><ShelfHighlight text="㍉ MH-1" query="MH-1" /></>);
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['MH-1', 'mh-1']);
    expect(container).toHaveTextContent('㍉ MH-1');
  });
  it('skips highlighting when expansion and composition cancel out in length', () => {
    const { container } = render(<ShelfHighlight text={'\ufb00e\u0301'} query="é" />);
    expect(container.querySelector('mark')).toBeNull();
  });
  it('includes only Gmail PDF page photos alongside PDF rows without removing them from photo results', () => {
    const material = { id: 'pdf', kind: 'PDF', origin: 'GMAIL' } as ProcedureMaterialDto;
    const page = { ...material, id: 'page', kind: 'PHOTO', originalFileName: 'scan p12.JPG' } as ProcedureMaterialDto;
    const photo = { ...page, id: 'photo', originalFileName: 'scan.jpg' };
    const rows = [material, page, photo, { ...page, id: 'work', origin: 'WORK_INSTRUCTION' } as ProcedureMaterialDto,
      { ...page, id: 'no-space', originalFileName: 'scanp1.jpg' }, { ...page, id: 'no-number', originalFileName: 'scan p.jpg' },
      { ...page, id: 'suffix', originalFileName: 'scan p1.jpg.png' }, { ...page, id: 'null', originalFileName: null }];
    expect(filterShelfMaterials(rows, { ...emptyShelfFilters, kinds: ['PDF'] })).toEqual([material, page]);
    expect(filterShelfMaterials(rows, { ...emptyShelfFilters, kinds: ['PHOTO'] })).toEqual(rows.slice(1));
    expect(filterShelfMaterials(rows, { ...emptyShelfFilters, kinds: ['PHOTO', 'PDF'] })).toEqual(rows);
  });
  it('uses local midnight for today, includes the seven-day boundary and excludes missing or future dates', () => {
    const now = new Date(2026, 9, 8, 12).getTime();
    expect(shelfPeriodMatches(new Date(2026, 9, 8, 0).toISOString(), 1, now)).toBe(true);
    expect(shelfPeriodMatches(new Date(2026, 9, 7, 23, 59).toISOString(), 1, now)).toBe(false);
    expect(shelfPeriodMatches(new Date(now - 7 * 86400000).toISOString(), 7, now)).toBe(true);
    expect(shelfPeriodMatches(new Date(now - 7 * 86400000 - 1).toISOString(), 7, now)).toBe(false);
    expect(shelfPeriodMatches(undefined, 7, now)).toBe(false);
    expect(shelfPeriodMatches(new Date(now + 1).toISOString(), 7, now)).toBe(false);
  });
  it('offers periods for processing candidates with dates and filters their source modification time', () => {
    const recent = { ...candidate, sourceModified: new Date(Date.now() - 1000).toISOString() };
    const old = { ...candidate, candidateKey: 'work:2', sourceModified: new Date(Date.now() - 31 * 86400000).toISOString() };
    const filters = { ...emptyShelfFilters, days: 7 };
    render(<ShelfFilterChips tab="workInstruction" hasWorkDates filters={filters} disabled={false} onChange={vi.fn()} />);
    expect(within(screen.getByLabelText('素材の絞り込み')).getByRole('button', { name: '7日' })).toHaveAttribute('aria-pressed', 'true');
    expect(filterShelfWorkInstructions([recent, old, candidate], filters)).toEqual([recent]);
    expect(filterShelfWorkInstructions([candidate], filters)).toEqual([candidate]);
  });
});
