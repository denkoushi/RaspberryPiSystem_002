import type { ClientDevice, Employee, Item, Loan, MeasuringInstrument, RiggingGear, Transaction, User } from '@prisma/client';

type DisplaySource<T, K extends keyof T> = Pick<T, K> & Partial<T>;

/** ORM relations may contain credentials; HTTP responses must use this allowlist. */
export type LoanResponseSource = Loan & {
  item?: DisplaySource<Item, 'id' | 'itemCode' | 'name'> | null;
  employee?: DisplaySource<Employee, 'id' | 'employeeCode' | 'displayName'> | null;
  client?: DisplaySource<ClientDevice, 'id' | 'name'> | null;
  measuringInstrument?: DisplaySource<MeasuringInstrument, 'id' | 'managementNumber' | 'name'> | null;
  riggingGear?: DisplaySource<RiggingGear, 'id' | 'managementNumber' | 'name'> | null;
  performedByUser?: DisplaySource<User, 'id' | 'username'> | null;
  photoToolHumanReviewedBy?: DisplaySource<User, 'id' | 'username'> | null;
};

function pickFields<T extends object, K extends keyof T>(source: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<T, K>;
}

function displayRelation<T extends object, K extends keyof T>(source: T | null | undefined, fields: readonly K[]) {
  return source == null ? source : pickFields(source, fields);
}

export function toLoanResponse(loan: LoanResponseSource) {
  return {
    ...pickFields(loan, [
      'id', 'itemId', 'measuringInstrumentId', 'riggingGearId', 'employeeId', 'clientId',
      'borrowedAt', 'dueAt', 'returnedAt', 'cancelledAt', 'notes', 'photoUrl', 'photoTakenAt',
      'photoToolDisplayName', 'photoToolVlmLabelProvenance', 'photoToolHumanDisplayName',
      'photoToolHumanQuality', 'photoToolHumanReviewedAt', 'photoToolHumanReviewedByUserId',
      'createdAt', 'updatedAt',
    ] as const),
    item: displayRelation(loan.item, [
      'id', 'itemCode', 'name', 'description', 'category', 'storageLocation', 'status', 'notes', 'createdAt', 'updatedAt',
    ] as const),
    employee: displayRelation(loan.employee, [
      'id', 'employeeCode', 'displayName', 'lastName', 'firstName', 'department', 'section', 'status', 'createdAt', 'updatedAt',
    ] as const),
    client: displayRelation(loan.client, ['id', 'name', 'location', 'defaultMode'] as const),
    measuringInstrument: displayRelation(loan.measuringInstrument, [
      'id', 'managementNumber', 'name', 'genreId', 'storageLocation', 'department', 'measurementRange',
      'calibrationExpiryDate', 'status', 'createdAt', 'updatedAt',
    ] as const),
    riggingGear: displayRelation(loan.riggingGear, [
      'id', 'managementNumber', 'name', 'idNum', 'storageLocation', 'department', 'maxLoadTon',
      'lengthMm', 'widthMm', 'thicknessMm', 'startedAt', 'usableYears', 'status', 'notes', 'createdAt', 'updatedAt',
    ] as const),
    performedByUser: displayRelation(loan.performedByUser, ['id', 'username'] as const),
    photoToolHumanReviewedBy: displayRelation(loan.photoToolHumanReviewedBy, ['id', 'username'] as const),
  };
}

type TransactionResponseSource = Transaction & {
  loan?: LoanResponseSource | null;
  actorEmployee?: DisplaySource<Employee, 'id' | 'employeeCode' | 'displayName'> | null;
  performedByUser?: DisplaySource<User, 'id' | 'username'> | null;
  client?: DisplaySource<ClientDevice, 'id' | 'name'> | null;
};

/** History embeds the same Loan DTO and must not serialize full ClientDevice/User rows. */
export function toTransactionResponse(transaction: TransactionResponseSource) {
  return {
    ...pickFields(transaction, [
      'id', 'loanId', 'action', 'actorEmployeeId', 'performedByUserId', 'clientId', 'details', 'createdAt',
    ] as const),
    loan: transaction.loan == null ? transaction.loan : toLoanResponse(transaction.loan),
    actorEmployee: displayRelation(transaction.actorEmployee, ['id', 'employeeCode', 'displayName'] as const),
    performedByUser: displayRelation(transaction.performedByUser, ['id', 'username'] as const),
    client: displayRelation(transaction.client, ['id', 'name', 'location', 'defaultMode'] as const),
  };
}
