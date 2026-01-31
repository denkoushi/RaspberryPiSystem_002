import { DataSourceFactory } from './data-sources/data-source-factory.js';
import { RendererFactory } from './renderers/renderer-factory.js';
import type { RenderOutput, VisualizationQuery } from './visualization.types.js';
import { logger } from '../../lib/logger.js';

export interface VisualizationDefinition {
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: VisualizationQuery;
  rendererConfig: VisualizationQuery;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const SLOW_THRESHOLD_MS = 1_500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class VisualizationService {
  async renderToBuffer(
    definition: VisualizationDefinition,
    options: { width: number; height: number; title?: string }
  ): Promise<RenderOutput> {
    const dataSource = DataSourceFactory.create(definition.dataSourceType);
    const renderer = RendererFactory.create(definition.rendererType);

    const dataSourceConfig = isPlainObject(definition.dataSourceConfig) ? definition.dataSourceConfig : {};
    const rendererConfig = isPlainObject(definition.rendererConfig) ? definition.rendererConfig : {};

    const dataStart = Date.now();
    const data = await withTimeout(dataSource.fetchData(dataSourceConfig), DEFAULT_TIMEOUT_MS, 'dataSource');
    const dataDuration = Date.now() - dataStart;
    if (dataDuration >= SLOW_THRESHOLD_MS) {
      logger.warn(
        { dataSourceType: definition.dataSourceType, durationMs: dataDuration },
        'Visualization data source is slow'
      );
    }

    const renderStart = Date.now();
    const output = await withTimeout(
      renderer.render(data, {
        width: options.width,
        height: options.height,
        title: options.title,
        ...rendererConfig,
      }),
      DEFAULT_TIMEOUT_MS,
      'renderer'
    );
    const renderDuration = Date.now() - renderStart;
    if (renderDuration >= SLOW_THRESHOLD_MS) {
      logger.warn(
        { rendererType: definition.rendererType, durationMs: renderDuration },
        'Visualization renderer is slow'
      );
    }

    return output;
  }
}
