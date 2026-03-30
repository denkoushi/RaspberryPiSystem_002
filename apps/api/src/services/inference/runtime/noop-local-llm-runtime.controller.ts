import type { LocalLlmRuntimeControllerPort, LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';

/** 常駐運用時: 何もしない */
export class NoopLocalLlmRuntimeController implements LocalLlmRuntimeControllerPort {
  getMode(): 'always_on' {
    return 'always_on';
  }

  async ensureReady(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    void useCase;
  }

  async release(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    void useCase;
  }
}
