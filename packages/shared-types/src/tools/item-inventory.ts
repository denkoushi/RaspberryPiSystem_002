export type InventoryToolScope = 'default' | 'seigi';

export type InventoryCompartment = {
  id: string;
  labelNumber: number;
  stockQuantity: number;
  area: string;
  shelfNumber: number;
  drawerNumber: number;
  itemTagUid: string | null;
  item: {
    id: string;
    itemCode: string;
    name: string;
    model: string | null;
    usage: string | null;
    category: string | null;
    area: string | null;
    note: string | null;
    unit: string | null;
    unitPrice?: number | null;
    maker?: string | null;
    toolName?: string | null;
    workMaterial?: string | null;
    toolSize?: string | null;
    photos: Array<{ id: string; photoIndex: number; photoUrl: string; originalFilename: string }>;
  };
  lastIssuedAt?: string | null;
};

export function formatInventoryLabelNumber(n: number): string {
  return String(n).padStart(4, '0');
}

/** Display grouping only: stored spellings change only on an explicit merge. */
export function normalizeToolValue(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

export type InventoryDashboard = {
  weeks: Array<{ weekStart: string; issued: number }>;
  totalIssued: number;
  previousTotalIssued: number;
  items: Array<{
    id: string; name: string; labelNumbers: number[]; toolName: string | null; maker: string | null;
    unit: string | null; unitPrice: number | null; stock: number; issued: number; weekly: number[];
  }>;
  lowStockCount: number;
  pricedItemCount: number;
  itemCount: number;
  machines: string[];
  cost: { total: number; previousTotal: number; byMonth: Array<{ month: string; amount: number }> };
};
export type InventoryVariantField = 'maker' | 'toolName' | 'model' | 'toolSize' | 'workMaterial' | 'usage';
export type InventoryVariantGroup = {
  field: InventoryVariantField; to: string; from: Array<{ value: string; count: number }>; auto: boolean;
};
export type InventoryValueVariants = { groups: InventoryVariantGroup[]; autoMergedValueCount: number };
