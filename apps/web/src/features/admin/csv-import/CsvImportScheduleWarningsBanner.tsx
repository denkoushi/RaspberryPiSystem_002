type CsvImportScheduleWarningsBannerProps = {
  warnings: string[];
};

export function CsvImportScheduleWarningsBanner({ warnings }: CsvImportScheduleWarningsBannerProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-md border-2 border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 shadow">
      <p className="font-semibold">Gmail CSV スケジュール警告</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        同時刻に複数の Gmail csvDashboards 取込が走ると、後続は履歴なしでスキップされる場合があります。衝突する場合は cron をずらしてください（例: `18 6 * * 0`）。
      </p>
    </div>
  );
}
