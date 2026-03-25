import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveClientDeviceId } from '../client-device-resolution.service.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      findUnique: vi.fn(),
    },
  },
}));

describe('client-device-resolution.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clientIdが指定されている場合はID検索で返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-1' } as never);

    const result = await resolveClientDeviceId('client-1', undefined);

    expect(result).toBe('client-1');
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { id: 'client-1' } });
  });

  it('clientIdが不正な場合は404エラーを返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);

    await expect(resolveClientDeviceId('missing-client', undefined)).rejects.toThrow(ApiError);
    await expect(resolveClientDeviceId('missing-client', undefined)).rejects.toThrow(
      '指定されたクライアントが存在しません'
    );
  });

  it('clientId未指定でx-client-keyが文字列の場合はAPIキー検索で返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-by-key' } as never);

    const result = await resolveClientDeviceId(undefined, 'client-api-key');

    expect(result).toBe('client-by-key');
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({
      where: { apiKey: 'client-api-key' },
    });
  });

  it('x-client-keyが不正な場合は401エラーを返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);

    await expect(resolveClientDeviceId(undefined, 'invalid-key')).rejects.toThrow(ApiError);
    await expect(resolveClientDeviceId(undefined, 'invalid-key')).rejects.toThrow(
      'クライアント API キーが不正です'
    );
  });

  it('clientIdもx-client-keyも未指定ならundefinedを返す', async () => {
    const result = await resolveClientDeviceId(undefined, undefined);

    expect(result).toBeUndefined();
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('x-client-keyが配列なら解決せずundefinedを返す', async () => {
    const result = await resolveClientDeviceId(undefined, ['k1', 'k2']);

    expect(result).toBeUndefined();
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });
});
