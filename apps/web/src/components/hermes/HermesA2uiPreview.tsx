import { A2uiSurface, basicCatalog, createComponentImplementation } from '@a2ui/react/v0_9';
import { Catalog, CommonSchemas, MessageProcessor, type A2uiMessage, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { BusinessHermesSignageProposal } from '../../api/domains/assembly';

const BUSINESS_SIGNAGE_A2UI_CATALOG_ID = 'https://example.local/catalogs/business-signage/v1';

type DataPoint = { label: string; value: number };
type BarChartRenderProps = { props: { data: unknown; color?: string } };

const barChartApi = {
  name: 'BarChart',
  schema: z.object({
    data: CommonSchemas.DynamicValue,
    color: z.string().optional(),
  }),
};

const BarChart = createComponentImplementation(barChartApi, ({ props }: BarChartRenderProps) => {
  const points = Array.isArray(props.data) ? props.data as DataPoint[] : [];
  const min = Math.min(0, ...points.map((point) => point.value));
  const max = Math.max(0, ...points.map((point) => point.value));
  const range = max - min || 1;
  return (
    <div className="hermes-chat-panel__a2ui-chart" data-testid="signage-a2ui-chart" aria-label="サイネージの実データ推移グラフ">
      {points.map((point) => (
        <div className="hermes-chat-panel__a2ui-chart-column" key={point.label}>
          <div className="hermes-chat-panel__a2ui-chart-track">
            <div
              className="hermes-chat-panel__a2ui-chart-bar"
              style={{
                height: `${Math.abs(point.value) / range * 100}%`,
                bottom: `${(Math.min(point.value, 0) - min) / range * 100}%`,
                background: props.color || '#60a5fa',
              }}
            />
          </div>
          <span>{point.label}</span>
          <strong>{point.value}</strong>
        </div>
      ))}
    </div>
  );
});

const businessSignageCatalog = new Catalog(
  BUSINESS_SIGNAGE_A2UI_CATALOG_ID,
  [...Array.from(basicCatalog.components.values()), BarChart],
  Array.from(basicCatalog.functions.values()),
);

const createSurfaceMessage: A2uiMessage = {
  version: 'v0.9',
  createSurface: {
    surfaceId: 'signage',
    catalogId: BUSINESS_SIGNAGE_A2UI_CATALOG_ID,
  },
};

function createProcessor(): MessageProcessor<typeof BarChart> {
  return new MessageProcessor([businessSignageCatalog], () => undefined, { version: 'v0.9' });
}

type A2uiPreviewProps = {
  proposal: NonNullable<BusinessHermesSignageProposal['a2ui']>;
  onReady?: (ready: boolean) => void;
};

/**
 * The conversation preview is driven by the official A2UI v0.9 processor and
 * surface renderer. Layout and data are separate messages: a later data-only
 * update can be processed without asking Hermes to regenerate the component
 * tree.
 */
export function HermesA2uiPreview({ proposal, onReady }: A2uiPreviewProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1920));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const processor = useRef<ReturnType<typeof createProcessor> | null>(null);
  const [failed, setFailed] = useState(false);
  const [surface, setSurface] = useState<SurfaceModel<typeof BarChart> | null>(null);

  useEffect(() => {
    const currentProcessor = createProcessor();
    processor.current = currentProcessor;
    let disposed = false;
    setSurface(null);
    setFailed(false);
    const errors: Array<{ unsubscribe(): void }> = [];
    const subscription = currentProcessor.onSurfaceCreated((createdSurface) => {
      if (!disposed) {
        errors.push(createdSurface.onError.subscribe(() => { setFailed(true); onReady?.(false); }));
        setSurface(createdSurface);
      }
    });
    try {
      currentProcessor.processMessages([createSurfaceMessage, proposal.layoutMessage]);
    } catch {
      if (!disposed) { setFailed(true); onReady?.(false); }
    }
    return () => {
      disposed = true;
      subscription.unsubscribe();
      errors.forEach((error) => error.unsubscribe());
      currentProcessor.processMessages([{ version: 'v0.9', deleteSurface: { surfaceId: 'signage' } }]);
      if (processor.current === currentProcessor) processor.current = null;
    };
  }, [onReady, proposal.layoutMessage]);

  useEffect(() => {
    try {
      processor.current?.processMessages([proposal.dataMessage]);
      onReady?.(true);
    } catch {
      setFailed(true);
      onReady?.(false);
    }
  }, [onReady, proposal.dataMessage, proposal.layoutMessage]);

  return (
    <div ref={viewport} className="hermes-chat-panel__a2ui-viewport">
      {failed ? <p role="alert" data-testid="signage-a2ui-error">プレビューを表示できません。</p> : surface ? (
        <div className="hermes-chat-panel__a2ui-surface" data-testid="signage-a2ui-preview" style={{ transform: `scale(${scale})` }}>
          <A2uiSurface surface={surface} />
        </div>
      ) : <p className="hermes-chat-panel__signage-preview-loading" role="status">プレビューを準備中…</p>}
    </div>
  );
}
