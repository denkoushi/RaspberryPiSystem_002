import { normalizeMachineName } from '../../productionSchedule/machineName';

/** 資源CDと加工機名を並べる。加工機名がすでに資源CDで始まるときは、資源CDを二重に出さない。 */
export function ganttResourceLabel(resource: string, names: readonly string[] | undefined): string {
  const cd = normalizeMachineName(resource);
  const shown = (names ?? []).map((name) => normalizeMachineName(name)).filter((name) => name !== '' && name !== cd);
  if (!shown.length) return cd;
  const joined = shown.join('・');
  return shown.some((name) => name.startsWith(cd)) ? joined : `${cd} ${joined}`;
}
