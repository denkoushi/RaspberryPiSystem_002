import { describe, expect, it, vi } from 'vitest';

import { MachineNameCatalogRepository } from '../machine-name-catalog.repository.js';

describe('MachineNameCatalogRepository', () => {
  it('shares one in-flight load and reuses the result within TTL', async () => {
    const entries = [{ fseiban: 'FS-1', machineName: 'L300KP', source: 'production_schedule' as const }];
    const dataSource = { load: vi.fn().mockResolvedValue(entries) };
    const repository = new MachineNameCatalogRepository(dataSource, () => 60_000);

    const [first, second] = await Promise.all([repository.list(), repository.list()]);
    const third = await repository.list();

    expect(first).toBe(entries);
    expect(second).toBe(entries);
    expect(third).toBe(entries);
    expect(dataSource.load).toHaveBeenCalledTimes(1);
  });

  it('loads again after explicit import invalidation', async () => {
    const dataSource = { load: vi.fn().mockResolvedValue([]) };
    const repository = new MachineNameCatalogRepository(dataSource, () => 60_000);
    await repository.list();

    repository.invalidate();
    await repository.list();

    expect(dataSource.load).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the cache with a load invalidated while in flight', async () => {
    let resolveFirst!: (entries: []) => void;
    const first = new Promise<[]>((resolve) => {
      resolveFirst = resolve;
    });
    const dataSource = { load: vi.fn().mockReturnValueOnce(first).mockResolvedValue([]) };
    const repository = new MachineNameCatalogRepository(dataSource, () => 60_000);
    const staleLoad = repository.list();

    repository.invalidate();
    resolveFirst([]);
    await staleLoad;
    await repository.list();

    expect(dataSource.load).toHaveBeenCalledTimes(2);
  });
});
