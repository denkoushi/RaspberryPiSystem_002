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
  BUSINESS_HERMES_PROVIDER: z.enum(['dgx', 'openai']).default('dgx'),
  BUSINESS_HERMES_BASE_URL: optionalHermesBaseUrl,
  BUSINESS_HERMES_API_KEY: optionalTrimmed,
  BUSINESS_HERMES_MODEL: optionalTrimmed,
  // Native consultation Responses may perform multiple read-only tool calls.
  // Keep their bounded investigation deadline separate from the 8s guide.
  BUSINESS_HERMES_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  BUSINESS_HERMES_CHAT_TIMEOUT_MS: z.coerce.number().int().min(500).max(300_000).default(180_000),
  /** Dedicated native Responses/MCP Hermes instance for consultation cases. */
  BUSINESS_HERMES_CHAT_BASE_URL: optionalHermesBaseUrl,
  BUSINESS_HERMES_CHAT_API_KEY: optionalTrimmed,
  BUSINESS_HERMES_CHAT_MODEL: optionalTrimmed,
  /** Internal read-only MCP service token; unset disables the MCP surface. */
  BUSINESS_HERMES_MCP_API_KEY: optionalTrimmed,
} as const;
