import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { PartMeasurementProcessGroup, PartMeasurementTemplateScope, SelfInspectionMode } from '@prisma/client';

import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import {
  PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN,
  PART_MEASUREMENT_FHINMEI_ONLY_BUCKET_FHINCD,
  PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
  PART_MEASUREMENT_LEGACY_RESOURCE_CD
} from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import { templateSupportsInspectionDrawing } from './part-measurement-inspection-drawing-policy.js';
import {
  assertOperableProductionPartMeasurementTemplate,
  isInspectionDrawingEvaluationTemplate,
  productionPartMeasurementTemplateWhere
} from './part-measurement-template-guards.js';
import { normalizeFhincd } from './template-candidate-rules.js';
import {
  resolveReviseSelfInspectionFields,
  validateSelfInspectionConfigFromDb
} from './self-inspection-config.js';

export type TemplateItemInput = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  /** 図面上の番号など表示用（任意） */
  displayMarker?: string | null;
  unit?: string | null;
  allowNegative?: boolean;
  decimalPlaces?: number;
  markerXRatio?: number | null;
  markerYRatio?: number | null;
  nominalValue?: number | null;
  lowerLimit?: number | null;
  upperLimit?: number | null;
};

function optionalDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return new Prisma.Decimal(String(value));
}

function clampRatio(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizeResourceCd(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
}

function buildInspectionDrawingEvaluationTemplateName(
  baseName: string,
  referenceFhincd: string,
  referenceResourceCd: string,
  referenceProcessGroup: PartMeasurementProcessGroup
): string {
  const suffix = `[eval ${referenceFhincd}/${referenceResourceCd}/${referenceProcessGroup}]`;
  const maxBaseLen = Math.max(1, 200 - suffix.length - 1);
  const clippedBase = baseName.trim().slice(0, maxBaseLen);
  return `${clippedBase} ${suffix}`.slice(0, 200);
}

type ResolvedLineage = {
  templateScope: PartMeasurementTemplateScope;
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  candidateFhinmei: string | null;
};

async function insertNextTemplateVersionInTransaction(
  tx: Prisma.TransactionClient,
  lineage: ResolvedLineage,
  content: {
    name: string;
    items: TemplateItemInput[];
    visualTemplateId: string | null;
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount: number | null;
  }
) {
  const visualId = content.visualTemplateId?.trim() || null;
  if (visualId) {
    const vt = await tx.partMeasurementVisualTemplate.findFirst({
      where: { id: visualId, isActive: true }
    });
    if (!vt) {
      throw new ApiError(400, 'visual template が見つからないか無効です');
    }
  }

  const { fhincd, processGroup, resourceCd, templateScope, candidateFhinmei } = lineage;

  const agg = await tx.partMeasurementTemplate.aggregate({
    where: { fhincd, processGroup, resourceCd },
    _max: { version: true }
  });
  const nextVersion = (agg._max.version ?? 0) + 1;

  await tx.partMeasurementTemplate.updateMany({
    where: { fhincd, processGroup, resourceCd },
    data: { isActive: false }
  });

  return tx.partMeasurementTemplate.create({
    data: {
      templateScope,
      fhincd,
      processGroup,
      resourceCd,
      candidateFhinmei,
      name: content.name.trim(),
      version: nextVersion,
      isActive: true,
      selfInspectionMode: content.selfInspectionMode,
      selfInspectionFixedCount: content.selfInspectionFixedCount,
      selfInspectionSampleSize: null,
      visualTemplateId: visualId,
      items: {
        create: content.items.map((item) => {
          const dp = item.decimalPlaces ?? 6;
          const clamped = Math.min(6, Math.max(0, Math.floor(dp)));
          const dm = item.displayMarker?.trim();
          const xRatio = clampRatio(item.markerXRatio);
          const yRatio = clampRatio(item.markerYRatio);
          return {
            sortOrder: item.sortOrder,
            datumSurface: item.datumSurface.trim(),
            measurementPoint: item.measurementPoint.trim(),
            measurementLabel: item.measurementLabel.trim(),
            displayMarker: dm && dm.length > 0 ? dm.slice(0, 40) : null,
            unit: item.unit?.trim() || null,
            allowNegative: item.allowNegative !== false,
            decimalPlaces: clamped,
            markerXRatio: xRatio != null ? optionalDecimal(xRatio) : null,
            markerYRatio: yRatio != null ? optionalDecimal(yRatio) : null,
            nominalValue: optionalDecimal(item.nominalValue),
            lowerLimit: optionalDecimal(item.lowerLimit),
            upperLimit: optionalDecimal(item.upperLimit)
          };
        })
      }
    },
    include: partMeasurementTemplateFullInclude
  });
}

export class PartMeasurementTemplateService {
  /**
   * キオスク検査図面テンプレ編集用。本番テンプレ条件 + 図面・全測定点マーカー必須。
   * 履歴版（isActive=false）も閲覧用に返す。
   */
  async getKioskInspectionDrawingTemplateById(id: string) {
    const template = await prisma.partMeasurementTemplate.findFirst({
      where: productionPartMeasurementTemplateWhere({ id }),
      include: partMeasurementTemplateFullInclude
    });
    if (!template) {
      throw new ApiError(404, '検査図面テンプレートが見つかりません');
    }
    assertOperableProductionPartMeasurementTemplate(template);
    if (template.templateScope !== 'THREE_KEY') {
      throw new ApiError(409, 'このテンプレートは検査図面編集の対象外です');
    }
    if (template.processGroup !== 'CUTTING' && template.processGroup !== 'GRINDING') {
      throw new ApiError(409, 'このテンプレートは検査図面編集の対象外です');
    }
    if (!templateSupportsInspectionDrawing(template)) {
      throw new ApiError(409, 'このテンプレートは検査図面編集の対象外です');
    }
    return template;
  }

  /**
   * キオスク検査図面一覧用。本番 THREE_KEY（切削/研削）かつ図面・全マーカーありのみ。
   * fhincd は部分一致（大文字小文字無視）。
   */
  async listKioskInspectionDrawingTemplates(query: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
  }) {
    const where: Prisma.PartMeasurementTemplateWhereInput = {
      templateScope: 'THREE_KEY',
      processGroup: { in: ['CUTTING', 'GRINDING'] },
      visualTemplateId: { not: null }
    };
    const fhincdQ = query.fhincd?.trim();
    if (fhincdQ) {
      where.fhincd = { contains: fhincdQ, mode: 'insensitive' };
    }
    if (query.processGroup) {
      where.processGroup = query.processGroup;
    }
    if (query.resourceCd !== undefined) {
      where.resourceCd = normalizeResourceCd(query.resourceCd);
    }
    if (!query.includeInactive) {
      where.isActive = true;
    }

    const rows = await prisma.partMeasurementTemplate.findMany({
      where: productionPartMeasurementTemplateWhere(where),
      orderBy: [{ fhincd: 'asc' }, { processGroup: 'asc' }, { resourceCd: 'asc' }, { version: 'desc' }],
      include: {
        visualTemplate: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            markerXRatio: true,
            markerYRatio: true,
            lowerLimit: true,
            upperLimit: true
          }
        }
      }
    });

    return rows
      .filter((row) => templateSupportsInspectionDrawing(row))
      .map((row) => ({
        template: row,
        itemCount: row.items.length
      }));
  }

  /** キオスク検査図面テンプレの改版（有効版かつ図面対象のみ） */
  async reviseKioskInspectionDrawingTemplate(
    sourceTemplateId: string,
    body: {
      name: string;
      items: TemplateItemInput[];
      visualTemplateId?: string | null;
      selfInspectionMode?: SelfInspectionMode;
      selfInspectionFixedCount?: number | null;
      selfInspectionSampleSize?: number | null;
    }
  ) {
    const source = await this.getKioskInspectionDrawingTemplateById(sourceTemplateId);
    if (!source.isActive) {
      throw new ApiError(409, '無効なテンプレートは編集できません。有効版を選び直してください。');
    }
    return this.reviseActiveTemplate(sourceTemplateId, body);
  }

  async findActiveByFhincdGroupAndResource(
    fhincd: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    const f = fhincd.trim();
    const r = normalizeResourceCd(resourceCd);
    if (f.length === 0) return null;
    return prisma.partMeasurementTemplate.findFirst({
      where: { fhincd: f, processGroup, resourceCd: r, isActive: true, templateScope: 'THREE_KEY' },
      orderBy: { version: 'desc' },
      include: partMeasurementTemplateFullInclude
    });
  }

  async listTemplates(query: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
  }) {
    const where: Prisma.PartMeasurementTemplateWhereInput = {};
    if (query.fhincd?.trim()) {
      where.fhincd = query.fhincd.trim();
    }
    if (query.processGroup) {
      where.processGroup = query.processGroup;
    }
    if (query.resourceCd !== undefined) {
      where.resourceCd = normalizeResourceCd(query.resourceCd);
    }
    if (!query.includeInactive) {
      where.isActive = true;
    }
    return prisma.partMeasurementTemplate.findMany({
      where: productionPartMeasurementTemplateWhere(where),
      orderBy: [{ fhincd: 'asc' }, { processGroup: 'asc' }, { resourceCd: 'asc' }, { version: 'desc' }],
      include: partMeasurementTemplateFullInclude
    });
  }

  /**
   * 同一 FIHNCD + 工程 + 資源CD で新バージョンを作成し、同キーの旧版を非アクティブ化する。
   */
  async createTemplateVersion(params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    name: string;
    items: TemplateItemInput[];
    visualTemplateId?: string | null;
    /** 既定 THREE_KEY（clone / 正本登録）。候補登録では FHINCD_RESOURCE / FHINMEI_ONLY */
    templateScope?: PartMeasurementTemplateScope;
    candidateFhinmei?: string | null;
    selfInspectionMode?: SelfInspectionMode;
    selfInspectionFixedCount?: number | null;
    /** @deprecated API 互換 */
    selfInspectionSampleSize?: number | null;
  }) {
    const templateScope: PartMeasurementTemplateScope = params.templateScope ?? 'THREE_KEY';
    let fhincd = params.fhincd.trim();
    let processGroup: PartMeasurementProcessGroup = params.processGroup;
    let resourceCd = normalizeResourceCd(params.resourceCd);
    let candidateFhinmei: string | null =
      params.candidateFhinmei != null && String(params.candidateFhinmei).trim().length > 0
        ? String(params.candidateFhinmei).trim()
        : null;

    if (templateScope === 'FHINCD_RESOURCE') {
      processGroup = 'CANDIDATE_FHINCD_RESOURCE';
      candidateFhinmei = null;
      if (fhincd.length === 0) {
        throw new ApiError(400, 'FIHNCD が空です');
      }
    } else if (templateScope === 'FHINMEI_ONLY') {
      processGroup = 'CANDIDATE_FHINMEI_ONLY';
      fhincd = PART_MEASUREMENT_FHINMEI_ONLY_BUCKET_FHINCD;
      resourceCd = randomUUID().replace(/-/g, '').slice(0, 32);
      if (!candidateFhinmei || candidateFhinmei.length === 0) {
        throw new ApiError(400, 'FHINMEI（候補キー）が空です');
      }
      if (candidateFhinmei.length < PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN) {
        throw new ApiError(400, 'FHINMEI（候補キー）は 2 文字以上にしてください');
      }
    } else {
      candidateFhinmei = null;
      if (fhincd.length === 0) {
        throw new ApiError(400, 'FIHNCD が空です');
      }
    }

    if (params.items.length === 0) {
      throw new ApiError(400, 'テンプレート項目が空です');
    }
    const validated = validateSelfInspectionConfigFromDb(
      params.selfInspectionMode ?? 'FULL',
      params.selfInspectionFixedCount,
      params.selfInspectionSampleSize
    );

    const visualId = params.visualTemplateId?.trim() || null;

    return prisma.$transaction((tx) =>
      insertNextTemplateVersionInTransaction(
        tx,
        { templateScope, fhincd, processGroup, resourceCd, candidateFhinmei },
        {
          name: params.name,
          items: params.items,
          visualTemplateId: visualId,
          selfInspectionMode: validated.mode,
          selfInspectionFixedCount: validated.fixedCount
        }
      )
    );
  }

  /**
   * 検査図面 MVP 用の評価テンプレ。実品番・資源CD とは別バケットに保存し、本番 active テンプレを非アクティブ化しない。
   */
  async createInspectionDrawingEvaluationTemplate(params: {
    referenceFhincd: string;
    referenceResourceCd: string;
    referenceProcessGroup: PartMeasurementProcessGroup;
    name: string;
    items: TemplateItemInput[];
    visualTemplateId?: string | null;
    /** 取込済み図面 URL と表示名（multipart 経路では importDrawingAndSave 済み） */
    drawingUpload?: { relativeUrl: string; displayName: string };
  }) {
    const referenceFhincd = params.referenceFhincd.trim();
    const referenceResourceCd = normalizeResourceCd(params.referenceResourceCd);
    if (referenceFhincd.length === 0) {
      throw new ApiError(400, '品番（評価用ラベル）が空です');
    }
    if (params.items.length === 0) {
      throw new ApiError(400, 'テンプレート項目が空です');
    }

    const resourceCd = randomUUID().replace(/-/g, '').slice(0, 32);
    const templateName = buildInspectionDrawingEvaluationTemplateName(
      params.name,
      referenceFhincd,
      referenceResourceCd,
      params.referenceProcessGroup
    );

    const lineage: ResolvedLineage = {
      templateScope: 'THREE_KEY',
      fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
      processGroup: 'CANDIDATE_FHINMEI_ONLY',
      resourceCd,
      candidateFhinmei: null
    };

    let drawingPathToCleanup: string | null = null;
    let orphanVisualTemplateId: string | null = null;
    try {
      let visualTemplateId = params.visualTemplateId?.trim() || null;
      if (params.drawingUpload) {
        const relativeUrl = params.drawingUpload.relativeUrl.trim();
        if (!relativeUrl.startsWith('/api/storage/part-measurement-drawings/')) {
          throw new ApiError(400, '図面の保存パスが不正です');
        }
        drawingPathToCleanup = relativeUrl;
        const vt = await prisma.partMeasurementVisualTemplate.create({
          data: {
            name: params.drawingUpload.displayName.slice(0, 200),
            drawingImageRelativePath: relativeUrl,
            isActive: true
          }
        });
        orphanVisualTemplateId = vt.id;
        visualTemplateId = vt.id;
      }
      if (!visualTemplateId) {
        throw new ApiError(400, 'visualTemplateId または図面ファイルが必要です');
      }

      const template = await prisma.$transaction((tx) =>
        insertNextTemplateVersionInTransaction(tx, lineage, {
          name: templateName,
          items: params.items,
          visualTemplateId,
          selfInspectionMode: 'FULL',
          selfInspectionFixedCount: null
        })
      );
      drawingPathToCleanup = null;
      const createdVisualTemplateId = orphanVisualTemplateId;
      orphanVisualTemplateId = null;
      return { template, createdVisualTemplateId };
    } catch (error) {
      if (orphanVisualTemplateId) {
        await prisma.partMeasurementVisualTemplate
          .delete({ where: { id: orphanVisualTemplateId } })
          .catch(() => undefined);
      }
      if (drawingPathToCleanup) {
        await PartMeasurementDrawingStorage.deleteDrawing(drawingPathToCleanup).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * 評価用テンプレ作成直後に記録表作成が失敗したときの片残り回収（通常一覧からは非表示のため）。
   * 既存 visual template を再利用した場合は `createdVisualTemplateId` を渡さず、図面資産を削除しない。
   */
  async cleanupInspectionDrawingEvaluationTemplate(
    templateId: string,
    options?: { createdVisualTemplateId?: string | null }
  ): Promise<void> {
    const template = await prisma.partMeasurementTemplate.findUnique({
      where: { id: templateId },
      include: { visualTemplate: true }
    });
    if (!template || !isInspectionDrawingEvaluationTemplate(template)) {
      return;
    }
    const visualTemplateId = template.visualTemplateId;
    const mayDeleteVisual =
      visualTemplateId != null &&
      options?.createdVisualTemplateId != null &&
      options.createdVisualTemplateId === visualTemplateId;
    const drawingPath = mayDeleteVisual
      ? (template.visualTemplate?.drawingImageRelativePath ?? null)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.partMeasurementSheet.deleteMany({ where: { templateId } });
      await tx.partMeasurementTemplate.delete({ where: { id: templateId } });
      if (mayDeleteVisual && visualTemplateId) {
        const otherTemplates = await tx.partMeasurementTemplate.count({
          where: { visualTemplateId, id: { not: templateId } }
        });
        if (otherTemplates === 0) {
          await tx.partMeasurementVisualTemplate.delete({ where: { id: visualTemplateId } });
        }
      }
    });

    if (drawingPath) {
      await PartMeasurementDrawingStorage.deleteDrawing(drawingPath).catch(() => undefined);
    }
  }

  /**
   * 有効版テンプレの系譜を固定したまま次バージョンを作成する（管理コンソール「編集」用）。
   * FHINMEI_ONLY でも DB 上の resourceCd を変えず版だけ上げる。
   */
  async reviseActiveTemplate(
    sourceTemplateId: string,
    body: {
      name: string;
      items: TemplateItemInput[];
      visualTemplateId?: string | null;
      /** FHINMEI_ONLY の改版でのみ指定可 */
      candidateFhinmei?: string | null;
      selfInspectionMode?: SelfInspectionMode;
      selfInspectionFixedCount?: number | null;
      /** @deprecated API 互換 */
      selfInspectionSampleSize?: number | null;
    }
  ) {
    if (body.items.length === 0) {
      throw new ApiError(400, 'テンプレート項目が空です');
    }

    const source = await prisma.partMeasurementTemplate.findUnique({
      where: { id: sourceTemplateId }
    });
    if (!source) {
      throw new ApiError(404, 'テンプレートが見つかりません');
    }
    assertOperableProductionPartMeasurementTemplate(source);
    if (!source.isActive) {
      throw new ApiError(409, '無効なテンプレートは編集できません。有効版を選び直してください。');
    }

    if (body.candidateFhinmei !== undefined && body.candidateFhinmei !== null && source.templateScope !== 'FHINMEI_ONLY') {
      throw new ApiError(400, 'FHINMEI_ONLY 以外では FHINMEI 候補キーを変更できません');
    }

    let nextCandidate = source.candidateFhinmei;
    if (body.candidateFhinmei !== undefined && source.templateScope === 'FHINMEI_ONLY') {
      const c = String(body.candidateFhinmei ?? '').trim();
      if (c.length < PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN) {
        throw new ApiError(400, 'FHINMEI（候補キー）は 2 文字以上にしてください');
      }
      nextCandidate = c;
    }

    const lineage: ResolvedLineage = {
      templateScope: source.templateScope,
      fhincd: source.fhincd,
      processGroup: source.processGroup,
      resourceCd: source.resourceCd,
      candidateFhinmei: nextCandidate
    };

    const visualId = body.visualTemplateId !== undefined ? body.visualTemplateId : source.visualTemplateId;
    const normalizedVisual = visualId?.trim() ? visualId.trim() : null;
    const validated = resolveReviseSelfInspectionFields(body, source);

    return prisma.$transaction((tx) =>
      insertNextTemplateVersionInTransaction(tx, lineage, {
        name: body.name,
        items: body.items,
        visualTemplateId: normalizedVisual,
        selfInspectionMode: validated.mode,
        selfInspectionFixedCount: validated.fixedCount
      })
    );
  }

  /**
   * 最新の有効版を論理削除する（行の isActive のみ false。旧版は自動で有効化しない）。
   */
  async retireActiveTemplate(templateId: string) {
    const t = await prisma.partMeasurementTemplate.findUnique({
      where: { id: templateId }
    });
    if (!t) {
      throw new ApiError(404, 'テンプレートが見つかりません');
    }
    assertOperableProductionPartMeasurementTemplate(t);
    if (!t.isActive) {
      throw new ApiError(409, '無効なテンプレートは削除できません。有効版を選び直してください。');
    }
    return prisma.partMeasurementTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
      include: partMeasurementTemplateFullInclude
    });
  }

  /**
   * キオスク候補選択: 参照テンプレの項目・図面を、日程の **FIHNCD + 工程 + 資源CD** に複製する。
   * 同一キーで既に active がある場合は新規作成せずそれを返す。
   */
  async cloneActiveTemplateToScheduleKey(params: {
    sourceTemplateId: string;
    targetFhincd: string;
    targetProcessGroup: PartMeasurementProcessGroup;
    targetResourceCd: string;
  }) {
    const fhincd = params.targetFhincd.trim();
    const resourceCd = normalizeResourceCd(params.targetResourceCd);
    if (fhincd.length === 0) {
      throw new ApiError(400, 'FIHNCD が空です');
    }

    const existingActive = await this.findActiveByFhincdGroupAndResource(
      fhincd,
      params.targetProcessGroup,
      resourceCd
    );
    if (existingActive) {
      return {
        template: existingActive,
        reusedExistingActive: true,
        didClone: false
      };
    }

    const source = await prisma.partMeasurementTemplate.findFirst({
      where: { id: params.sourceTemplateId, isActive: true },
      include: partMeasurementTemplateFullInclude
    });
    if (!source) {
      throw new ApiError(404, 'テンプレートが見つからないか無効です');
    }
    assertOperableProductionPartMeasurementTemplate(source);

    const targetFhincdNorm = normalizeFhincd(fhincd);
    const sourceFhincdNorm = normalizeFhincd(source.fhincd);
    const sourceResNorm = normalizeResourceCd(source.resourceCd);
    const sameThreeKey =
      source.templateScope === 'THREE_KEY' &&
      sourceFhincdNorm === targetFhincdNorm &&
      sourceResNorm === resourceCd &&
      source.processGroup === params.targetProcessGroup;

    if (sameThreeKey) {
      return {
        template: source,
        reusedExistingActive: false,
        didClone: false
      };
    }

    if (!source.items?.length) {
      throw new ApiError(400, '参照テンプレートに項目がありません');
    }

    const items: TemplateItemInput[] = source.items.map((item) => ({
      sortOrder: item.sortOrder,
      datumSurface: item.datumSurface,
      measurementPoint: item.measurementPoint,
      measurementLabel: item.measurementLabel,
      displayMarker: item.displayMarker,
      unit: item.unit,
      allowNegative: item.allowNegative,
      decimalPlaces: item.decimalPlaces,
      markerXRatio: item.markerXRatio != null ? Number(item.markerXRatio) : null,
      markerYRatio: item.markerYRatio != null ? Number(item.markerYRatio) : null,
      nominalValue: item.nominalValue != null ? Number(item.nominalValue) : null,
      lowerLimit: item.lowerLimit != null ? Number(item.lowerLimit) : null,
      upperLimit: item.upperLimit != null ? Number(item.upperLimit) : null
    }));

    const baseName = source.name.trim().slice(0, 120);
    const crossPart = sourceFhincdNorm !== targetFhincdNorm;
    const name = (
      crossPart
        ? `${fhincd} ${baseName}（類似流用）`
        : `${baseName}（資源${resourceCd}へ流用）`
    ).slice(0, 200);

    const template = await this.createTemplateVersion({
      fhincd,
      processGroup: params.targetProcessGroup,
      resourceCd,
      name,
      items,
      visualTemplateId: source.visualTemplateId,
      templateScope: 'THREE_KEY',
      candidateFhinmei: null,
      selfInspectionMode: source.selfInspectionMode,
      selfInspectionFixedCount: source.selfInspectionFixedCount,
      selfInspectionSampleSize: source.selfInspectionSampleSize
    });

    return {
      template,
      reusedExistingActive: false,
      didClone: true
    };
  }

  async setActiveVersion(templateId: string) {
    const t = await prisma.partMeasurementTemplate.findUnique({ where: { id: templateId } });
    if (!t) {
      throw new ApiError(404, 'テンプレートが見つかりません');
    }
    assertOperableProductionPartMeasurementTemplate(t);
    await prisma.$transaction([
      prisma.partMeasurementTemplate.updateMany({
        where: { fhincd: t.fhincd, processGroup: t.processGroup, resourceCd: t.resourceCd },
        data: { isActive: false }
      }),
      prisma.partMeasurementTemplate.update({
        where: { id: templateId },
        data: { isActive: true }
      })
    ]);
    return prisma.partMeasurementTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: partMeasurementTemplateFullInclude
    });
  }
}
