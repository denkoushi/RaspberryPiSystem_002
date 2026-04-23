import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { resolveKioskDocumentPageImageUrl, type KioskDocumentSource } from '../../api/client';
import { useKioskDocumentDetail, useKioskDocuments } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import {
  BarcodeScanModal,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL,
  BARCODE_READER_OPTIONS_KIOSK_DEFAULT,
} from '../../features/barcode-scan';
import { buildPagePairs } from '../../features/kiosk/documents/kioskDocumentPageLayout';
import { KioskDocumentsListPanel } from '../../features/kiosk/documents/KioskDocumentsListPanel';
import {
  KioskDocumentsViewerPanel,
  type KioskDocumentWidthMode,
} from '../../features/kiosk/documents/KioskDocumentsViewerPanel';
import { buildKioskDocumentSearchSnippetModel } from '../../features/kiosk/documents/search/kiosk-document-search-snippets';
import { useKioskDocumentListPrefetch } from '../../features/kiosk/documents/useKioskDocumentListPrefetch';
import { usesKioskImmersiveLayout } from '../../features/kiosk/kioskImmersiveLayoutPolicy';

type LayoutMode = 'single' | 'spread';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

export function KioskDocumentsPage() {
  const location = useLocation();
  const toolbarRevealEnabled = usesKioskImmersiveLayout(location.pathname);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'' | KioskDocumentSource>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [widthMode, setWidthMode] = useState<KioskDocumentWidthMode>('default');
  const [zoom, setZoom] = useState(1);
  const [listPanelOpen, setListPanelOpen] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const commitSearchFromScan = useCallback((text: string) => {
    const v = text.trim();
    setSearch(v);
    setDebouncedSearch(v);
  }, []);

  const clearSearchOnScanAbort = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const handleScanSuccess = useCallback(
    (text: string) => {
      commitSearchFromScan(text);
      setScanOpen(false);
    },
    [commitSearchFromScan]
  );

  const handleScanAbort = useCallback(() => {
    clearSearchOnScanAbort();
    setScanOpen(false);
  }, [clearSearchOnScanAbort]);

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
  const { schedulePrefetchDocumentId, cancelScheduledPrefetch } = useKioskDocumentListPrefetch({
    selectedId,
  });
  const pageUrls = useMemo(() => detailQuery.data?.pageUrls ?? [], [detailQuery.data?.pageUrls]);

  const pagePairs = useMemo(() => buildPagePairs(pageUrls, layoutMode), [layoutMode, pageUrls]);

  const snippetModel = useMemo(
    () =>
      buildKioskDocumentSearchSnippetModel(
        detailQuery.data?.document.extractedText,
        debouncedSearch
      ),
    [debouncedSearch, detailQuery.data?.document.extractedText]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
      <BarcodeScanModal
        open={scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        readerOptions={BARCODE_READER_OPTIONS_KIOSK_DEFAULT}
        idleTimeoutMs={30_000}
        onSuccess={handleScanSuccess}
        onAbort={handleScanAbort}
      />
      <KioskDocumentsListPanel
        className={clsx(!listPanelOpen && 'hidden')}
        search={search}
        onSearchChange={setSearch}
        searchAccessory={
          <Button
            type="button"
            variant="ghostOnDark"
            className="shrink-0 px-3 py-2 text-sm"
            aria-label="バーコードをスキャンして検索"
            onClick={() => setScanOpen(true)}
          >
            スキャン
          </Button>
        }
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        documents={documents}
        selectedId={selectedId}
        onSelectId={setSelectedId}
        onRowPointerEnter={schedulePrefetchDocumentId}
        onRowPointerLeave={cancelScheduledPrefetch}
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
        snippetModel={snippetModel}
        detailLoading={detailQuery.isLoading}
        detailError={detailQuery.isError}
        pagePairs={pagePairs}
        resolveImageUrl={resolveKioskDocumentPageImageUrl}
        toolbarRevealEnabled={toolbarRevealEnabled}
      />
    </div>
  );
}
