import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import { getProcedureVideoPoster } from './assembly';

vi.mock('../http', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.mocked(api.get).mockReset().mockResolvedValue({ data: new Blob(['jpeg']) }));
describe('procedure-video poster URLs', () => {
  it('requests an encoded scene poster URL', async () => {
    await getProcedureVideoPoster('video/id', 'scene/id');
    expect(api.get).toHaveBeenCalledWith('/assembly/procedure-videos/video%2Fid/scenes/scene%2Fid/poster', { responseType: 'blob' });
  });
  it('requests the video poster URL when no scene is chosen', async () => {
    await getProcedureVideoPoster('video/id');
    expect(api.get).toHaveBeenCalledWith('/assembly/procedure-videos/video%2Fid/poster', { responseType: 'blob' });
  });
});
