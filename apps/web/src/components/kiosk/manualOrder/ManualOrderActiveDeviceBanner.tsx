type Props = {
  visible: boolean;
  label: string;
  resourceCd: string | null;
};

export function ManualOrderActiveDeviceBanner({ visible, label, resourceCd }: Props) {
  if (!visible) return null;
  return (
    <div className="mb-2 rounded border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
      編集中: <span className="font-semibold">{label}</span>
      {resourceCd ? <span className="ml-2 text-cyan-200">資源CD {resourceCd}</span> : null}
    </div>
  );
}
