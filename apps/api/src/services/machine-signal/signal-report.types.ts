/** ランプ1色の状態。日報CSVの数値コードをそのまま保持する（0=判定に使っていない, 1=消灯, 2=点灯, 4=点滅）。 */
export type LampCode = 0 | 1 | 2 | 4;

/**
 * 状態遷移ログ1件。保存サイズを抑えるためタプルで持つ。
 * [開始秒(集計日の開始時刻からの秒), 継続秒, 赤, 黄, 緑, 状態名のindex]
 */
export type SignalSegmentTuple = [number, number, LampCode, LampCode, LampCode, number];

export type ParsedSignalDailyReport = {
  /** 集計日（YYYY-MM-DD）。1行目の日付 */
  reportDate: string;
  /** 1行目の機械名（センサー側の登録名。拠点が違えば重複しうる） */
  machineName: string;
  /** 集計日の開始時刻（0時からの分）。「カウント HH:MM」の先頭行から読む。既定 480（08:00） */
  dayStartMinute: number;
  /** 日報上段の集計値（稼働時間、稼働率など）。ラベル→値。参考値としてそのまま残す */
  summary: Record<string, string>;
  /** 状態名の一覧。segments の index が指す */
  stateNames: string[];
  segments: SignalSegmentTuple[];
};

export const SIGNAL_DAY_SECONDS = 86_400;

export const SIGNAL_CATEGORIES = ['RUN', 'RUN_ALARM', 'STOP', 'ALARM_STOP', 'IDLE', 'NO_RECORD'] as const;
/** 機械をまたいで比較するための共通6区分。 */
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];
