import { procedureDocumentFeedbackResponseSchema, type ProcedureDocumentFeedbackResponse } from '@raspi-system/shared-types';

import { env } from '../../config/env.js';
import { DomainHttpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { extractJsonObject, stringList } from '../../lib/llm-json.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import { readAssemblyProcedureAssetAsJpeg } from './procedure-asset-jpeg.js';
import { PROCEDURE_DOCUMENT_FEEDBACK_REFERENCE } from './procedure-document-feedback.reference.js';
import type { Employee } from '@prisma/client';

const SYSTEM_PROMPT = 'あなたは、国内外の金属加工の現場と工程設計をよく知る読み手で、この手順書を初めて読みます。手順書を作り直すのは人間で、あなたは読んだ感想を返すだけです。文書を書き直したり、まとめ直したりしない。人の名前は書かない。まず文書が何の作業(機械加工、段取り、組立、検査など)の、どの段を扱っているかをつかみ、下の専門知識のうち合う分野だけを当てはめて読む。合う知識が無い分野でも、手順書の作り方の知識と、初めて読む人として分からない所から感想を書く。文書にも専門知識にも根拠の無い思いつきや、どの文書にも言える一般論は書かない。';
const PHOTO_PROMPT = 'これは要領書に貼ってある写真です(向きが回っていることがあります)。読み取れることだけを日本語の箇条書きで書いてください。図面なら、部品の形、穴の種類と数(注記の数とも比べる)、寸法の入れ方、削り代や表面の指示。読めない所は「読めない」と書き、推測で埋めない。';
const FEEDBACK_PROMPT = [
  '読んだ感想を、次の4つに分けて書いてください。どれも、どこの話か(例: 1ページ目の「1 加工原点」)が分かる書き出しにし、1つ1〜2文で短く、話し言葉で。感想には、専門知識にある具体的な数値・やり方・よくある失敗を当てはめて書く(例:「工具選定に突き出し長さの決め方が無い。ふつうは工具径の3倍くらいまでで、それより長いと条件を下げるので、そこがあると新人が迷わない」)。「確認が必要」「明確にするとよい」だけで終わる感想は書かない。専門知識から引いた所には「ふつうは〜」と添える(1つの感想に1回まで)。知識の番号(R1 など)や「専門知識」「参考資料」という言葉は書かない。写真は、文書の中で何のために貼ってあるか(作業の対象そのもの、やり方の見本、書き込みの手本、完成の見本など)を同じページの文字から考え、文書の目的に照らして意味のある所を感想にする。段の文と写真が対応しているか、どこを見ればよいか分かるかも見る。文書を読めば分かることは聞かない。言えることが無い分類は少なくてよい。各0〜4個。写真は先頭3枚だけを読んでいて、ページの下地の画像は読めていないので、読めていない所が足りないとは言わない。',
  'questions: 素朴な質問(読んで分からなかったこと、聞いてみたいこと)',
  'missing: ここが足りないかも',
  'unclear: ここが分かりにくいかも',
  'ideas: こうしたらいいかも',
  '次の JSON だけを返す。{"questions":[...],"missing":[...],"unclear":[...],"ideas":[...]}',
].join('\n');

function createNameRedactor(employees: Pick<Employee, 'displayName' | 'lastName' | 'firstName'>[]) {
  const aliases = new Map<string, number>();
  employees.forEach(({ displayName, lastName, firstName }, index) => {
    const last = lastName?.trim();
    const first = firstName?.trim();
    const fullNames = last && first ? [last + first, `${last} ${first}`, `${last}\u3000${first}`] : [];
    for (const name of [displayName.trim(), last, first, ...fullNames]) {
      if (name && Array.from(name).length >= 2 && !aliases.has(name)) aliases.set(name, index);
    }
  });
  if (!aliases.size) return (text: string) => text;
  const pattern = new RegExp([...aliases.keys()]
    .sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'), 'gu');
  const labels = new Map<number, string>();
  return (text: string) => text.replace(pattern, name => {
    const employee = aliases.get(name)!;
    const previous = labels.get(employee);
    if (previous) return previous;
    let label = '';
    for (let n = labels.size + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      label = String.fromCharCode(65 + (n - 1) % 26) + label;
    }
    const replacement = `作業者${label}`;
    labels.set(employee, replacement);
    return replacement;
  });
}

function parseFeedback(raw: string, redact: (text: string) => string) {
  const data = extractJsonObject(raw);
  if (!data) return null;
  const strings = (value: unknown) => stringList(value, 6).map(redact);
  const sections = {
    questions: strings(data.questions),
    missing: strings(data.missing),
    unclear: strings(data.unclear),
    ideas: strings(data.ideas),
  };
  return Object.values(sections).some(items => items.length) ? sections : null;
}

export async function getProcedureDocumentFeedback(documentId: string): Promise<ProcedureDocumentFeedbackResponse> {
  const document = await prisma.assemblyProcedureDocument.findUnique({
    where: { id: documentId },
    select: { revisionMetadata: { select: { revisionRootId: true } } },
  });
  if (!document) throw new DomainHttpError(404, '手順書が見つかりません');
  const revisionRootId = document.revisionMetadata?.revisionRootId ?? documentId;
  const [feedback, optOut] = await Promise.all([prisma.assemblyProcedureDocumentFeedback.findFirst({
    where: { revisionRootId },
    orderBy: [{ sourceUpdatedAt: 'desc' }, { revisionNumber: 'desc' }],
    select: { revisionNumber: true, createdAt: true, questions: true, missing: true, unclear: true, ideas: true },
  }), prisma.assemblyProcedureDocumentFeedbackOptOut.findUnique({ where: { revisionRootId }, select: { revisionRootId: true } })]);
  return procedureDocumentFeedbackResponseSchema.parse({
    feedback: feedback && { ...feedback, createdAt: feedback.createdAt.toISOString() },
    nightlyTarget: !optOut,
  });
}

export async function setProcedureDocumentFeedbackTarget(documentId: string, nightlyTarget: boolean): Promise<ProcedureDocumentFeedbackResponse> {
  const document = await prisma.assemblyProcedureDocument.findUnique({
    where: { id: documentId },
    select: { revisionMetadata: { select: { revisionRootId: true } } },
  });
  if (!document) throw new DomainHttpError(404, '手順書が見つかりません');
  const revisionRootId = document.revisionMetadata?.revisionRootId ?? documentId;
  if (nightlyTarget) {
    await prisma.assemblyProcedureDocumentFeedbackOptOut.deleteMany({ where: { revisionRootId } });
  } else {
    await prisma.assemblyProcedureDocumentFeedbackOptOut.createMany({ data: { revisionRootId }, skipDuplicates: true });
  }
  return getProcedureDocumentFeedback(documentId);
}

type Candidate = { id: string; updatedAt: Date };

async function generateFeedback(candidate: Candidate, employees: Parameters<typeof createNameRedactor>[0], signal: AbortSignal) {
  const document = await prisma.$transaction(tx => tx.assemblyProcedureDocument.findUnique({
    where: { id: candidate.id, isActive: true },
    select: {
      name: true, updatedAt: true,
      revisionMetadata: { select: { revisionRootId: true, revisionNumber: true } },
      pages: {
        orderBy: { pageIndex: 'asc' },
        select: {
          pageIndex: true,
          overlayElements: {
            where: { kind: { in: ['TEXT', 'IMAGE'] } },
            orderBy: [{ yRatio: 'asc' }, { xRatio: 'asc' }, { id: 'asc' }],
            select: { kind: true, text: true, asset: { select: { storageKey: true } } },
          },
        },
      },
    },
  }), { isolationLevel: 'RepeatableRead' });
  if (!document) return false;
  signal.throwIfAborted();
  const redact = createNameRedactor(employees);
  const name = redact(document.name);
  const pages = document.pages.map(page => {
    const texts = page.overlayElements.flatMap(element => element.kind === 'TEXT' && element.text ? [redact(element.text)] : []);
    return [`${page.pageIndex + 1}ページ目`, ...texts].join('\n');
  });
  const photos = document.pages.flatMap(page => page.overlayElements.flatMap(element =>
    element.kind === 'IMAGE' && element.asset ? [{ pageIndex: page.pageIndex, asset: element.asset }] : []
  )).slice(0, 3);

  const runtime = getLocalLlmRuntimeController();
  if (runtime) await runtime.ensureReady('business_hermes');
  try {
    signal.throwIfAborted();
    const inference = getInferenceRuntime();
    const descriptions: string[] = [];
    for (const [index, photo] of photos.entries()) {
      const heading = `${photo.pageIndex + 1}ページ目の写真 ${index + 1}`;
      try {
        const imageBytes = await readAssemblyProcedureAssetAsJpeg(photo.asset);
        signal.throwIfAborted();
        const result = await inference.createVisionCompletionPort().complete({
          userText: PHOTO_PROMPT, imageBytes, mimeType: 'image/jpeg', maxTokens: 500, temperature: 0, signal,
        });
        signal.throwIfAborted();
        descriptions.push(`${heading}\n${redact(result.rawText.trim()) || '・読めない'}`);
      } catch {
        signal.throwIfAborted();
        logger.warn({ documentId: candidate.id, photo: index + 1 }, 'procedure_document_feedback_photo_failed');
        descriptions.push(`${heading}\n・読めない`);
      }
    }
    const photoSection = descriptions.length ? `\n\n=== 貼ってある写真を読んだ結果\n${descriptions.join('\n\n')}` : '';
    const result = await inference.createTextCompletionPort().complete({
      useCase: 'business_hermes', jsonOutput: true, enableThinking: false, temperature: 0, maxTokens: 2400, signal,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `文書名: ${name}\n\n=== 専門知識(機械加工・段取り・組立・検査と、手順書の作り方)\n${PROCEDURE_DOCUMENT_FEEDBACK_REFERENCE}\n\n=== 文書の文字(ページごと)\n${pages.join('\n\n')}${photoSection}\n\n${FEEDBACK_PROMPT}` },
      ],
    });
    signal.throwIfAborted();
    const feedback = parseFeedback(result.rawText, redact);
    if (!feedback) {
      logger.warn({ documentId: candidate.id }, 'procedure_document_feedback_unusable_response');
      return false;
    }
    const saved = await prisma.assemblyProcedureDocumentFeedback.createMany({
      data: {
        documentId: candidate.id,
        revisionRootId: document.revisionMetadata?.revisionRootId ?? candidate.id,
        revisionNumber: document.revisionMetadata?.revisionNumber ?? 1,
        sourceUpdatedAt: candidate.updatedAt,
        ...feedback,
      },
      skipDuplicates: true,
    });
    return saved.count > 0;
  } finally {
    if (runtime) await runtime.release('business_hermes');
  }
}

export async function runProcedureDocumentFeedback(signal: AbortSignal) {
  if (env.PROCEDURE_DOCUMENT_FEEDBACK_ENABLED !== 'true') return { selected: 0, saved: 0 };
  signal.throwIfAborted();
  const cutoff = new Date(Date.now() - env.PROCEDURE_DOCUMENT_FEEDBACK_LOOKBACK_DAYS * 86_400_000);
  // Select and cap eligible series before loading any pages or calling AI.
  // Text and photo saves replace overlay rows and bump the revision row without touching the document row,
  // so "last edited" is the latest of the document, its revision row and its overlay elements.
  const candidates = await prisma.$queryRaw<Candidate[]>`
    WITH edited AS (
      SELECT d."id", COALESCE(r."revisionRootId", d."id") AS "rootId", r."revisionNumber",
        GREATEST(d."updatedAt", COALESCE(r."updatedAt", d."updatedAt"), COALESCE(o."updatedAt", d."updatedAt")) AS "updatedAt"
      FROM "AssemblyProcedureDocument" d
      LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
      LEFT JOIN LATERAL (
        SELECT MAX(e."updatedAt") AS "updatedAt" FROM "AssemblyProcedureOverlayElement" e WHERE e."documentId" = d."id"
      ) o ON true
      WHERE d."isActive"
    )
    SELECT candidates."id", candidates."updatedAt"
    FROM (
      SELECT DISTINCT ON (edited."rootId") edited."id", edited."updatedAt"
      FROM edited
      LEFT JOIN LATERAL (
        SELECT f."sourceUpdatedAt"
        FROM "AssemblyProcedureDocumentFeedback" f
        WHERE f."revisionRootId" = edited."rootId"
        ORDER BY f."sourceUpdatedAt" DESC
        LIMIT 1
      ) latest ON true
      WHERE (edited."updatedAt" > latest."sourceUpdatedAt"
        OR (latest."sourceUpdatedAt" IS NULL AND edited."updatedAt" >= ${cutoff}))
        AND NOT EXISTS (SELECT 1 FROM "AssemblyProcedureDocumentFeedbackOptOut" o WHERE o."revisionRootId" = edited."rootId")
      ORDER BY edited."rootId", edited."updatedAt" DESC, edited."revisionNumber" DESC NULLS LAST, edited."id"
    ) candidates
    ORDER BY candidates."updatedAt" DESC, candidates."id"
    LIMIT ${env.PROCEDURE_DOCUMENT_FEEDBACK_BATCH_LIMIT}
  `;
  if (!candidates.length) return { selected: 0, saved: 0 };
  const employees = await prisma.employee.findMany({
    orderBy: { id: 'asc' }, select: { displayName: true, lastName: true, firstName: true },
  });
  let saved = 0;
  for (const candidate of candidates) {
    signal.throwIfAborted();
    try {
      const documentSignal = AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]);
      if (await generateFeedback(candidate, employees, documentSignal)) saved += 1;
    } catch (error) {
      signal.throwIfAborted();
      logger.warn({ documentId: candidate.id, error: error instanceof Error ? error.name : 'unknown' }, 'procedure_document_feedback_failed');
    }
  }
  return { selected: candidates.length, saved };
}
