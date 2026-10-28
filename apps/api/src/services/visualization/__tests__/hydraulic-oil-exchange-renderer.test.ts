import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildHydraulicOilExchangeSvg, HydraulicOilExchangeRenderer } from '../renderers/hydraulic-oil-exchange/hydraulic-oil-exchange-renderer.js';
import type { TableVisualizationData } from '../visualization.types.js';

const config = { width: 1920, height: 1080 };
const data: TableVisualizationData = {
  kind: 'table', columns: [], rows: [
    { equipmentManagementNumber: 'M1', machineName: 'ｍｃ-１', subText: 'MC', cycle: '半年１回', state: 'overdue', remainingDays: -12, lastDate: '2026-04-16', nextDate: '2026-10-16' },
    { equipmentManagementNumber: 'M2', machineName: '旋盤', cycle: '年１回', state: 'ok', remainingDays: 90, lastDate: '2026-01-26', nextDate: '2027-01-26' },
  ], metadata: { today: '2026-10-28', counts: { overdue: 1, soon: 0, ok: 1, unknown: 0 } },
};
describe('HydraulicOilExchangeRenderer', () => {
  it('renders a 1920x1080 JPEG', async () => {
    const output = await new HydraulicOilExchangeRenderer().render(data, config);
    expect(output.contentType).toBe('image/jpeg');
    expect(Buffer.isBuffer(output.buffer)).toBe(true);
    expect(await sharp(output.buffer).metadata()).toMatchObject({ format: 'jpeg', width: 1920, height: 1080 });
  });
  it('shows normalized names, cycles, urgency, dates, and count chips without a progress bar', () => {
    const svg = buildHydraulicOilExchangeSvg(data, config);
    for (const text of ['MC-1', '>6M</text>', '>Y</text>', '日超過', 'あと', '2026/10/28', '2026/04/16', '→ 2026/10/16', '1 超過', '0 30日以内', '1 余裕あり']) expect(svg).toContain(text);
    expect(svg).not.toMatch(/progress|<[^>]*\bbar\b/i);
  });
  it('preserves the twelve-card 4x3 layout at 1080p', () => {
    const svg = buildHydraulicOilExchangeSvg({ ...data, rows: Array.from({ length: 12 }, () => data.rows[0]) }, config);
    expect(svg.match(/data-card=/g)).toHaveLength(12);
    expect(svg).toContain('<rect x="40" y="140" width="445" height="286.6666666666667"');
    expect(svg).toContain('<rect x="505" y="140"');
    expect(svg).toContain('<rect x="40" y="446.6666666666667"');
    expect(svg).toContain('font-size="44.16"');
  });
  it.each([
    [13, 6, 4], [20, 6, 4], [24, 6, 4], [25, 8, 6], [46, 8, 6], [48, 8, 6], [49, 8, 6],
  ])('renders %i rows in a %i-column, %i-row grid, capped at the first 48', (count, columns, rows) => {
    const many = { ...data, rows: Array.from({ length: count }, (_, index) => ({
      ...data.rows[index % 2], machineName: `MC${String(index).padStart(2, '0')}`,
      ...(index > 1 ? { state: 'none' } : {}),
    })) };
    const svg = buildHydraulicOilExchangeSvg(many, config);
    const cards = [...svg.matchAll(/<g data-card="\d+">\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
    expect(cards).toHaveLength(Math.min(count, 48));
    for (let index = 0; index < Math.min(count, 48); index++) {
      expect(svg).toContain(`>${many.rows[index].machineName}</text>`);
      expect(Number(cards[index][1]) + Number(cards[index][3])).toBeLessThanOrEqual(1880);
      expect(Number(cards[index][2]) + Number(cards[index][4])).toBeLessThanOrEqual(1040);
    }
    expect(new Set(cards.map((card) => card[1])).size).toBe(columns);
    expect(Number(cards[columns - 1][2])).toBe(140);
    expect(Number(cards[columns][1])).toBe(40);
    expect(Number(cards[columns][2])).toBeCloseTo(140 + (900 + 80 / columns) / rows);
    expect(svg).not.toContain('>MC48</text>');
    expect(svg.match(/→ /g)).toHaveLength(2);
    expect(svg.split('<g data-card=')[0]).toBe(buildHydraulicOilExchangeSvg(data, config).split('<g data-card=')[0]);
    const nameSize = Number(svg.match(/font-size="([^"]+)"[^>]*>MC00<\/text>/)?.[1]);
    // 残り日数の数字だけは名前より大きくしてよい
    const cardSizes = [...svg.slice(svg.indexOf('<g data-card=')).matchAll(/font-size="([^"]+)"(?! font-weight="700">\d)/g)].map((match) => Number(match[1]));
    expect(Math.max(...cardSizes)).toBe(nameSize);
  });
  it('escapes XML, ellipsizes long names and handles unknown cycles', () => {
    const svg = buildHydraulicOilExchangeSvg({ ...data, rows: [
      { machineName: '<&', equipmentManagementNumber: '<&', subText: '"maker"', cycle: '<&', remainingDays: null, state: 'unknown' },
      { machineName: '長い加工機名称長い加工機名称長い加工機名称', cycle: '6M' },
    ] }, config);
    expect(svg).toContain('&lt;&amp;');
    expect(svg).toContain('…');
    expect(svg).toContain('—');
    expect(svg).not.toContain('<&');
  });
  it('renders six none cards without dates or cycle pills alongside dated machines', () => {
    const svg = buildHydraulicOilExchangeSvg({ ...data, rows: [...data.rows,
      ...Array.from({ length: 6 }, (_, i) => ({ equipmentManagementNumber: `N${i}`, machineName: `MC${i}`, state: 'none', cycle: null })),
    ] }, config);
    expect(svg.match(/data-card=/g)).toHaveLength(8);
    expect(svg.match(/次回から/g)).toHaveLength(6);
    expect(svg.match(/→ /g)).toHaveLength(2);
    expect(svg).not.toContain('半年');
    expect(svg).not.toContain('年１回');
  });
  it('renders empty and error messages', () => {
    expect(buildHydraulicOilExchangeSvg({ ...data, rows: [] }, config)).toContain('作動油交換の記録はありません');
    expect(buildHydraulicOilExchangeSvg({ ...data, metadata: { error: '<failure>' } }, config)).toContain('データ取得エラー: &lt;failure&gt;');
    expect(buildHydraulicOilExchangeSvg({ kind: 'series', labels: [], datasets: [] }, config)).toContain('可視化データが不正です');
  });
});
