import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';
import { businessSourceAdapters, sourceDocument, type SourceDocument } from './business-hermes-source-adapters.js';

/** The same visibility-aware, registered readers serve chat and nightly indexing. */
export async function exportBusinessHermesSources(service = new BusinessHermesMcpService(), signal?: AbortSignal, onRecord?: (record: Record<string, unknown>) => void) {
  const records: SourceDocument[] = [];
  for (const [kind, { sourceKey, cursorKey }] of Object.entries(businessSourceAdapters)) {
    let offset = 0;
    for (let page = 0; page < 5000; page++) {
      signal?.throwIfAborted();
      const result = await service.readSourcePage(kind, offset);
      if (result.isError) throw new Error('Authorized source export failed');
      const data = JSON.parse(result.content[0]!.text);
      if (!Array.isArray(data.results) || !data.hasMore || !data.nextCursor) throw new Error('Invalid source page');
      for (const record of data.results) {
        if (record.kind !== kind || typeof record.id !== 'string') throw new Error('Source page identity mismatch');
        records.push(sourceDocument(record));
        onRecord?.(record);
      }
      if (!data.hasMore[sourceKey]) break;
      const next = data.nextCursor[cursorKey];
      if (!Number.isSafeInteger(next) || next <= offset || page === 4999) throw new Error('Incomplete source export');
      offset = next;
    }
  }
  return { version: 2, exportedAt: new Date().toISOString(), records };
}
