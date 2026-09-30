import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  upsertDueManagementAccessPassword
} from '../../services/production-schedule/production-schedule-settings.service.js';
import { createTestClientDevice, createTestEmployee, createTestItem } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const PIN = '4821';
const TAG_PREFIX = 'TAGDESK-';

describe('kiosk tag desk', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let clientKey: string;
  let run: string;

  const headers = (pin: string | null = PIN) => ({
    'x-client-key': clientKey,
    ...(pin === null ? {} : { 'x-kiosk-access-password': pin })
  });

  beforeAll(async () => {
    app = await buildServer();
    await upsertDueManagementAccessPassword({ location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION, password: PIN });
    clientKey = (await createTestClientDevice()).apiKey;
  });

  beforeEach(async () => {
    run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    await prisma.measuringInstrumentTag.deleteMany({ where: { rfidTagUid: { startsWith: TAG_PREFIX } } });
    await prisma.riggingGearTag.deleteMany({ where: { rfidTagUid: { startsWith: TAG_PREFIX } } });
    await prisma.nfcTagBindingEvent.deleteMany({ where: { uid: { startsWith: TAG_PREFIX } } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses requests without the operation password or with a wrong one', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/kiosk/tag-desk/registry?kind=employee', headers: headers(null) });
    expect(missing.statusCode).toBe(403);
    const wrong = await app.inject({ method: 'GET', url: '/api/kiosk/tag-desk/registry?kind=employee', headers: headers('0000') });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().errorCode ?? wrong.json().code).toBe('TAG_DESK_ACCESS_DENIED');
    const noClient = await app.inject({ method: 'GET', url: '/api/kiosk/tag-desk/registry?kind=employee', headers: { 'x-kiosk-access-password': PIN } });
    expect(noClient.statusCode).toBe(401);
  });

  it('verifies the PIN typed on the pad', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/kiosk/tag-desk/verify-access-password', headers: headers(null), payload: { password: PIN } });
    expect(ok.json()).toEqual({ success: true });
    const ng = await app.inject({ method: 'POST', url: '/api/kiosk/tag-desk/verify-access-password', headers: headers(null), payload: { password: '1111' } });
    expect(ng.json()).toEqual({ success: false });
  });

  it('shows where a tag is used, releases it, and records the release', async () => {
    const uid = `${TAG_PREFIX}EMP-${run}`;
    const employee = await createTestEmployee({ nfcTagUid: uid, displayName: `タグ机 ${run}` });

    const lookup = await app.inject({ method: 'GET', url: `/api/kiosk/tag-desk/tags/${uid}`, headers: headers() });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().bindings).toMatchObject([{ kind: 'employee', bindingId: employee.id, name: `タグ机 ${run}` }]);

    const release = await app.inject({ method: 'DELETE', url: '/api/kiosk/tag-desk/bindings', headers: headers(), payload: { kind: 'employee', bindingId: employee.id } });
    expect(release.statusCode).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).nfcTagUid).toBeNull();

    const again = await app.inject({ method: 'DELETE', url: '/api/kiosk/tag-desk/bindings', headers: headers(), payload: { kind: 'employee', bindingId: employee.id } });
    expect(again.statusCode).toBe(404);

    const after = await app.inject({ method: 'GET', url: `/api/kiosk/tag-desk/tags/${uid}`, headers: headers() });
    expect(after.json().bindings).toEqual([]);

    const events = await prisma.nfcTagBindingEvent.findMany({ where: { uid } });
    expect(events).toMatchObject([{ action: 'UNLINK', targetKind: 'employee', targetId: employee.id }]);
  });

  it('binds a free tag, refuses a tag that is in use, and adds a second tag to an instrument', async () => {
    const item = await createTestItem({ nfcTagUid: `${TAG_PREFIX}ITEM-${run}` });
    const instrument = await prisma.measuringInstrument.create({ data: { name: `タグ机計測 ${run}`, managementNumber: `TD-${run}` } });

    const inUse = await app.inject({
      method: 'POST', url: '/api/kiosk/tag-desk/bindings', headers: headers(),
      payload: { kind: 'instrument', targetId: instrument.id, uid: item.nfcTagUid }
    });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().message).toContain(item.name);

    for (const suffix of ['A', 'B']) {
      const bound = await app.inject({
        method: 'POST', url: '/api/kiosk/tag-desk/bindings', headers: headers(),
        payload: { kind: 'instrument', targetId: instrument.id, uid: `${TAG_PREFIX}MI-${suffix}-${run}` }
      });
      expect(bound.statusCode).toBe(200);
      expect(bound.json().bindings).toMatchObject([{ kind: 'instrument', targetId: instrument.id }]);
    }
    expect(await prisma.measuringInstrumentTag.count({ where: { measuringInstrumentId: instrument.id } })).toBe(2);

    const hasTag = await app.inject({
      method: 'POST', url: '/api/kiosk/tag-desk/bindings', headers: headers(),
      payload: { kind: 'item', targetId: item.id, uid: `${TAG_PREFIX}ITEM2-${run}` }
    });
    expect(hasTag.statusCode).toBe(409);
    const replaced = await app.inject({
      method: 'POST', url: '/api/kiosk/tag-desk/bindings', headers: headers(),
      payload: { kind: 'item', targetId: item.id, uid: `${TAG_PREFIX}ITEM2-${run}`, replace: true }
    });
    expect(replaced.statusCode).toBe(200);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).nfcTagUid).toBe(`${TAG_PREFIX}ITEM2-${run}`);

    await prisma.measuringInstrument.delete({ where: { id: instrument.id } });
  });

  it('creates, edits and deletes master records without touching tags', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/kiosk/tag-desk/rigging-gears', headers: headers(),
      payload: { name: `タグ机吊具 ${run}`, managementNumber: `TDR-${run}`, maxLoadTon: 2 }
    });
    expect(created.statusCode).toBe(200);
    const gearId = created.json().riggingGear.id as string;

    const edited = await app.inject({
      method: 'PUT', url: `/api/kiosk/tag-desk/rigging-gears/${gearId}`, headers: headers(),
      payload: { storageLocation: '吊具庫 2', rfidTagUid: 'SHOULD-BE-IGNORED' }
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().riggingGear.storageLocation).toBe('吊具庫 2');
    expect(await prisma.riggingGearTag.count({ where: { riggingGearId: gearId } })).toBe(0);

    const registry = await app.inject({ method: 'GET', url: '/api/kiosk/tag-desk/registry?kind=rigging', headers: headers() });
    expect(registry.json().rows.find((row: { id: string }) => row.id === gearId)).toMatchObject({ code: `TDR-${run}`, tags: [] });

    const removed = await app.inject({ method: 'DELETE', url: `/api/kiosk/tag-desk/rigging-gears/${gearId}`, headers: headers() });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.riggingGear.findUnique({ where: { id: gearId } })).toBeNull();
  });
});
