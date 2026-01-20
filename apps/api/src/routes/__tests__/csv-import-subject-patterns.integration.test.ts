import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

describe('CSV Import Subject Patterns API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    const viewer = await createTestUser('VIEWER');
    adminToken = admin.token;
    viewerToken = viewer.token;
    await prisma.csvImportSubjectPattern.deleteMany({});
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should require admin role', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/csv-import-subject-patterns',
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    expect(response.statusCode).toBe(403);
  });

  it('should create, update, and delete pattern', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/csv-import-subject-patterns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        importType: 'employees',
        pattern: '[CSV Import] employees',
        priority: 1,
        enabled: true
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { pattern: { id: string; pattern: string } };
    expect(created.pattern.pattern).toBe('[CSV Import] employees');

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/csv-import-subject-patterns/${created.pattern.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { priority: 0, enabled: false }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json() as { pattern: { priority: number; enabled: boolean } };
    expect(updated.pattern.priority).toBe(0);
    expect(updated.pattern.enabled).toBe(false);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/csv-import-subject-patterns/${created.pattern.id}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it('should enforce unique importType and pattern', async () => {
    await prisma.csvImportSubjectPattern.create({
      data: {
        importType: 'items',
        pattern: 'CSV Import - items',
        priority: 0,
        enabled: true
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/csv-import-subject-patterns',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        importType: 'items',
        pattern: 'CSV Import - items',
        priority: 1,
        enabled: true
      }
    });
    expect(response.statusCode).toBe(409);
  });

  it('should reorder patterns by priority', async () => {
    const first = await prisma.csvImportSubjectPattern.create({
      data: {
        importType: 'employees',
        pattern: 'Pattern A',
        priority: 0,
        enabled: true
      }
    });
    const second = await prisma.csvImportSubjectPattern.create({
      data: {
        importType: 'employees',
        pattern: 'Pattern B',
        priority: 1,
        enabled: true
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/csv-import-subject-patterns/reorder',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        importType: 'employees',
        orderedIds: [second.id, first.id]
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { patterns: Array<{ id: string; priority: number }> };
    const priorities = body.patterns.reduce<Record<string, number>>((acc, pattern) => {
      acc[pattern.id] = pattern.priority;
      return acc;
    }, {});
    expect(priorities[second.id]).toBe(0);
    expect(priorities[first.id]).toBe(1);
  });
});
