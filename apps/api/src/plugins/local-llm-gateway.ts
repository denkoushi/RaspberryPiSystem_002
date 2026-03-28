import type { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';
import {
  createLocalLlmGateway,
  type LocalLlmRuntimeConfig,
} from '../services/system/local-llm-proxy.service.js';

const getLocalLlmRuntimeConfig = (): LocalLlmRuntimeConfig => ({
  configured: Boolean(env.LOCAL_LLM_BASE_URL && env.LOCAL_LLM_SHARED_TOKEN && env.LOCAL_LLM_MODEL),
  baseUrl: env.LOCAL_LLM_BASE_URL,
  sharedToken: env.LOCAL_LLM_SHARED_TOKEN,
  model: env.LOCAL_LLM_MODEL,
  timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
});

export async function registerLocalLlmGateway(app: FastifyInstance): Promise<void> {
  const gateway = createLocalLlmGateway({
    getConfig: getLocalLlmRuntimeConfig,
    fetchImpl: (input, init) => fetch(input, init),
  });

  app.decorate('localLlmGateway', gateway);
}
