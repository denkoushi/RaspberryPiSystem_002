import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listClientDevices,
  storeClientLogs,
  upsertClientHeartbeat,
} from '../client-telemetry.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    clientLog: {
      createMany: vi.fn(),
    },
  },
}));

describe('client-telemetry.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('heartbeatをclientDeviceへupsertする', async () => {
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({
      id: 'device-1',
      name: 'kiosk-1',
    } as never);

    await upsertClientHeartbeat({
      apiKey: 'api-key-1',
      name: 'kiosk-1',
      location: null,
    });

    expect(prisma.clientDevice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.clientDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { apiKey: 'api-key-1' },
        create: expect.objectContaining({ name: 'kiosk-1', apiKey: 'api-key-1' }),
      })
    );
  });

  it('clientDevice一覧をname昇順で取得する', async () => {
    vi.mocked(prisma.clientDevice.findMany).mockResolvedValue([
      { id: 'device-a', name: 'A' },
      { id: 'device-b', name: 'B' },
    ] as never);

    const result = await listClientDevices();

    expect(result).toHaveLength(2);
    expect(prisma.clientDevice.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('storeClientLogsはmessageを1000文字に切り詰めて保存する', async () => {
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientLog.createMany).mockResolvedValue({ count: 1 } as never);
    const longMessage = 'x'.repeat(1500);

    const result = await storeClientLogs({
      clientKey: 'client-key-1',
      clientId: 'client-1',
      requestId: 'req-logs',
      logs: [{ level: 'ERROR', message: longMessage }],
    });

    expect(result).toEqual({ requestId: 'req-logs', logsStored: 1 });
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          clientId: 'client-1',
          level: 'ERROR',
          message: 'x'.repeat(1000),
        }),
      ],
    });
  });
});

