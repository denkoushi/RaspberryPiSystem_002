import { useState } from 'react';

import { ProtectedImage } from '../../../components/common/ProtectedImage';

import './AssemblyProcedureCleanView.css';

import type { AssemblyProcedureOverlayAssetDto } from '../types';
import type { CleanStep } from './cleanViewSteps';
import type { AssemblyProcedureImageOverlayElement } from '@raspi-system/shared-types';
import type { CSSProperties, KeyboardEvent } from 'react';

const PAGE_RATIO = 1240 / 1754;

export function AssemblyProcedureCleanView({ name, pageNumber, pageCount, steps, assets }: {
  name: string;
  pageNumber: number;
  pageCount: number;
  steps: readonly CleanStep[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const expandedIndex = steps.findIndex(step => step.id === expandedId);
  const otherRows = Math.max(1, steps.length - 1);
  const compactHeight = `min(6.15cqw, calc(55cqh / ${otherRows}))`;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (expandedIndex < 0 || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setExpandedId(null);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = Math.max(0, Math.min(steps.length - 1, expandedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
    setExpandedId(steps[index].id);
    event.currentTarget.querySelectorAll('button')[index]?.focus({ preventScroll: true });
  }

  function imageHeightRatio(image: AssemblyProcedureImageOverlayElement) {
    const size = sizes[image.id];
    return size ? size.height / size.width : image.bbox.heightRatio / image.bbox.widthRatio / PAGE_RATIO;
  }

  // Cap intrinsic text minimums to a share of the sheet when a page is especially dense.
  const textWeights = steps.map(({ heading, body }) => (heading.length + body.length) / 24 + body.split('\n').length);
  const totalTextWeight = textWeights.reduce((sum, weight) => sum + weight, 0);
  const rows = steps.map((step, index) => {
    const photoWeight = Math.max(0, ...step.images.map(imageHeightRatio)) * 42 / Math.max(1, step.images.length);
    const weight = Math.max(6, Math.min(31, photoWeight), textWeights[index] * 4);
    if (index === expandedIndex) return 'auto';
    return `minmax(${expandedIndex < 0 ? 'min-content' : compactHeight}, ${weight}fr)`;
  });

  return <div className="assembly-clean-viewport">
    <section className="assembly-clean-paper" aria-label={`${pageNumber}ページ目の清書`} onKeyDown={onKeyDown}>
      <header className="assembly-clean-header">
        <h2>{name}</h2><span>{pageNumber} / {pageCount}</span>
      </header>
      <div className="assembly-clean-table">
        <div className="assembly-clean-rows" style={{
          gridTemplateRows: rows.join(' '),
          '--clean-step-count': steps.length
        } as CSSProperties}>
          {steps.map((step, index) => {
            const expanded = index === expandedIndex;
            const compact = expandedIndex >= 0 && !expanded;
            const photoHeights = expanded ? step.images.map(image => {
              const size = sizes[image.id];
              const availableWidth = `100cqw - var(--clean-number-width) - 2 * var(--clean-expanded-padding) - ${step.images.length - 1} * var(--clean-photo-gap)`;
              const height = `calc((${availableWidth}) * ${imageHeightRatio(image) / step.images.length})`;
              return size ? `min(${height}, ${size.height}px)` : height;
            }) : [];
            return <div key={step.id} className="assembly-clean-step" data-expanded={expanded} data-compact={compact}
              onClick={event => {
                event.currentTarget.querySelector('button')?.focus({ preventScroll: true });
                setExpandedId(expanded ? null : step.id);
              }}>
              <button type="button" aria-label={`手順${index + 1} ${step.heading}`} aria-pressed={expanded}>{index + 1}</button>
              <div className="assembly-clean-content" style={{
                '--clean-text-max': `${85 * textWeights[index] / totalTextWeight}cqh`,
                '--clean-expanded-max': steps.length === 1 ? '100cqh' : `calc(100cqh - ${compactHeight} * ${otherRows})`
              } as CSSProperties}>
                <div className="assembly-clean-text">
                  <h3>{step.heading}</h3>
                  {!compact && step.body ? <p>{step.body}</p> : null}
                </div>
                <div className="assembly-clean-photos" style={expanded && photoHeights.length ? { flexBasis: `max(${photoHeights.join(', ')})` } : undefined}>
                  {step.images.map(image => {
                    const asset = assets?.[image.assetId];
                    const path = image.assetId ? asset?.url ?? asset?.relativeUrl
                      ?? `/api/storage/assembly-procedure-assets/${encodeURIComponent(image.assetId)}` : null;
                    return <div key={image.id}>
                      <ProtectedImage path={path} alt="" draggable={false} onLoad={event => {
                        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                        if (width && height) setSizes(current => current[image.id]?.width === width && current[image.id]?.height === height
                          ? current : { ...current, [image.id]: { width, height } });
                      }} />
                    </div>;
                  })}
                </div>
              </div>
            </div>;
          })}
        </div>
      </div>
    </section>
  </div>;
}
