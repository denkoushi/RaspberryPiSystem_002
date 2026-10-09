import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { procedureLayoutSuggestionResponseSchema, type OverlayTextElement, type ProcedureLayoutSuggestionRequest, type ProcedureLayoutSuggestionResponse } from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { getAssemblyProcedureAssetStorage } from '../assembly-procedure-assets/index.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { TextCompletionPort } from '../inference/ports/text-completion.port.js';
import type { VisionCompletionPort } from '../inference/ports/vision-completion.port.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';
import { arrangeProcedureLayout, assignProcedureLayoutRows, median, ProcedureLayoutError, rewriteProcedureTexts } from './procedure-layout.js';

const TEXT_INSTRUCTION = `あなたは工場の手順書を仕上げる編集者です。入力は手順書1ページ分の文章です。各 text を、作業者がすぐ読める最終形に書き直してください。
規則:
- text にある数値・品名・数量・見出しは必ず残す。text に無い事実や数値を足さない。
- 品名と数量の列挙は1行1品の箇条書き(・)にする。「A、B2個、C２個」は3行に分ける。
- 作業の説明文は、番号付きで1行1動作に分ける。許容値は動作の行に入れる。
- 見出し(第一工程目、使用治具、測定方法など)には番号や・を付けない。
- 見出しだけの text、すでに読みやすい text はそのまま返す。
- 1行が長くなっても文の途中では改行しない。
例:
入力: "加工前ボルトを締めて芯出し\nゲージで端の傾きを0.02以内にする。その後高さが0.5以内なら開始。切り込み5μ"
出力: "1. ボルトを締めて芯出し\n2. ゲージで端の傾き 0.02 以内\n3. 高さ 0.5 以内なら加工開始\n切り込み 5μ"
JSONだけを返す: {"texts":[{"id":"...","text":"..."}]}`;

const photoInstruction = (name: string, n: number, pageTexts: string) => `手順書「${name}」の${n}枚目の写真です。
このページの文章(参考):
${pageTexts}

この写真で作業者が行っている準備・段取り・測定を、手順書に載せる1行(全角20字以内、体言止めか「〜する」)で書いてください。
規則:
- 現場の言葉を使う: 加工する品物は「ワーク」、L字や箱形の治具は「イケール」、円柱の押さえは「重り」、測定器は「ダイヤルゲージ」、回転する石は「砥石」。色や形(オレンジ色、銀色、円筒など)では呼ばない。
- 同じ物が複数あれば必ず数えて個数を入れる。
- 置いてある台の種類は、磁石の台(電磁チャック)だとはっきり分かるときだけ書く。分からなければ台の名前は書かない。
- 写真に見えないことは書かない。機械が動いているかどうかは書かない。
- はっきり分からないときは「不明」とだけ書く。
1行だけを返す。`;

type SuggestParams = ProcedureLayoutSuggestionRequest & { documentId: string; signal: AbortSignal };
export class ProcedureLayoutSuggestionService {
  constructor(
    private readonly text: TextCompletionPort = getInferenceRuntime().createTextCompletionPort(),
    private readonly access = new AssemblyTemplateAccessService(),
    private readonly vision?: VisionCompletionPort,
  ) {}

  async suggest(params: SuggestParams): Promise<ProcedureLayoutSuggestionResponse> {
    try {
      params.signal.throwIfAborted();
      const feedback: Prisma.AssemblyProcedureCaptionFeedbackCreateManyInput[] = [];
      const result = await this.buildSuggestion(params, feedback);
      params.signal.throwIfAborted();
      if (feedback.length) {
        try {
          await prisma.assemblyProcedureCaptionFeedback.createMany({ data: feedback, skipDuplicates: true });
        } catch (error) {
          logger.warn({ err: error, documentId: params.documentId }, 'assembly_procedure_caption_feedback_proposal_failed');
        }
      }
      params.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (params.signal.aborted) throw new ApiError(499, '提案を中断しました', undefined, 'ASSEMBLY_PROCEDURE_LAYOUT_CANCELLED');
      throw error;
    }
  }

  private async buildSuggestion(params: SuggestParams, feedback: Prisma.AssemblyProcedureCaptionFeedbackCreateManyInput[]): Promise<ProcedureLayoutSuggestionResponse> {
    await this.access.requireAccessPassword(params.accessPassword);
    const document = await prisma.assemblyProcedureDocument.findUnique({
      where: { id: params.documentId },
      select: { name: true, status: true, isActive: true, revisionMetadata: { select: { revisionRootId: true, isRevisionHead: true } } },
    });
    if (!document) throw new ApiError(404, '手順書が見つかりません');
    if (document.status !== 'DRAFT' || !document.isActive || !document.revisionMetadata?.revisionRootId || !document.revisionMetadata.isRevisionHead) {
      throw new ApiError(409, '最新版の改版下書きだけ編集できます');
    }
    const page = await prisma.assemblyProcedureDocumentPage.findUnique({ where: { documentId_pageIndex: { documentId: params.documentId, pageIndex: params.pageIndex } } });
    if (!page) throw new ApiError(400, '指定ページが存在しません');
    let pageSize: { width: number; height: number };
    try {
      const pageImage = await AssemblyProcedureImageStorage.readImage(page.imageRelativePath);
      const metadata = await sharp(pageImage.buffer).metadata();
      if (!metadata.width || !metadata.height) throw new Error('Missing page dimensions');
      pageSize = { width: metadata.width, height: metadata.height };
    } catch {
      throw new ApiError(422, 'ページ画像の寸法を取得できません', undefined, 'ASSEMBLY_PROCEDURE_LAYOUT_DIMENSIONS_UNAVAILABLE');
    }
    const rows = assignProcedureLayoutRows(params.elements, pageSize);
    let elements = params.elements;
    const textChanges: string[] = [];
    const addedElementIds: string[] = [];
    const texts = elements.filter((element): element is OverlayTextElement => element.kind === 'TEXT');
    // Hold the runtime across the text and photo calls, like the knowledge worker does.
    const runtime = getLocalLlmRuntimeController();
    let held = false;
    let llmAvailable = true;
    try {
    try {
      params.signal.throwIfAborted();
      if (runtime) { await runtime.ensureReady('business_hermes'); held = true; }
    } catch {
      params.signal.throwIfAborted();
      llmAvailable = false;
      if (texts.length) textChanges.push('文章はそのまま(AI が応答しませんでした)');
    }
    if (texts.length && llmAvailable) {
      try {
        {
          params.signal.throwIfAborted();
          const result = await this.text.complete({
            useCase: 'business_hermes', maxTokens: 4000, temperature: 0, enableThinking: false, jsonOutput: true, signal: params.signal,
            messages: [{ role: 'system', content: TEXT_INSTRUCTION }, { role: 'user', content: JSON.stringify({ texts: texts.map(({ id, text }) => ({ id, text })) }) }],
          });
          params.signal.throwIfAborted();
          elements = rewriteProcedureTexts(elements, JSON.parse(result.rawText) as unknown);
        }
        const rewritten = elements.filter((element, index) => element.kind === 'TEXT' && params.elements[index].kind === 'TEXT' && element.text !== (params.elements[index] as OverlayTextElement).text).length;
        if (rewritten) textChanges.push(`文章 ${rewritten} 個を読みやすく書き直した`);
      } catch {
        params.signal.throwIfAborted();
        elements = params.elements;
        llmAvailable = false;
        textChanges.push('文章はそのまま(AI が応答しませんでした)');
      }
    }
    if (rows && llmAvailable) {
      const byId = new Map(elements.map(element => [element.id, element]));
      const eligible = rows.filter(row => {
        const lines = row.textIds.flatMap(id => (byId.get(id) as OverlayTextElement).text.split('\n')).map(line => line.trim()).filter(Boolean);
        return !lines.length || (lines.length === 1 && Array.from(lines[0]).length <= 10);
      }).slice(0, 6);
      // Missing/unreadable assets affect only the optional photo descriptions.
      const assets = eligible.length ? await prisma.assemblyProcedureAsset.findMany({
        where: { id: { in: eligible.map(row => {
          const image = byId.get(row.imageId)!;
          return image.kind === 'IMAGE' ? image.assetId : '';
        }) }, kind: 'OVERLAY_IMAGE' }, select: { id: true, storageKey: true },
      }).catch(() => []) : [];
      const pageTexts = rows.map((row, i) => `${i + 1}枚目: ${row.textIds.map(id => (byId.get(id) as OverlayTextElement).text).join('\n')}`).join('\n');
      const representativeFont = median(texts.map(text => text.style?.fontSizeRatio ?? 0.025));
      const representative = [...texts].sort((a, b) => Math.abs((a.style?.fontSizeRatio ?? 0.025) - representativeFont) - Math.abs((b.style?.fontSizeRatio ?? 0.025) - representativeFont))[0];
      for (const row of eligible) {
        params.signal.throwIfAborted();
        try {
          const image = byId.get(row.imageId)!;
          if (image.kind !== 'IMAGE') continue;
          const asset = assets.find(asset => asset.id === image.assetId);
          if (!asset) continue;
          let imageBytes = await getAssemblyProcedureAssetStorage().read({ storageKey: asset.storageKey });
          if ((await sharp(imageBytes).metadata()).format !== 'jpeg') imageBytes = await sharp(imageBytes).rotate().jpeg().toBuffer();
          params.signal.throwIfAborted();
          const result = await (this.vision ?? getInferenceRuntime().createVisionCompletionPort()).complete({
            userText: photoInstruction(document.name, rows.indexOf(row) + 1, pageTexts), imageBytes, mimeType: 'image/jpeg',
            maxTokens: 120, temperature: 0, signal: params.signal,
          });
          params.signal.throwIfAborted();
          const line = result.rawText.split(/\r?\n/)[0].trim();
          if (!line || Array.from(line).length > 30 || line.includes('不明')) continue;
          let id: string;
          do { id = randomUUID(); } while (byId.has(id));
          const added: OverlayTextElement = { id, kind: 'TEXT', pageIndex: params.pageIndex, text: line,
            bbox: { xRatio: 0.04, yRatio: image.bbox.yRatio, widthRatio: 0.3, heightRatio: 0.01 },
            zIndex: Math.max(0, ...elements.map(element => element.zIndex)) + 1,
            style: { ...representative?.style, fontSizeRatio: representativeFont },
          };
          const contextText = row.textIds.map(textId => {
            const original = params.elements.find(element => element.id === textId);
            return original?.kind === 'TEXT' ? original.text : '';
          }).join('\n').trim() || null;
          feedback.push({ documentId: params.documentId, pageIndex: params.pageIndex, elementId: id,
            assetId: image.assetId, documentName: document.name, contextText, aiText: line, outcome: 'PROPOSED' });
          const insertAt = row.textIds.length ? 1 : 0;
          row.textIds.splice(insertAt, 0, id);
          elements = [...elements, added]; byId.set(id, added); addedElementIds.push(id);
        } catch { params.signal.throwIfAborted(); }
      }
    }
    } finally { if (held && runtime) await runtime.release('business_hermes'); }
    try {
      params.signal.throwIfAborted();
      const result = arrangeProcedureLayout({ elements, page: pageSize, rows, originalElements: params.elements });
      const changes = [...result.changes, ...textChanges, ...(addedElementIds.length ? [`写真を読んで ${addedElementIds.length} 行足した`] : [])].slice(0, 8);
      return procedureLayoutSuggestionResponseSchema.parse({ elements: result.elements, addedElementIds, changes: changes.length ? changes : ['直すところはありません'] });
    } catch (error) {
      params.signal.throwIfAborted();
      if (error instanceof ProcedureLayoutError) throw new ApiError(422, 'このページは1枚に収まりません', undefined, 'ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT');
      throw new ApiError(502, 'いまは提案できません', undefined, 'ASSEMBLY_PROCEDURE_LAYOUT_INVALID_RESULT');
    }
  }
}
