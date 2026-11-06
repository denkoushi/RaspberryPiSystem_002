import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../services/mobile-placement/haizen-overview.service.js', () => ({ listHaizenOverview: vi.fn() }));
vi.mock('../../services/mobile-placement/schedule-seiban-status.service.js', () => ({ listHaizenUnplacedParts: vi.fn(), listScheduleSeibans: vi.fn(), getScheduleSeiban: vi.fn() }));
import { requireClientDevice } from '../kiosk/shared.js';
import { listHaizenOverview } from '../../services/mobile-placement/haizen-overview.service.js';
import { listHaizenUnplacedParts } from '../../services/mobile-placement/schedule-seiban-status.service.js';
import { registerMobilePlacementRoutes } from '../mobile-placement/index.js';

afterEach(() => vi.resetAllMocks());
describe('haizen overview routes', () => {
  it('authenticates both endpoints and exempts both from rate limits', async () => {
    const app = Fastify();
    await app.register(rateLimit, { max: 1 });
    await registerMobilePlacementRoutes(app);
    vi.mocked(requireClientDevice).mockResolvedValue({} as never);
    const part = { fseiban: 'BA1', productNo: '1', fhincd: 'P1', fhinmei: '部品', verified: false, machineName: null, dueDate: null };
    vi.mocked(listHaizenUnplacedParts).mockResolvedValue([part]);
    vi.mocked(listHaizenOverview).mockResolvedValue({ rows: [], truncated: false });
    try {
      for (const url of ['/mobile-placement/haizen-overview', '/mobile-placement/haizen-overview/unplaced-parts']) {
        for (let i = 0; i < 2; i++) {
          const result = await app.inject({ url, headers: { 'x-client-key': 'key' } });
          expect(result.statusCode).toBe(200);
          expect(result.json()).toEqual(url.endsWith('unplaced-parts') ? [part] : { rows: [], truncated: false });
        }
      }
      expect(requireClientDevice).toHaveBeenCalledWith('key');
    } finally { await app.close(); }
  });
  it('does not read data when authentication fails', async () => {
    const app = Fastify();
    await registerMobilePlacementRoutes(app);
    vi.mocked(requireClientDevice).mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    try {
      for (const url of ['/mobile-placement/haizen-overview', '/mobile-placement/haizen-overview/unplaced-parts']) expect((await app.inject({ url })).statusCode).toBe(401);
      expect(listHaizenOverview).not.toHaveBeenCalled();
      expect(listHaizenUnplacedParts).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
