export type PalletVizBarcodeGlyphProps = {
  className?: string;
};

/** 製造 order スキャン等で用いるバーコード風の縦線アイコン */
export function PalletVizBarcodeGlyph({ className }: PalletVizBarcodeGlyphProps) {
  const xs = [3, 5, 8, 9.5, 12, 14, 16, 18, 20] as const;
  const ws = [1.2, 0.8, 1.4, 0.7, 1.1, 0.9, 1.3, 0.8, 1] as const;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {xs.map((x, i) => (
        <rect key={i} x={x} y={5} width={ws[i] ?? 1} height={14} rx={0.2} fill="currentColor" />
      ))}
    </svg>
  );
}
