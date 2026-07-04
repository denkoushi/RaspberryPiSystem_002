import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

type UnifiedListItem = {
  id: string;
  type: 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR';
  name: string;
  code: string;
  category?: string | null;
  storageLocation?: string | null;
  status: string;
  nfcTagUid?: string | null;
};

describe('GET /api/tools/unified integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let viewerToken: string;
  let searchToken: string;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    searchToken = `unified-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await prisma.riggingGearTag.deleteMany({ where: { rfidTagUid: { contains: 'UNIFIED-RG-' } } });
    await prisma.riggingGear.deleteMany({ where: { name: { contains: 'UnifiedTest' } } });
    await prisma.measuringInstrumentTag.deleteMany({ where: { rfidTagUid: { contains: 'UNIFIED-MI-' } } });
    await prisma.measuringInstrument.deleteMany({ where: { name: { contains: 'UnifiedTest' } } });
    await prisma.measuringInstrumentGenre.deleteMany({ where: { name: { contains: 'UnifiedTest' } } });
    await prisma.item.deleteMany({ where: { name: { contains: 'UnifiedTest' } } });
    await prisma.clientDevice.deleteMany({ where: { name: { startsWith: 'Unified Test Client ' } } });

    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedUnifiedFixture() {
    const item = await prisma.item.create({
      data: {
        itemCode: `UT-${searchToken}`,
        name: `あ UnifiedTest ${searchToken}`,
        category: '治具',
        storageLocation: '棚-A',
        nfcTagUid: `UNIFIED-TOOL-${searchToken}`,
        status: 'AVAILABLE'
      }
    });

    const genre = await prisma.measuringInstrumentGenre.create({
      data: { name: `UnifiedTest Genre ${searchToken}` }
    });
    const instrument = await prisma.measuringInstrument.create({
      data: {
        managementNumber: `UM-${searchToken}`,
        name: `い UnifiedTest ${searchToken}`,
        genreId: genre.id,
        storageLocation: '計測棚-B',
        status: 'MAINTENANCE'
      }
    });
    await prisma.measuringInstrumentTag.create({
      data: {
        measuringInstrumentId: instrument.id,
        rfidTagUid: `UNIFIED-MI-${searchToken}`
      }
    });

    const riggingGear = await prisma.riggingGear.create({
      data: {
        managementNumber: `UR-${searchToken}`,
        name: `う UnifiedTest ${searchToken}`,
        department: '吊具部門',
        storageLocation: '吊具棚-C',
        status: 'IN_USE'
      }
    });
    await prisma.riggingGearTag.create({
      data: {
        riggingGearId: riggingGear.id,
        rfidTagUid: `UNIFIED-RG-${searchToken}`
      }
    });

    return { item, instrument, riggingGear };
  }

  async function listUnified(params: { category?: string; headers?: Record<string, string> } = {}) {
    const query = new URLSearchParams({ search: searchToken });
    if (params.category) {
      query.set('category', params.category);
    }
    const response = await app.inject({
      method: 'GET',
      url: `/api/tools/unified?${query.toString()}`,
      headers: params.headers ?? createAuthHeader(viewerToken)
    });
    expect(response.statusCode).toBe(200);
    return response.json().items as UnifiedListItem[];
  }

  it('returns all domains with tag UIDs and ja-locale name ordering for JWT viewers', async () => {
    const { item, instrument, riggingGear } = await seedUnifiedFixture();

    const items = await listUnified();

    expect(items.map((entry) => entry.type)).toEqual([
      'TOOL',
      'MEASURING_INSTRUMENT',
      'RIGGING_GEAR'
    ]);
    expect(items.map((entry) => entry.name)).toEqual([
      item.name,
      instrument.name,
      riggingGear.name
    ]);
    expect(items).toMatchObject([
      {
        id: item.id,
        type: 'TOOL',
        code: item.itemCode,
        category: item.category,
        storageLocation: item.storageLocation,
        status: 'AVAILABLE',
        nfcTagUid: item.nfcTagUid
      },
      {
        id: instrument.id,
        type: 'MEASURING_INSTRUMENT',
        code: instrument.managementNumber,
        category: null,
        storageLocation: instrument.storageLocation,
        status: 'MAINTENANCE',
        nfcTagUid: `UNIFIED-MI-${searchToken}`
      },
      {
        id: riggingGear.id,
        type: 'RIGGING_GEAR',
        code: riggingGear.managementNumber,
        category: riggingGear.department,
        storageLocation: riggingGear.storageLocation,
        status: 'IN_USE',
        nfcTagUid: `UNIFIED-RG-${searchToken}`
      }
    ]);
  });

  it('allows a valid x-client-key without JWT', async () => {
    await seedUnifiedFixture();
    const client = await prisma.clientDevice.create({
      data: {
        name: `Unified Test Client ${searchToken}`,
        apiKey: `unified-client-${searchToken}`
      }
    });

    const items = await listUnified({ headers: { 'x-client-key': client.apiKey } });

    expect(items).toHaveLength(3);
  });

  it('returns 401 for invalid x-client-key', async () => {
    await seedUnifiedFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/api/tools/unified?search=${encodeURIComponent(searchToken)}`,
      headers: { 'x-client-key': 'invalid-unified-client-key' }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { errorCode?: string; message?: string };
    expect(body.errorCode).toBe('INVALID_CLIENT_KEY');
    expect(body.message).toBe('無効なクライアントキーです');
  });

  it('returns 401 without authentication when x-client-key is absent', async () => {
    await seedUnifiedFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/api/tools/unified?search=${encodeURIComponent(searchToken)}`
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { errorCode?: string; message?: string };
    expect(body.errorCode).toBe('AUTH_TOKEN_REQUIRED');
    expect(body.message).toBe('認証トークンが必要です');
  });

  it('filters each unified category independently', async () => {
    await seedUnifiedFixture();

    await expect(listUnified({ category: 'TOOLS' })).resolves.toMatchObject([
      { type: 'TOOL', nfcTagUid: `UNIFIED-TOOL-${searchToken}` }
    ]);
    await expect(listUnified({ category: 'MEASURING_INSTRUMENTS' })).resolves.toMatchObject([
      { type: 'MEASURING_INSTRUMENT', nfcTagUid: `UNIFIED-MI-${searchToken}` }
    ]);
    await expect(listUnified({ category: 'RIGGING_GEARS' })).resolves.toMatchObject([
      { type: 'RIGGING_GEAR', nfcTagUid: `UNIFIED-RG-${searchToken}` }
    ]);
  });
});
