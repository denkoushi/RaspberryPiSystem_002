import { performance } from 'node:perf_hooks';

import { logger } from '../../../lib/logger.js';
import type { LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';

const log = logger.child({ component: 'mainLocalLlmRuntimeControlQueue' });

/**
 * DGX 側メインAI相当のランタイム制御（POST /start | /stop および同等の ensure/stop 経路）を
 * Pi5 API プロセス内で直列化し、競合や二重操作を避ける。
 */
export const MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES = {
  business: 0,
  agent: 1,
  private: 2,
  experiment: 3,
  gatewayControl: 4,
} as const;

type MainLocalLlmRuntimeControlPriority =
  (typeof MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES)[keyof typeof MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES];

type QueueJob = {
  label: string;
  priority: MainLocalLlmRuntimeControlPriority;
  queuedAt: number;
  seq: number;
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

let pendingJobs: QueueJob[] = [];
let running = false;
let sequence = 0;

const QUEUE_WAIT_LOG_MS = 50;

function sortPendingJobs(): void {
  pendingJobs.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
}

async function drainMainLocalLlmRuntimeControlQueue(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    while (pendingJobs.length > 0) {
      const job = pendingJobs.shift();
      if (!job) {
        continue;
      }
      const waitMs = Math.round(performance.now() - job.queuedAt);
      if (waitMs >= QUEUE_WAIT_LOG_MS) {
        log.info(
          {
            label: job.label,
            action: 'main_llm_control_queue_wait',
            waitMs,
            priority: job.priority,
            queueDepth: pendingJobs.length + 1,
          },
          '[MainLLMControlQueue] runtime control command waited in queue'
        );
      }
      try {
        job.resolve(await job.fn());
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    running = false;
    if (pendingJobs.length > 0) {
      void drainMainLocalLlmRuntimeControlQueue();
    }
  }
}

export function resolveMainLocalLlmRuntimeControlPriorityForUseCase(
  useCase: LocalLlmRuntimeUseCase
): MainLocalLlmRuntimeControlPriority {
  switch (useCase) {
    case 'photo_label':
    case 'document_summary':
      return MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.business;
    case 'admin_console_chat':
    case 'stackchan_chat':
    case 'agent_container_task':
      return MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.agent;
  }
}

export function enqueueMainLocalLlmRuntimeControl<T>(
  label: string,
  fn: () => Promise<T>,
  priority: MainLocalLlmRuntimeControlPriority = MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.gatewayControl
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingJobs.push({
      label,
      priority,
      queuedAt: performance.now(),
      seq: sequence++,
      fn: async () => fn(),
      resolve: (value) => resolve(value as T),
      reject,
    });
    sortPendingJobs();
    void drainMainLocalLlmRuntimeControlQueue();
  });
}

/** 単体テスト用: グローバルキューを初期化し直す */
export function resetMainLocalLlmRuntimeControlQueueForTests(): void {
  pendingJobs = [];
  running = false;
  sequence = 0;
}
