import type { RegisteredShelfEntryDto } from './types';

/** 加工機名ごとの塊にする。先に出てきた順を保つ。 */
export function groupShelvesByMachine(shelves: RegisteredShelfEntryDto[]): Map<string | undefined, RegisteredShelfEntryDto[]> {
  const groups = new Map<string | undefined, RegisteredShelfEntryDto[]>();
  for (const shelf of shelves) {
    const group = groups.get(shelf.machineName) ?? [];
    group.push(shelf);
    groups.set(shelf.machineName, group);
  }
  return groups;
}

const order = (shelf: RegisteredShelfEntryDto) => shelf.sortOrder ?? null;

/**
 * 設定した並び順で棚を並べる。加工機ごとの塊にし、塊の順は塊の中の最小の並び順、塊の中は並び順。
 * 並び順が無いものは後ろに、元の順のまま並ぶ。
 */
export function sortShelvesBySetting(shelves: RegisteredShelfEntryDto[]): RegisteredShelfEntryDto[] {
  const sortedGroups = [...groupShelvesByMachine(shelves).values()].map((group) => {
    const ordered = group.filter((shelf) => order(shelf) !== null).sort((a, b) => order(a)! - order(b)!);
    const rest = group.filter((shelf) => order(shelf) === null);
    return { shelves: [...ordered, ...rest], min: ordered.length ? order(ordered[0])! : null };
  });
  const withOrder = sortedGroups.filter((group) => group.min !== null).sort((a, b) => a.min! - b.min!);
  const withoutOrder = sortedGroups.filter((group) => group.min === null);
  return [...withOrder, ...withoutOrder].flatMap((group) => group.shelves);
}
