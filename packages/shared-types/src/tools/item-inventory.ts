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
