/**
 * Ubuntu 等の LocalLLM ランタイム（llama-server）を Pi5 から必要時だけ起動・停止する境界。
 * 業務コードは Docker/SSH の詳細を知らない。
 */
export type LocalLlmRuntimeUseCase = 'photo_label' | 'document_summary' | 'admin_console_chat';

export interface LocalLlmRuntimeControllerPort {
  /** 推論前に呼ぶ。参照カウントを増やし、初回のみ起動と ready 待ちを行う。 */
  ensureReady(useCase: LocalLlmRuntimeUseCase): Promise<void>;
  /** 推論後に呼ぶ。参照カウントが 0 になったら停止を試みる。 */
  release(useCase: LocalLlmRuntimeUseCase): Promise<void>;
  /** 運用モード（観測・UI 用） */
  getMode(): 'always_on' | 'on_demand';
}
