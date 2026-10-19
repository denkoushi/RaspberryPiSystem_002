import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { SignageRenderer } from '../signage.renderer.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      findUnique: vi.fn(),
    },
    clientStatus: {
      findUnique: vi.fn(),
    },
  },
}));

type MetricsReader = {
  getClientSystemMetricsText: () => Promise<string | null>;
};

describe('SignageRenderer Pi3 client metrics identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads ClientStatus by the stable status-agent client id without an API-key lookup', async () => {
    vi.mocked(prisma.clientStatus.findUnique).mockResolvedValue({
      clientId: 'raspberrypi3-signage1',
      cpuUsage: 42.4,
      temperature: 51.2,
    } as never);

    const renderer = Object.create(SignageRenderer.prototype) as MetricsReader;
    const result = await renderer.getClientSystemMetricsText();

    expect(result).toBe('CPU 42%  Temp 51.2°C');
    expect(prisma.clientStatus.findUnique).toHaveBeenCalledWith({
      where: { clientId: 'raspberrypi3-signage1' },
    });
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });
});
