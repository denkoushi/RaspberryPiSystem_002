import { z } from 'zod';

import { overlayElementSchema, type OverlayElement } from '../overlay/normalized-overlay.js';

// Suggestions refer to existing draft elements, so every element needs an identity.
const identifiedElementSchema: z.ZodType<OverlayElement, z.ZodTypeDef, unknown> = z.unknown().transform((value, ctx) => {
  const result = overlayElementSchema.and(z.object({ id: z.string().min(1).max(120) })).safeParse(value);
  if (!result.success) {
    result.error.issues.forEach((issue) => ctx.addIssue(issue));
    return z.NEVER;
  }
  // The persisted schema trims text. Suggestions must retain the draft's exact
  // text, including intentional indentation/newlines, after validating it.
  return result.data.kind === 'TEXT'
    ? { ...result.data, text: (value as { text: string }).text }
    : result.data;
});
const elementsSchema = z.array(identifiedElementSchema).superRefine((elements, ctx) => {
  if (new Set(elements.map((element) => element.id)).size !== elements.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '要素のidが重複しています' });
  }
});

export const procedureLayoutSuggestionRequestSchema = z.object({
  accessPassword: z.string().max(128).optional(),
  pageIndex: z.number().int().min(0),
  elements: elementsSchema
}).superRefine((request, ctx) => {
  if (request.elements.some((element) => element.pageIndex !== request.pageIndex)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '対象ページ以外の要素があります', path: ['elements'] });
  }
  if (request.elements.filter((element) => element.kind !== 'SHAPE').length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '文章・写真が2個以上必要です', path: ['elements'] });
  }
});

export const procedureLayoutSuggestionResponseSchema = z.object({
  elements: elementsSchema,
  addedElementIds: z.array(z.string().min(1).max(120)),
  changes: z.array(z.string().trim().min(1).max(120)).min(1).max(8)
}).superRefine((response, ctx) => {
  const texts = new Set(response.elements.filter(element => element.kind === 'TEXT').map(element => element.id));
  if (new Set(response.addedElementIds).size !== response.addedElementIds.length || response.addedElementIds.some(id => !texts.has(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '追加した文章のidが不正です', path: ['addedElementIds'] });
  }
});

export type ProcedureLayoutSuggestionRequest = z.infer<typeof procedureLayoutSuggestionRequestSchema>;
export type ProcedureLayoutSuggestionResponse = z.infer<typeof procedureLayoutSuggestionResponseSchema>;
