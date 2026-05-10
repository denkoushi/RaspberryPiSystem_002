import type { LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';

/**
 * LocalLLM on_demand 停止タイミングのスケジュール判定（純関数・I/O なし）。
 * Pi5 のコンテナ時計と upstream のTZズレに備え、明示的な IANA タイムゾーンで解釈する。
 */

export type LocalLlmWarmWindowConfig = {
  enabled: boolean;
  /** IANA 例: Asia/Tokyo */
  timeZone: string;
  /** 窓の開始時（この時を含む。0–23） */
  startHourInclusive: number;
  /** 窓の終了時（この時を含まない。0–23）。07–23 なら 07:00〜22:59 が warm */
  endHourExclusive: number;
};

/**
 * 指定タイムゾーンの「時」（0–23, hour23）を返す。
 */
export function getHourInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  if (!hourPart) {
    throw new Error(`LocalLlmWarmWindow: could not resolve hour for timeZone=${timeZone}`);
  }
  return Number.parseInt(hourPart.value, 10);
}

/**
 * warm 窓内なら true。無効設定・不正窓は false。
 */
export function isWithinLocalLlmWarmWindow(now: Date, config: LocalLlmWarmWindowConfig): boolean {
  if (!config.enabled) {
    return false;
  }
  const { startHourInclusive: start, endHourExclusive: end, timeZone } = config;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23
  ) {
    return false;
  }
  if (start >= end) {
    return false;
  }
  const hour = getHourInTimeZone(now, timeZone);
  return hour >= start && hour < end;
}

/**
 * 業務・Agent 相当の用途は refCount=0 でも /stop しない方針（メインAI・Agent コンテナを維持）。
 * 将来追加される「私用/実験」専用用途はここに含めず、下の warm 窓または停止許可側で扱う。
 */
export const LOCAL_LLM_ALWAYS_KEEP_WARM_USE_CASES: readonly LocalLlmRuntimeUseCase[] = [
  'photo_label',
  'document_summary',
  'admin_console_chat',
  'agent_container_task',
];

export function isAlwaysKeepWarmLocalLlmUseCase(useCase: LocalLlmRuntimeUseCase): boolean {
  return LOCAL_LLM_ALWAYS_KEEP_WARM_USE_CASES.includes(useCase);
}

/**
 * release 時に /stop を抑止するか。
 * - 業務/Agent用途は常に抑止（メインAI維持）
 * - それ以外は warm 窓が有効なときのみ時間帯内で抑止
 */
export function shouldSuppressLocalLlmRuntimeStop(params: {
  useCase: LocalLlmRuntimeUseCase;
  now: Date;
  warmWindow: LocalLlmWarmWindowConfig;
}): boolean {
  if (isAlwaysKeepWarmLocalLlmUseCase(params.useCase)) {
    return true;
  }
  return isWithinLocalLlmWarmWindow(params.now, params.warmWindow);
}
