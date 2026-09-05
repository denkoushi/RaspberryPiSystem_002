import { z } from 'zod';

const optionalTrimmed = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
);

const optionalHermesBaseUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().url().optional()
).superRefine((value, ctx) => {
  if (!value) return;
  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BUSINESS_HERMES_BASE_URL must be an origin without a path' });
  }
});

export const businessHermesEnvShape = {
  /** 業務用途専用HermesのOpenAI互換API。Private Pi5/LocalLLM設定とは別管理。 */
  BUSINESS_HERMES_BASE_URL: optionalHermesBaseUrl,
  BUSINESS_HERMES_API_KEY: optionalTrimmed,
  BUSINESS_HERMES_MODEL: optionalTrimmed,
  BUSINESS_HERMES_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
} as const;
