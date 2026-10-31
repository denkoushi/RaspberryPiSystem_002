import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../lib/logger.js';
import { receiveSampleFrame } from '../watch-camera-sample.service.js';
import { acceptWatchCameraFrame } from '../watch-camera.service.js';

const processor = vi.hoisted(() => ({ receive: vi.fn() }));
vi.mock('../watch-camera-processor.js', () => ({
  WatchCameraCapacity: class {}, WatchCameraProcessor: class { receive = processor.receive; }, parsePersonResponse: vi.fn(),
}));
vi.mock('../watch-camera-sample.service.js', () => ({ receiveSampleFrame: vi.fn() }));
vi.mock('../../../config/env.js', () => ({ env: {} }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../inference/inference-runtime.js', () => ({}));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({}));
beforeEach(() => vi.resetAllMocks());

describe('independent watch camera receivers', () => {
  it('keeps calling the existing processor and rate limits sample failure warnings', async () => {
    processor.receive.mockResolvedValue(undefined);
    vi.mocked(receiveSampleFrame).mockRejectedValue(new Error('sample db'));
    const bytes = Buffer.from('jpeg');
    expect(acceptWatchCameraFrame('camera', bytes)).toBeUndefined();
    acceptWatchCameraFrame('camera', bytes);
    await new Promise(setImmediate);
    expect(processor.receive).toHaveBeenNthCalledWith(1, 'camera', bytes);
    expect(processor.receive).toHaveBeenCalledTimes(2);
    expect(receiveSampleFrame).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
  it('calls samples even when existing processing rejects', async () => {
    processor.receive.mockRejectedValue(new Error('processor'));
    vi.mocked(receiveSampleFrame).mockResolvedValue(undefined);
    const bytes = Buffer.from('jpeg');
    acceptWatchCameraFrame('camera', bytes);
    await new Promise(setImmediate);
    expect(receiveSampleFrame).toHaveBeenCalledWith('camera', bytes);
  });
});
