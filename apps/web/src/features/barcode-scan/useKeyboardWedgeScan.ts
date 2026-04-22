import { useEffect, useRef } from 'react';

export type UseKeyboardWedgeScanOptions = {
  /** false のときはリスナを張らない（カメラモーダル表示中・送信中など） */
  active: boolean;
  /** 確定したスキャン文字列（trim 済みを推奨は呼び出し側） */
  onScan: (text: string) => void;
  /** これ未満の長さは無視（誤タイプ抑止） */
  minChars?: number;
  /** これを超える入力間隔なら別スキャンとして扱う（人手タイピングの誤検知抑止） */
  maxInterKeyDelayMs?: number;
  /**
   * 最後のキー入力からこの時間経過でバッファを確定（Enter を送らないスキャナ用）。
   * 実スキャナはキー間隔が極短いことが多い。
   */
  idleFlushMs?: number;
};

const DEFAULT_MIN_CHARS = 4;
const DEFAULT_MAX_INTER_KEY_DELAY_MS = 35;
const DEFAULT_IDLE_MS = 120;

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * USB ハンディスキャナのキーボードウェッジ入力を取り込む。
 * capture フェーズで監視するため、フォーカスがボタン上でもスキャン文字を取りこぼしにくい。
 */
export function useKeyboardWedgeScan({
  active,
  onScan,
  minChars = DEFAULT_MIN_CHARS,
  maxInterKeyDelayMs = DEFAULT_MAX_INTER_KEY_DELAY_MS,
  idleFlushMs = DEFAULT_IDLE_MS,
}: UseKeyboardWedgeScanOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return;
    }

    let buffer = '';
    let idleTimer: ReturnType<typeof window.setTimeout> | undefined;
    let lastCharAt = 0;

    const clearIdle = () => {
      if (idleTimer !== undefined) {
        window.clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };

    const emitIfReady = (raw: string) => {
      const text = raw.replace(/\r/g, '').trim();
      if (text.length >= minChars) {
        onScanRef.current(text);
      }
    };

    const flushBuffer = () => {
      const snapshot = buffer;
      buffer = '';
      lastCharAt = 0;
      clearIdle();
      emitIfReady(snapshot);
    };

    const scheduleIdleFlush = () => {
      clearIdle();
      idleTimer = window.setTimeout(() => {
        idleTimer = undefined;
        flushBuffer();
      }, idleFlushMs);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!active) return;
      if (isTextInputTarget(event.target)) return;

      if (event.key === 'Escape') {
        buffer = '';
        lastCharAt = 0;
        clearIdle();
        return;
      }

      if (event.key === 'Enter') {
        if (buffer.length >= minChars) {
          event.preventDefault();
          event.stopPropagation();
          flushBuffer();
        }
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        if (buffer && now - lastCharAt > maxInterKeyDelayMs) {
          buffer = '';
        }
        buffer += event.key;
        lastCharAt = now;
        scheduleIdleFlush();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearIdle();
      buffer = '';
      lastCharAt = 0;
    };
  }, [active, minChars, maxInterKeyDelayMs, idleFlushMs]);
}
