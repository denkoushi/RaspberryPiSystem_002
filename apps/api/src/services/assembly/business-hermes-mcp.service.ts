import { Prisma, type PrismaClient } from '@prisma/client';
import { SignageContentType } from '@prisma/client';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { resolveDeviceScopeKey } from '../../lib/location-scope-resolver.js';
import { ScawStFutekigoReadService } from '../scaw-stfutekigo/scaw-stfutekigo-read.service.js';
import { SignageService, type SignageScheduleInput } from '../signage/signage.service.js';
import type { SignageCanvasLayoutConfig, SignageLayoutConfig, SignageLayoutConfigJson } from '../signage/signage-layout.types.js';
import {
  SIGNAGE_CANVAS_DATA_SOURCE_DESCRIPTIONS,
  signageCanvasSpecSchema,
  signageCanvasLayoutSchema,
  toSignageCanvasLayout,
} from '../signage/signage-canvas.js';
import {
  BUSINESS_SIGNAGE_A2UI_CATALOG_ID,
  parseSignageA2uiProposal,
  signageA2uiProposalSchema,
  signageA2uiSourceSchema,
} from '../signage/signage-a2ui.js';
import { SignageA2uiDataService } from '../signage/signage-a2ui-data.service.js';
import { normalizeWorkInstructionPartNumber, normalizeWorkInstructionShootingTarget } from '../work-instructions/domain/normalization.js';
import type { WorkInstructionGroupSummaryView, WorkInstructionGroupView, WorkInstructionStepView } from '../work-instructions/domain/types.js';
import { WorkInstructionReadService } from '../work-instructions/work-instruction-read.service.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';
import {
  businessHermesSourceDefinition,
  businessHermesSourceDefinitionList,
  type BusinessHermesSourceKind
} from './business-hermes-source-adapters.js';

export const BUSINESS_HERMES_MCP_TOOL_NAMES = [
  'business_hermes_describe_sources',
  'business_hermes_read_signage_source',
  'business_hermes_search',
  'business_hermes_get_detail',
  'business_hermes_list_signage_targets',
  'business_hermes_list_signage_schedules',
  'business_hermes_configure_signage_kiosk_progress_overview',
  'business_hermes_configure_signage_custom_dashboard'
] as const;

export type BusinessHermesMcpToolName = (typeof BUSINESS_HERMES_MCP_TOOL_NAMES)[number];

export type BusinessHermesMcpTool = {
  name: BusinessHermesMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type BusinessHermesMcpResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type BusinessHermesSourceCandidate = {
  kind: BusinessHermesSourceKind;
  field: string;
  value: string;
  code?: string;
  source: string;
  matchedTerms: ReadonlyArray<string>;
};

export type BusinessHermesSourceFieldResolution = {
  kind: BusinessHermesSourceKind;
  field: string;
  status: 'resolved' | 'ambiguous';
  truncated?: boolean;
  candidates: ReadonlyArray<BusinessHermesSourceCandidate>;
  selected?: BusinessHermesSourceCandidate;
};

export type BusinessHermesSourceResolution = {
  version: 1;
  request: string;
  terms: ReadonlyArray<string>;
  requestedKinds: ReadonlyArray<BusinessHermesSourceKind>;
  requestedLimit: number;
  unresolvedConditions: ReadonlyArray<string>;
  fields: ReadonlyArray<BusinessHermesSourceFieldResolution>;
  ambiguous: boolean;
};

export type BusinessHermesGroundedSearch = {
  resolution: BusinessHermesSourceResolution;
  conditions: Readonly<Record<string, string | number>> | null;
  result: Record<string, unknown> | null;
  evidence: ReadonlyArray<Record<string, unknown>>;
};

/**
 * Task-only OpenJev seam. The selector may choose only values/results that
 * this service already read from the authorized database. Production callers
 * leave it unset and retain the existing deterministic resolver.
 */
export type BusinessHermesOpenJevSelector = {
  selectSourceCandidates(input: {
    request: string;
    context?: Readonly<Record<string, unknown>>;
    terms: ReadonlyArray<string>;
    candidates: ReadonlyArray<BusinessHermesSourceCandidate>;
    truncatedFields: ReadonlySet<string>;
  }): Promise<ReadonlyArray<BusinessHermesSourceCandidate>>;
  selectGroundedResults(input: {
    request: string;
    context?: Readonly<Record<string, unknown>>;
    conditions: Readonly<Record<string, string | number>>;
    result: Record<string, unknown>;
    evidence: ReadonlyArray<Record<string, unknown>>;
  }): Promise<ReadonlyArray<string>>;
};

type MpcDeps = {
  db?: PrismaClient;
  nonconformities?: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  workInstructions?: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup' | 'searchPublishedGroups'>;
  signage?: Pick<SignageService, 'listSchedulesForManagement' | 'createSchedule' | 'updateSchedule'>;
  a2uiData?: Pick<SignageA2uiDataService, 'resolve' | 'readSource' | 'listSources'>;
  openJevSelector?: BusinessHermesOpenJevSelector;
};

type BusinessHermesSourceCount = {
  total: number | null;
  returned: number;
  returnedScope: 'returned_page';
};

const MAX_LIMIT = 20;
const MAX_QUERY_CHARS = 200;
const ORIGIN_DEPARTMENT_MEANING = '起因部署';
const MAX_SOURCE_CANDIDATE_VALUES = 64;
const MAX_SOURCE_CANDIDATES_PER_FIELD = 6;
const MAX_SOURCE_CANDIDATE_TERMS = 12;
const MAX_GROUNDED_EVIDENCE = 64;
const SOURCE_RESOLUTION_VERSION = 1 as const;
const SOURCE_CONDITION_FIELDS = new Set(['partNumber', 'shootingTarget', 'nonconformityNo', 'originDepartmentName']);
const JAPANESE_PARTICLES = new Set(['の', 'を', 'に', 'へ', 'が', 'は', 'で', 'と', 'や', 'も', 'から', 'まで', 'より', 'だけ', 'など', 'について']);

const signageFields = {
  scheduleName: z.string().trim().min(1).max(200).optional(),
  scheduleId: z.string().uuid().optional(),
  deviceScopeKey: z.string().trim().min(1).max(200).optional(),
  dayOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  startTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  endTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  slideIntervalSeconds: z.number().int().positive().max(3600).optional(),
  seibanPerPage: z.number().int().min(1).max(8).optional(),
  targetClientDeviceIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  enabled: z.boolean().optional()
} as const;

function addUniqueSignageFieldChecks<T extends { dayOfWeek?: number[]; targetClientDeviceIds?: string[] }>(value: T, ctx: z.RefinementCtx): void {
  if (value.dayOfWeek && new Set(value.dayOfWeek).size !== value.dayOfWeek.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfWeek'], message: 'dayOfWeek must not contain duplicates' });
  }
  if (value.targetClientDeviceIds && new Set(value.targetClientDeviceIds).size !== value.targetClientDeviceIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetClientDeviceIds'], message: 'targetClientDeviceIds must not contain duplicates' });
  }
  if ('scheduleName' in value && 'scheduleId' in value && !(value as { scheduleName?: string; scheduleId?: string }).scheduleName
    && !(value as { scheduleName?: string; scheduleId?: string }).scheduleId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduleName'], message: 'scheduleName or scheduleId is required' });
  }
}

const signageProposalSchema = z.object({
  ...signageFields,
  canvas: signageCanvasSpecSchema.optional(),
  a2ui: signageA2uiProposalSchema.optional(),
}).strict().superRefine((value, ctx) => {
  addUniqueSignageFieldChecks(value, ctx);
  if (value.canvas && value.a2ui) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['a2ui'], message: 'canvas and a2ui are alternative screen definitions' });
  }
  if (value.a2ui && !parseSignageA2uiProposal(value.a2ui)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['a2ui'], message: 'A2UI messages are not valid for the business signage catalog' });
  }
});
const signageConfigureSchema = z.object({ ...signageFields, confirm: z.literal(true) }).strict().superRefine(addUniqueSignageFieldChecks);
const signageCustomConfigureSchema = z.object({
  ...signageFields,
  canvas: signageCanvasSpecSchema.optional(),
  a2ui: signageA2uiProposalSchema.optional(),
  confirm: z.literal(true),
}).strict().superRefine((value, ctx) => {
  addUniqueSignageFieldChecks(value, ctx);
  if (!value.canvas && !value.a2ui) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['canvas'], message: 'canvas or a2ui is required' });
  }
  if (value.canvas && value.a2ui) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['a2ui'], message: 'canvas and a2ui are alternative screen definitions' });
  }
  if (value.a2ui && !parseSignageA2uiProposal(value.a2ui)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['a2ui'], message: 'A2UI messages are not valid for the business signage catalog' });
  }
});

export type BusinessHermesSignageProposal = z.infer<typeof signageProposalSchema>;

export type BusinessHermesSignageTargetSummary = {
  id: string;
  name: string;
  deviceScopeKey: string;
};

export type BusinessHermesSignageSchedulePreview = {
  id?: string;
  name: string;
  contentType: SignageContentType;
  pdfId: string | null;
  layoutConfig: SignageLayoutConfigJson;
  targetClientCount: number;
  targetClientDevices: BusinessHermesSignageTargetSummary[];
  targetAllClients: boolean;
  deviceScopeKey: string | null;
  slideIntervalSeconds: number | null;
  seibanPerPage: number | null;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  enabled: boolean;
  rendering: {
    schedulerEnabled: boolean;
    dataRefreshIntervalSeconds: number;
    scheduleTimeZone: string;
    llmCalledOnDataChange: boolean;
  };
};

export type BusinessHermesSignagePreparation = {
  proposal: BusinessHermesSignageProposal;
  schedule: BusinessHermesSignageSchedulePreview;
};

export function parseBusinessHermesSignageProposal(value: unknown): BusinessHermesSignageProposal | undefined {
  const parsed = signageProposalSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type SignageManagementSchedule = Awaited<ReturnType<SignageService['listSchedulesForManagement']>>[number];
type KioskProgressConfig = {
  deviceScopeKey: string;
  slideIntervalSeconds?: number;
  seibanPerPage?: number;
};

type PreparedSignage = {
  existing?: SignageManagementSchedule;
  targetClientKeys?: string[];
  targetClientDevices: BusinessHermesSignageTargetSummary[];
  scheduleInput: SignageScheduleInput;
  proposal: BusinessHermesSignageProposal;
};

const signageCanvasInputSchema = {
  type: 'object',
  properties: {
    width: { type: 'integer', minimum: 640, maximum: 3840, default: 1920 },
    height: { type: 'integer', minimum: 360, maximum: 2160, default: 1080 },
    backgroundColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#020617' },
    elements: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              kind: { const: 'text' },
              x: { type: 'integer', minimum: 0, maximum: 3839 }, y: { type: 'integer', minimum: 0, maximum: 2159 },
              width: { type: 'integer', minimum: 1, maximum: 3840 }, height: { type: 'integer', minimum: 1, maximum: 2160 },
              text: { type: 'string', maxLength: 500 },
              style: {
                type: 'object', additionalProperties: false,
                properties: {
                  fontSize: { type: 'integer', minimum: 12, maximum: 200 },
                  fontWeight: { type: 'string', enum: ['normal', '600', '700'] },
                  color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                  align: { type: 'string', enum: ['start', 'middle', 'end'] },
                  verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
                },
              },
            },
            required: ['id', 'kind', 'x', 'y', 'width', 'height', 'text'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              kind: { const: 'visualization' },
              x: { type: 'integer', minimum: 0, maximum: 3839 }, y: { type: 'integer', minimum: 0, maximum: 2159 },
              width: { type: 'integer', minimum: 1, maximum: 3840 }, height: { type: 'integer', minimum: 1, maximum: 2160 },
              title: { type: 'string', minLength: 1, maxLength: 120 },
              dataSourceType: { type: 'string', enum: ['production_schedule', 'measuring_instruments', 'pallet_visualization_board'] },
              dataSourceConfig: {
                type: 'object', additionalProperties: false,
                properties: {
                  view: { type: 'string', enum: ['table', 'kpi', 'series'] },
                  metric: { type: 'string', enum: ['usage_top', 'return_rate'] },
                  periodDays: { type: 'integer', minimum: 1, maximum: 90 },
                  topN: { type: 'integer', minimum: 1, maximum: 20 },
                  machineCds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 32 }, maxItems: 100 },
                },
              },
              rendererType: { type: 'string', enum: ['kpi_cards', 'table', 'bar_chart', 'progress_list', 'pallet_visualization_board'] },
              rendererConfig: {
                type: 'object', additionalProperties: false,
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  maxRows: { type: 'integer', minimum: 1, maximum: 100 },
                  maxIncompletePartsPerCard: { type: 'integer', minimum: 1, maximum: 20 },
                  showIncompleteParts: { type: 'boolean' },
                  colors: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      good: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                      bad: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                      neutral: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                    },
                  },
                },
              },
            },
            required: ['id', 'kind', 'x', 'y', 'width', 'height', 'dataSourceType', 'dataSourceConfig', 'rendererType', 'rendererConfig'],
            additionalProperties: false,
          },
        ],
      },
    },
  },
        required: ['elements'],
  additionalProperties: false,
} as const;

const TOOLS: ReadonlyArray<BusinessHermesMcpTool> = [
  {
    name: 'business_hermes_read_signage_source',
    description: 'List saved business data sources when source is omitted; otherwise read its current structured values for signage bindings. Never invent IDs or measured values. Work-instruction sources use partNumber and shootingTarget from business_hermes_search. self_inspection id is an existing scheduleRowId; part_measurement id is an existing measurement sheet. Visualization values reuse the enabled saved dashboard. JSON pointers select fields in this result.',
    inputSchema: { type: 'object', properties: { source: { type: 'object', properties: {
      kind: { enum: ['visualization', 'self_inspection', 'part_measurement', 'work_instruction'] }, id: { type: 'string' },
      partNumber: { type: 'string' }, shootingTarget: { type: 'string' },
    }, required: ['kind'], additionalProperties: false } }, additionalProperties: false },
  },
  {
    name: 'business_hermes_describe_sources',
    description: 'Describe the authorized read-only business sources, record units, field/date meanings, real relation keys, and bounded retrieval operations before searching.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'business_hermes_search',
    description: 'Search active latest nonconformities and PUBLIC work-instruction text using the source contract returned by business_hermes_describe_sources. originDepartmentCode/name are explicit 起因部署 filters; they are not responsibility-department or treatment-owner filters. Spaces are literal characters, not AND keywords. Nonconformity search results include condition, remarks, correctiveContent and disposition, with the same fields as get_detail. kind=both returns both source kinds for the supplied conditions. Results never include private paths or case history.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'Literal case-insensitive substring across searchable text fields; spaces are literal characters, not AND keywords. It may be combined with dedicated filters.' },
        partNumber: { type: 'string', maxLength: 200, description: 'Known product number; use this dedicated condition for a product-specific search and follow existing source normalization.' },
        shootingTarget: { type: 'string', maxLength: 200 },
        nonconformityNo: { type: 'string', maxLength: 120 },
        partName: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'Exact recorded part name for a nonconformity search.' },
        machineName: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'Exact recorded machine name for a nonconformity search.' },
        originDepartmentCode: { type: 'string', maxLength: 120, description: 'Exact code for the recorded origin (cause) department; it is not a responsibility-department or treatment-owner filter.' },
        originDepartmentName: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'Literal case-insensitive substring for the recorded origin (cause) department name; it is not a responsibility-department or treatment-owner filter.' },
        originDepartmentNames: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: MAX_QUERY_CHARS }, description: 'Multiple literal origin-department terms; every term must match the recorded origin name.' },
        originDepartmentNameAny: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: MAX_QUERY_CHARS }, description: 'Alternative literal origin-department terms; at least one term must match the recorded origin name. Combine with originDepartmentName for an AND condition.' },
        condition: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'Literal case-insensitive substring limited to the nonconformity content field; it may be combined with dedicated filters.' },
        dateFrom: { type: 'string', maxLength: 10, description: 'Inclusive discoveredOn date lower bound in YYYY-MM-DD format.' },
        dateTo: { type: 'string', maxLength: 10, description: 'Inclusive discoveredOn date upper bound in YYYY-MM-DD format.' },
        exactExclude: { type: 'object', properties: {
          nonconformityNo: { type: 'string', maxLength: 120 },
          partNumber: { type: 'string', maxLength: 200 },
          partName: { type: 'string', maxLength: MAX_QUERY_CHARS },
          machineName: { type: 'string', maxLength: MAX_QUERY_CHARS },
          originDepartmentCode: { type: 'string', maxLength: 120 },
          discoveredOn: { type: 'string', maxLength: 10 }
        }, additionalProperties: false, description: 'Exact nonconformity values to exclude while retaining all other exact conditions.' },
        excludeOriginDepartmentNames: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: MAX_QUERY_CHARS }, description: 'Literal origin-department terms to exclude from the live latest-data search.' },
        kind: { type: 'string', enum: ['nonconformity', 'work_instruction', 'both'] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        nonconformityOffset: { type: 'integer', minimum: 0, maximum: 100_000 },
        workInstructionOffset: { type: 'integer', minimum: 0, maximum: 100_000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'business_hermes_get_detail',
    description: 'Get bounded detail for one active nonconformity or PUBLIC work-instruction record. Nonconformity detail includes condition, remarks, correctiveContent and disposition. Work-instruction detail can include rows, steps and photos.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['nonconformity', 'work_instruction'] },
        id: { type: 'string', minLength: 1, maxLength: 200 },
        partNumber: { type: 'string', maxLength: 200 },
        shootingTarget: { type: 'string', maxLength: 200 }
      },
      required: ['kind'],
      additionalProperties: false
    }
  },
  {
    name: 'business_hermes_list_signage_targets',
    description: 'List existing business signage targets using non-secret ClientDevice identifiers. Results include only IDs, names, and canonical device scope keys; never ask for or return signage API keys.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'business_hermes_list_signage_schedules',
    description: 'List existing business signage schedule IDs, names, content types, safe content/layout summaries, timing, priority, enabled state, target counts, and supported progress-screen settings. IDs are non-secret and target API keys are never returned.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'business_hermes_configure_signage_kiosk_progress_overview',
    description: 'Validate and prepare a proposal for one existing or new business signage schedule. This MCP tool never writes. The business application must show the proposal and require explicit approval from an authenticated ADMIN or MANAGER before applying it. Existing schedules of any content type may change timing, priority, enabled state, and targets while preserving contentType, pdfId, and layoutConfig. Only kiosk_progress_overview schedules may change progress page settings or scope; new schedules create that screen and require explicit target ClientDevice IDs and all schedule fields. On updates, omitted fields preserve their current values. Periodic screen reappearance frequency is not supported. Never request or return signage API keys.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleName: { type: 'string', minLength: 1, maxLength: 200, description: 'Existing schedule name or the new schedule name. Use scheduleId instead when the name is not known.' },
        scheduleId: { type: 'string', format: 'uuid', description: 'Non-secret existing schedule ID from list_signage_schedules. Use scheduleName or scheduleId, not an API key.' },
        confirm: { type: 'boolean', const: true, description: 'Confirms that the user asked for this proposal; it does not apply the change. Application requires the business page ADMIN/MANAGER approval action.' },
        deviceScopeKey: { type: 'string', minLength: 1, maxLength: 200, description: 'Existing canonical ClientDevice.location scope. Required for a new schedule; omitted on update preserves the current scope.' },
        dayOfWeek: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true, description: 'Schedule days, Sunday=0 through Saturday=6. Required for a new schedule; omitted on update preserves them.' },
        startTime: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):[0-5][0-9]$', description: 'Start of the existing signage time window in the signage timezone. Required for a new schedule; omitted on update preserves it.' },
        endTime: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):[0-5][0-9]$', description: 'End of the existing signage time window in the signage timezone. Required for a new schedule; omitted on update preserves it.' },
        priority: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'Schedule priority. Required for a new schedule; omitted on update preserves it.' },
        slideIntervalSeconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'Seconds between pages inside the generated progress screen. This is page rotation, not periodic screen reappearance; omitted on update preserves it.' },
        seibanPerPage: { type: 'integer', minimum: 1, maximum: 8, description: 'Number of production orders per generated page. Omitted on update preserves it.' },
        targetClientDeviceIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 500, uniqueItems: true, description: 'Existing non-secret ClientDevice UUIDs from list_signage_targets. Required for a new schedule; omitted on update preserves current targeting. Do not provide API keys.' },
        enabled: { type: 'boolean', description: 'Whether the schedule is enabled. Required only as an explicit change; omitted on update preserves it.' }
      },
      required: ['confirm'],
      additionalProperties: false
    }
  },
  {
    name: 'business_hermes_configure_signage_custom_dashboard',
    description: `Prepare a proposal for a freely composed business signage screen. For a new screen, return one official A2UI v0.9 layoutMessage/dataMessage pair for catalog ${BUSINESS_SIGNAGE_A2UI_CATALOG_ID}; that definition is saved and used for both the conversation preview and periodically refreshed JPEG delivery. Read business_hermes_read_signage_source first and bind changing values to its actual fields. The legacy canvas field remains available only for existing canvas-based screens and must not be combined with a2ui. Allowed components are Text, Row, Column, Card, Image and BarChart. Compose containers with children IDs and weight; there is no fixed domain layout. Elements use only the listed authorized existing business data sources and renderers; JavaScript, SQL, shell, arbitrary URLs, and signage API keys are not accepted. This MCP tool never writes. The business application must show the concrete screen preview and require authenticated ADMIN or MANAGER approval before applying. New schedules require explicit target ClientDevice IDs, canonical scope, days, time window, and priority. Existing legacy schedules are not converted; create a new schedule for a new screen.`,
    inputSchema: {
      type: 'object',
      properties: {
        scheduleName: { type: 'string', minLength: 1, maxLength: 200, description: 'New schedule name, or the existing custom schedule name.' },
        scheduleId: { type: 'string', format: 'uuid', description: 'Existing custom schedule ID from list_signage_schedules.' },
        confirm: { type: 'boolean', const: true, description: 'Confirms the requested proposal; application still requires the business page approval action.' },
        deviceScopeKey: { type: 'string', minLength: 1, maxLength: 200, description: 'Existing canonical ClientDevice.location scope; required for a new schedule.' },
        dayOfWeek: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true },
        startTime: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):[0-5][0-9]$' },
        endTime: { type: 'string', pattern: '^([0-1][0-9]|2[0-3]):[0-5][0-9]$' },
        priority: { type: 'integer', minimum: 0, maximum: 1000000 },
        targetClientDeviceIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 500, uniqueItems: true },
        enabled: { type: 'boolean' },
        canvas: { ...signageCanvasInputSchema, description: 'Legacy canvas definition for an existing canvas-based screen. Do not combine with a2ui.' },
        a2ui: {
          type: 'object',
          properties: {
            layoutMessage: {
              type: 'object', properties: {
                version: { const: 'v0.9' },
                updateComponents: { type: 'object', properties: {
                  surfaceId: { const: 'signage' },
                  components: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', properties: {
                    id: { type: 'string' }, component: { enum: ['Text', 'Row', 'Column', 'Card', 'Image', 'BarChart'] },
                    text: { description: 'Text string or {path: JSON pointer}; variant h1/h2/h3 controls prominence.' },
                    children: { type: 'array', items: { type: 'string' } }, child: { type: 'string' },
                    url: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
                    description: { description: 'Image description string or {path: JSON pointer}.' },
                    data: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
                    variant: { type: 'string', description: 'Text: h1,h2,h3,h4,h5,caption,body. Image: icon,avatar,smallFeature,mediumFeature,largeFeature,header.' },
                    weight: { type: 'number' },
                    align: { enum: ['start', 'center', 'end', 'stretch'], description: 'Row/Column only.' },
                    justify: { enum: ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'], description: 'Row/Column only.' },
                    fit: { enum: ['contain', 'cover', 'fill', 'none', 'scaleDown'], description: 'Image only.' },
                    color: { type: 'string', description: 'BarChart only. Text has no color/align/verticalAlign/style property.' },
                  }, required: ['id', 'component'], additionalProperties: false } },
                }, required: ['surfaceId', 'components'], additionalProperties: false },
              }, required: ['version', 'updateComponents'], additionalProperties: false,
              description: 'Exact wire shape: {version:"v0.9",updateComponents:{surfaceId:"signage",components:[...]}}. surfaceId belongs inside updateComponents.',
            },
            dataMessage: { type: 'object', properties: {
              version: { const: 'v0.9' },
              updateDataModel: { type: 'object', properties: { surfaceId: { const: 'signage' }, path: { const: '/' }, value: { type: 'object' } }, required: ['surfaceId', 'path', 'value'], additionalProperties: false },
            }, required: ['version', 'updateDataModel'], additionalProperties: false, description: 'Exact wire shape: {version:"v0.9",updateDataModel:{surfaceId:"signage",path:"/",value:{}}}. Static labels only; the application populates bound values.' },
            bindings: { type: 'array', maxItems: 24, items: { type: 'object', properties: { path: { type: 'string' }, source: { type: 'object' }, select: { type: 'string' }, format: { enum: ['text', 'series', 'image'] }, labelField: { type: 'string' }, valueField: { type: 'string' } }, required: ['path', 'source', 'select', 'format'], additionalProperties: false }, description: 'path is the A2UI destination JSON pointer, select is the pointer in read_signage_source result. Text selects one scalar; series selects an array with label/value fields (or labelField/valueField); image selects a published work-instruction imageUrl. Images require a binding. No fixed domain path names are required.' },
          },
          required: ['layoutMessage', 'dataMessage'],
          additionalProperties: false,
          description: 'Verified A2UI preview messages. Use only the application catalog and authorized business data paths.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
  }
];

function text(value: unknown, max = MAX_QUERY_CHARS): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return normalized || null;
}

function nonconformityRawText(row: {
  nonconformityNo: string | null;
  partNumber: string | null;
  partName: string | null;
  machineName: string | null;
  originDepartmentName: string | null;
  discoveredOn: Date | null;
  nonconformityContent: string | null;
  remarks: string | null;
  correctiveContent1: string | null;
  correctiveContent2: string | null;
  dispositionContent: string | null;
}): string {
  const fields: Array<[string, string | null]> = [
    ['不適合番号', row.nonconformityNo], ['品番', row.partNumber], ['品名', row.partName],
    ['機械名', row.machineName], ['起因部署', row.originDepartmentName],
    ['発見日', row.discoveredOn?.toISOString().slice(0, 10) ?? null],
    ['不適合内容', row.nonconformityContent], ['備考', row.remarks],
    ['個別是正内容', [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null],
    ['処置内容', row.dispositionContent]
  ];
  return fields.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value!.trim()}`).join('\n');
}

function safeLimit(value: unknown, maximum = MAX_LIMIT): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 10;
  return Math.max(1, Math.min(maximum, value));
}

function safeOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(100_000, value);
}

function parseDateBound(value: string | null, endOfDay: boolean): Date | null | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function jsonText(value: unknown): BusinessHermesMcpResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorText(error: string, code: string): BusinessHermesMcpResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error, code }) }], isError: true };
}

function kioskProgressConfig(layoutConfig: unknown): KioskProgressConfig | null {
  if (!layoutConfig || typeof layoutConfig !== 'object' || Array.isArray(layoutConfig)) return null;
  const layout = layoutConfig as Partial<SignageLayoutConfig>;
  if (layout.layout !== 'FULL' || !Array.isArray(layout.slots) || layout.slots.length !== 1) return null;
  const slot = layout.slots[0];
  if (!slot || typeof slot !== 'object' || slot.position !== 'FULL' || slot.kind !== 'kiosk_progress_overview') return null;
  if (!slot.config || typeof slot.config !== 'object' || Array.isArray(slot.config)) return null;
  const config = slot.config as Record<string, unknown>;
  if (typeof config.deviceScopeKey !== 'string' || !config.deviceScopeKey.trim()) return null;
  return {
    deviceScopeKey: config.deviceScopeKey.trim(),
    ...(typeof config.slideIntervalSeconds === 'number' ? { slideIntervalSeconds: config.slideIntervalSeconds } : {}),
    ...(typeof config.seibanPerPage === 'number' ? { seibanPerPage: config.seibanPerPage } : {})
  };
}

function isSupportedKioskProgressSchedule(schedule: SignageManagementSchedule): boolean {
  return schedule.contentType === SignageContentType.TOOLS && kioskProgressConfig(schedule.layoutConfig) !== null;
}

function canvasLayoutConfig(value: unknown): SignageCanvasLayoutConfig | null {
  const parsed = signageCanvasLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isSupportedBusinessSignageSchedule(schedule: SignageManagementSchedule): boolean {
  return isSupportedKioskProgressSchedule(schedule) || canvasLayoutConfig(schedule.layoutConfig) !== null ||
    Boolean(schedule.layoutConfig && typeof schedule.layoutConfig === 'object' &&
      parseSignageA2uiProposal((schedule.layoutConfig as { a2ui?: unknown }).a2ui));
}

function safeSignageSlotConfig(kind: string, value: unknown): Record<string, unknown> {
  const config = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {};
  const addString = (key: string) => {
    if (typeof config[key] === 'string') result[key] = config[key];
  };
  const addNumber = (key: string) => {
    if (typeof config[key] === 'number' && Number.isFinite(config[key])) result[key] = config[key];
  };
  switch (kind) {
    case 'pdf':
      addString('pdfId');
      if (config.displayMode === 'SLIDESHOW' || config.displayMode === 'SINGLE') result.displayMode = config.displayMode;
      if (config.slideInterval === null) result.slideInterval = null;
      else addNumber('slideInterval');
      break;
    case 'csv_dashboard':
      addString('csvDashboardId');
      break;
    case 'visualization':
      addString('visualizationDashboardId');
      break;
    case 'kiosk_progress_overview':
      addString('deviceScopeKey');
      addNumber('slideIntervalSeconds');
      addNumber('seibanPerPage');
      break;
    case 'kiosk_leader_order_cards':
      addString('deviceScopeKey');
      if (Array.isArray(config.resourceCds)) result.resourceCds = config.resourceCds.filter((item): item is string => typeof item === 'string');
      addNumber('slideIntervalSeconds');
      addNumber('cardsPerPage');
      break;
    case 'mobile_placement_parts_shelf_grid':
      addNumber('maxItemsPerZone');
      break;
    case 'self_inspection_machine_board':
      if (config.targetMode === 'manual_machine_name' || config.targetMode === 'auto_from_leaderboard_status' || config.targetMode === 'kiosk_active_sessions') result.targetMode = config.targetMode;
      addString('machineName');
      addString('deviceScopeKey');
      if (Array.isArray(config.resourceCds)) result.resourceCds = config.resourceCds.filter((item): item is string => typeof item === 'string');
      addNumber('slideIntervalSeconds');
      addNumber('partsPerPage');
      addNumber('detailTopN');
      addNumber('maxAutoMachines');
      break;
    default:
      break;
  }
  return result;
}

function safeSignageLayoutPreview(value: unknown): SignageLayoutConfigJson {
  const canvas = canvasLayoutConfig(value);
  if (canvas) return canvas;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const layout = value as { layout?: unknown; slots?: unknown; a2ui?: unknown };
  const a2ui = parseSignageA2uiProposal(layout.a2ui);
  if (layout.layout === 'FULL' && a2ui) return { layout: 'FULL', slots: [], a2ui };
  if (layout.layout !== 'FULL' && layout.layout !== 'SPLIT') return null;
  if (!Array.isArray(layout.slots)) return null;
  return {
    layout: layout.layout,
    slots: layout.slots.flatMap((slot) => {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return [];
      const candidate = slot as { position?: unknown; kind?: unknown; config?: unknown };
      if (!['FULL', 'LEFT', 'RIGHT'].includes(String(candidate.position)) || typeof candidate.kind !== 'string') return [];
      return [{
        position: candidate.position as 'FULL' | 'LEFT' | 'RIGHT',
        kind: candidate.kind as SignageLayoutConfig['slots'][number]['kind'],
        config: safeSignageSlotConfig(candidate.kind, candidate.config)
      }];
    })
  } as SignageLayoutConfig;
}

function safeScheduleSummary(
  schedule: Awaited<ReturnType<SignageService['createSchedule']>>,
  targetClientCount: number,
) {
  return {
    id: schedule.id,
    name: schedule.name,
    contentType: schedule.contentType,
    pdfId: schedule.pdfId,
    layoutConfig: schedule.layoutConfig,
    targetClientCount,
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    priority: schedule.priority,
    enabled: schedule.enabled,
    rendering: {
      schedulerEnabled: env.SIGNAGE_RENDER_ENABLED,
      dataRefreshIntervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS,
      scheduleTimeZone: env.SIGNAGE_TIMEZONE,
      llmCalledOnDataChange: false
    }
  };
}

function safeScheduleDraft(
  input: SignageScheduleInput,
  targetClientCount: number,
  targetClientDevices: BusinessHermesSignageTargetSummary[],
  id?: string,
  deviceScopeKeyOverride?: string,
): BusinessHermesSignageSchedulePreview {
  const progress = kioskProgressConfig(input.layoutConfig);
  return {
    ...(id ? { id } : {}),
    name: input.name,
    contentType: input.contentType,
    pdfId: input.pdfId ?? null,
    layoutConfig: input.layoutConfig ?? null,
    targetClientCount,
    targetClientDevices,
    targetAllClients: targetClientCount === 0,
    deviceScopeKey: progress?.deviceScopeKey ?? deviceScopeKeyOverride ?? null,
    slideIntervalSeconds: progress?.slideIntervalSeconds ?? null,
    seibanPerPage: progress?.seibanPerPage ?? null,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    priority: input.priority,
    enabled: input.enabled ?? true,
    rendering: {
      schedulerEnabled: env.SIGNAGE_RENDER_ENABLED,
      dataRefreshIntervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS,
      scheduleTimeZone: env.SIGNAGE_TIMEZONE,
      llmCalledOnDataChange: false
    }
  };
}

function sourceCandidateTerms(value: string): string[] {
  const normalized = value.normalize('NFKC').replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．]/g, ' ');
  const terms = new Set<string>();
  const add = (term: string) => {
    const candidate = term.trim();
    if (Array.from(candidate).length >= 2) terms.add(candidate);
  };
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  let run = '';
  const flush = () => {
    add(run);
    run = '';
  };
  for (const segment of segmenter.segment(normalized)) {
    const token = segment.segment.trim();
    if (!token || !segment.isWordLike || JAPANESE_PARTICLES.has(token)) {
      flush();
      continue;
    }
    add(token);
    run += token;
  }
  flush();
  for (const identifier of normalized.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) ?? []) add(identifier);
  return [...terms].sort((left, right) => right.length - left.length).slice(0, MAX_SOURCE_CANDIDATE_TERMS);
}

function normalizedCandidateValue(value: string): string {
  return value.normalize('NFKC').toUpperCase();
}

function matchedCandidateTerms(value: string, terms: ReadonlyArray<string>): string[] {
  const normalized = normalizedCandidateValue(value);
  return terms.filter((term) => normalized.includes(normalizedCandidateValue(term)));
}

function candidateScore(candidate: BusinessHermesSourceCandidate): number {
  return candidate.matchedTerms.reduce((score, term) => score + Math.max(1, Array.from(term).length) ** 2, 0);
}

function buildSourceResolution(
  request: string,
  terms: ReadonlyArray<string>,
  candidates: ReadonlyArray<BusinessHermesSourceCandidate>,
  truncatedFields: ReadonlySet<string>
): BusinessHermesSourceResolution {
  const groups = new Map<string, BusinessHermesSourceCandidate>();
  for (const candidate of candidates) {
    const key = [candidate.kind, candidate.field, candidate.value, candidate.code ?? '', candidate.source].join('\u0000');
    const current = groups.get(key);
    if (!current) {
      groups.set(key, candidate);
      continue;
    }
    groups.set(key, { ...current, matchedTerms: [...new Set([...current.matchedTerms, ...candidate.matchedTerms])] });
  }
  const byField = new Map<string, BusinessHermesSourceCandidate[]>();
  for (const candidate of groups.values()) {
    const key = `${candidate.kind}\u0000${candidate.field}`;
    const current = byField.get(key) ?? [];
    current.push(candidate);
    byField.set(key, current);
  }
  const fields: BusinessHermesSourceFieldResolution[] = [];
  for (const [key, values] of byField) {
    const [kind, field] = key.split('\u0000') as [BusinessHermesSourceKind, string];
    const sorted = values.sort((left, right) => candidateScore(right) - candidateScore(left) || left.value.localeCompare(right.value, 'ja'));
    const exact = sorted.filter((candidate) => normalizedCandidateValue(request).includes(normalizedCandidateValue(candidate.value)));
    const topCoverage = Math.max(...sorted.map((candidate) => candidate.matchedTerms.length));
    const top = (exact.length === 1
      ? exact
      : sorted.filter((candidate) => candidate.matchedTerms.length === topCoverage)).slice(0, MAX_SOURCE_CANDIDATES_PER_FIELD);
    const truncated = truncatedFields.has(key);
    // A ranked candidate is only a suggestion. Automatic resolution requires
    // the complete authorized value to be present in the request text.
    const status = exact.length === 1 && !truncated ? 'resolved' : 'ambiguous';
    fields.push({
      kind,
      field,
      status,
      ...(truncated ? { truncated: true } : {}),
      candidates: top,
      ...(status === 'resolved' ? { selected: top[0] } : {})
    });
  }
  fields.sort((left, right) => left.kind.localeCompare(right.kind) || left.field.localeCompare(right.field));
  const requestedKinds = businessHermesSourceDefinitionList()
    .filter((definition) => definition.requestHints.some((hint) => request.includes(hint)))
    .map((definition) => definition.kind);
  return {
    version: SOURCE_RESOLUTION_VERSION,
    request,
    terms,
    requestedKinds,
    requestedLimit: requestedResultLimit(request),
    unresolvedConditions: unresolvedConditionNames(request),
    fields,
    ambiguous: fields.some((field) => field.status === 'ambiguous'
      && SOURCE_CONDITION_FIELDS.has(field.field)
      && (requestedKinds.length === 0 || requestedKinds.includes(field.kind)))
  };
}

function requestedResultLimit(request: string): number {
  const match = request.match(/(?:^|[^0-9])([0-9]{1,3})\s*件/u);
  if (!match) return 10;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(MAX_LIMIT, value)) : 10;
}

function unresolvedConditionNames(request: string): string[] {
  // Date operators are intentionally detected, not interpreted. A free-form
  // year can mean discoveredOn, sourceVersionDate, or publication metadata;
  // silently choosing one would drop the user's condition.
  return /(?:\b\d{4}-\d{2}-\d{2}\b|\b\d{4}年|以降|以前|年度)/u.test(request) ? ['date'] : [];
}

function sourceSearchConditions(resolution: BusinessHermesSourceResolution): Readonly<Record<string, string | number>> | null {
  if (resolution.ambiguous || resolution.unresolvedConditions.length > 0) return null;
  const relevant = resolution.fields.filter((field) => SOURCE_CONDITION_FIELDS.has(field.field)
    && (resolution.requestedKinds.length === 0 || resolution.requestedKinds.includes(field.kind)));
  if (relevant.length === 0 || relevant.some((field) => field.status === 'ambiguous' || !field.selected)) return null;
  const selected = relevant.map((field) => field.selected!);
  const kinds = new Set(selected.map((candidate) => candidate.kind));
  const conditions: Record<string, string | number> = {
    kind: kinds.size > 1 ? 'both' : [...kinds][0]!,
    limit: resolution.requestedLimit
  };
  for (const field of relevant) {
    const candidate = field.selected!;
    if (field.field === 'partNumber') {
      conditions.partNumber = normalizeWorkInstructionPartNumber(candidate.value) ?? candidate.value;
    } else if (field.field === 'shootingTarget') {
      conditions.shootingTarget = normalizeWorkInstructionShootingTarget(candidate.value) ?? candidate.value;
    } else if (field.field === 'nonconformityNo') {
      conditions.nonconformityNo = candidate.value;
    } else if (field.field === 'originDepartmentName') {
      conditions.originDepartmentName = candidate.value;
      if (candidate.code) conditions.originDepartmentCode = candidate.code;
    }
  }
  return conditions;
}

function sourceCount(result: Record<string, unknown>, kind: 'nonconformity' | 'workInstruction'): BusinessHermesSourceCount | null {
  const counts = result.sourceCounts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const count = (counts as Record<string, unknown>)[kind];
  if (!count || typeof count !== 'object' || Array.isArray(count)) return null;
  const record = count as Record<string, unknown>;
  const total = record.total === null || (typeof record.total === 'number' && Number.isSafeInteger(record.total))
    ? record.total : null;
  const returned = typeof record.returned === 'number' && Number.isSafeInteger(record.returned) ? record.returned : null;
  if (returned === null) return null;
  return { total, returned, returnedScope: 'returned_page' };
}

function groundedEvidence(
  result: Record<string, unknown> | null,
  conditions: Readonly<Record<string, string | number>> | null
): Record<string, unknown>[] {
  if (!result || !Array.isArray(result.results)) return [];
  const evidence: Record<string, unknown>[] = [];
  const nonconformityCount = sourceCount(result, 'nonconformity');
  const workInstructionCount = sourceCount(result, 'workInstruction');
  const visibleNonconformityCount = result.results.filter((entry) => entry && typeof entry === 'object'
    && !Array.isArray(entry) && (entry as Record<string, unknown>).kind === 'nonconformity').length;
  const visibleWorkInstructionCount = result.results.filter((entry) => entry && typeof entry === 'object'
    && !Array.isArray(entry) && (entry as Record<string, unknown>).kind === 'work_instruction').length;
  const legacyTotal = typeof result.total === 'number' && Number.isSafeInteger(result.total) ? result.total : null;
  const nonconformityTotal = nonconformityCount?.total
    ?? (conditions?.kind === 'nonconformity' ? legacyTotal : null);
  const nonconformityReturned = nonconformityCount?.returned ?? visibleNonconformityCount;
  const workInstructionReturned = workInstructionCount?.returned ?? visibleWorkInstructionCount;
  for (const entry of result.results) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (item.kind === 'nonconformity') {
      evidence.push({
        ...item,
        ...(nonconformityTotal === null ? {} : { sourceResultCount: nonconformityTotal }),
        sourceReturnedCount: nonconformityReturned
      });
      continue;
    }
    if (item.kind !== 'work_instruction' || !Array.isArray(item.rows)) continue;
    const sourceRowCount = item.rows.length;
    for (const row of item.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rowRecord = row as Record<string, unknown>;
      if (!Array.isArray(rowRecord.steps)) continue;
      for (const step of rowRecord.steps) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
        const stepRecord = step as Record<string, unknown>;
        if (typeof stepRecord.id !== 'string') continue;
        evidence.push({
          ...stepRecord,
          kind: 'work_instruction',
          title: '公開作業要領',
          partNumber: item.partNumber,
          shootingTarget: item.shootingTarget,
          sourceGroupCount: workInstructionReturned,
          sourceGroupCountScope: 'returned_page',
          ...(workInstructionCount?.total === null || workInstructionCount?.total === undefined
            ? {} : { sourceGroupTotal: workInstructionCount.total }),
          sourceRowCount
        });
      }
    }
  }
  return evidence.slice(0, MAX_GROUNDED_EVIDENCE);
}

function sameSourceCandidate(left: BusinessHermesSourceCandidate, right: BusinessHermesSourceCandidate): boolean {
  return left.kind === right.kind && left.field === right.field
    && left.value === right.value && left.code === right.code && left.source === right.source;
}

function applyOpenJevCandidateSelection(
  resolution: BusinessHermesSourceResolution,
  selectedCandidates: ReadonlyArray<BusinessHermesSourceCandidate>,
  truncatedFields: ReadonlySet<string>
): BusinessHermesSourceResolution {
  const fields = resolution.fields.map((field) => {
    const key = sourceFieldKey(field.kind, field.field);
    if (field.status === 'resolved' || field.truncated || truncatedFields.has(key)) return field;
    const matches = selectedCandidates.filter((candidate) =>
      candidate.kind === field.kind && candidate.field === field.field
        && field.candidates.some((available) => sameSourceCandidate(available, candidate)));
    if (matches.length !== 1) return field;
    return { ...field, status: 'resolved' as const, selected: matches[0] };
  });
  return {
    ...resolution,
    fields,
    ambiguous: fields.some((field) => field.status === 'ambiguous'
      && SOURCE_CONDITION_FIELDS.has(field.field)
      && (resolution.requestedKinds.length === 0 || resolution.requestedKinds.includes(field.kind)))
  };
}

function filterGroundedResult(result: Record<string, unknown>, selectedKeys: ReadonlyArray<string>): Record<string, unknown> {
  const selected = new Set(selectedKeys);
  if (!Array.isArray(result.results)) return result;
  const results = result.results.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.kind !== 'string' || typeof item.id !== 'string') return false;
    if (selected.has(`${item.kind}:${item.id}`)) return true;
    if (item.kind !== 'work_instruction' || !Array.isArray(item.rows)) return false;
    return (item.rows as unknown[]).some((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const steps = (row as Record<string, unknown>).steps;
      return Array.isArray(steps) && steps.some((step: unknown) => step && typeof step === 'object' && !Array.isArray(step)
        && typeof (step as Record<string, unknown>).id === 'string'
        && selected.has(`work_instruction:${(step as Record<string, unknown>).id}`));
    });
  });
  const sourceCounts = result.sourceCounts && typeof result.sourceCounts === 'object' && !Array.isArray(result.sourceCounts)
    ? Object.fromEntries(Object.entries(result.sourceCounts as Record<string, unknown>).map(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [key, value];
      const record = value as Record<string, unknown>;
      return [key, { ...record, returned: results.filter((entry) =>
        (key === 'nonconformity' && entry.kind === 'nonconformity')
          || (key === 'workInstruction' && entry.kind === 'work_instruction')).length }];
    }))
    : result.sourceCounts;
  return { ...result, results, sourceCounts };
}

function uniqueTextValues(items: ReadonlyArray<Record<string, unknown>>, field: string): string[] {
  return [...new Set(items.flatMap((item) => typeof item[field] === 'string' && item[field].trim() ? [item[field].trim()] : []))];
}

function numericEvidenceValue(items: ReadonlyArray<Record<string, unknown>>, field: string): number | null {
  const value = items.find((item) => typeof item[field] === 'number' && Number.isSafeInteger(item[field]))?.[field];
  return typeof value === 'number' ? value : null;
}

/**
 * The source result is authoritative for bounded facts that must not be
 * restated from model prose. Record cards carry the full source text.
 */
export function groundedAnswerMessage(
  grounding: BusinessHermesGroundedSearch,
  display: { recordCount: number; recordView?: 'summary' | 'detail' }
): string | null {
  if (!grounding.conditions || !grounding.result) return null;
  const kind = grounding.conditions.kind;
  const evidence = [...grounding.evidence];
  const statements: string[] = [];
  const sourceHas = (sourceKind: 'nonconformity' | 'work_instruction') =>
    kind === 'both' || kind === sourceKind;
  if (sourceHas('nonconformity')) {
    const items = evidence.filter((item) => item.kind === 'nonconformity');
    const count = sourceCount(grounding.result, 'nonconformity')?.total
      ?? numericEvidenceValue(items, 'sourceResultCount')
      ?? items.length;
    const returned = sourceCount(grounding.result, 'nonconformity')?.returned
      ?? numericEvidenceValue(items, 'sourceReturnedCount')
      ?? items.length;
    const identifiers = uniqueTextValues(items, 'nonconformityNo');
    const dates = uniqueTextValues(items, 'discoveredOn');
    statements.push(`不適合を${count}件確認しました（返却${returned}件）。${identifiers.length > 0 ? `不適合番号: ${identifiers.join('、')}。` : ''}${dates.length > 0 ? `発見日: ${dates.join('、')}。` : ''}`);
  }
  if (sourceHas('work_instruction')) {
    const items = evidence.filter((item) => item.kind === 'work_instruction');
    const count = sourceCount(grounding.result, 'workInstruction')?.returned
      ?? numericEvidenceValue(items, 'sourceGroupCount')
      ?? new Set(items.map((item) => `${item.partNumber ?? ''}\u0000${item.shootingTarget ?? ''}`)).size;
    const total = sourceCount(grounding.result, 'workInstruction')?.total
      ?? numericEvidenceValue(items, 'sourceGroupTotal');
    const groupRows = new Map<string, number>();
    for (const item of items) {
      const key = `${item.partNumber ?? ''}\u0000${item.shootingTarget ?? ''}`;
      const rows = item.sourceRowCount;
      if (typeof rows === 'number' && Number.isSafeInteger(rows)) groupRows.set(key, Math.max(groupRows.get(key) ?? 0, rows));
    }
    const rowCount = [...groupRows.values()].reduce((sum, rows) => sum + rows, 0);
    const dates = uniqueTextValues(items, 'sourceVersionDate');
    const totalSuffix = total !== null && total !== count ? `（既知の総数${total}グループ）` : '';
    statements.push(`公開作業要領を${count}グループ（返却ページ内）${totalSuffix}${rowCount > 0 ? `、${rowCount}行` : ''}確認しました。${dates.length > 0 ? `元データ更新日: ${dates.join('、')}。` : ''}`);
  }
  if (statements.length === 0) return null;
  const displayStatement = display.recordCount === 0
    ? '記録カードの表示指定はありません。'
    : display.recordView === 'detail'
      ? '選択した記録カードに原文を表示します。'
      : '選択した記録カードは概要表示です。原文は詳細表示で確認できます。';
  return `${statements.join(' ')}${displayStatement}`;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function sourceFieldKey(kind: BusinessHermesSourceKind, field: string): string {
  return `${kind}\u0000${field}`;
}

function publicStep(
  step: WorkInstructionStepView,
  sourceModified: Date,
  source: { system: string; list: string; itemId: number },
  partNumber: string,
  shootingTarget: string,
  publication?: WorkInstructionGroupView['rows'][number]['publication']
) {
  // memoOverride is an effective public edited memo. Do not concatenate it
  // with the immutable import text; an empty override is meaningful.
  const effectiveText = step.memoOverride !== undefined ? step.memoOverride : step.text;
  return {
    id: step.id,
    evidenceKey: `work_instruction:${step.id}`,
    step: step.step,
    effectiveText,
    publicEdited: step.memoOverride !== undefined,
    sourceVersionDate: sourceModified.toISOString(),
    source,
    sourceUrl: `/kiosk/part-measurement/self-inspection?partNumber=${encodeURIComponent(partNumber)}&shootingTarget=${encodeURIComponent(shootingTarget)}`,
    ...(publication ? {
      publication: {
        publishedVersionId: publication.publishedVersionId,
        publishedVersionCreatedAt: publication.publishedVersionCreatedAt.toISOString(),
        publishedRevisionId: publication.publishedRevisionId,
        publishedRevisionCreatedAt: publication.publishedRevisionCreatedAt?.toISOString() ?? null
      },
      publishedVersionId: publication.publishedVersionId,
      publishedVersionCreatedAt: publication.publishedVersionCreatedAt.toISOString(),
      publishedRevisionId: publication.publishedRevisionId,
      publishedRevisionCreatedAt: publication.publishedRevisionCreatedAt?.toISOString() ?? null
    } : {}),
    imageAssetId: step.imageAssetId,
    imageMimeType: step.imageMimeType,
    imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
    rawImageLabel: step.imageAssetId ? '元写真（公開作業要領）' : null,
    overlays: step.overlays ?? []
  };
}

function workInstructionResult(group: WorkInstructionGroupView) {
  return {
    kind: 'work_instruction' as const,
    id: group.rows[0]?.id ?? null,
    partNumber: group.partNumber,
    shootingTarget: group.shootingTarget,
    public: true,
    rows: group.rows.map((row) => ({
      id: row.id,
      source: row.source,
      sourceVersionDate: row.source.modified.toISOString(),
      ...(row.publication ? {
        publication: {
          publishedVersionId: row.publication.publishedVersionId,
          publishedVersionCreatedAt: row.publication.publishedVersionCreatedAt.toISOString(),
          publishedRevisionId: row.publication.publishedRevisionId,
          publishedRevisionCreatedAt: row.publication.publishedRevisionCreatedAt?.toISOString() ?? null
        }
      } : {}),
      steps: row.steps.map((step) => publicStep(step, row.source.modified, row.source, group.partNumber, group.shootingTarget, row.publication))
    }))
  };
}

export class BusinessHermesMcpService {
  private readonly db: PrismaClient;
  private readonly nonconformities: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  private readonly workInstructions: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup' | 'searchPublishedGroups'>;
  private readonly signage: Pick<SignageService, 'listSchedulesForManagement' | 'createSchedule' | 'updateSchedule'>;
  private readonly a2uiData: Pick<SignageA2uiDataService, 'resolve' | 'readSource' | 'listSources'>;
  private readonly openJevSelector?: BusinessHermesOpenJevSelector;

  constructor(deps: MpcDeps = {}) {
    this.db = deps.db ?? prisma;
    this.nonconformities = deps.nonconformities ?? new ScawStFutekigoReadService();
    this.workInstructions = deps.workInstructions ?? getWorkInstructionServices().read;
    this.signage = deps.signage ?? new SignageService();
    this.a2uiData = deps.a2uiData ?? new SignageA2uiDataService(this.db);
    this.openJevSelector = deps.openJevSelector;
  }

  listTools(): ReadonlyArray<BusinessHermesMcpTool> {
    return TOOLS;
  }

  /**
   * Resolve user wording against bounded, authorized source values before the
   * answer limit is applied. The result is server-owned retrieval context for
   * native Hermes, not a model-created alias or a business-data catalogue.
   */
  async resolveAndSearch(request: string, context?: Readonly<Record<string, unknown>>): Promise<BusinessHermesGroundedSearch> {
    const normalizedRequest = text(request, MAX_QUERY_CHARS) ?? '';
    const terms = sourceCandidateTerms(normalizedRequest);
    if (terms.length === 0) {
      const resolution = buildSourceResolution(normalizedRequest, terms, [], new Set());
      return { resolution, conditions: null, result: null, evidence: [] };
    }
    const [nonconformity, workInstruction] = await Promise.all([
      this.readNonconformityCandidates(terms),
      this.readWorkInstructionCandidates(terms)
    ]);
    const candidates = [...nonconformity.candidates, ...workInstruction.candidates];
    const truncatedFields = new Set([...nonconformity.truncatedFields, ...workInstruction.truncatedFields]);
    let resolution = buildSourceResolution(normalizedRequest, terms, candidates, truncatedFields);
    if (this.openJevSelector && candidates.length > 0) {
      const selectedCandidates = await this.openJevSelector.selectSourceCandidates({
        request: normalizedRequest,
        context,
        terms,
        candidates,
        truncatedFields
      });
      resolution = applyOpenJevCandidateSelection(resolution, selectedCandidates, truncatedFields);
    }
    const conditions = sourceSearchConditions(resolution);
    if (!conditions) return { resolution, conditions: null, result: null, evidence: [] };
    const response = await this.call('business_hermes_search', conditions);
    if (response.isError) return { resolution, conditions, result: null, evidence: [] };
    let result: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(response.content[0]?.text ?? 'null');
      result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      result = null;
    }
    return this.finishGroundedSearch(normalizedRequest, resolution, conditions, result, context);
  }

  /** Isolated Chat pilot: execute the existing MCP contract, retaining its factual projection. */
  async resolveAndSearchPlanned(
    request: string,
    conditions: Readonly<Record<string, string | number>>,
    context?: Readonly<Record<string, unknown>>
  ): Promise<BusinessHermesGroundedSearch> {
    const kinds: BusinessHermesSourceKind[] = conditions.kind === 'both'
      ? ['nonconformity', 'work_instruction'] : [conditions.kind as BusinessHermesSourceKind];
    const resolution: BusinessHermesSourceResolution = {
      version: SOURCE_RESOLUTION_VERSION, request, terms: [], requestedKinds: kinds,
      requestedLimit: Number(conditions.limit), unresolvedConditions: [], fields: [], ambiguous: false
    };
    const response = await this.call('business_hermes_search', conditions);
    if (response.isError) throw new Error(response.content[0]?.text ?? 'Planned search failed');
    const parsed: unknown = JSON.parse(response.content[0]?.text ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid search result');
    return this.finishGroundedSearch(request, resolution, conditions, parsed as Record<string, unknown>, context);
  }

  private async finishGroundedSearch(
    request: string,
    resolution: BusinessHermesSourceResolution,
    conditions: Readonly<Record<string, string | number>> | null,
    result: Record<string, unknown> | null,
    context?: Readonly<Record<string, unknown>>
  ): Promise<BusinessHermesGroundedSearch> {
    let evidence = groundedEvidence(result, conditions);
    if (this.openJevSelector && result && conditions && evidence.length > 0) {
      const selectedKeys = await this.openJevSelector.selectGroundedResults({ request, context, conditions, result, evidence });
      result = filterGroundedResult(result, selectedKeys);
      evidence = groundedEvidence(result, conditions);
    }
    return { resolution, conditions, result, evidence };
  }

  private async readNonconformityCandidates(terms: ReadonlyArray<string>): Promise<{
    candidates: BusinessHermesSourceCandidate[];
    truncatedFields: ReadonlySet<string>;
  }> {
    const definition = businessHermesSourceDefinition('nonconformity');
    if (!definition) return { candidates: [], truncatedFields: new Set() };
    const pages = await Promise.all(definition.candidateFields.map(async (field) => {
      const column = Prisma.raw(`"${field.name}"`);
      const codeColumn = field.codeField ? Prisma.raw(`"${field.codeField}"`) : Prisma.raw('NULL');
      const patterns = Prisma.join(terms.map((term) => Prisma.sql`${column} ILIKE ${`%${escapeLikeValue(term)}%`} ESCAPE '\\'`), ' OR ');
      const rows = await this.db.$queryRaw<Array<{ value: string | null; code: string | null }>>(Prisma.sql`
        SELECT DISTINCT ${column} AS "value", ${codeColumn} AS "code"
        FROM "ScawStfutekigoCurrent"
        WHERE "isPresentInLatestSnapshot" = TRUE
          AND ${column} IS NOT NULL
          AND (${patterns})
        LIMIT ${MAX_SOURCE_CANDIDATE_VALUES + 1}
      `);
      return {
        field,
        rows,
        truncated: rows.length > MAX_SOURCE_CANDIDATE_VALUES
      };
    }));
    const candidates = pages.flatMap(({ field, rows }) => rows.slice(0, MAX_SOURCE_CANDIDATE_VALUES).flatMap((row) => {
      const value = row.value?.trim() ?? '';
      if (!value) return [];
      const matchedTerms = matchedCandidateTerms(value, terms);
      if (matchedTerms.length === 0) return [];
      const code = row.code?.trim() ?? '';
      return [{
        kind: 'nonconformity' as const,
        field: field.name,
        value,
        ...(code ? { code } : {}),
        source: field.source,
        matchedTerms
      }];
    }));
    return {
      candidates,
      truncatedFields: new Set(pages.filter((page) => page.truncated).map((page) => sourceFieldKey('nonconformity', page.field.name)))
    };
  }

  private async readWorkInstructionCandidates(terms: ReadonlyArray<string>): Promise<{
    candidates: BusinessHermesSourceCandidate[];
    truncatedFields: ReadonlySet<string>;
  }> {
    const definition = businessHermesSourceDefinition('work_instruction');
    if (!definition) return { candidates: [], truncatedFields: new Set() };
    const pages = await Promise.all(definition.candidateFields.map(async (field) => {
      const column = field.name === 'partNumber' ? Prisma.raw('"partNumber"') : Prisma.raw('"shootingTarget"');
      const patterns = Prisma.join(terms.map((term) => Prisma.sql`${column} ILIKE ${`%${escapeLikeValue(term)}%`} ESCAPE '\\'`), ' OR ');
      const rows = await this.db.$queryRaw<Array<{ value: string | null }>>(Prisma.sql`
        WITH public_groups AS (
          SELECT version."partNumber" AS "partNumber", version."shootingTarget" AS "shootingTarget"
          FROM "WorkInstructionSourcePublication" AS publication
          JOIN "WorkInstructionSourceVersion" AS version
            ON version."id" = publication."publishedVersionId"
          WHERE version."partNumber" IS NOT NULL AND version."shootingTarget" IS NOT NULL
          UNION
          SELECT row."partNumber" AS "partNumber", row."shootingTarget" AS "shootingTarget"
          FROM "WorkInstructionRow" AS row
          LEFT JOIN "WorkInstructionSourcePublication" AS publication ON publication."rowId" = row."id"
          WHERE row."partNumber" IS NOT NULL AND row."shootingTarget" IS NOT NULL AND publication."rowId" IS NULL
        )
        SELECT DISTINCT ${column} AS "value"
        FROM public_groups
        WHERE ${column} IS NOT NULL
          AND (${patterns})
        LIMIT ${MAX_SOURCE_CANDIDATE_VALUES + 1}
      `);
      return { field, rows, truncated: rows.length > MAX_SOURCE_CANDIDATE_VALUES };
    }));
    const candidates = pages.flatMap(({ field, rows }) => rows.slice(0, MAX_SOURCE_CANDIDATE_VALUES).flatMap((row) => {
      const value = row.value?.trim() ?? '';
      if (!value) return [];
      const normalizedValue = field.name === 'partNumber'
        ? normalizeWorkInstructionPartNumber(value) ?? value
        : normalizeWorkInstructionShootingTarget(value) ?? value;
      const matchedTerms = matchedCandidateTerms(normalizedValue, terms);
      return matchedTerms.length > 0 ? [{
        kind: 'work_instruction' as const,
        field: field.name,
        value: normalizedValue,
        source: field.source,
        matchedTerms
      }] : [];
    }));
    return {
      candidates,
      truncatedFields: new Set(pages.filter((page) => page.truncated).map((page) => sourceFieldKey('work_instruction', page.field.name)))
    };
  }

  async call(name: string, rawArgs: unknown): Promise<BusinessHermesMcpResult> {
    if (!BUSINESS_HERMES_MCP_TOOL_NAMES.includes(name as BusinessHermesMcpToolName)) {
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    }
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs as Record<string, unknown> : {};
    if (name === 'business_hermes_read_signage_source') {
      if (!args.source) return jsonText(await this.a2uiData.listSources());
      const source = signageA2uiSourceSchema.safeParse(args.source);
      if (!source.success) return errorText('Invalid signage source', 'BUSINESS_HERMES_SIGNAGE_INVALID_SOURCE');
      try {
        return jsonText(await this.a2uiData.readSource(source.data));
      } catch {
        return errorText('The signage source could not be read. Check that it exists and is available or PUBLIC.', 'BUSINESS_HERMES_SIGNAGE_SOURCE_UNAVAILABLE');
      }
    }
    if (name === 'business_hermes_describe_sources') return jsonText(this.describeSources());
    if (name === 'business_hermes_search') return jsonText(await this.search(args));
    if (name === 'business_hermes_get_detail') return jsonText(await this.detail(args));
    if (name === 'business_hermes_list_signage_targets') return jsonText(await this.listSignageTargets());
    if (name === 'business_hermes_list_signage_schedules') return jsonText(await this.listSignageSchedules());
    if (name === 'business_hermes_configure_signage_custom_dashboard') {
      return this.configureSignage(rawArgs, signageCustomConfigureSchema);
    }
    return this.configureSignage(rawArgs, signageConfigureSchema);
  }

  private async listSignageTargets() {
    const rows = await this.db.clientDevice.findMany({
      select: { id: true, name: true, location: true },
      orderBy: { name: 'asc' }
    });
    return {
      targets: rows.map((row) => ({
        id: row.id,
        name: row.name,
        deviceScopeKey: String(resolveDeviceScopeKey(row))
      })),
      note: 'Only existing ClientDevice identifiers and canonical location scopes are returned. Signage API keys are never exposed.'
    };
  }

  private async listSignageSchedules() {
    const schedules = await this.signage.listSchedulesForManagement();
    return {
      schedules: schedules.map((schedule) => {
        const progress = kioskProgressConfig(schedule.layoutConfig);
        return {
          id: schedule.id,
          name: schedule.name,
          contentType: schedule.contentType,
          content: {
            pdfId: schedule.pdfId,
            layoutConfig: safeSignageLayoutPreview(schedule.layoutConfig)
          },
          supportedByBusinessHermes: isSupportedBusinessSignageSchedule(schedule),
          supportsFreeformCanvas: canvasLayoutConfig(schedule.layoutConfig) !== null,
          deviceScopeKey: progress?.deviceScopeKey ?? null,
          slideIntervalSeconds: progress?.slideIntervalSeconds ?? null,
          seibanPerPage: progress?.seibanPerPage ?? null,
          targetClientCount: schedule.targetClientKeys.length,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          priority: schedule.priority,
          enabled: schedule.enabled
        };
      })
    };
  }

  private async configureSignage(
    rawArgs: unknown,
    schema: typeof signageConfigureSchema | typeof signageCustomConfigureSchema,
  ): Promise<BusinessHermesMcpResult> {
    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      return errorText(`Invalid signage configuration request: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}. A2UI layoutMessage requires {version:"v0.9",updateComponents:{surfaceId:"signage",components:[...]}}; dataMessage requires {version:"v0.9",updateDataModel:{surfaceId:"signage",path:"/",value:{}}}. Read each binding source with business_hermes_read_signage_source and use its exact result paths.`, 'BUSINESS_HERMES_SIGNAGE_INVALID_REQUEST');
    }
    const proposal: BusinessHermesSignageProposal = { ...parsed.data };
    Reflect.deleteProperty(proposal, 'confirm');
    const prepared = await this.prepareSignage(proposal);
    if ('content' in prepared) return prepared;
    return jsonText({
      action: 'proposed',
      operation: prepared.existing ? 'update' : 'create',
      approvalRequired: true,
      // The application hydrates the preview. Do not send image bytes back through inference.
      proposal: proposal.a2ui ? { ...prepared.proposal, a2ui: proposal.a2ui } : prepared.proposal,
      schedule: safeScheduleDraft(
        prepared.scheduleInput,
        prepared.targetClientKeys?.length ?? 0,
        prepared.targetClientDevices,
        prepared.existing?.id,
        prepared.proposal.deviceScopeKey,
      ),
      note: 'No schedule was changed. An authenticated business application ADMIN or MANAGER approval is required to apply this proposal.'
    });
  }

  async applySignageProposal(rawArgs: unknown): Promise<BusinessHermesMcpResult> {
    const parsed = signageProposalSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return errorText('Invalid signage proposal', 'BUSINESS_HERMES_SIGNAGE_INVALID_PROPOSAL');
    }
    const prepared = await this.prepareSignage(parsed.data, true);
    if ('content' in prepared) return prepared;
    const scheduleInput = prepared.scheduleInput;
    const schedule = prepared.existing
      ? await this.signage.updateSchedule(prepared.existing.id, scheduleInput)
      : await this.signage.createSchedule(scheduleInput);
    return jsonText({
      action: prepared.existing ? 'updated' : 'created',
      schedule: safeScheduleSummary(schedule, prepared.targetClientKeys?.length ?? 0)
    });
  }

  async prepareSignageProposal(rawArgs: unknown): Promise<BusinessHermesSignagePreparation | BusinessHermesMcpResult> {
    const parsed = signageProposalSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return errorText('Invalid signage proposal', 'BUSINESS_HERMES_SIGNAGE_INVALID_PROPOSAL');
    }
    const prepared = await this.prepareSignage(parsed.data);
    if ('content' in prepared) return prepared;
    return {
      proposal: prepared.proposal,
      schedule: safeScheduleDraft(
        prepared.scheduleInput,
        prepared.targetClientKeys?.length ?? 0,
        prepared.targetClientDevices,
        prepared.existing?.id,
        prepared.proposal.deviceScopeKey,
      )
    };
  }

  private async prepareSignage(
    proposal: BusinessHermesSignageProposal,
    resolveSecrets = false,
  ): Promise<PreparedSignage | BusinessHermesMcpResult> {
    const input = proposal;
    const schedules = await this.signage.listSchedulesForManagement();
    const matches = input.scheduleId
      ? schedules.filter((schedule) => schedule.id === input.scheduleId)
      : input.scheduleName
        ? schedules.filter((schedule) => schedule.name === input.scheduleName)
        : [];
    if (matches.length > 1) {
      return errorText('The signage schedule name is ambiguous; use a unique name', 'BUSINESS_HERMES_SIGNAGE_SCHEDULE_NAME_AMBIGUOUS');
    }

    const existing = matches[0];
    if (input.scheduleId && input.scheduleName && existing && existing.name !== input.scheduleName) {
      return errorText('The signage schedule name and ID refer to different schedules', 'BUSINESS_HERMES_SIGNAGE_SCHEDULE_IDENTIFIER_CONFLICT');
    }
    if (!existing && input.scheduleId) {
      return errorText('The signage schedule was not found', 'BUSINESS_HERMES_SIGNAGE_SCHEDULE_NOT_FOUND');
    }
    if (!existing && !input.scheduleName) {
      return errorText('A scheduleName is required when creating a signage schedule', 'BUSINESS_HERMES_SCHEDULE_NAME_REQUIRED');
    }
    const existingConfig = existing ? kioskProgressConfig(existing.layoutConfig) : null;
    const existingCanvas = existing ? canvasLayoutConfig(existing.layoutConfig) : null;
    if (existing && input.canvas !== undefined && !existingCanvas) {
      return errorText('Existing legacy schedules are not converted to a custom screen; create a new schedule', 'BUSINESS_HERMES_SIGNAGE_CONTENT_CHANGE_UNSUPPORTED');
    }
    if (existing && !isSupportedKioskProgressSchedule(existing)
      && (input.deviceScopeKey !== undefined || input.slideIntervalSeconds !== undefined || input.seibanPerPage !== undefined)) {
      return errorText('Existing non-progress schedules support timing, priority, enabled state, and targets only; their content is preserved', 'BUSINESS_HERMES_SIGNAGE_CONTENT_CHANGE_UNSUPPORTED');
    }

    if (!existing && (
      input.deviceScopeKey === undefined
      || input.dayOfWeek === undefined
      || input.startTime === undefined
      || input.endTime === undefined
      || input.priority === undefined
      || input.targetClientDeviceIds === undefined
    )) {
      return errorText('New signage schedules require an explicit target, scope, time window, days, and priority', 'BUSINESS_HERMES_CREATE_REQUIRES_EXPLICIT_FIELDS');
    }

    const deviceScopeKey = input.deviceScopeKey ?? existingConfig?.deviceScopeKey;
    if (!existing || input.deviceScopeKey !== undefined || existingConfig) {
      if (!deviceScopeKey) {
        return errorText('deviceScopeKey is required', 'BUSINESS_HERMES_DEVICE_SCOPE_REQUIRED');
      }
      const scopeRows = await this.db.clientDevice.findMany({
        select: { id: true, name: true, location: true }
      });
      const registeredScope = scopeRows.find((row) => String(resolveDeviceScopeKey(row)) === deviceScopeKey);
      if (!registeredScope) {
        return errorText('Unknown deviceScopeKey', 'BUSINESS_HERMES_UNKNOWN_DEVICE_SCOPE_KEY');
      }
    }

    let targetClientKeys = existing?.targetClientKeys;
    let targetClientDevices: BusinessHermesSignageTargetSummary[] = [];
    if (input.targetClientDeviceIds !== undefined) {
      const targetRows = resolveSecrets
        ? await this.db.clientDevice.findMany({
          where: { id: { in: input.targetClientDeviceIds } },
          select: { id: true, name: true, location: true, apiKey: true }
        })
        : await this.db.clientDevice.findMany({
          where: { id: { in: input.targetClientDeviceIds } },
          select: { id: true, name: true, location: true }
        });
      if (targetRows.length !== input.targetClientDeviceIds.length) {
        return errorText('One or more target ClientDevices are unknown', 'BUSINESS_HERMES_UNKNOWN_TARGET_CLIENT_DEVICE');
      }
      if (resolveSecrets) {
        const keysById = new Map<string, string>();
        for (const row of targetRows) {
          keysById.set(row.id, 'apiKey' in row && typeof row.apiKey === 'string' ? row.apiKey : '');
        }
        targetClientKeys = input.targetClientDeviceIds.map((id) => keysById.get(id)!).filter(Boolean);
        if (targetClientKeys.length !== input.targetClientDeviceIds.length) {
          return errorText('One or more target ClientDevices are not configured for signage', 'BUSINESS_HERMES_TARGET_CLIENT_DEVICE_NOT_CONFIGURED');
        }
      } else {
        targetClientKeys = input.targetClientDeviceIds.map(() => 'proposal-target');
      }
      const targetsById = new Map(targetRows.map((row) => [row.id, row]));
      targetClientDevices = input.targetClientDeviceIds.map((id) => {
        const row = targetsById.get(id)!;
        return {
          id: row.id,
          name: row.name,
          deviceScopeKey: String(resolveDeviceScopeKey(row))
        };
      });
    } else if (existing && existing.targetClientKeys.length > 0) {
      const targetRows = await this.db.clientDevice.findMany({
        where: { apiKey: { in: existing.targetClientKeys } },
        select: { id: true, name: true, location: true }
      });
      targetClientDevices = targetRows.map((row) => ({
        id: row.id,
        name: row.name,
        deviceScopeKey: String(resolveDeviceScopeKey(row))
      }));
    }
    if (!existing && (!targetClientKeys || targetClientKeys.length === 0)) {
      return errorText('New signage schedules require at least one explicit target ClientDevice', 'BUSINESS_HERMES_CREATE_REQUIRES_EXPLICIT_TARGETS');
    }

    let resolvedA2ui;
    try {
      resolvedA2ui = input.a2ui ? await this.a2uiData.resolve(input.a2ui) : undefined;
    } catch (error) {
      return errorText(error instanceof ApiError && error.code === 'SIGNAGE_BINDING_MISSING'
        ? error.message
        : 'The signage data could not be resolved. Read each source with business_hermes_read_signage_source and check its exact paths and value types.',
      'BUSINESS_HERMES_SIGNAGE_SOURCE_UNAVAILABLE');
    }
    const layoutConfig: SignageLayoutConfigJson = resolvedA2ui
      ? { layout: 'FULL', slots: [], a2ui: input.a2ui }
      : input.canvas !== undefined
      ? toSignageCanvasLayout(input.canvas)
      : existing
      ? existingConfig && (input.deviceScopeKey !== undefined || input.slideIntervalSeconds !== undefined || input.seibanPerPage !== undefined)
        ? {
          layout: 'FULL',
          slots: [{
            position: 'FULL',
            kind: 'kiosk_progress_overview',
            config: {
              deviceScopeKey: deviceScopeKey!.trim(),
              ...(input.slideIntervalSeconds !== undefined
                ? { slideIntervalSeconds: input.slideIntervalSeconds }
                : existingConfig.slideIntervalSeconds !== undefined
                  ? { slideIntervalSeconds: existingConfig.slideIntervalSeconds }
                  : {}),
              ...(input.seibanPerPage !== undefined
                ? { seibanPerPage: input.seibanPerPage }
                : existingConfig.seibanPerPage !== undefined
                  ? { seibanPerPage: existingConfig.seibanPerPage }
                  : {})
            }
          }]
        }
        : existing.layoutConfig as SignageLayoutConfigJson
      : {
        layout: 'FULL',
        slots: [{
          position: 'FULL',
          kind: 'kiosk_progress_overview',
          config: {
            deviceScopeKey: deviceScopeKey!.trim(),
            ...(input.slideIntervalSeconds !== undefined ? { slideIntervalSeconds: input.slideIntervalSeconds } : {}),
            ...(input.seibanPerPage !== undefined ? { seibanPerPage: input.seibanPerPage } : {})
          }
        }]
      };
    const scheduleInput: SignageScheduleInput = {
      name: existing?.name ?? input.scheduleName!,
      contentType: input.a2ui ? SignageContentType.TOOLS : existing?.contentType ?? SignageContentType.TOOLS,
      pdfId: input.a2ui ? null : existing?.pdfId ?? null,
      layoutConfig,
      targetClientKeys,
      dayOfWeek: input.dayOfWeek ?? existing!.dayOfWeek,
      startTime: input.startTime ?? existing!.startTime,
      endTime: input.endTime ?? existing!.endTime,
      priority: input.priority ?? existing!.priority,
      enabled: input.enabled ?? existing?.enabled ?? true
    };
    const canonicalInput = resolvedA2ui ? { ...input, a2ui: resolvedA2ui } : input;
    const canonicalProposal = existing && !input.scheduleId
      ? { ...canonicalInput, scheduleId: existing.id }
      : canonicalInput;
    return { existing, targetClientKeys, targetClientDevices, scheduleInput, proposal: canonicalProposal };
  }

  /** Internal catalogue preparation reuses the authorized reader in larger pages.
   * This is not an MCP tool; interactive calls retain their 20-result bound.
   */
  async readSourcePage(kind: string, offset: number): Promise<BusinessHermesMcpResult> {
    if (!['nonconformity', 'work_instruction'].includes(kind)
        || !Number.isSafeInteger(offset) || offset < 0 || offset >= 100_000) {
      throw new Error('Invalid source export cursor');
    }
    return jsonText(await this.search({ kind, limit: 200,
      nonconformityOffset: offset, workInstructionOffset: offset }, 200));
  }

  private describeSources() {
    return {
      sources: businessHermesSourceDefinitionList().map((definition) => ({
        ...definition,
        fields: definition.fields.map((field) => field.name),
        fieldDefinitions: definition.fields,
        fieldMeanings: Object.fromEntries(definition.fields.map((field) => [field.name, field.meaning])),
        rules: definition.constraints,
        ...(definition.kind === 'nonconformity' ? {
          responsibilityDepartment: '正式な責任部署項目はこのデータソースに提供されていません。'
        } : {})
      })),
      limits: { maxResults: MAX_LIMIT, maxQueryChars: MAX_QUERY_CHARS },
      signageDataSources: SIGNAGE_CANVAS_DATA_SOURCE_DESCRIPTIONS,
      searchSemantics: 'query and condition use literal case-insensitive substring matching; spaces are literal characters, not AND keywords. Start with one concise term, then refine with identifiers, dates, or a narrower term.',
      authorization: 'Existing API read visibility and publication/active-asset rules remain authoritative.',
      derivedSearch: 'The existing GPTCache/FastEmbed/FAISS/SQLite FTS path may suggest a source question in background preparation. It does not replace live MCP search, source authorization, or answer-time source verification.'
    };
  }

  private async search(args: Record<string, unknown>, maximum = MAX_LIMIT) {
    const query = text(args.query);
    const partNumber = normalizeWorkInstructionPartNumber(text(args.partNumber, 200));
    const shootingTarget = normalizeWorkInstructionShootingTarget(text(args.shootingTarget, 200));
    const nonconformityNo = text(args.nonconformityNo, 120);
    const partName = text(args.partName);
    const machineName = text(args.machineName);
    const originDepartmentCode = text(args.originDepartmentCode, 120);
    const originDepartmentName = text(args.originDepartmentName);
    const originDepartmentNames = Array.isArray(args.originDepartmentNames)
      ? [...new Set(args.originDepartmentNames.map((value) => text(value)).filter((value): value is string => Boolean(value)))].slice(0, 12)
      : [];
    const originDepartmentNameAny = Array.isArray(args.originDepartmentNameAny)
      ? [...new Set(args.originDepartmentNameAny.map((value) => text(value)).filter((value): value is string => Boolean(value)))].slice(0, 12)
      : [];
    const excludeOriginDepartmentNames = Array.isArray(args.excludeOriginDepartmentNames)
      ? [...new Set(args.excludeOriginDepartmentNames.map((value) => text(value)).filter((value): value is string => Boolean(value)))].slice(0, 12)
      : [];
    const exactExclude = args.exactExclude && typeof args.exactExclude === 'object' && !Array.isArray(args.exactExclude)
      ? args.exactExclude as Record<string, unknown>
      : {};
    const exactExcludeFields = ['nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode', 'discoveredOn'] as const;
    const unsupportedExactExcludeField = Object.keys(exactExclude).find((field) => !exactExcludeFields.includes(field as (typeof exactExcludeFields)[number]));
    if (unsupportedExactExcludeField) return { error: `exactExclude.${unsupportedExactExcludeField} is not supported` };
    const exactExclusionWhere: Array<Record<string, unknown>> = [];
    for (const field of exactExcludeFields) {
      const raw = exactExclude[field];
      const values = (Array.isArray(raw) ? raw : [raw])
        .map((value) => text(value, field === 'nonconformityNo' || field === 'originDepartmentCode' ? 120 : field === 'discoveredOn' ? 10 : 200))
        .filter((value): value is string => Boolean(value));
      if (!values.length) continue;
      if (field === 'discoveredOn') {
        const ranges = values.map((value) => {
          const from = parseDateBound(value, false);
          const to = parseDateBound(value, true);
          return from && to ? { discoveredOn: { gte: from, lte: to } } : null;
        });
        if (ranges.some((range) => range === null)) return { error: 'exactExclude.discoveredOn must contain valid YYYY-MM-DD dates' };
        exactExclusionWhere.push({ OR: ranges });
      } else {
        exactExclusionWhere.push({ [field]: { in: values } });
      }
    }
    exactExclusionWhere.push(...excludeOriginDepartmentNames.map((term) => ({ originDepartmentName: { contains: term, mode: 'insensitive' } })));
    const condition = text(args.condition);
    const dateFrom = text(args.dateFrom, 10);
    const dateTo = text(args.dateTo, 10);
    const dateFromBound = parseDateBound(dateFrom, false);
    const dateToBound = parseDateBound(dateTo, true);
    if (dateFrom !== null && dateFromBound === null) return { error: 'dateFrom must be a valid YYYY-MM-DD date' };
    if (dateTo !== null && dateToBound === null) return { error: 'dateTo must be a valid YYYY-MM-DD date' };
    if (dateFromBound && dateToBound && dateFromBound > dateToBound) return { error: 'dateFrom must be on or before dateTo' };
    const kind = args.kind === 'nonconformity' || args.kind === 'work_instruction' ? args.kind : 'both';
    const limit = safeLimit(args.limit, maximum);
    const nonconformityOffset = safeOffset(args.nonconformityOffset);
    const workInstructionOffset = safeOffset(args.workInstructionOffset);
    const results: unknown[] = [];
    let nonconformityTotal = 0;

    if (kind === 'nonconformity' || kind === 'both') {
      const where: Record<string, unknown> = {
        isPresentInLatestSnapshot: true,
        ...(partNumber ? { partNumber } : {}),
        ...(nonconformityNo ? { nonconformityNo } : {}),
        ...(partName ? { partName } : {}),
        ...(machineName ? { machineName } : {}),
        ...(originDepartmentCode ? { originDepartmentCode } : {}),
        ...(originDepartmentName ? { originDepartmentName: { contains: originDepartmentName, mode: 'insensitive' } } : {}),
        ...(originDepartmentNames.length || originDepartmentNameAny.length ? {
          AND: [
            ...originDepartmentNames.map((term) => ({ originDepartmentName: { contains: term, mode: 'insensitive' } })),
            ...(originDepartmentNameAny.length ? [{ OR: originDepartmentNameAny.map((term) => ({ originDepartmentName: { contains: term, mode: 'insensitive' } })) }] : []),
          ],
        } : {}),
        ...(exactExclusionWhere.length ? { NOT: { OR: exactExclusionWhere } } : {}),
        ...(dateFromBound || dateToBound ? { discoveredOn: { ...(dateFromBound ? { gte: dateFromBound } : {}), ...(dateToBound ? { lte: dateToBound } : {}) } } : {}),
        ...(query ? {
          OR: [
            { nonconformityNo: { contains: query, mode: 'insensitive' } },
            { partNumber: { contains: query, mode: 'insensitive' } },
            { nonconformityContent: { contains: query, mode: 'insensitive' } },
            { remarks: { contains: query, mode: 'insensitive' } },
            { correctiveContent1: { contains: query, mode: 'insensitive' } },
            { correctiveContent2: { contains: query, mode: 'insensitive' } },
            { dispositionContent: { contains: query, mode: 'insensitive' } },
            { partName: { contains: query, mode: 'insensitive' } },
            { machineName: { contains: query, mode: 'insensitive' } }
          ]
        } : {}),
        ...(condition ? { nonconformityContent: { contains: condition, mode: 'insensitive' } } : {})
      };
      const rows = await this.db.scawStfutekigoCurrent.findMany({
        where,
        orderBy: [{ discoveredOn: { sort: 'desc', nulls: 'last' } }, { nonconformityNo: 'desc' }],
        skip: nonconformityOffset,
        take: limit,
        select: {
          id: true,
          nonconformityNo: true,
          partNumber: true,
          partName: true,
          machineName: true,
          originDepartmentCode: true,
          originDepartmentName: true,
          discoveredOn: true,
          nonconformityContent: true,
          remarks: true,
          correctiveContent1: true,
          correctiveContent2: true,
          dispositionContent: true,
          sourceUpdatedOn: true
        }
      });
      nonconformityTotal = await this.db.scawStfutekigoCurrent.count({ where });
      results.push(...rows.map((row) => ({
        kind: 'nonconformity' as const,
        id: row.id,
        nonconformityNo: row.nonconformityNo,
        partNumber: row.partNumber,
        partName: row.partName,
        machineName: row.machineName,
        originDepartmentCode: row.originDepartmentCode,
        originDepartmentName: row.originDepartmentName,
        originDepartmentMeaning: ORIGIN_DEPARTMENT_MEANING,
        evidenceKey: `nonconformity:${row.id}`,
        condition: row.nonconformityContent,
        remarks: row.remarks,
        correctiveContent: [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null,
        disposition: row.dispositionContent,
        rawText: nonconformityRawText(row),
        discoveredOn: row.discoveredOn?.toISOString().slice(0, 10) ?? null,
        sourceVersionDate: row.sourceUpdatedOn?.toISOString().slice(0, 10) ?? null,
        provenance: { source: 'ScawStfutekigoCurrent', activeLatest: true, meaning: '不適合の発生状況と記録済みの対処を確認する情報源。' }
      })));
    }

    let truncated = false;
    const workInstructionResults: unknown[] = [];
    const workInstructionResultOffsets: number[] = [];
    let workInstructionTotal = 0;
    let workInstructionTotalKnown = false;
    let workInstructionPageSize = 0;
    if (kind === 'work_instruction' || kind === 'both') {
      const summaries: Array<{ summary: WorkInstructionGroupSummaryView; offset: number }> = [];
      if (query) {
        const page = await this.workInstructions.searchPublishedGroups({
          query,
          partNumber: partNumber ?? undefined,
          shootingTarget: shootingTarget ?? undefined,
          limit,
          offset: workInstructionOffset
        });
        summaries.push(...page.groups.map((summary, index) => ({ summary, offset: workInstructionOffset + index })));
        workInstructionTotal = page.total;
        workInstructionTotalKnown = true;
        truncated = page.hasMore;
      } else {
        // Empty query is a bounded catalog page. It must not scan every group
        // just to discover that a user has not yet supplied search text.
        const page = await this.workInstructions.readPublishedGroups({
          partNumber: partNumber ?? undefined,
          shootingTarget: shootingTarget ?? undefined,
          limit: limit + 1,
          offset: workInstructionOffset
        });
        summaries.push(...page.slice(0, limit).map((summary, index) => ({ summary, offset: workInstructionOffset + index })));
        truncated = page.length > limit;
      }
      workInstructionPageSize = summaries.length;
      for (const { summary, offset: summaryOffset } of summaries) {
        const group = await this.workInstructions.readPublishedGroup({ partNumber: summary.partNumber, shootingTarget: summary.shootingTarget });
        if (!group) continue;
        workInstructionResults.push(workInstructionResult(group));
        workInstructionResultOffsets.push(summaryOffset);
      }
    }
    if (!workInstructionTotalKnown) workInstructionTotal = workInstructionResults.length;
    const visibleResults: unknown[] = [];
    if (kind === 'both') {
      // Keep both sources visible when one source has many matches instead of
      // letting the first source consume the entire bounded response.
      for (let index = 0; visibleResults.length < limit && (index < results.length || index < workInstructionResults.length); index += 1) {
        if (results[index] !== undefined && visibleResults.length < limit) visibleResults.push(results[index]);
        if (workInstructionResults[index] !== undefined && visibleResults.length < limit) visibleResults.push(workInstructionResults[index]);
      }
    } else {
      visibleResults.push(...(kind === 'nonconformity' ? results : workInstructionResults).slice(0, limit));
    }
    const visibleNonconformityCount = visibleResults.filter((result) => (result as { kind?: string }).kind === 'nonconformity').length;
    const visibleWorkInstructionCount = visibleResults.filter((result) => (result as { kind?: string }).kind === 'work_instruction').length;
    const nonconformityHasMore = nonconformityTotal > nonconformityOffset + visibleNonconformityCount;
    const workInstructionHasMore = truncated || (workInstructionTotalKnown
      ? workInstructionTotal > workInstructionOffset + visibleWorkInstructionCount
      : workInstructionResults.length > visibleWorkInstructionCount);
    // Text-search pages have a global count; bounded catalog pages expose
    // only the count loaded for this page and therefore keep total unknown.
    const totalKnown = workInstructionTotalKnown || (!truncated && workInstructionOffset === 0);
    const total = totalKnown
      ? kind === 'both' ? nonconformityTotal + workInstructionTotal : kind === 'nonconformity' ? nonconformityTotal : workInstructionTotal
      : null;
    const sourceCounts: Record<string, BusinessHermesSourceCount> = {};
    if (kind === 'nonconformity' || kind === 'both') {
      sourceCounts.nonconformity = { total: nonconformityTotal, returned: visibleNonconformityCount, returnedScope: 'returned_page' };
    }
    if (kind === 'work_instruction' || kind === 'both') {
      sourceCounts.workInstruction = {
        total: totalKnown ? workInstructionTotal : null,
        returned: visibleWorkInstructionCount,
        returnedScope: 'returned_page'
      };
    }
    // Cursor points at the first matching group not returned in this page.
    // This matters when `both` fills the page with NC rows first.
    const nextWorkInstructionResultOffset = workInstructionResultOffsets[visibleWorkInstructionCount];
    const workInstructionCursor = workInstructionHasMore
      ? nextWorkInstructionResultOffset === undefined
        ? workInstructionOffset + workInstructionPageSize
        : nextWorkInstructionResultOffset
      : null;
    return {
      results: visibleResults,
      total,
      sourceCounts,
      limit,
      truncated: Boolean(truncated || nonconformityHasMore || workInstructionHasMore),
      hasMore: {
        nonconformity: kind !== 'work_instruction' && nonconformityHasMore,
        workInstruction: kind !== 'nonconformity' && workInstructionHasMore
      },
      nextCursor: {
        nonconformityOffset: nonconformityHasMore ? nonconformityOffset + visibleNonconformityCount : null,
        workInstructionOffset: workInstructionCursor
      },
      ...(kind !== 'nonconformity' && (!totalKnown || workInstructionOffset > 0) ? {
        scannedMatches: { workInstruction: workInstructionTotal }
      } : {})
    };
  }

  private async detail(args: Record<string, unknown>) {
    const kind = args.kind === 'work_instruction' ? args.kind : args.kind === 'nonconformity' ? args.kind : null;
    if (!kind) return { error: 'kind must be nonconformity or work_instruction' };
    const id = text(args.id, 200);
    if (kind === 'nonconformity') {
      if (!id) return { error: 'id is required for nonconformity detail' };
      const row = await this.db.scawStfutekigoCurrent.findFirst({
        where: { isPresentInLatestSnapshot: true, ...(id ? { OR: [{ id }, { nonconformityNo: id }] } : {}) },
        select: {
          id: true,
          nonconformityNo: true,
          partNumber: true,
          partName: true,
          machineName: true,
          originDepartmentCode: true,
          originDepartmentName: true,
          discoveredOn: true,
          nonconformityContent: true,
          remarks: true,
          correctiveContent1: true,
          correctiveContent2: true,
          dispositionContent: true,
          sourceUpdatedOn: true
        }
      });
      return row ? {
        kind,
        id: row.id,
        nonconformityNo: row.nonconformityNo,
        partNumber: row.partNumber,
        partName: row.partName,
        machineName: row.machineName,
        originDepartmentCode: row.originDepartmentCode,
        originDepartmentName: row.originDepartmentName,
        originDepartmentMeaning: ORIGIN_DEPARTMENT_MEANING,
        evidenceKey: `nonconformity:${row.id}`,
        condition: row.nonconformityContent,
        remarks: row.remarks,
        correctiveContent: [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null,
        disposition: row.dispositionContent,
        rawText: nonconformityRawText(row),
        discoveredOn: row.discoveredOn?.toISOString().slice(0, 10) ?? null,
        sourceVersionDate: row.sourceUpdatedOn?.toISOString().slice(0, 10) ?? null,
        provenance: { source: 'ScawStfutekigoCurrent', activeLatest: true, meaning: '不適合の発生状況と記録済みの対処を確認する情報源。' }
      } : { result: null };
    }

    let partNumber = normalizeWorkInstructionPartNumber(text(args.partNumber, 200));
    let shootingTarget = normalizeWorkInstructionShootingTarget(text(args.shootingTarget, 200));
    if ((!partNumber || !shootingTarget) && id) {
      const publication = await this.db.workInstructionSourcePublication.findUnique({ where: { rowId: id }, select: { publishedVersion: { select: { partNumber: true, shootingTarget: true } } } });
      const row = publication?.publishedVersion;
      partNumber = normalizeWorkInstructionPartNumber(row?.partNumber ?? null);
      shootingTarget = normalizeWorkInstructionShootingTarget(row?.shootingTarget ?? null);
    }
    if (!partNumber || !shootingTarget) return { error: 'partNumber and shootingTarget are required for work_instruction detail' };
    const group = await this.workInstructions.readPublishedGroup({ partNumber, shootingTarget });
    if (!group || (id && !group.rows.some((row) => row.id === id))) return { result: null };
    return workInstructionResult(group);
  }
}
