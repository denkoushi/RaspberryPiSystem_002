import { describe, expect, it } from 'vitest';
import { PalletBoardRenderer } from '../pallet-board-renderer.js';

describe('PalletBoardRenderer', () => {
  const renderer = new PalletBoardRenderer();
  const config = { width: 1920, height: 1080, title: 'Test board' };

  it('renders JPEG for single-machine layout', async () => {
    const out = await renderer.render(
      {
        kind: 'pallet_board',
        machines: [
          {
            machineCd: 'M1',
            machineName: 'Machine 1',
            illustrationUrl: null,
            pallets: [
              { palletNo: 1, lines: [], isEmpty: true },
              {
                palletNo: 2,
                lines: ['line'],
                isEmpty: false,
                primaryItem: {
                  fhincd: 'C1',
                  fhinmei: '部品',
                  fseiban: 'S1',
                  machineNameDisplay: '機種',
                  plannedStartDateDisplay: '4/1',
                  plannedQuantity: 3,
                },
              },
            ],
          },
        ],
      },
      config,
    );
    expect(out.contentType).toBe('image/jpeg');
    expect(out.buffer.length).toBeGreaterThan(800);
  });

  it('renders JPEG for single-machine layout with very long FHI fields (no throw)', async () => {
    const out = await renderer.render(
      {
        kind: 'pallet_board',
        machines: [
          {
            machineCd: 'M1',
            machineName: 'Machine 1',
            illustrationUrl: null,
            pallets: [
              {
                palletNo: 1,
                lines: ['line'],
                isEmpty: false,
                primaryItem: {
                  fhincd: 'C1'.repeat(200),
                  fhinmei: '部品名'.repeat(80),
                  fseiban: 'S1'.repeat(200),
                  machineNameDisplay: '横形ボーリング／フライス横形ボーリング／フライス',
                  plannedStartDateDisplay: '2026-05-28',
                  plannedQuantity: 5,
                },
              },
            ],
          },
        ],
      },
      config,
    );
    expect(out.contentType).toBe('image/jpeg');
    expect(out.buffer.length).toBeGreaterThan(800);
  });

  it('renders JPEG for multi-machine layout', async () => {
    const out = await renderer.render(
      {
        kind: 'pallet_board',
        machines: [
          {
            machineCd: 'A',
            machineName: 'Ma',
            illustrationUrl: null,
            pallets: [{ palletNo: 1, lines: ['x'] }],
          },
          {
            machineCd: 'B',
            machineName: 'Mb',
            illustrationUrl: null,
            pallets: [{ palletNo: 1, lines: ['y'] }],
          },
        ],
      },
      config,
    );
    expect(out.contentType).toBe('image/jpeg');
    expect(out.buffer.length).toBeGreaterThan(800);
  });
});
