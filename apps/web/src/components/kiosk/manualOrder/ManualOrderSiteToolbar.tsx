type Props = {
  siteKey: string;
  defaultSites: readonly string[];
  onSiteChange: (siteKey: string) => void;
};

/**
 * 手動順番ページ上ペイン左側: 見出し + 工場選択（状態は親が保持）
 */
export function ManualOrderSiteToolbar({ siteKey, defaultSites, onSiteChange }: Props) {
  return (
    <>
      <h2 className="text-sm font-semibold text-white">手動順番</h2>
      <select
        value={siteKey}
        onChange={(event) => onSiteChange(event.target.value)}
        className="h-8 rounded border border-white/20 bg-slate-900 px-2 text-xs text-white"
        aria-label="工場を選択"
      >
        {defaultSites.map((site) => (
          <option key={site} value={site}>
            {site}
          </option>
        ))}
      </select>
    </>
  );
}
