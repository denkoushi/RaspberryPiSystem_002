/**
 * VLM ラベル推論への GOOD 類似補助（シャドー／将来の有効化）の境界契約。
 * 実装は埋め込み・ギャラリー検索の詳細を隠蔽する。
 */
export type PhotoToolLabelAssistDecision = {
  shouldAssist: boolean;
  /** 先頭K件で収束した canonicalLabel。補助不成立時は null */
  convergedCanonicalLabel: string | null;
  /** プロンプトに載せる候補ラベル（重複除去済み・空のときは補助しない） */
  candidateLabels: string[];
  /** ログ用: 補助しない理由コード */
  reason: string;
  /** フィルタ後の最近傍距離（無ければ null） */
  topDistance: number | null;
  /** assist 用 max cosine 距離でフィルタ後の件数 */
  neighborCountAfterFilter: number;
};

export type PhotoToolLabelAssistPort = {
  /**
   * 同一 JPEG をクエリとして GOOD ギャラリー近傍を評価し、条件を満たすときだけ補助対象とする。
   */
  evaluateForShadow(input: {
    loanId: string;
    /** ログ用（将来のデバッグ） */
    photoUrl: string;
    queryJpegBytes: Buffer;
  }): Promise<PhotoToolLabelAssistDecision>;
};
