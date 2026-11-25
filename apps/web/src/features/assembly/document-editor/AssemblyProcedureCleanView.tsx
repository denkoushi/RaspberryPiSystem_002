import { useState } from 'react';

import { ProtectedImage } from '../../../components/common/ProtectedImage';

import { usablePhotoTranscript } from './cleanViewSteps';

import './AssemblyProcedureCleanView.css';

import type { AssemblyProcedureOverlayAssetDto } from '../types';
import type { CleanStep } from './cleanViewSteps';
import type { AssemblyProcedureImageOverlayElement, OverlayImageTranscript } from '@raspi-system/shared-types';
import type { CSSProperties, KeyboardEvent } from 'react';

const PAGE_RATIO = 1240 / 1754;

function PhotoTranscript({ transcript, activeChoice }: {
  transcript: OverlayImageTranscript;
  activeChoice?: OverlayImageTranscript['choices'][number];
}) {
  const marks = new Map<number, OverlayImageTranscript['choices']>();
  for (const choice of transcript.choices) {
    const rowMarks = marks.get(choice.row) ?? [];
    rowMarks.push(choice);
    marks.set(choice.row, rowMarks);
  }
  const rowProps = (index: number) => ({
    'data-selected': transcript.sel.includes(index),
    'data-highlighted': activeChoice?.row === index,
    'data-dimmed': activeChoice !== undefined && activeChoice.row !== index,
    style: activeChoice?.row === index ? { outlineColor: activeChoice.color } : undefined
  });
  const rowMarks = (index: number) => marks.get(index)?.map(({ color }, markIndex) =>
    <span key={markIndex} aria-hidden="true" className="assembly-clean-transcript-mark" style={{ backgroundColor: color }} />);

  if (transcript.kind === 'list') {
    return <div className="assembly-clean-transcript">
      {transcript.title ? <div className="assembly-clean-transcript-title">{transcript.title}</div> : null}
      <ul>{transcript.rows.map(([text], index) => <li key={index} {...rowProps(index)}>
        <span>{text}</span>{rowMarks(index)}
      </li>)}</ul>
    </div>;
  }

  const [header, ...rows] = transcript.rows;
  const columns = Math.max(...transcript.rows.map(row => row.length));
  return <div className="assembly-clean-transcript">
    <table>
      <thead><tr {...rowProps(0)}>{Array.from({ length: columns }, (_, index) =>
        <th key={index} scope="col">{header[index]}{index === columns - 1 ? rowMarks(0) : null}</th>
      )}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} {...rowProps(index + 1)}>
        {Array.from({ length: columns }, (_, col) => <td key={col}>{row[col]}{col === columns - 1 ? rowMarks(index + 1) : null}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function AssemblyProcedureCleanView({ name, pageNumber, pageCount, steps, assets }: {
  name: string;
  pageNumber: number;
  pageCount: number;
  steps: readonly CleanStep[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeChoice, setActiveChoice] = useState<{ imageId: string; index: number } | null>(null);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const expandedIndex = steps.findIndex(step => step.id === expandedId);
  const otherRows = Math.max(1, steps.length - 1);
  const compactHeight = `min(6.15cqw, calc(55cqh / ${otherRows}))`;

  function showStep(id: string | null) {
    setExpandedId(id);
    setActiveChoice(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (expandedIndex < 0 || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      showStep(null);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target instanceof Element && event.target.closest('.assembly-clean-transcript-pane')) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(steps.length - 1, expandedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
    showStep(steps[index].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('.assembly-clean-step > button')[index]?.focus({ preventScroll: true });
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
            const transcripts = step.images.map(usablePhotoTranscript);
            const hasTranscript = expanded && transcripts.some(Boolean);
            const hasChoices = !compact && transcripts.some(transcript => transcript?.choices.length);
            const photoHeights = expanded ? step.images.map((image, photoIndex) => {
              if (transcripts[photoIndex]) return null;
              const size = sizes[image.id];
              const availableWidth = `100cqw - var(--clean-number-width) - 2 * var(--clean-expanded-padding) - ${step.images.length - 1} * var(--clean-photo-gap)`;
              const height = `calc((${availableWidth}) * ${imageHeightRatio(image) / step.images.length})`;
              return size ? `min(${height}, ${size.height}px)` : height;
            }) : [];
            return <div key={step.id} className="assembly-clean-step" data-expanded={expanded} data-compact={compact}
              onClick={event => {
                event.currentTarget.querySelector('button')?.focus({ preventScroll: true });
                showStep(expanded ? null : step.id);
              }}>
              <button type="button" aria-label={`手順${index + 1} ${step.heading}`} aria-pressed={expanded}>{index + 1}</button>
              <div className="assembly-clean-content" style={{
                '--clean-text-max': `${85 * textWeights[index] / totalTextWeight}cqh`,
                '--clean-expanded-max': steps.length === 1 ? '100cqh' : `calc(100cqh - ${compactHeight} * ${otherRows})`
              } as CSSProperties}>
                <div className="assembly-clean-text" data-choices={hasChoices}>
                  <h3>{step.heading}</h3>
                  {!compact && step.body ? <p>{step.body}</p> : null}
                  {hasChoices ? <div className="assembly-clean-choices">
                    {step.images.flatMap((image, photoIndex) => transcripts[photoIndex]?.choices.map(({ label, color }, choiceIndex) => {
                      const pressed = expanded && activeChoice?.imageId === image.id && activeChoice.index === choiceIndex;
                      return <button key={`${image.id}:${choiceIndex}`} type="button" aria-pressed={pressed} onClick={event => {
                        event.stopPropagation();
                        setExpandedId(step.id);
                        setActiveChoice(pressed ? null : { imageId: image.id, index: choiceIndex });
                      }}><span aria-hidden="true" style={{ backgroundColor: color }} />{label}</button>;
                    }) ?? [])}
                  </div> : null}
                </div>
                <div className="assembly-clean-photos" style={expanded && !hasTranscript && photoHeights.length ? { flexBasis: `max(${photoHeights.join(', ')})` } : undefined}>
                  {step.images.map((image, photoIndex) => {
                    const transcript = transcripts[photoIndex];
                    if (expanded && transcript) return <div key={image.id} className="assembly-clean-transcript-pane"
                      role="region" aria-label="写真の文字" tabIndex={0} onClick={event => event.stopPropagation()}
                      ref={pane => {
                        const row = pane?.querySelector('[data-highlighted="true"]');
                        if (!pane || !row) return;
                        const visible = pane.getBoundingClientRect();
                        const target = row.getBoundingClientRect();
                        if (target.top < visible.top || target.bottom > visible.bottom) {
                          pane.scrollTop += target.top - visible.top;
                        }
                      }}>
                      <PhotoTranscript transcript={transcript}
                        activeChoice={activeChoice?.imageId === image.id ? transcript.choices[activeChoice.index] : undefined} />
                    </div>;
                    const asset = assets?.[image.assetId];
                    const path = image.assetId ? asset?.url ?? asset?.relativeUrl
                      ?? `/api/storage/assembly-procedure-assets/${encodeURIComponent(image.assetId)}` : null;
                    return <div key={image.id} style={hasTranscript ? { height: photoHeights[photoIndex] ?? undefined, maxHeight: '100%' } : undefined}>
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
