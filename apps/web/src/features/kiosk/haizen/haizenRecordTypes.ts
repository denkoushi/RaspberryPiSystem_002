export type HaizenVerifyRecord = {
  id: string;
  verifiedAt: string;
  deviceName: string;
  result: 'match' | 'mismatch' | 'not_found' | 'error';
  reason: string | null;
  transfer: { orderNo: string; partNo: string | null; fseiban: string | null };
  actual: { slipNo: string | null; partNo: string | null; fseiban: string | null };
  mismatch: 'fseiban' | 'part' | null;
  fhinmei: string | null;
  machineName: string | null;
  placedShelfCodeRaw: string | null;
  branchNo: number | null;
};

export type HaizenOrderTrail = {
  orderNo: string;
  fhinmei: string;
  machineName: string;
  fseiban: string;
  fhincd: string;
  currentShelves: { shelfCodeRaw: string; branchNo: number | null }[];
  steps: { processOrder: string; resourceName: string; status: string; tone: 'done' | 'active' | 'waiting' | 'none' }[];
  events: {
    id: string;
    at: string | null;
    date: string;
    source: '棚' | '照合' | '工程' | 'パレット' | 'Zero2W' | '購買';
    processOrder: string | null;
    title: string;
    detail: string | null;
    loose: boolean;
  }[];
};
