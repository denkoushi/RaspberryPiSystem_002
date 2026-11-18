import process from 'node:process';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../../lib/logger.js', () => ({ logger: { level: 'info' } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $disconnect: mocks.disconnect } }));
vi.mock('../procedure-dictation-evaluation.service.js', () => ({ evaluateProcedureDictation: mocks.evaluate }));

it('runs the CLI against an already running model and prints the result', async () => {
  const argv = process.argv;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const result = { site: 'assembly', dictationLearningAdopted: false };
  mocks.evaluate.mockResolvedValue({ result });
  process.argv = ['node', 'evaluate-procedure-dictation.js', '--site', 'assembly'];
  try {
    await import('../../../scripts/evaluate-procedure-dictation.js');
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith('assembly', { manageRuntime: false });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result));
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  } finally {
    process.argv = argv;
    log.mockRestore();
  }
});
