import type { BusinessHermesMcpResult, BusinessHermesMcpService } from './business-hermes-mcp.service.js';

/** A batch owns the authorized records already read by the source exporter.
 * Search and detail must expose identical records; serving still rereads live details.
 */
export class NightlySourceEvidence {
  private readonly records = new Map<string, BusinessHermesMcpResult>();

  add(record: Record<string, unknown>): void {
    if (typeof record.kind !== 'string' || typeof record.id !== 'string' || !record.id) {
      throw new Error('Invalid source evidence identity');
    }
    const key = record.kind + ':' + record.id;
    if (this.records.has(key)) throw new Error('Source changed during pagination; retry the batch');
    this.records.set(key, { content: [{ type: 'text', text: JSON.stringify(record) }] });
  }

  async read(ref: { kind: string; id: string }, reader: Pick<BusinessHermesMcpService, 'call'>,
    signal: AbortSignal): Promise<BusinessHermesMcpResult> {
    signal.throwIfAborted();
    const known = this.records.get(ref.kind + ':' + ref.id);
    // Missing/removed records must still pass the current visibility-aware reader.
    return known ?? reader.call('business_hermes_get_detail', { kind: ref.kind, id: ref.id });
  }
}
