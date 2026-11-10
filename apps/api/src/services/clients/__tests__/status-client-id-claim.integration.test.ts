import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { claimStatusClientId } from '../status-client-id-claim.js';
let ids: string[] = [];
beforeEach(async () => {
  ids = [];
  for (const name of ['first', 'second']) {
    const device = await prisma.clientDevice.create({ data: { name, apiKey: randomUUID() } });
    ids.push(device.id);
  }
});
afterEach(async () => {
  if (ids.length) await prisma.clientDevice.deleteMany({ where: { id: { in: ids } } });
});
describe('PostgreSQL status ID claims', () => {
  it.each([false, true])('accepts only one concurrent conflicting claim (same device=%s)', async (sameDevice) => {
    const statusId = randomUUID();
    const results = await Promise.allSettled([
      claimStatusClientId(ids[0], statusId),
      claimStatusClientId(sameDevice ? ids[0] : ids[1], sameDevice ? randomUUID() : statusId)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    const registered = await prisma.clientDevice.findMany({ where: { id: { in: ids }, statusClientId: { not: null } } });
    expect(registered).toHaveLength(1);
  });
});
