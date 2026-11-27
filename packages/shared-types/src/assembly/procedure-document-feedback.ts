import { z } from 'zod';

export const procedureDocumentFeedbackSectionsSchema = z.object({
  questions: z.array(z.string()).max(6),
  missing: z.array(z.string()).max(6),
  unclear: z.array(z.string()).max(6),
  ideas: z.array(z.string()).max(6),
});

export const procedureDocumentFeedbackSchema = procedureDocumentFeedbackSectionsSchema.extend({
  revisionNumber: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export const procedureDocumentFeedbackResponseSchema = z.object({
  feedback: procedureDocumentFeedbackSchema.nullable(),
});

export type ProcedureDocumentFeedback = z.infer<typeof procedureDocumentFeedbackSchema>;
export type ProcedureDocumentFeedbackResponse = z.infer<typeof procedureDocumentFeedbackResponseSchema>;
