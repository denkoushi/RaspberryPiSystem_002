import './env/load-dotenv.js';

import { z } from 'zod';

import { parseInferenceProvidersJsonQuiet } from '../services/inference/config/inference-providers-json.schema.js';
import { collectLocalLlmProviderAlignmentIssues } from '../services/inference/config/local-llm-env-alignment.js';
import { alertsEnvShape } from './env/alerts.js';
import { coreEnvShape, isWeakSecret, SECRET_MIN_LENGTH } from './env/core.js';
import { dgxResourceEnvShape } from './env/dgx-resource.js';
import { inferenceEnvShape } from './env/inference.js';
import { ingestTuningEnvShape } from './env/ingest-tuning.js';
import { kioskFlagsEnvShape } from './env/kiosk-flags.js';
import { localLlmEnvShape } from './env/local-llm.js';
import { networkEnvShape } from './env/network.js';
import { photoToolEnvShape } from './env/photo-tool.js';
import { signageEnvShape } from './env/signage.js';

const envSchema = z
  .object({
    ...coreEnvShape,
    ...signageEnvShape,
    ...networkEnvShape,
    ...alertsEnvShape,
    ...ingestTuningEnvShape,
    ...kioskFlagsEnvShape,
    ...localLlmEnvShape,
    ...dgxResourceEnvShape,
    ...inferenceEnvShape,
    ...photoToolEnvShape,
  })
  .superRefine((value, ctx) => {
    if (value.LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED) {
      if (value.LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR >= value.LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR'],
          message:
            'LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR must be greater than LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR when warm window is enabled',
        });
      }
    }

    if (value.PHOTO_TOOL_EMBEDDING_ENABLED) {
      if (!value.PHOTO_TOOL_EMBEDDING_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_TOOL_EMBEDDING_URL'],
          message: 'PHOTO_TOOL_EMBEDDING_URL is required when PHOTO_TOOL_EMBEDDING_ENABLED=true',
        });
      }
      if (!value.PHOTO_TOOL_EMBEDDING_MODEL_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PHOTO_TOOL_EMBEDDING_MODEL_ID'],
          message: 'PHOTO_TOOL_EMBEDDING_MODEL_ID is required when PHOTO_TOOL_EMBEDDING_ENABLED=true',
        });
      }
    }

    const parsedProviders = parseInferenceProvidersJsonQuiet(value.INFERENCE_PROVIDERS_JSON);
    if (parsedProviders && parsedProviders.length > 0) {
      for (const issue of collectLocalLlmProviderAlignmentIssues(parsedProviders, {
        LOCAL_LLM_BASE_URL: value.LOCAL_LLM_BASE_URL,
        LOCAL_LLM_SHARED_TOKEN: value.LOCAL_LLM_SHARED_TOKEN,
        LOCAL_LLM_MODEL: value.LOCAL_LLM_MODEL,
        LOCAL_LLM_RUNTIME_MODE: value.LOCAL_LLM_RUNTIME_MODE,
        LOCAL_LLM_RUNTIME_CONTROL_START_URL: value.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
        LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: value.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
        LOCAL_LLM_RUNTIME_CONTROL_TOKEN: value.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
        INFERENCE_ADMIN_PROVIDER_ID: value.INFERENCE_ADMIN_PROVIDER_ID,
        INFERENCE_ADMIN_MODEL: value.INFERENCE_ADMIN_MODEL,
        INFERENCE_PHOTO_LABEL_PROVIDER_ID: value.INFERENCE_PHOTO_LABEL_PROVIDER_ID,
        INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: value.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID,
      })) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path as string[],
          message: issue.message,
        });
      }
    }

    if (value.NODE_ENV !== 'production') {
      return;
    }

    if (isWeakSecret(value.JWT_ACCESS_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: `JWT_ACCESS_SECRET must be a strong secret (min ${SECRET_MIN_LENGTH} chars, no weak patterns) in production`,
      });
    }

    if (isWeakSecret(value.JWT_REFRESH_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: `JWT_REFRESH_SECRET must be a strong secret (min ${SECRET_MIN_LENGTH} chars, no weak patterns) in production`,
      });
    }
  });

export const env = envSchema.parse(process.env);
