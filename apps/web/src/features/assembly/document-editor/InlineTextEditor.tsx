import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { overlayTextFontSize } from '../../overlays/OverlayLayer';

import type { AssemblyProcedureCropRect, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type InlineTextElement = Extract<AssemblyProcedureOverlayElement, { kind: 'TEXT' }>;
export type InlineTextFlush = () => InlineTextElement | null;

/** The draft stays local until one explicit finish. The surrounding layer is the cqw container. */
export function InlineTextEditor({ element, crop, onCommit, onFinish, registerFlush, onDraftChange }: {
  element: InlineTextElement;
  crop?: AssemblyProcedureCropRect | null;
  onCommit: (element: InlineTextElement) => void;
  onFinish: () => void;
  onDraftChange?: (element: InlineTextElement | null) => void;
  registerFlush?: (flush: InlineTextFlush | null) => void;
}) {
  const [text, setText] = useState(element.text);
  const draft = useRef(text);
  const done = useRef(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ element, onCommit, onFinish, onDraftChange });
  live.current = { element, onCommit, onFinish, onDraftChange };
  const finish = useCallback((save: boolean): InlineTextElement | null => {
    if (done.current) return null;
    done.current = true;
    const { element: current, onCommit: commit, onFinish: end } = live.current;
    const changed = save && draft.current.trim() && draft.current !== current.text ? { ...current, text: draft.current } : null;
    if (changed) commit(changed);
    live.current.onDraftChange?.(null);
    end();
    return changed;
  }, []);
  useLayoutEffect(() => {
    registerFlush?.(() => finish(true));
    return () => { registerFlush?.(null); };
  }, [registerFlush, finish]);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => { if (!input.current?.contains(event.target as Node)) finish(true); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [finish]);
  const finishFromKeyboard = (save: boolean) => {
    const root = input.current?.parentElement;
    finish(save);
    queueMicrotask(() => {
      const overlay = [...(root?.querySelectorAll<HTMLElement>('[data-overlay-id]') ?? [])].find(node => node.dataset.overlayId === live.current.element.id);
      overlay?.focus({ preventScroll: true });
    });
  };
  const scaleX = crop?.widthRatio ?? 1, scaleY = crop?.heightRatio ?? 1;
  return <textarea ref={input} aria-label="本文をその場で編集" value={text} maxLength={12000}
    className="pointer-events-auto absolute resize-none overflow-hidden border-0 p-0.5 outline outline-2 outline-blue-500"
    style={{ left: `${(element.bbox.xRatio - (crop?.xRatio ?? 0)) / scaleX * 100}%`, top: `${(element.bbox.yRatio - (crop?.yRatio ?? 0)) / scaleY * 100}%`, width: `${element.bbox.widthRatio / scaleX * 100}%`, height: `${element.bbox.heightRatio / scaleY * 100}%`, zIndex: 1_000_002,
      backgroundColor: element.mask?.enabled ? element.mask.color : '#ffffff', color: element.style?.color ?? '#0f172a', fontFamily: element.style?.fontFamily, fontSize: overlayTextFontSize(element.style?.fontSizeRatio, crop), fontWeight: element.style?.fontWeight ?? 'normal', textAlign: element.style?.align === 'center' ? 'center' : element.style?.align === 'end' ? 'right' : 'left' }}
    onChange={event => { draft.current = event.target.value; setText(event.target.value); live.current.onDraftChange?.(event.target.value === element.text ? null : { ...element, text: event.target.value }); }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onBlur={() => finish(true)}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); finishFromKeyboard(false); return; }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); finishFromKeyboard(true);
      }
    }} />;
}
