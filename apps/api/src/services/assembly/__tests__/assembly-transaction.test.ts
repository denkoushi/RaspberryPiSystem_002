import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { lockAssemblyWorkSession } from '../assembly-work-session-lock.repository.js';
import {
  ASSEMBLY_TRANSACTION_OPTIONS,
  runAssemblyTransaction,
  runLockedAssemblyWorkSessionTransaction
} from '../assembly-transaction.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $transaction: vi.fn() }
}));

vi.mock('../assembly-work-session-lock.repository.js', () => ({
  lockAssemblyWorkSession: vi.fn()
}));

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];

    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('assembly transaction policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (work) => work({} as never));
  });

  it('uses one bounded max-wait and callback timeout for every assembly transaction', async () => {
    await expect(runAssemblyTransaction(async () => 'done')).resolves.toBe('done');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15_000,
      timeout: 30_000
    });
    expect(ASSEMBLY_TRANSACTION_OPTIONS).toEqual({ maxWait: 15_000, timeout: 30_000 });
    expect(Object.isFrozen(ASSEMBLY_TRANSACTION_OPTIONS)).toBe(true);
  });

  it('locks and loads a work session before invoking the shared mutation callback', async () => {
    const session = { id: 'session-1' } as never;
    vi.mocked(lockAssemblyWorkSession).mockResolvedValue(session);
    const work = vi.fn(async () => 'updated');

    await expect(runLockedAssemblyWorkSessionTransaction('session-1', work)).resolves.toBe('updated');

    expect(lockAssemblyWorkSession).toHaveBeenCalledWith(expect.any(Object), 'session-1');
    expect(work).toHaveBeenCalledWith(expect.any(Object), session);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      ASSEMBLY_TRANSACTION_OPTIONS
    );
  });

  it('prevents assembly and torque-wrench services from bypassing the shared policy', () => {
    const servicesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const policyFile = join(servicesRoot, 'assembly', 'assembly-transaction.ts');
    const sourceFiles = ['assembly', 'torque-wrenches'].flatMap((directory) =>
      listProductionTypeScriptFiles(join(servicesRoot, directory))
    );
    const bypasses = sourceFiles
      .filter((file) => file !== policyFile)
      .filter((file) => readFileSync(file, 'utf8').includes('prisma.$transaction'));

    expect(bypasses).toEqual([]);
  });
});
