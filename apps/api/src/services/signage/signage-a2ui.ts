import { A2uiMessageSchema, TextApi, RowApi, ColumnApi, CardApi, ImageApi } from '@a2ui/web_core/v0_9';
import { z } from 'zod';

/**
 * The catalog is intentionally application-owned.  The browser bootstraps this
 * catalog before it accepts a proposal, so a model cannot select an arbitrary
 * renderer or remote catalog.
 */
export const BUSINESS_SIGNAGE_A2UI_CATALOG_ID = 'https://example.local/catalogs/business-signage/v1';

const dataPointSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.number().finite(),
}).strict();

// JSON pointers are data selectors, never expressions or executable code.
export const signageDataPointerSchema = z.string().min(2).max(200)
  .regex(/^\/(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*$/u)
  .refine((value) => !value.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)));

export const signageA2uiSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visualization'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('part_measurement'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('self_inspection'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('work_instruction'), partNumber: z.string().min(1).max(200), shootingTarget: z.string().min(1).max(200) }).strict(),
]);
export const signageA2uiBindingSchema = z.object({
  path: signageDataPointerSchema,
  source: signageA2uiSourceSchema,
  select: signageDataPointerSchema,
  format: z.enum(['text', 'series', 'image']),
  labelField: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(80).optional(),
  valueField: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(80).optional(),
}).strict();
export type SignageA2uiSource = z.infer<typeof signageA2uiSourceSchema>;
export type SignageA2uiBinding = z.infer<typeof signageA2uiBindingSchema>;
const dataPathSchema = signageDataPointerSchema;

const dynamicValueSchema = z.object({ path: dataPathSchema }).strict();
const componentIdSchema = z.string().min(1).max(64);
const componentProperties = {
  Text: TextApi.schema, Row: RowApi.schema, Column: ColumnApi.schema, Card: CardApi.schema, Image: ImageApi.schema,
  BarChart: z.object({ data: dynamicValueSchema, color: z.string().optional() }).strict(),
};
const componentSchema = z.object({
  id: componentIdSchema,
  component: z.enum(['Text', 'Row', 'Column', 'Card', 'Image', 'BarChart']),
}).passthrough().superRefine((value, ctx) => {
  const { id: _id, component, ...properties } = value;
  void _id;
  const parsed = componentProperties[component].safeParse(properties);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: `${component}: ${issue.message}` });
  }
});

const a2uiLayoutMessageSchema = z.object({
  version: z.literal('v0.9'),
  updateComponents: z.object({
    surfaceId: z.literal('signage'),
    components: z.array(componentSchema).min(1).max(24),
  }).strict(),
}).strict();

const a2uiDataMessageSchema = z.object({
  version: z.literal('v0.9'),
  updateDataModel: z.object({
    surfaceId: z.literal('signage'),
    path: z.literal('/'),
    value: z.record(z.unknown()),
  }).strict(),
}).strict();

export const signageA2uiProposalSchema = z.object({
  layoutMessage: z.unknown().superRefine((value, ctx) => {
    const parsed = a2uiLayoutMessageSchema.safeParse(value);
    if (!parsed.success) for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  }),
  dataMessage: z.unknown(),
  bindings: z.array(signageA2uiBindingSchema).max(24).optional(),
}).strict();

export type SignageA2uiProposal = z.infer<typeof signageA2uiProposalSchema>;

export function valueAtPath(value: unknown, pointer: string): unknown {
  return pointer.slice(1).split('/').reduce((current: unknown, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function componentReferences(component: Record<string, unknown>): string[] {
  if (component.component === 'Card') return typeof component.child === 'string' ? [component.child] : [];
  if (component.component === 'Row' || component.component === 'Column') {
    return Array.isArray(component.children)
      ? component.children.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
  return [];
}

function componentDynamicPaths(component: Record<string, unknown>): string[] {
  const values: unknown[] = component.component === 'Text'
    ? [component.text]
    : component.component === 'Image'
      ? [component.url, component.description]
      : component.component === 'BarChart'
        ? [component.data]
        : [];
  return values.flatMap((value) => (
    value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { path?: unknown }).path === 'string'
      ? [(value as { path: string }).path]
      : []
  ));
}

function validateComponentSemantics(
  components: Array<Record<string, unknown>>,
  issues: Array<{ path: (string | number)[]; message: string }>,
): void {
  const ids = new Set(components.map((component) => component.id));
  if (ids.size !== components.length) issues.push({ path: ['layoutMessage', 'updateComponents', 'components'], message: 'component ids must be unique' });
  if (!ids.has('root')) issues.push({ path: ['layoutMessage', 'updateComponents', 'components'], message: 'root component is required' });

  components.forEach((component, index) => {
    if (component.component === 'Text') {
      const text = component.text;
      const validText = typeof text === 'string'
        ? !text.startsWith('/') && !text.includes('![') && text.length <= 500
        : dynamicValueSchema.safeParse(text).success;
      if (!validText) issues.push({ path: ['layoutMessage', 'updateComponents', 'components', index, 'text'], message: 'Text must use a bounded literal or an allowed data path' });
    }
    if (component.component === 'Row' || component.component === 'Column') {
      if (!Array.isArray(component.children) || component.children.length < 1 || component.children.length > 12 || component.children.some((child) => typeof child !== 'string')) {
        issues.push({ path: ['layoutMessage', 'updateComponents', 'components', index, 'children'], message: 'container children must be component ids' });
      }
    }
    if (component.component === 'Card' && typeof component.child !== 'string') {
      issues.push({ path: ['layoutMessage', 'updateComponents', 'components', index, 'child'], message: 'Card child must be a component id' });
    }
    if (component.component === 'Image' && (!dynamicValueSchema.safeParse(component.url).success ||
        !(typeof component.description === 'string' || dynamicValueSchema.safeParse(component.description).success))) {
      issues.push({ path: ['layoutMessage', index], message: 'Image requires a bound URL and description' });
    }
    if (component.component === 'BarChart' && !dynamicValueSchema.safeParse(component.data).success) {
      issues.push({ path: ['layoutMessage', index], message: 'BarChart requires a data path' });
    }
    componentReferences(component).forEach((reference) => {
      if (!ids.has(reference)) issues.push({ path: ['layoutMessage', 'updateComponents', 'components', index], message: `unknown component reference: ${reference}` });
    });
  });

  const referencesById = new Map(components.map((component) => [String(component.id), component]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const circular = componentReferences(referencesById.get(id) ?? {}).some((reference) => visit(reference));
    visiting.delete(id);
    visited.add(id);
    return circular;
  };
  if (visit('root')) issues.push({ path: ['layoutMessage', 'updateComponents', 'components'], message: 'component references must be acyclic' });
}

/**
 * Validates the official v0.9 wire messages and then applies the bounded
 * business catalog/data boundary. The returned object is safe to persist in a
 * consultation confirmation and to hand to the official browser renderer.
 */
export function parseSignageA2uiProposal(value: unknown): SignageA2uiProposal | undefined {
  const parsed = signageA2uiProposalSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const layoutOfficial = A2uiMessageSchema.safeParse(parsed.data.layoutMessage);
  if (!layoutOfficial.success) return undefined;
  const dataOfficial = A2uiMessageSchema.safeParse(parsed.data.dataMessage);
  if (!dataOfficial.success) return undefined;

  const layout = a2uiLayoutMessageSchema.safeParse(parsed.data.layoutMessage);
  const data = a2uiDataMessageSchema.safeParse(parsed.data.dataMessage);
  if (!layout.success || !data.success) return undefined;

  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  validateComponentSemantics(layout.data.updateComponents.components as Array<Record<string, unknown>>, issues);
  const model = data.data.updateDataModel.value;
  const paths = new Set(
    (layout.data.updateComponents.components as Array<Record<string, unknown>>).flatMap(componentDynamicPaths),
  );
  const bindings = parsed.data.bindings ?? [];
  const bindingPaths = bindings.map((binding) => binding.path);
  if (new Set(bindingPaths).size !== bindingPaths.length || bindingPaths.some((path, index) =>
    bindingPaths.some((other, otherIndex) => index !== otherIndex && other.startsWith(`${path}/`)))) return undefined;
  for (const binding of bindings) {
    if (!paths.has(binding.path)) return undefined;
    if (binding.format === 'image' && binding.source.kind !== 'work_instruction') return undefined;
  }
  for (const component of layout.data.updateComponents.components) {
    for (const pointer of componentDynamicPaths(component)) {
      const format = component.component === 'Image' && (component.url as { path?: string })?.path === pointer
        ? 'image' : component.component === 'BarChart' ? 'series' : 'text';
      const binding = bindings.find((entry) => entry.path === pointer);
      if (binding) {
        if (binding.format !== format) return undefined;
        continue; // The application replaces model-supplied values from the authoritative reader.
      }
      const value = valueAtPath(model, pointer);
      const valid = format === 'text' ? typeof value === 'string' && value.length <= 2000
        : format === 'series' ? z.array(dataPointSchema).max(24).safeParse(value).success
        : false; // Photos must come from a published work instruction.
      if (!valid) return undefined;
    }
  }
  return issues.length > 0 ? undefined : parsed.data;
}
