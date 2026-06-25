import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  getKioskInspectionDrawingTemplate,
  getResolvedClientKey,
  getSelfInspectionPaperReportPrint,
  setClientKeyHeader
} from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  buildInspectionDrawingPrintViewModel,
  InspectionDrawingPrintBuildError,
  InspectionDrawingPrintPreview
} from '../../features/part-measurement/inspection-drawing';
import {
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  KIOSK_INSPECTION_DRAWING_PRINT_RETURN_LABEL,
  parseKioskInspectionDrawingPrintReturnToFromSearch,
  parseInspectionDrawingPrintPlannedQuantityFromSearch
} from '../../features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';

import type {
  PartMeasurementTemplateDto,
  SelfInspectionPaperReportDto
} from '../../features/part-measurement/types';

type TemplateLoadState =
  | { kind: 'loading' }
  | { kind: 'missing_template_id' }
  | { kind: 'not_found'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      template: PartMeasurementTemplateDto;
      paperReport: SelfInspectionPaperReportDto | null;
    };

type TemplateLoadErrorState = Exclude<TemplateLoadState, { kind: 'loading' } | { kind: 'loaded' }>;

function resolveTemplateLoadError(error: unknown): TemplateLoadErrorState {
  const err = error as { response?: { status?: number; data?: { message?: string } } };
  const message = err.response?.data?.message?.trim();

  if (err.response?.status === 404) {
    return {
      kind: 'not_found',
      message: message || 'テンプレートが見つかりません。'
    };
  }

  if (err.response?.status === 409) {
    return {
      kind: 'unsupported',
      message: message || '検査図面帳票の対象外テンプレートです。'
    };
  }

  return {
    kind: 'error',
    message: message || 'テンプレートの読み込みに失敗しました。'
  };
}

function PrintErrorScreen({
  title,
  message,
  detail,
  returnLink
}: {
  title: string;
  message: string;
  detail?: string;
  returnLink?: { to: string; label: string };
}) {
  const link = returnLink ?? { to: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH, label: '検査図面一覧へ' };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-6 text-slate-900">
      <div className="max-w-lg rounded border border-slate-300 bg-white p-6 shadow">
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-700">{message}</p>
        {detail ? <p className="mt-2 text-xs text-slate-500">{detail}</p> : null}
        <Link
          to={link.to}
          replace={Boolean(returnLink)}
          className="mt-4 inline-flex rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white"
        >
          {link.label}
        </Link>
      </div>
    </div>
  );
}

/** 保存済み検査図面テンプレートの A4 横 HTML 帳票プレビュー（KioskLayout 外） */
export function KioskInspectionDrawingPrintPage() {
  const { templateId, reportId } = useParams<{ templateId?: string; reportId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [issuedAt] = useState(() => new Date());
  const [loadState, setLoadState] = useState<TemplateLoadState>(() =>
    templateId?.trim() || reportId?.trim() ? { kind: 'loading' } : { kind: 'missing_template_id' }
  );

  useEffect(() => {
    setClientKeyHeader(getResolvedClientKey());
  }, []);

  const clientKey = getResolvedClientKey();
  const isPaperReportPrint = Boolean(reportId?.trim());
  const paperReportReturnTo = useMemo(
    () =>
      isPaperReportPrint
        ? parseKioskInspectionDrawingPrintReturnToFromSearch(location.search)
        : null,
    [isPaperReportPrint, location.search]
  );
  const paperReportReturnLink = paperReportReturnTo
    ? { to: paperReportReturnTo, label: KIOSK_INSPECTION_DRAWING_PRINT_RETURN_LABEL }
    : undefined;
  const paperReportReturnAction = paperReportReturnTo
    ? {
        label: KIOSK_INSPECTION_DRAWING_PRINT_RETURN_LABEL,
        onClick: () => navigate(paperReportReturnTo, { replace: true })
      }
    : undefined;
  const resourcesQuery = useKioskProductionScheduleResources();
  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );

  useEffect(() => {
    const id = templateId?.trim();
    const paperId = reportId?.trim();
    if (!id && !paperId) {
      setLoadState({ kind: 'missing_template_id' });
      return;
    }

    let cancelled = false;
    setLoadState({ kind: 'loading' });

    void (async () => {
      try {
        if (paperId) {
          const paper = await getSelfInspectionPaperReportPrint(paperId, clientKey);
          if (!cancelled) {
            setLoadState({
              kind: 'loaded',
              template: paper.template,
              paperReport: paper.report
            });
          }
          return;
        }

        const template = await getKioskInspectionDrawingTemplate(id!, clientKey);
        if (!cancelled) {
          setLoadState({ kind: 'loaded', template, paperReport: null });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState(resolveTemplateLoadError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientKey, reportId, templateId]);

  const template = loadState.kind === 'loaded' ? loadState.template : null;
  const paperReport = loadState.kind === 'loaded' ? loadState.paperReport : null;
  const drawingPath = template?.visualTemplate?.drawingImageRelativePath ?? null;
  const { blobUrl, error: blobError } = usePartMeasurementDrawingBlobUrl(drawingPath);

  const viewModelResult = useMemo(() => {
    if (!template) return null;
    const plannedQuantity =
      paperReport?.plannedQuantity ?? parseInspectionDrawingPrintPlannedQuantityFromSearch(location.search);
    const issuedAtForViewModel = paperReport ? new Date(paperReport.issuedAt) : issuedAt;
    try {
      return {
        viewModel: buildInspectionDrawingPrintViewModel({
          template,
          resourceName: formatResourceCdWithJapaneseNames(template.resourceCd, resourceNameMap),
          issuedAt: issuedAtForViewModel,
          plannedQuantity,
          paperReport: paperReport
            ? {
                reportId: paperReport.id,
                pages: paperReport.pages.map((page) => ({
                  pageNumber: page.pageNumber,
                  qrPayload: page.qrPayload
                }))
              }
            : null
        }),
        error: null as InspectionDrawingPrintBuildError | null
      };
    } catch (error) {
      if (error instanceof InspectionDrawingPrintBuildError) {
        return { viewModel: null, error };
      }
      throw error;
    }
  }, [issuedAt, location.search, paperReport, resourceNameMap, template]);

  if (loadState.kind === 'loading') {
    return (
      <PrintErrorScreen
        title="帳票を準備中"
        message="保存済みテンプレートを読み込んでいます…"
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (loadState.kind === 'missing_template_id') {
    return (
      <PrintErrorScreen
        title="帳票を表示できません"
        message="テンプレート ID が指定されていません。"
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (loadState.kind === 'not_found') {
    return (
      <PrintErrorScreen
        title={isPaperReportPrint ? '帳票が見つかりません' : 'テンプレートが見つかりません'}
        message={loadState.message}
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (loadState.kind === 'unsupported') {
    return (
      <PrintErrorScreen
        title="帳票の対象外"
        message={loadState.message}
        detail="409"
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (loadState.kind === 'error') {
    return (
      <PrintErrorScreen
        title="読み込みエラー"
        message={loadState.message}
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (!drawingPath?.trim()) {
    return (
      <PrintErrorScreen
        title="図面がありません"
        message="このテンプレートには印刷用の図面が設定されていません。"
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (viewModelResult?.error) {
    return (
      <PrintErrorScreen
        title="帳票を生成できません"
        message={viewModelResult.error.message}
        detail={viewModelResult.error.code}
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (blobError) {
    return (
      <PrintErrorScreen
        title="図面の読み込みに失敗しました"
        message={blobError}
        detail="Blob 取得失敗"
        returnLink={paperReportReturnLink}
      />
    );
  }

  if (!blobUrl || !viewModelResult?.viewModel) {
    return (
      <PrintErrorScreen
        title="帳票を準備中"
        message="図面データを読み込んでいます…"
        returnLink={paperReportReturnLink}
      />
    );
  }

  return (
    <InspectionDrawingPrintPreview
      viewModel={viewModelResult.viewModel}
      imageUrl={blobUrl}
      showToolbar
      returnAction={paperReportReturnAction}
    />
  );
}
