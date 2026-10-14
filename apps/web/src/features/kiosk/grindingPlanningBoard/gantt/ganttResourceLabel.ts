import { normalizeMachineName } from '../../productionSchedule/machineName';

/** 資源CDを1回だけ先頭に出し、加工機名の頭に付いた資源CDは外して並べる。 */
export function ganttResourceLabel(resource: string, names: readonly string[] | undefined): string {
  const cd = normalizeMachineName(resource);
  const shown = (names ?? [])
    .map((name) => {
      const normalized = normalizeMachineName(name);
      return normalized.startsWith(cd) ? normalized.slice(cd.length).replace(/^[\s・:：-]+/, '') : normalized;
    })
    .filter((name, index, all) => name !== '' && all.indexOf(name) === index);
  return shown.length ? `${cd} ${shown.join('・')}` : cd;
}
