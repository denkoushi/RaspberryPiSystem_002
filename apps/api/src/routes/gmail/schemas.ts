import { z } from 'zod';

export const gmailOauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).max(4096).optional(),
  state: z.string().trim().min(1).max(512).optional(),
  error: z.string().trim().min(1).max(256).optional(),
}).superRefine((value, ctx) => {
  if (!value.error && !value.code) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Authorization code is required',
      path: ['code'],
    });
  }
});
