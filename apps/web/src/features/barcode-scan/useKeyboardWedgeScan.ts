import { useEffect, useRef, useSyncExternalStore } from 'react';

export type UseKeyboardWedgeScanOptions = {
  /** false のときはリスナを張らない（読み取り待受中以外など） */
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
  /** 他の画面と同時に待受しないための排他的な所有者名。 */
  owner?: string;
};

const DEFAULT_MIN_CHARS = 4;
const DEFAULT_MAX_INTER_KEY_DELAY_MS = 35;
const DEFAULT_IDLE_MS = 120;

let activeOwner: string | null = null;
let ownershipEpoch = 0;
const ownerListeners = new Set<() => void>();

function notifyOwnerListeners() {
  ownerListeners.forEach((listener) => listener());
}

function subscribeToOwner(listener: () => void) {
  ownerListeners.add(listener);
  return () => ownerListeners.delete(listener);
}

function getActiveOwnerSnapshot() {
  return `${ownershipEpoch}:${activeOwner ?? ''}`;
}

/** HIDウェッジ入力の受信権を取得する。現在の所有者の途中入力は破棄される。 */
export function claimKeyboardWedgeScanOwner(owner: string): void {
  if (!owner || activeOwner === owner) return;
  activeOwner = owner;
  ownershipEpoch += 1;
  notifyOwnerListeners();
}

/** HIDウェッジ入力の受信権を解放する。 */
export function releaseKeyboardWedgeScanOwner(owner: string): void {
  if (activeOwner !== owner) return;
  activeOwner = null;
  ownershipEpoch += 1;
  notifyOwnerListeners();
}

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
  owner,
}: UseKeyboardWedgeScanOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const ownerSnapshot = useSyncExternalStore(subscribeToOwner, getActiveOwnerSnapshot, getActiveOwnerSnapshot);

  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return;
    }

    const listenerEpoch = ownershipEpoch;
    const ownsInput = () => (
      (owner ? activeOwner === owner : activeOwner === null) &&
      ownershipEpoch === listenerEpoch
    );
    if (!ownsInput()) return;

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
      if (!ownsInput()) return;
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
      if (!active || !ownsInput()) return;
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
  }, [active, owner, ownerSnapshot, minChars, maxInterKeyDelayMs, idleFlushMs]);
}
