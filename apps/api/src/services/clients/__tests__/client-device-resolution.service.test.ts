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

  it('JWT認証済みの呼び出し元はキー無しでclientIdを解決できる', async () => {
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
      '無効なクライアントキーです'
    );
  });

  it('JWT認証済みの呼び出し元は端末未指定を許可する', async () => {
    const result = await resolveClientDeviceId(undefined, undefined);

    expect(result).toBeUndefined();
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('x-client-keyが配列なら先頭のキーを検証する', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-1' } as never);

    expect(await resolveClientDeviceId(undefined, ['k1', 'k2'])).toBe('client-1');
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'k1' } });
  });

  it.each([{ key: undefined }, { key: '' }, { key: '   ' }, { key: [] }])('必須のキーが無ければ401を返す ($key)', async ({ key }) => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);
    await expect(resolveClientDeviceId(undefined, key, true)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('clientId指定時もキーを検証する', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);
    await expect(resolveClientDeviceId('client-1', 'invalid-key')).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'invalid-key' } });
  });

  it('キーの端末と一致するclientIdを返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-1' } as never);
    expect(await resolveClientDeviceId('client-1', 'valid-key')).toBe('client-1');
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledTimes(1);
  });

  it('代理操作を許可していない端末のclientId不一致は403を返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'client-1', canProxyOtherDevices: false } as never);
    await expect(resolveClientDeviceId('client-2', 'valid-key')).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledTimes(1);
  });

  it('代理操作を許可した端末は登録済みclientIdを指定できる', async () => {
    vi.mocked(prisma.clientDevice.findUnique)
      .mockResolvedValueOnce({ id: 'client-1', canProxyOtherDevices: true } as never)
      .mockResolvedValueOnce({ id: 'client-2' } as never);
    expect(await resolveClientDeviceId('client-2', 'valid-key')).toBe('client-2');
    expect(prisma.clientDevice.findUnique).toHaveBeenNthCalledWith(1, { where: { apiKey: 'valid-key' } });
    expect(prisma.clientDevice.findUnique).toHaveBeenNthCalledWith(2, { where: { id: 'client-2' } });
  });

  it('代理操作でも未登録clientIdは404を返す', async () => {
    vi.mocked(prisma.clientDevice.findUnique)
      .mockResolvedValueOnce({ id: 'client-1', canProxyOtherDevices: true } as never)
      .mockResolvedValueOnce(null);
    await expect(resolveClientDeviceId('missing-client', 'valid-key')).rejects.toMatchObject({ statusCode: 404 });
  });
});
