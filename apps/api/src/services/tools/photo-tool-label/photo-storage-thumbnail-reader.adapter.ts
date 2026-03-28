import { PhotoStorage } from '../../../lib/photo-storage.js';

import type { ThumbnailReaderPort } from './photo-tool-label-ports.js';

export class PhotoStorageThumbnailReader implements ThumbnailReaderPort {
  async readThumbnail(photoUrl: string): Promise<Buffer> {
    return PhotoStorage.readThumbnailBuffer(photoUrl);
  }
}
