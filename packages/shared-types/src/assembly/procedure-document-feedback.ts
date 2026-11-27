import { z } from 'zod';

export const procedureDocumentFeedbackSectionsSchema = z.object({
  questions: z.array(z.string()).max(6),
  missing: z.array(z.string()).max(6),
  unclear: z.array(z.string()).max(6),
  ideas: z.array(z.string()).max(6),
});

export const procedureDocumentFeedbackSectionSchema = z.enum(['questions', 'missing', 'unclear', 'ideas']);
export const procedureDocumentFeedbackVerdictSchema = z.enum(['useful', 'miss']);

export const procedureDocumentFeedbackRatingSchema = z.object({
  section: procedureDocumentFeedbackSectionSchema,
  itemIndex: z.number().int().min(0),
  verdict: procedureDocumentFeedbackVerdictSchema,
});

export const procedureDocumentFeedbackSchema = procedureDocumentFeedbackSectionsSchema.extend({
  id: z.string().min(1),
  ratings: z.array(procedureDocumentFeedbackRatingSchema),
  revisionNumber: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const procedureDocumentFeedbackResponseSchema = z.object({
  feedback: procedureDocumentFeedbackSchema.nullable(),
  nightlyTarget: z.boolean(),
});

export const procedureDocumentFeedbackTargetRequestSchema = z.object({ nightlyTarget: z.boolean() });
export const procedureDocumentFeedbackRatingRequestSchema = z.object({
  feedbackId: z.string().min(1),
  section: procedureDocumentFeedbackSectionSchema,
  itemIndex: z.number().int().min(0),
  verdict: procedureDocumentFeedbackVerdictSchema.nullable(),
});

export type ProcedureDocumentFeedback = z.infer<typeof procedureDocumentFeedbackSchema>;
export type ProcedureDocumentFeedbackResponse = z.infer<typeof procedureDocumentFeedbackResponseSchema>;
export type ProcedureDocumentFeedbackTargetRequest = z.infer<typeof procedureDocumentFeedbackTargetRequestSchema>;
export type ProcedureDocumentFeedbackSection = z.infer<typeof procedureDocumentFeedbackSectionSchema>;
export type ProcedureDocumentFeedbackVerdict = z.infer<typeof procedureDocumentFeedbackVerdictSchema>;
export type ProcedureDocumentFeedbackRatingRequest = z.infer<typeof procedureDocumentFeedbackRatingRequestSchema>;
