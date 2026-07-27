import { describe, expect, it } from 'vitest';

import {
  appendAssemblyProcedureDocument,
  createAssemblyBoltAt,
  createFullPageStepDraft,
  emptyAssemblyArea,
  evaluateAssemblyTemplateReadiness
} from '.';

import type {
  AssemblyTemplateReadinessInput
} from './assemblyTemplateReadiness';
import type { AssemblyProcedureDocumentSummaryDto } from './types';
import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-07-27T00:00:00.000Z';

function documentFixture(): AssemblyProcedureDocumentSummaryDto {
  return {
    id: DOCUMENT_ID,
    name: '主手順書',
    imageRelativePath: '/api/procedure.png',
    status: 'published',
    publishedAt: NOW,
    isActive: true,
    pages: [{ pageIndex: 0, imageRelativePath: '/api/procedure-1.png' }],
    createdAt: NOW,
    updatedAt: NOW,
    activeTemplateCount: 0,
    totalTemplateCount: 0
  };
}

function groupFixture(): TorqueWrenchCapabilityGroupApi {
  return {
    id: GROUP_ID,
    name: 'M6 標準',
    nominalDiameter: 'Ｍ６',
    boltLengthMm: '30',
    material: ' SCM 435 ',
    strengthClass: '10.9',
    isActive: true,
    models: []
  };
}

function readyInput(): AssemblyTemplateReadinessInput {
  const document = documentFixture();
  const procedureItems = appendAssemblyProcedureDocument([], document);
  procedureItems[0]!.localId = 'document-1';
  const page = {
    key: 'assembly:document-1:0',
    label: '主手順書 1/1',
    source: 'assembly_procedure_document' as const,
    documentId: DOCUMENT_ID,
    pageIndex: 0,
    imageRelativePath: '/api/procedure-1.png'
  };
  const area = emptyAssemblyArea();
  area.id = 'area-1';
  area.processNo = '10';
  area.areaCode = 'A';
  area.unitCode = 'U1';
  area.areaName = '本体';
  const bolt = createAssemblyBoltAt(area, 0.5, 0.5, {
    source: 'assembly_procedure_document',
    documentId: DOCUMENT_ID,
    pageIndex: 0
  });
  bolt.id = 'bolt-1';
  bolt.nominalDiameter = 'm 6';
  bolt.boltLengthMm = 30;
  bolt.material = 'scm435';
  bolt.strengthClass = '10.9';
  bolt.lowerLimit = 9;
  bolt.nominalTorque = 10;
  bolt.upperLimit = 11;
  bolt.unit = 'N·m';
  bolt.capabilityGroupId = GROUP_ID;
  area.bolts = [bolt];

  return {
    modelCode: 'MODEL-1',
    procedurePattern: '標準',
    templateName: 'MODEL-1 標準',
    procedureItems,
    procedureSteps: [createFullPageStepDraft(page)],
    pageOptions: [page],
    areas: [area],
    checkItems: [],
    documents: [document],
    capabilityCatalog: { status: 'ready', groups: [groupFixture()] }
  };
}

describe('evaluateAssemblyTemplateReadiness', () => {
  it('accepts a complete REQUIRED draft and uses the shared normalized fastener comparison', () => {
    const readiness = evaluateAssemblyTemplateReadiness(readyInput());

    expect(readiness).toEqual({
      isReady: true,
      issues: [],
      stages: {
        basic: 'complete',
        procedure: 'complete',
        areas: 'complete',
        review: 'complete'
      }
    });
  });

  it('groups blank area and bolt fields instead of emitting one issue per field', () => {
    const input = readyInput();
    input.areas[0] = emptyAssemblyArea();
    input.areas[0]!.id = 'area-blank';
    const bolt = createAssemblyBoltAt(input.areas[0]!, 0.5, 0.5, {
      source: 'assembly_procedure_document',
      documentId: DOCUMENT_ID,
      pageIndex: 0
    });
    bolt.id = 'bolt-blank';
    input.areas[0]!.bolts = [bolt];

    const readiness = evaluateAssemblyTemplateReadiness(input);

    expect(readiness.issues.filter((issue) => issue.code === 'area.fields_required')).toHaveLength(1);
    expect(readiness.issues.filter((issue) => issue.code === 'bolt.fields_required')).toHaveLength(1);
    expect(
      readiness.issues.find((issue) => issue.code === 'bolt.fields_required')
        ?.missingFields
    ).toEqual([
      '呼び径',
      '長さ',
      '材質',
      '強度区分',
      '下限',
      '規定',
      '上限',
      '単位',
      '適合グループ'
    ]);
  });

  it.each([
    ['文書なし', (input: AssemblyTemplateReadinessInput) => {
      input.procedureItems = [];
      input.procedureSteps = [];
      input.pageOptions = [];
    }, 'procedure.documents.required'],
    ['未使用文書', (input: AssemblyTemplateReadinessInput) => {
      const second = documentFixture();
      second.id = '33333333-3333-4333-8333-333333333333';
      second.name = '未使用文書';
      input.documents.push(second);
      input.procedureItems.push(...appendAssemblyProcedureDocument([], second));
    }, 'procedure.document.unused'],
    ['空工程', (input: AssemblyTemplateReadinessInput) => {
      input.areas[0]!.bolts = [];
    }, 'area.bolts.required'],
    ['トルク順序不正', (input: AssemblyTemplateReadinessInput) => {
      input.areas[0]!.bolts[0]!.lowerLimit = 12;
    }, 'bolt.torque_order_invalid'],
    ['不一致グループ', (input: AssemblyTemplateReadinessInput) => {
      input.areas[0]!.bolts[0]!.material = 'SUS304';
    }, 'bolt.capability_group_invalid']
  ])('%sを保存不可として報告する', (_label, mutate, expectedCode) => {
    const input = readyInput();
    mutate(input);

    const readiness = evaluateAssemblyTemplateReadiness(input);

    expect(readiness.isReady).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toContain(expectedCode);
  });

  it('reports a marker that no display step can show', () => {
    const input = readyInput();
    input.procedureSteps[0] = {
      ...input.procedureSteps[0]!,
      viewMode: 'crop',
      crop: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 }
    };

    expect(evaluateAssemblyTemplateReadiness(input).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'procedure.marker.hidden',
          target: expect.objectContaining({ kind: 'bolt', id: 'bolt-1' })
        })
      ])
    );
  });

  it('blocks saving while the catalog is loading or unavailable', () => {
    const loading = readyInput();
    loading.capabilityCatalog = { status: 'loading', groups: [] };
    expect(evaluateAssemblyTemplateReadiness(loading)).toMatchObject({
      isReady: false,
      stages: { areas: 'checking', review: 'checking' }
    });

    const failed = readyInput();
    failed.capabilityCatalog = { status: 'error', groups: [] };
    const readiness = evaluateAssemblyTemplateReadiness(failed);
    expect(readiness.isReady).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toContain(
      'capability_catalog.unavailable'
    );
  });
});
