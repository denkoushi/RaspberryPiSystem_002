import { describe, expect, it, vi } from 'vitest';

import { AssemblyMachineNameCandidatesService } from '../assembly-machine-name-candidates.service.js';

describe('AssemblyMachineNameCandidatesService', () => {
  it('normalizes, de-duplicates, applies digit/text AND filters, and sorts naturally', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue([
        { fseiban: 'A', machineName: ' L300KP-10 ', source: 'production_schedule' },
        { fseiban: 'B', machineName: 'Ｌ３００ｋｐ－２', source: 'supplement' },
        { fseiban: 'C', machineName: 'l300kp-10', source: 'supplement' },
        { fseiban: 'D', machineName: 'L301KP-1', source: 'production_schedule' },
        { fseiban: 'E', machineName: '機種名未登録', source: 'supplement' },
      ]),
    };
    const service = new AssemblyMachineNameCandidatesService(repository);

    const result = await service.list({ digitQuery: '300', q: 'ＫＰ', limit: 40 });

    expect(result).toEqual({
      candidates: ['Ｌ３００ｋｐ－２', 'L300KP-10'],
      hasMore: false,
    });
  });

  it('returns a stable limited page and reports additional candidates', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue(
        Array.from({ length: 42 }, (_, index) => ({
          fseiban: `FS-${index}`,
          machineName: `MODEL-${index + 1}`,
          source: 'supplement' as const,
        }))
      ),
    };
    const service = new AssemblyMachineNameCandidatesService(repository);

    const result = await service.list({ limit: 40 });

    expect(result.candidates).toHaveLength(40);
    expect(result.candidates.slice(0, 3)).toEqual(['MODEL-1', 'MODEL-2', 'MODEL-3']);
    expect(result.hasMore).toBe(true);
  });
});
