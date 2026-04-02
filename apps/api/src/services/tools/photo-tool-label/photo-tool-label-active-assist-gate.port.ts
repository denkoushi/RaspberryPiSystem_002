/**
 * GOOD ギャラリー件数に基づき、補助 VLM 結果を本番保存してよいかを判定する境界。
 */
export type PhotoToolLabelActiveAssistGateResult = {
  /** アクティブ保存が許可される（有効フラグ ON かつ件数が閾値以上） */
  allowed: boolean;
  /** BTRIM 一致で数えたギャラリー行数 */
  rowCount: number;
};

export type PhotoToolLabelActiveAssistGatePort = {
  /**
   * 収束した canonicalLabel（近傍ラベル）についてギャラリー行数を数え、閾値を満たすか返す。
   */
  evaluate(convergedCanonicalLabel: string): Promise<PhotoToolLabelActiveAssistGateResult>;
};
