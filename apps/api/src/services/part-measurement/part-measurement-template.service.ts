import { randomUUID } from 'node:crypto';

import type { PartMeasurementProcessGroup, PartMeasurementTemplateScope, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import {
  PART_MEASUREMENT_FHINMEI_CANDIDATE_MIN_LEN,
  PART_MEASUREMENT_FHINMEI_ONLY_BUCKET_FHINCD,
  PART_MEASUREMENT_LEGACY_RESOURCE_CD
} from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import { normalizeFhincd } from './template-candidate-rules.js';

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
};

function normalizeResourceCd(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
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
  content: { name: string; items: TemplateItemInput[]; visualTemplateId: string | null }
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
      visualTemplateId: visualId,
      items: {
        create: content.items.map((item) => {
          const dp = item.decimalPlaces ?? 6;
          const clamped = Math.min(6, Math.max(0, Math.floor(dp)));
          const dm = item.displayMarker?.trim();
          return {
            sortOrder: item.sortOrder,
            datumSurface: item.datumSurface.trim(),
            measurementPoint: item.measurementPoint.trim(),
            measurementLabel: item.measurementLabel.trim(),
            displayMarker: dm && dm.length > 0 ? dm.slice(0, 40) : null,
            unit: item.unit?.trim() || null,
            allowNegative: item.allowNegative !== false,
            decimalPlaces: clamped
          };
        })
      }
    },
    include: partMeasurementTemplateFullInclude
  });
}

export class PartMeasurementTemplateService {
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
      where,
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

    const visualId = params.visualTemplateId?.trim() || null;

    return prisma.$transaction((tx) =>
      insertNextTemplateVersionInTransaction(
        tx,
        { templateScope, fhincd, processGroup, resourceCd, candidateFhinmei },
        { name: params.name, items: params.items, visualTemplateId: visualId }
      )
    );
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

    return prisma.$transaction((tx) =>
      insertNextTemplateVersionInTransaction(tx, lineage, {
        name: body.name,
        items: body.items,
        visualTemplateId: normalizedVisual
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
      decimalPlaces: item.decimalPlaces
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
      candidateFhinmei: null
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
