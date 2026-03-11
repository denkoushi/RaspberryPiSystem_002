import { prisma } from '../../lib/prisma.js';

type RowNoteUpsertInput = {
  csvDashboardId: string;
  csvDashboardRowId: string;
  note: string;
  dueDate: Date | null;
  processingType: string | null;
};

type SeibanDueDateUpsertInput = {
  csvDashboardId: string;
  fseiban: string;
  dueDate: Date;
};

type PartProcessingTypeUpsertInput = {
  csvDashboardId: string;
  fhincd: string;
  processingType: string;
};

export const sharedScheduleFieldsRepository = {
  findRowNoteByRowId(csvDashboardRowId: string) {
    return prisma.productionScheduleRowNote.findUnique({
      where: { csvDashboardRowId }
    });
  },

  findRowNotesByRowIds(csvDashboardId: string, rowIds: string[]) {
    return prisma.productionScheduleRowNote.findMany({
      where: {
        csvDashboardId,
        csvDashboardRowId: { in: rowIds }
      },
      select: {
        csvDashboardRowId: true,
        processingType: true,
        dueDate: true
      }
    });
  },

  deleteRowNoteByRowId(csvDashboardRowId: string) {
    return prisma.productionScheduleRowNote.deleteMany({
      where: { csvDashboardRowId }
    });
  },

  upsertRowNote(input: RowNoteUpsertInput) {
    return prisma.productionScheduleRowNote.upsert({
      where: { csvDashboardRowId: input.csvDashboardRowId },
      create: {
        csvDashboardId: input.csvDashboardId,
        csvDashboardRowId: input.csvDashboardRowId,
        note: input.note,
        dueDate: input.dueDate,
        processingType: input.processingType
      },
      update: {
        note: input.note,
        dueDate: input.dueDate,
        processingType: input.processingType
      }
    });
  },

  findSeibanDueDate(csvDashboardId: string, fseiban: string) {
    return prisma.productionScheduleSeibanDueDate.findUnique({
      where: {
        csvDashboardId_fseiban: {
          csvDashboardId,
          fseiban
        }
      },
      select: { dueDate: true }
    });
  },

  deleteSeibanDueDate(csvDashboardId: string, fseiban: string) {
    return prisma.productionScheduleSeibanDueDate.deleteMany({
      where: {
        csvDashboardId,
        fseiban
      }
    });
  },

  upsertSeibanDueDate(input: SeibanDueDateUpsertInput) {
    return prisma.productionScheduleSeibanDueDate.upsert({
      where: {
        csvDashboardId_fseiban: {
          csvDashboardId: input.csvDashboardId,
          fseiban: input.fseiban
        }
      },
      create: {
        csvDashboardId: input.csvDashboardId,
        fseiban: input.fseiban,
        dueDate: input.dueDate
      },
      update: {
        dueDate: input.dueDate
      }
    });
  },

  deletePartProcessingType(csvDashboardId: string, fhincd: string) {
    return prisma.productionSchedulePartProcessingType.deleteMany({
      where: {
        csvDashboardId,
        fhincd
      }
    });
  },

  upsertPartProcessingType(input: PartProcessingTypeUpsertInput) {
    return prisma.productionSchedulePartProcessingType.upsert({
      where: {
        csvDashboardId_fhincd: {
          csvDashboardId: input.csvDashboardId,
          fhincd: input.fhincd
        }
      },
      create: {
        csvDashboardId: input.csvDashboardId,
        fhincd: input.fhincd,
        processingType: input.processingType
      },
      update: {
        processingType: input.processingType
      }
    });
  }
};
