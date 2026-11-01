import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployWindowEndedAt, refreshKioskDeployWindows, KIOSK_DEPLOY_GRACE_MS } from '../kiosk-deploy-window.js';

const now = new Date('2026-10-30T00:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
let directory: string;
let path: string;
async function status(phase: string, start = now.toISOString()) {
  await writeFile(path, JSON.stringify({ kioskByClient: {
    pi4: { phase, startedAt: start, noticeStartedAt: start }
  } }));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kiosk-window-'));
  path = join(directory, 'deploy-status.json');
  vi.stubEnv('DEPLOY_STATUS_FILE_PATH', path);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('kiosk deploy window', () => {
  it.each(['notice', 'preparing', 'deploying'])('suppresses %s for the matching client', async (phase) => {
    await status(phase);
    expect(await deployWindowEndedAt('pi4', now)).toEqual(later(KIOSK_DEPLOY_GRACE_MS));
    expect(await deployWindowEndedAt('other', now)).toBeNull();
  });
  it('clears remembered grace immediately on failure', async () => {
    await status('deploying');
    await refreshKioskDeployWindows(now);
    await status('failed');
    expect(await deployWindowEndedAt('pi4', later(60_000))).toBeNull();
  });
  it('remembers a deploy observed by the tick through removal and grace expiry', async () => {
    await status('deploying');
    await refreshKioskDeployWindows(now);
    await writeFile(path, JSON.stringify({ kioskByClient: {} }));
    expect(await deployWindowEndedAt('pi4', later(60_000))).toEqual(later(KIOSK_DEPLOY_GRACE_MS));
    const after = later(KIOSK_DEPLOY_GRACE_MS + 1);
    expect((await deployWindowEndedAt('pi4', after))!.getTime()).toBeLessThan(after.getTime());
  });
  it('keeps remembered grace when the file becomes unreadable', async () => {
    await status('deploying');
    await refreshKioskDeployWindows(now);
    await writeFile(path, '{broken');
    expect(await deployWindowEndedAt('pi4', later(60_000))).toEqual(later(KIOSK_DEPLOY_GRACE_MS));
  });
  it('caches the file for a few seconds', async () => {
    await status('deploying');
    await refreshKioskDeployWindows(now);
    await status('failed');
    expect(await deployWindowEndedAt('pi4', later(1_000))).not.toBeNull();
    expect(await deployWindowEndedAt('pi4', later(5_000))).toBeNull();
  });
  it.each(['notice', 'preparing', 'deploying'])('ignores expired %s entries', async (phase) => {
    await status(phase, new Date(now.getTime() - 30 * 60_000 - 1).toISOString());
    expect(await deployWindowEndedAt('pi4', now)).toBeNull();
  });
  it.each(['missing', 'corrupt', 'null', 'invalid timestamp'])('does not suppress for %s data', async (kind) => {
    if (kind === 'corrupt') await writeFile(path, '{broken');
    if (kind === 'null') await writeFile(path, 'null');
    if (kind === 'invalid timestamp') await status('deploying', 'bad');
    expect(await deployWindowEndedAt('pi4', now)).toBeNull();
  });
});
