import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../lib/prisma.js';
import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';
import { BusinessHermesConsultationService } from './business-hermes-consultation.service.js';

/** Opt-in only; run against a disposable loopback database after migration deploy. */
const integrationEnabled = process.env.BUSINESS_HERMES_CONSULTATION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled && !/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('BUSINESS_HERMES_CONSULTATION_INTEGRATION requires a disposable loopback DATABASE_URL');
}

const fixturePrefix = `hermes-consultation-it-${process.pid}-${Date.now()}`;

async function cleanupFixtures(): Promise<void> {
  await prisma.scawStfutekigoCurrent.deleteMany({ where: { nonconformityNo: { startsWith: fixturePrefix } } });
  await prisma.businessHermesConsultation.deleteMany({ where: { title: { startsWith: fixturePrefix } } });
}

describeIntegration('Business Hermes consultation persistence (isolated integration)', () => {
  const service = new BusinessHermesConsultationService({ db: prisma });

  beforeAll(cleanupFixtures);
  afterEach(cleanupFixtures);
  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  it('searches business identifiers and intersects an added condition filter', async () => {
    const partNumber = `${fixturePrefix}-part`;
    await prisma.scawStfutekigoCurrent.createMany({data: ['漏れ', '傷'].map((condition, index) => ({
      nonconformityNo: `${fixturePrefix}-nc-${index}`, partNumber,
      nonconformityContent: condition, rawPayload: {}, contentHash: `fixture-${index}`,
      enrichmentStatus: 'NOT_FOUND', isPresentInLatestSnapshot: true
    }))});
    const mcp = new BusinessHermesMcpService({db: prisma});
    const search = async (arguments_: Record<string, unknown>) => {
      const result = await mcp.call('business_hermes_search', {kind:'nonconformity', ...arguments_});
      return JSON.parse(result.content[0]!.text) as {results: Array<{nonconformityNo:string}>; total:number};
    };
    expect((await search({query:partNumber})).total).toBe(2);
    const refined = await search({query:partNumber,condition:'漏れ'});
    expect(refined.results.map(row=>row.nonconformityNo)).toEqual([`${fixturePrefix}-nc-0`]);
    expect((await search({query:`${fixturePrefix}-nc-1`})).results.map(row=>row.nonconformityNo)).toEqual([`${fixturePrefix}-nc-1`]);
  });

  it('persists two independent cases and pages newest history with an older cursor', async () => {
    const first = await service.create({ title: `${fixturePrefix}-a` });
    const second = await service.create({ title: `${fixturePrefix}-b` });
    await prisma.businessHermesConsultationMessage.createMany({
      data: Array.from({ length: 42 }, (_, index) => ({
        consultationId: first.id,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `history-${index}`,
        evidence: [],
        ...(index === 41 ? {
          confirmation: { prompt: '組立後の漏れですか？' },
          searchDiagnostics: [{ arguments: { query: '漏れ' }, total: 0, truncated: false, resultIds: [] }]
        } : {}),
        createdAt: new Date(Date.UTC(2026, 8, 7, 0, 0, index))
      }))
    });
    await service.update(second.id, { relatedIdentifiers: ['PN-SECOND'] });

    const firstPage = await service.getPage(first.id);
    expect(firstPage?.messages).toHaveLength(40);
    expect(firstPage?.messages[0]?.content).toBe('history-2');
    expect(firstPage?.messages.at(-1)?.content).toBe('history-41');
    expect(firstPage?.messages.at(-1)?.confirmation).toEqual({ prompt: '組立後の漏れですか？' });
    expect(firstPage?.messages.at(-1)?.searchDiagnostics[0]).toMatchObject({ total: 0, arguments: { query: '漏れ' } });
    expect(firstPage?.messagesNextCursor).toBe(firstPage?.messages[0]?.id);

    const older = await service.getPage(first.id, firstPage?.messagesNextCursor ?? undefined);
    expect(older?.messages.map((message) => message.content)).toEqual(['history-0', 'history-1']);
    const isolated = await service.get(second.id);
    expect(isolated?.messages).toHaveLength(0);
    expect(isolated?.relatedIdentifiers).toEqual(['PN-SECOND']);
  });
});
