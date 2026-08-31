import { describe, expect, it, vi, afterEach } from 'vitest';

import { registerWorkInstructionRoutes } from '../../../routes/work-instructions/index.js';
import { getWorkInstructionServices, resetWorkInstructionServicesForTests } from '../work-instruction-service.factory.js';
import {
  getWorkInstructionGmailScheduler,
  resetWorkInstructionGmailSchedulerForTests,
} from '../work-instruction-gmail.scheduler.js';

afterEach(() => {
  resetWorkInstructionGmailSchedulerForTests();
  resetWorkInstructionServicesForTests();
});

describe('work-instruction Gmail scheduler wiring', () => {
  it('uses the same ingestion singleton that route registration resolves', () => {
    const app = {
      post: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    registerWorkInstructionRoutes(app as never);

    const services = getWorkInstructionServices();
    const scheduler = getWorkInstructionGmailScheduler();
    const schedulerInternals = scheduler as unknown as { ingestion: unknown };

    expect(schedulerInternals.ingestion).toBe(services.ingestion);
    expect(app.post).toHaveBeenCalledWith('/work-instructions/ingest', expect.any(Object), expect.any(Function));
    expect(app.get).toHaveBeenCalledWith('/work-instructions/groups', expect.any(Object), expect.any(Function));
  });
});
