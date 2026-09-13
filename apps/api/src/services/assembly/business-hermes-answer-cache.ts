import { createHash } from 'node:crypto';
import { z } from 'zod';

import { businessSourceAdapters, sourceDocument } from './business-hermes-source-adapters.js';
import { env } from '../../config/env.js';
import type { BusinessHermesMcpService } from './business-hermes-mcp.service.js';

export const SOURCE_QUESTION_PREFIX = 'この資料で回答：';
export const CACHED_QUESTION_PREFIX = 'この質問の回答：';
const questionSchema = z.string().trim().min(1).max(100);
const sourceSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), id: z.string().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});
export const experienceSchema = z.object({ canonicalQuestion: questionSchema.nullable(), question: z.string().trim().min(1).max(4000), answer: z.string().min(1).max(4000), sources: z.array(sourceSchema).min(1).max(8) });
export const EXPERIENCE_KIND = 'business-hermes-experience-v1';
const answerSchema = z.object({ question: questionSchema, answer: z.string().min(1).max(4000), sources: z.array(sourceSchema).min(1).max(8) });

// Shared with the catalogue producer: hash the complete current MCP detail,
// including publication/active-source state, rather than just its stable ID.
export function sourceFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, canonical(val)]))
      : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export class BusinessHermesAnswerCache {
  constructor(private readonly details: Pick<BusinessHermesMcpService, 'call'>,
    private readonly config = { baseUrl: env.BUSINESS_HERMES_ANSWER_CACHE_URL, token: env.BUSINESS_HERMES_ANSWER_CACHE_TOKEN },
    private readonly fetchImpl: typeof fetch = fetch) {}

  isEnabled(): boolean { return Boolean(this.config.baseUrl && this.config.token); }

  private async request(path: string, question: string | Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.baseUrl || !this.config.token) return null;
    try {
      const timeout = AbortSignal.timeout(800);
      const response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
        method: 'POST', headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof question === 'string' ? { question } : question), signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > 50_000) return null;
      return (JSON.parse(body) as { result?: unknown }).result ?? null;
    } catch { return null; }
  }


  async remember(event: { id: string; canonicalQuestion: string | null; question: string; answer: string; sources: Array<{kind: string; id: string; sha256: string}> }, signal?: AbortSignal): Promise<boolean> {
    return await this.request('/experience', event, signal) === true;
  }

  async feedback(id: string, verdict: 'helpful' | 'unhelpful'): Promise<boolean> {
    return await this.request('/feedback', { id, verdict }) === true;
  }

  async suggest(question: string, signal?: AbortSignal): Promise<string | null> {
    const parsed = z.object({ question: questionSchema }).safeParse(await this.request('/search', question, signal));
    return parsed.success ? parsed.data.question : null;
  }

  async candidates(question: string, signal?: AbortSignal): Promise<string[]> {
    const parsed = z.array(z.object({ option: z.string().min(1).max(120).startsWith(SOURCE_QUESTION_PREFIX) })).max(3)
      .safeParse(await this.request('/candidates', question, signal));
    return parsed.success ? parsed.data.map((entry) => entry.option) : [];
  }

  async source(option: string, signal?: AbortSignal): Promise<{ record: Record<string, unknown>; result: Awaited<ReturnType<BusinessHermesMcpService['call']>> } | null> {
    const parsed = sourceSchema.omit({ sha256: true }).safeParse(await this.request('/source', option, signal));
    if (!parsed.success || signal?.aborted || !Object.hasOwn(businessSourceAdapters, parsed.data.kind)) return null;
    try {
      const result = await this.details.call('business_hermes_get_detail', parsed.data);
      if (result.isError || signal?.aborted) return null;
      const record = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
      if (record.kind !== parsed.data.kind || record.id !== parsed.data.id) return null;
      if (SOURCE_QUESTION_PREFIX + sourceDocument(record).title !== option) return null;
      return { record, result };
    } catch { return null; }
  }

  async answer(question: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const parsed = answerSchema.safeParse(await this.request('/lookup', question, signal));
    if (!parsed.success || parsed.data.question !== question) return null;
    try {
      const output: Record<string, unknown>[] = [];
      for (const [index, source] of parsed.data.sources.entries()) {
        if (signal?.aborted || !Object.hasOwn(businessSourceAdapters, source.kind)) return null;
        const result = await this.details.call('business_hermes_get_detail', { kind: source.kind, id: source.id });
        if (result.isError || sourceFingerprint(result) !== source.sha256) return null;
        const visible = result.content.some((part) => part.type === 'text'
          && JSON.parse(part.text).kind === source.kind && JSON.parse(part.text).id === source.id);
        if (!visible) return null;
        const callId = `cache-source-${index}`;
        // These outputs are fresh calls to the existing visibility-aware source
        // reader, not cached model/tool transcripts. Reuse the evidence projector.
        output.push({ type: 'function_call', name: 'business_hermes_get_detail', call_id: callId },
          { type: 'function_call_output', call_id: callId,
            output: result.content.filter((part) => part.type === 'text').map((part) => ({ type: 'input_text', text: part.text })) });
      }
      return { status: 'completed', learning: { question, canonicalQuestion: question, answer: parsed.data.answer, sources: parsed.data.sources }, output, output_text: JSON.stringify({
        message: parsed.data.answer, summary: parsed.data.answer.slice(0, 2000),
        needsClarification: false, openQuestions: [], showEvidence: false
      }) };
    } catch { return null; }
  }
}
