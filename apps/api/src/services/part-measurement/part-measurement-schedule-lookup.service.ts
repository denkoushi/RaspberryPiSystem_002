/**
 * @deprecated 日程照会は production-schedule の公開窓口を利用する。
 * 既存importとの互換性を維持する。実装・契約の所有者は生産日程。
 */
export {
  listScheduleRowsByProductNo,
  listScheduleRowsByFseiban,
  resolveMachineNameForSeiban,
} from '../production-schedule/production-schedule-lookup.service.js';

export type {
  ProductionScheduleLookupRow as PartMeasurementScheduleRowCandidate,
} from '../production-schedule/production-schedule-lookup.service.js';
