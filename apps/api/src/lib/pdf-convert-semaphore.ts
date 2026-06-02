import { ApiError } from './errors.js';
import { PART_MEASUREMENT_PDF_CONVERT_QUEUE_MAX } from './part-measurement-drawing-import.constants.js';

/** プロセス内の PDF 変換同時実行数を 1 に制限する */
let active = 0;
const waitQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active === 0) {
    active = 1;
    return;
  }
  if (waitQueue.length >= PART_MEASUREMENT_PDF_CONVERT_QUEUE_MAX) {
    throw new ApiError(503, 'PDF 変換が混み合っています。しばらくしてから再試行してください');
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  active = 1;
}

function release(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
    return;
  }
  active = 0;
}

export async function withPdfConvertSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** テスト用: キューと実行中フラグをリセット */
export function resetPdfConvertSemaphoreForTests(): void {
  active = 0;
  waitQueue.length = 0;
}
