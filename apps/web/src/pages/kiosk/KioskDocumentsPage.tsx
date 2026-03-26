import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { resolveKioskDocumentPageImageUrl, type KioskDocumentSource } from '../../api/client';
import { useKioskDocumentDetail, useKioskDocuments } from '../../api/hooks';
import { buildPagePairs } from '../../features/kiosk/documents/kioskDocumentPageLayout';
import { KioskDocumentsListPanel } from '../../features/kiosk/documents/KioskDocumentsListPanel';
import {
  KioskDocumentsViewerPanel,
  type KioskDocumentWidthMode,
} from '../../features/kiosk/documents/KioskDocumentsViewerPanel';

type LayoutMode = 'single' | 'spread';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

export function KioskDocumentsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'' | KioskDocumentSource>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [widthMode, setWidthMode] = useState<KioskDocumentWidthMode>('default');
  const [zoom, setZoom] = useState(1);
  const [listPanelOpen, setListPanelOpen] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const listQuery = useKioskDocuments({
    q: debouncedSearch || undefined,
    sourceType: sourceFilter || undefined,
  });

  const documents = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !documents.some((d) => d.id === selectedId)) {
      setSelectedId(documents[0].id);
    }
  }, [documents, selectedId]);

  const detailQuery = useKioskDocumentDetail(selectedId);
  const pageUrls = useMemo(() => detailQuery.data?.pageUrls ?? [], [detailQuery.data?.pageUrls]);

  const pagePairs = useMemo(() => buildPagePairs(pageUrls, layoutMode), [layoutMode, pageUrls]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
      <KioskDocumentsListPanel
        className={clsx(!listPanelOpen && 'hidden')}
        search={search}
        onSearchChange={setSearch}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        documents={documents}
        selectedId={selectedId}
        onSelectId={setSelectedId}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
      />
      <KioskDocumentsViewerPanel
        listOpen={listPanelOpen}
        onToggleList={() => setListPanelOpen((v) => !v)}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        widthMode={widthMode}
        onWidthModeChange={setWidthMode}
        zoom={zoom}
        onZoomDecrease={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        onZoomIncrease={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        onZoomReset={() => setZoom(1)}
        selectedId={selectedId}
        documentTitle={detailQuery.data?.document.displayTitle || detailQuery.data?.document.title || null}
        detailLoading={detailQuery.isLoading}
        detailError={detailQuery.isError}
        pagePairs={pagePairs}
        resolveImageUrl={resolveKioskDocumentPageImageUrl}
      />
    </div>
  );
}
