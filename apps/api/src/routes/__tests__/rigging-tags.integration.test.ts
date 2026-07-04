import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('rigging gear tag routes integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await prisma.riggingGearTag.deleteMany();
    await prisma.riggingGear.deleteMany();
    await prisma.clientDevice.deleteMany({ where: { name: { startsWith: 'Rigging Tag Test Client ' } } });

    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const manager = await createTestUser('MANAGER');
    managerToken = manager.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createRiggingGear(token: string = adminToken): Promise<{ id: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rigging-gears',
      headers: {
        ...createAuthHeader(token),
        'Content-Type': 'application/json'
      },
      payload: {
        name: `Test Rigging ${Date.now()}`,
        managementNumber: `RG-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    });
    expect(response.statusCode).toBe(200);
    return response.json().riggingGear as { id: string };
  }

  it('POST /api/rigging-gears/:id/tags creates a tag and replaces on second POST', async () => {
    const gear = await createRiggingGear(adminToken);
    const firstUid = `TAG-RIG-${Date.now()}-1`;
    const secondUid = `TAG-RIG-${Date.now()}-2`;

    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/rigging-gears/${gear.id}/tags`,
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: { rfidTagUid: firstUid }
    });
    expect(firstResponse.statusCode).toBe(200);
    const firstTag = firstResponse.json().tag as { id: string; rfidTagUid: string; riggingGearId: string };
    expect(firstTag.rfidTagUid).toBe(firstUid);
    expect(firstTag.riggingGearId).toBe(gear.id);

    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/rigging-gears/${gear.id}/tags`,
      headers: {
        ...createAuthHeader(managerToken),
        'Content-Type': 'application/json'
      },
      payload: { rfidTagUid: secondUid }
    });
    expect(secondResponse.statusCode).toBe(200);
    const secondTag = secondResponse.json().tag as { id: string; rfidTagUid: string; riggingGearId: string };
    expect(secondTag.rfidTagUid).toBe(secondUid);
    expect(secondTag.riggingGearId).toBe(gear.id);

    const oldTagRow = await prisma.riggingGearTag.findUnique({ where: { id: firstTag.id } });
    expect(oldTagRow).toBeNull();

    const tagsForGear = await prisma.riggingGearTag.findMany({ where: { riggingGearId: gear.id } });
    expect(tagsForGear).toHaveLength(1);
    expect(tagsForGear[0]?.id).toBe(secondTag.id);
    expect(tagsForGear[0]?.rfidTagUid).toBe(secondUid);
  });

  it('DELETE /api/rigging-gear-tags/:tagId removes the tag and returns it', async () => {
    const gear = await createRiggingGear(adminToken);
    const rfidTagUid = `TAG-RIG-DEL-${Date.now()}`;

    const createResponse = await app.inject({
      method: 'POST',
      url: `/api/rigging-gears/${gear.id}/tags`,
      headers: {
        ...createAuthHeader(adminToken),
        'Content-Type': 'application/json'
      },
      payload: { rfidTagUid }
    });
    expect(createResponse.statusCode).toBe(200);
    const createdTag = createResponse.json().tag as { id: string; rfidTagUid: string };

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/rigging-gear-tags/${createdTag.id}`,
      headers: createAuthHeader(adminToken)
    });
    expect(deleteResponse.statusCode).toBe(200);
    const deletedTag = deleteResponse.json().tag as { id: string; rfidTagUid: string };
    expect(deletedTag.id).toBe(createdTag.id);
    expect(deletedTag.rfidTagUid).toBe(rfidTagUid);

    const row = await prisma.riggingGearTag.findUnique({ where: { id: createdTag.id } });
    expect(row).toBeNull();
  });

  it('DELETE /api/rigging-gear-tags/:tagId with nonexistent id returns current prisma error shape', async () => {
    const missingTagId = randomUUID();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/rigging-gear-tags/${missingTagId}`,
      headers: createAuthHeader(adminToken)
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { errorCode?: string; message?: string };
    expect(body.errorCode).toBe('P2025');
    expect(body.message).toContain('P2025');
  });

  describe('GET /api/rigging-gears allowClientKey auth', () => {
    it('returns 200 with a valid x-client-key', async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const client = await prisma.clientDevice.create({
        data: {
          name: `Rigging Tag Test Client ${suffix}`,
          apiKey: `rigging-tag-client-${suffix}`
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/rigging-gears',
        headers: { 'x-client-key': client.apiKey }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('riggingGears');
    });

    it('returns 403 with invalid x-client-key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/rigging-gears',
        headers: { 'x-client-key': 'invalid-client-key-not-in-db' }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json() as { errorCode?: string; message?: string };
      expect(body.errorCode).toBe('CLIENT_KEY_INVALID');
      expect(body.message).toBe('クライアントキーが無効です');
    });

    it('returns 401 without any auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/rigging-gears'
      });

      expect(response.statusCode).toBe(401);
      const body = response.json() as { errorCode?: string; message?: string };
      expect(body.errorCode).toBe('CLIENT_KEY_REQUIRED');
      expect(body.message).toBe('クライアントキーが必要です');
    });
  });
});
