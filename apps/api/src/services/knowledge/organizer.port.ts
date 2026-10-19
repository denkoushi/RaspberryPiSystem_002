import type { KnowledgeSource, OrganizedNote } from './knowledge-source.js';

export interface KnowledgeOrganizerPort {
  organize(source: KnowledgeSource, signal?: AbortSignal): Promise<OrganizedNote>;
}

/** Images are described separately so I/O and vision transport cannot enter domain rules. */
export interface KnowledgePhotoDescriberPort {
  describe(image: KnowledgeSource['images'][number], signal?: AbortSignal): Promise<string>;
}
