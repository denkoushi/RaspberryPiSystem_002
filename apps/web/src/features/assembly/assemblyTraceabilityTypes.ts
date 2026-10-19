export type AssemblyTraceabilityWorkUnitDto = {
  id: string;
  workId: string;
  status: 'in_progress' | 'completed' | 'cancelled' | 'not_started';
  productNo: string | null;
  targetUnit: string | null;
  templateName: string | null;
  completedAt: string | null;
  invalidation: {
    reason: string;
    invalidatedAt: string;
    sourceState: string;
  } | null;
};

export type AssemblyFormalIdentifierDto = {
  id: string;
  formalId: string;
  assignedAt?: string;
};

export type AssemblyGenealogyNodeDto = {
  workUnit: AssemblyTraceabilityWorkUnitDto;
  children: AssemblyGenealogyNodeDto[];
};

export type AssemblyTraceabilityDetailDto = {
  workUnit: AssemblyTraceabilityWorkUnitDto;
  activeParent: { linkId: string; workUnit: AssemblyTraceabilityWorkUnitDto } | null;
  activeChildren: Array<{ linkId: string; workUnit: AssemblyTraceabilityWorkUnitDto }>;
  root: { workUnit: AssemblyTraceabilityWorkUnitDto; formalIdentifier: AssemblyFormalIdentifierDto | null };
  formalIdentifierHistory: Array<{
    id: string;
    formalId: string;
    assignedAt: string;
    assignedByUsernameSnapshot: string | null;
    supersededAt: string | null;
    supersededByUsernameSnapshot: string | null;
    supersedeReason: string | null;
  }>;
  compositionHistory: Array<{
    id: string;
    parentWorkId: string;
    childWorkId: string;
    linkedAt: string;
    linkedByUsernameSnapshot: string | null;
    unlinkedAt: string | null;
    unlinkedByUsernameSnapshot: string | null;
    unlinkReason: string | null;
  }>;
  genealogy: AssemblyGenealogyNodeDto[];
};
