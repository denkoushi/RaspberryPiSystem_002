import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import type { KioskRouteDeps } from './production-schedule/shared.js';
import type { FastifyInstance } from 'fastify';

const versionSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string(),
  fileName: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive()
});

export async function registerMobileAppRoutes(
  app: FastifyInstance,
  deps: Pick<KioskRouteDeps, 'requireClientDevice'>,
  options: { directory?: string } = {}
) {
  const directory = options.directory ?? process.env.HAIZEN_APP_DIR ?? '/app/storage/haizen-app';
  const readVersion = async () => {
    try {
      return versionSchema.parse(JSON.parse(await readFile(join(directory, 'version.json'), 'utf8')));
    } catch {
      return null;
    }
  };

  app.get('/kiosk/mobile-app/version', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'private, no-store');
    const version = await readVersion();
    if (!version || !(await stat(join(directory, version.fileName)).catch(() => null))?.isFile()) return reply.code(404).send();
    const { versionCode, versionName, sha256, size } = version;
    return { versionCode, versionName, sha256, size };
  });

  app.get('/kiosk/mobile-app/apk', { config: { compress: false, rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'private, no-store');
    const version = await readVersion();
    if (!version) return reply.code(404).send();
    const path = join(directory, version.fileName);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send();
    // Open before sending headers so a missing APK never becomes a streaming 500.
    const stream = createReadStream(path);
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
      });
    } catch {
      stream.destroy();
      return reply.code(404).send();
    }
    return reply.type('application/vnd.android.package-archive').header('Content-Length', info.size).send(stream);
  });
}
