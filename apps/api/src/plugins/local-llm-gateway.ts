import type { FastifyInstance } from 'fastify';

import { createPinoLocalLlmObservability } from '../services/system/local-llm-observability.js';
import {
  createLocalLlmGateway,
  type LocalLlmRuntimeConfig,
} from '../services/system/local-llm-proxy.service.js';
import { getInferenceRuntime } from '../services/inference/inference-runtime.js';

/** 管理用疎通: 既定プロバイダ（id=default または先頭）。業務推論ルートとは別経路。 */
const getLocalLlmRuntimeConfig = (): LocalLlmRuntimeConfig => getInferenceRuntime().getAdminLocalLlmRuntimeConfig();

export async function registerLocalLlmGateway(app: FastifyInstance): Promise<void> {
  const log = app.log.child({ component: 'localLlmGateway' });
  const observability = createPinoLocalLlmObservability(log);

  const gateway = createLocalLlmGateway({
    getConfig: getLocalLlmRuntimeConfig,
    fetchImpl: (input, init) => fetch(input, init),
    observability,
  });

  app.decorate('localLlmGateway', gateway);
}
