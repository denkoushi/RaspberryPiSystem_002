import type { LoanReportViewModel } from './loan-report.types.js';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mixHexWithWhite(hex: string, amount: number): string {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return `rgba(15,23,42,${0.12 + 0.75 * amount})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const t = Math.max(0, Math.min(1, amount));
  const rr = Math.round(r + (255 - r) * (1 - t));
  const gg = Math.round(g + (255 - g) * (1 - t));
  const bb = Math.round(b + (255 - b) * (1 - t));
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

const REPORT_STYLES = `
    :root {
      --ink: #0f172a;
      --ink-2: #1e293b;
      --sub: #475569;
      --muted: #64748b;
      --faint: #94a3b8;
      --line: #dbe3ef;
      --line-2: #c4d0df;
      --surface: #f8fafc;
      --surface-2: #f1f5f9;
      --page-bg: #e9edf3;
      --white: #ffffff;

      --loan: #ea580c;
      --ret: #0d9488;
      --open: #2563eb;
      --over: #dc2626;
      --ok: #059669;
      --warn: #d97706;
      --bad: #dc2626;

      --num: ui-monospace, SFMono-Regular, Menlo, monospace;
      --sans: ui-sans-serif, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--page-bg);
      color: var(--ink);
      font-family: var(--sans);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .pages {
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      max-height: 297mm;
      background: var(--white);
      border: 1px solid #ccd5e1;
      box-shadow: 0 22px 48px rgba(15, 23, 42, 0.12);
      padding: 5.5mm 6mm 5mm;
      display: grid;
      grid-template-rows: auto auto auto auto 1fr auto auto;
      gap: 1.4mm;
      overflow: hidden;
      page-break-after: always;
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2mm;
      align-items: end;
      padding-bottom: 1.8mm;
      border-bottom: 2.6px solid var(--ink);
    }

    .title-row {
      display: flex;
      align-items: baseline;
      gap: 2.4mm;
    }

    .title-row h1 {
      font-size: 18px;
      line-height: 1.08;
      letter-spacing: 0.05em;
      font-weight: 900;
    }

    .cat-badge {
      display: inline-flex;
      align-items: center;
      height: 6.5mm;
      padding: 0 2.8mm;
      border-radius: 999px;
      color: #fff;
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .meta {
      text-align: right;
      font-family: var(--num);
      font-size: 7.1px;
      line-height: 1.45;
      color: var(--sub);
      font-variant-numeric: tabular-nums;
    }

    .meta .id {
      font-weight: 800;
      color: var(--ink-2);
      font-size: 7.7px;
    }

    .metric-strip {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1mm;
    }

    .metric {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 1.4mm;
      background: var(--surface);
      padding: 1mm 1.35mm 1.2mm;
      overflow: hidden;
    }

    .metric::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--metric-color);
    }

    .metric .label {
      font-size: 6.8px;
      line-height: 1.15;
      color: var(--muted);
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .metric .value {
      margin-top: 0.55mm;
      font-family: var(--num);
      font-size: 16px;
      line-height: 1;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--metric-color);
    }

    .metric .unit {
      margin-left: 0.5mm;
      font-size: 7px;
      color: var(--muted);
      font-weight: 600;
    }

    .eval-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.2mm;
    }

    .hero-card,
    .panel,
    .findings {
      border: 1px solid var(--line);
      border-radius: 1.8mm;
      background: linear-gradient(180deg, #ffffff 0%, var(--surface) 100%);
      overflow: hidden;
    }

    .hero-card {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 36.5mm;
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1mm;
      padding: 1.15mm 1.6mm;
      border-bottom: 1px solid var(--line);
      background: rgba(248, 250, 252, 0.92);
    }

    .card-head h2,
    .card-head h3 {
      font-size: 7.9px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0.03em;
      color: var(--ink-2);
    }

    .tiny-tag {
      display: inline-flex;
      align-items: center;
      min-height: 4mm;
      padding: 0 1.5mm;
      border-radius: 999px;
      font-family: var(--num);
      font-size: 6.2px;
      font-weight: 800;
      white-space: nowrap;
    }

    .tag-ok { background: rgba(5, 150, 105, 0.12); color: var(--ok); }
    .tag-warn { background: rgba(217, 119, 6, 0.12); color: var(--warn); }
    .tag-bad { background: rgba(220, 38, 38, 0.12); color: var(--bad); }

    .hero-body {
      padding: 1.4mm 1.6mm 1.2mm;
      display: grid;
      grid-template-columns: 1.2fr 0.9fr;
      gap: 1.2mm;
      align-items: center;
    }

    .chip-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.9mm;
      padding: 0 1.4mm 1.3mm;
    }

    .chip {
      border: 1px solid var(--line);
      border-radius: 1.1mm;
      background: rgba(255,255,255,0.88);
      padding: 0.85mm 1mm 0.95mm;
      min-height: 9mm;
    }

    .chip .k {
      font-size: 6.1px;
      line-height: 1.2;
      color: var(--muted);
      font-weight: 700;
    }

    .chip .v {
      margin-top: 0.45mm;
      font-family: var(--num);
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      color: var(--ink-2);
      font-variant-numeric: tabular-nums;
    }

    .hero-text {
      display: grid;
      gap: 0.8mm;
    }

    .hero-text .big {
      font-family: var(--num);
      font-size: 24px;
      line-height: 1;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      color: var(--ink);
    }

    .hero-text .sub {
      font-size: 6.4px;
      line-height: 1.35;
      color: var(--faint);
      font-weight: 700;
    }

    .hero-text .state {
      font-size: 8px;
      font-weight: 900;
      letter-spacing: 0.03em;
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 1.4mm;
      min-height: 3.8mm;
    }

    .divider h2 {
      font-size: 7.5px;
      font-weight: 900;
      letter-spacing: 0.08em;
      color: var(--ink);
      text-transform: uppercase;
      white-space: nowrap;
    }

    .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--line-2);
    }

    .analysis-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 1.1mm;
      min-height: 0;
    }

    .panel {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }

    .panel-body {
      padding: 1.15mm 1.35mm 1.2mm;
      min-height: 0;
      overflow: hidden;
    }

    .panel-note {
      margin-top: 0.7mm;
      font-size: 6.2px;
      line-height: 1.35;
      color: var(--faint);
      font-weight: 700;
    }

    .bars {
      display: grid;
      gap: 0.82mm;
    }

    .bar-row {
      display: grid;
      grid-template-columns: 18mm 1fr 8mm;
      gap: 0.7mm;
      align-items: center;
    }

    .bar-label {
      font-size: 7px;
      font-weight: 700;
      color: var(--ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .bar-track {
      position: relative;
      height: 4.1mm;
      border-radius: 0.9mm;
      background: var(--surface-2);
      overflow: hidden;
      border: 1px solid rgba(203, 213, 225, 0.75);
    }

    .bar-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      border-radius: 0.9mm;
    }

    .bar-marker {
      position: absolute;
      top: 0;
      width: 2px;
      height: 100%;
      background: var(--ink);
      opacity: 0.7;
    }

    .bar-value {
      font-family: var(--num);
      font-size: 7px;
      font-weight: 800;
      text-align: right;
      color: var(--ink-2);
      font-variant-numeric: tabular-nums;
    }

    .flow-stack {
      display: grid;
      gap: 0.82mm;
    }

    .flow-row {
      display: grid;
      grid-template-columns: 15mm 1fr;
      gap: 0.9mm;
      align-items: center;
    }

    .flow-label {
      font-size: 7px;
      font-weight: 700;
      color: var(--ink-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .flow-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.55mm;
    }

    .flow-metric {
      display: grid;
      gap: 0.25mm;
    }

    .flow-k {
      font-size: 5.8px;
      font-weight: 800;
      color: var(--muted);
      letter-spacing: 0.01em;
    }

    .flow-track {
      position: relative;
      height: 3.5mm;
      overflow: hidden;
      border-radius: 0.8mm;
      border: 1px solid rgba(203, 213, 225, 0.75);
      background: var(--surface-2);
    }

    .flow-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      border-radius: 0.8mm;
    }

    .flow-val {
      font-family: var(--num);
      font-size: 6.2px;
      font-weight: 800;
      text-align: right;
      color: var(--ink-2);
    }

    .heatmap {
      display: grid;
      gap: 0.55mm;
      height: 100%;
      align-items: stretch;
    }

    .hm-head,
    .hm-side,
    .hm-cell {
      border-radius: 0.9mm;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .hm-head,
    .hm-side {
      background: var(--surface);
      border: 1px solid var(--line);
      font-size: 6.2px;
      font-weight: 800;
      color: var(--muted);
      line-height: 1.2;
      padding: 0.6mm;
    }

    .hm-cell {
      font-family: var(--num);
      font-size: 8px;
      font-weight: 800;
      color: var(--ink-2);
      border: 1px solid rgba(203, 213, 225, 0.65);
      font-variant-numeric: tabular-nums;
    }

    .findings {
      display: grid;
      grid-template-rows: auto auto 1fr;
    }

    .findings .head {
      display: flex;
      align-items: center;
      gap: 1.2mm;
      padding: 1.1mm 1.5mm;
      border-bottom: 1px solid var(--line);
      background: rgba(248, 250, 252, 0.94);
    }

    .findings .dot {
      width: 2.2mm;
      height: 2.2mm;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .findings .head h2 {
      font-size: 7.8px;
      font-weight: 900;
      letter-spacing: 0.05em;
      color: var(--ink-2);
    }

    .verdicts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.8mm;
      padding: 1mm 1.5mm 0;
    }

    .verdict {
      border: 1px solid var(--line-2);
      border-radius: 999px;
      padding: 0.45mm 1.3mm 0.5mm;
      font-size: 6.8px;
      font-weight: 800;
      color: var(--ink-2);
      background: #fff;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    .verdict strong {
      font-family: var(--num);
      color: var(--muted);
      margin-right: 0.55mm;
      font-weight: 800;
    }

    .verdict.good { border-color: rgba(5,150,105,0.38); background: rgba(5,150,105,0.08); }
    .verdict.warn { border-color: rgba(217,119,6,0.38); background: rgba(217,119,6,0.08); }
    .verdict.bad { border-color: rgba(220,38,38,0.38); background: rgba(220,38,38,0.08); }

    .findings .body {
      padding: 1mm 1.5mm 1.3mm;
      font-size: 7.8px;
      line-height: 1.58;
      color: var(--ink-2);
    }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 2mm;
      padding-top: 1.2mm;
      border-top: 1px solid var(--line-2);
      font-family: var(--num);
      font-size: 6.8px;
      color: var(--faint);
    }

    @page {
      size: A4 portrait;
      margin: 7mm;
    }

    @media print {
      body { background: #fff; }
      .pages { padding: 0; gap: 0; }
      .page {
        box-shadow: none;
        border: none;
        width: auto;
        min-height: auto;
        max-height: none;
        padding: 0;
      }
    }
`;

const metricConfigs = [
  { key: 'assets' as const, label: '管理対象', unit: '点', color: '#1e293b' },
  { key: 'out' as const, label: '持出', unit: '', color: '#ea580c' },
  { key: 'returned' as const, label: '返却', unit: '', color: '#0d9488' },
  { key: 'open' as const, label: '未返却', unit: '', color: '#2563eb' },
  { key: 'overdue' as const, label: '期限超過', unit: '', color: '#dc2626' },
  { key: 'returnRate' as const, label: '返却率', unit: '%', color: '#0d9488' },
];

function renderMetricStrip(metrics: LoanReportViewModel['metrics']): string {
  return `
        <section class="metric-strip">
          ${metricConfigs
            .map(
              (cfg) => `
            <div class="metric" style="--metric-color:${cfg.color}">
              <div class="label">${escapeHtml(cfg.label)}</div>
              <div class="value">${metrics[cfg.key]}${
                cfg.unit ? `<span class="unit">${escapeHtml(cfg.unit)}</span>` : ''
              }</div>
            </div>
          `
            )
            .join('')}
        </section>
      `;
}

function renderSupplyScale(report: LoanReportViewModel): string {
  const score = report.supply.score;
  const accent = report.accent;
  const W = 290;
  const H = 54;
  const trackX = 10;
  const trackY = 20;
  const trackW = 270;
  const trackH = 10;
  const pointerX = trackX + trackW * (score / 100);
  const zones = [
    { w: 0.28, color: '#d9e4ef', label: '余裕' },
    { w: 0.26, color: '#c7f0e5', label: '適正' },
    { w: 0.2, color: '#fde0b9', label: 'やや逼迫' },
    { w: 0.26, color: '#f8c7c7', label: '逼迫' },
  ];
  let x = trackX;
  let rects = '';
  let labels = '';
  for (const zone of zones) {
    const w = trackW * zone.w;
    rects += `<rect x="${x}" y="${trackY}" width="${w}" height="${trackH}" rx="4" fill="${zone.color}"/>`;
    labels += `<text x="${x + w / 2}" y="${trackY + 18}" text-anchor="middle" font-size="6" fill="#64748b" font-family="var(--sans)" font-weight="700">${escapeHtml(zone.label)}</text>`;
    x += w;
  }
  return `
        <div class="hero-text">
          <div class="big" style="color:${escapeHtml(accent)}">${score}%</div>
          <div class="state" style="color:${escapeHtml(accent)}">${escapeHtml(report.supply.state)}</div>
          <div class="sub">現在の利用率。高いほど今すぐ使える在庫が少なく、需給が逼迫しています。</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" aria-hidden="true">
          ${rects}
          <rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="4" fill="none" stroke="#94a3b8" stroke-width="0.8" opacity="0.65"/>
          ${labels}
          <path d="M ${pointerX} ${trackY - 1} L ${pointerX - 4} ${trackY - 8} L ${pointerX + 4} ${trackY - 8} Z" fill="#0f172a"/>
        </svg>
      `;
}

function renderComplianceGauge(report: LoanReportViewModel): string {
  const score = report.compliance.score;
  const accent = report.accent;
  const R = 24;
  const circ = 2 * Math.PI * R;
  const dash = circ * (score / 100);
  return `
        <div style="display:grid;grid-template-columns:56px 1fr;gap:1.2mm;align-items:center;">
          <svg viewBox="0 0 70 70" width="56" height="56" aria-hidden="true">
            <circle cx="35" cy="35" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="9"/>
            <circle cx="35" cy="35" r="${R}" fill="none" stroke="${escapeHtml(accent)}" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${dash} ${circ - dash}" transform="rotate(-90 35 35)"/>
            <text x="35" y="32" text-anchor="middle" font-size="6.5" fill="#64748b" font-family="var(--num)">遵守</text>
            <text x="35" y="44" text-anchor="middle" font-size="15" font-weight="900" fill="#0f172a" font-family="var(--num)">${score}</text>
          </svg>
          <div class="hero-text">
            <div class="state" style="color:${escapeHtml(accent)}">${escapeHtml(report.compliance.state)}</div>
            <div class="sub">期間内の返却完了率。期限超過率と未返却件数は下段チップで補足します。</div>
          </div>
        </div>
      `;
}

function renderChips(chips: LoanReportViewModel['supply']['chips']): string {
  return `
        <div class="chip-grid">
          ${chips
            .map(
              (chip) => `
            <div class="chip">
              <div class="k">${escapeHtml(chip.k)}</div>
              <div class="v">${escapeHtml(chip.v)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
}

function renderItemBars(report: LoanReportViewModel): string {
  const maxDemand = Math.max(...report.itemAxis.map((d) => d.demand), 1);
  const maxStock = Math.max(...report.itemAxis.map((d) => d.stock), 1);
  const maxBase = Math.max(maxDemand, maxStock, 1);
  const rows = report.itemAxis
    .map((item) => {
      const demandPct = (item.demand / maxBase) * 100;
      const stockPct = (item.stock / maxBase) * 100;
      return `
              <div class="bar-row">
                <div class="bar-label">${escapeHtml(item.name)}</div>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${demandPct}%;background:linear-gradient(90deg, ${escapeHtml(report.accent)}, ${escapeHtml(report.accent)}bb);"></div>
                  <div class="bar-marker" style="left:calc(${stockPct}% - 1px);"></div>
                </div>
                <div class="bar-value">${item.demand}</div>
              </div>
            `;
    })
    .join('');
  return `
        <div class="bars">
          ${rows}
        </div>
        <div class="panel-note">色帯=需要、黒線=使える在庫。需要帯が在庫線を超えるほど不足寄り。</div>
      `;
}

function renderFlowBars(report: LoanReportViewModel): string {
  const maxBorrowed = Math.max(...report.personAxis.map((person) => person.borrowed), 1);
  const maxReturned = Math.max(...report.personAxis.map((person) => person.returned), 1);
  const maxOpen = Math.max(...report.personAxis.map((person) => person.open), 1);
  const maxOverdue = Math.max(...report.personAxis.map((person) => person.overdue), 1);
  const rows = report.personAxis
    .map((person) => {
      const openOnTime = Math.max(0, person.open - person.overdue);
      return `
              <div class="flow-row">
                <div class="flow-label">${escapeHtml(person.name)}</div>
                <div class="flow-metrics">
                  <div class="flow-metric">
                    <div class="flow-k">持出</div>
                    <div class="flow-track"><span class="flow-fill" style="width:${(person.borrowed / maxBorrowed) * 100}%;background:${escapeHtml(report.accent)};"></span></div>
                    <div class="flow-val">${person.borrowed}</div>
                  </div>
                  <div class="flow-metric">
                    <div class="flow-k">返却</div>
                    <div class="flow-track"><span class="flow-fill" style="width:${(person.returned / maxReturned) * 100}%;background:#0d9488;"></span></div>
                    <div class="flow-val">${person.returned}</div>
                  </div>
                  <div class="flow-metric">
                    <div class="flow-k">未返却</div>
                    <div class="flow-track"><span class="flow-fill" style="width:${(openOnTime / maxOpen) * 100}%;background:#2563eb;"></span></div>
                    <div class="flow-val">${openOnTime}</div>
                  </div>
                  <div class="flow-metric">
                    <div class="flow-k">超過</div>
                    <div class="flow-track"><span class="flow-fill" style="width:${(person.overdue / maxOverdue) * 100}%;background:#dc2626;"></span></div>
                    <div class="flow-val">${person.overdue}</div>
                  </div>
                </div>
              </div>
            `;
    })
    .join('');
  return `
        <div class="flow-stack">
          ${rows}
        </div>
        <div class="panel-note">借用者ごとの実件数。持出・返却・未返却・超過を別バーで表示し、推定配分は行いません。</div>
      `;
}

function renderHeatmap(report: LoanReportViewModel): string {
  const cols = Math.max(1, report.cross.x.length);
  const rows = Math.max(1, report.cross.y.length);
  const flat = report.cross.values.flat();
  const maxVal = Math.max(...flat, 1);
  const base = report.accent;
  let html = `<div class="heatmap" style="grid-template-columns: 22mm repeat(${cols}, 1fr); grid-template-rows: 8mm repeat(${rows}, 1fr);">`;
  html += '<div></div>';
  for (const x of report.cross.x) {
    html += `<div class="hm-head">${escapeHtml(x)}</div>`;
  }
  report.cross.y.forEach((y, r) => {
    html += `<div class="hm-side">${escapeHtml(y)}</div>`;
    const row = report.cross.values[r] ?? [];
    for (let c = 0; c < report.cross.x.length; c += 1) {
      const v = row[c] ?? 0;
      const alpha = 0.12 + 0.75 * (v / maxVal);
      html += `<div class="hm-cell" style="background:${mixHexWithWhite(base, alpha)}">${v}</div>`;
    }
  });
  html += '</div>';
  html += '<div class="panel-note">濃いほど人×物の接点が強く、需給・運用ルールの両面で影響が出やすい交点。</div>';
  return html;
}

function renderTrend(report: LoanReportViewModel): string {
  const demand = report.trend.demand;
  const compliance = report.trend.compliance;
  const labels = report.trend.labels;
  const W = 390;
  const H = 125;
  const P = { t: 12, r: 12, b: 20, l: 24 };
  const iW = W - P.l - P.r;
  const iH = H - P.t - P.b;
  const demandMax = Math.max(...demand, 1) * 1.05;
  const xAt = (i: number) => P.l + (i / Math.max(1, demand.length - 1)) * iW;
  const yDemand = (v: number) => P.t + iH - (v / demandMax) * iH;
  const yComp = (v: number) => P.t + iH - (v / 100) * iH;
  let svg = '';
  for (let i = 0; i <= 4; i += 1) {
    const yy = P.t + (iH / 4) * i;
    svg += `<line x1="${P.l}" x2="${P.l + iW}" y1="${yy}" y2="${yy}" stroke="#e2e8f0" stroke-dasharray="2 2"/>`;
  }
  const p1 = demand.map((v, i) => `${xAt(i)},${yDemand(v)}`).join(' ');
  const p2 = compliance.map((v, i) => `${xAt(i)},${yComp(v)}`).join(' ');
  svg += `<polyline fill="none" stroke="${escapeHtml(report.accent)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${p1}"/>`;
  svg += `<polyline fill="none" stroke="#0d9488" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${p2}"/>`;
  demand.forEach((v, i) => {
    svg += `<circle cx="${xAt(i)}" cy="${yDemand(v)}" r="2.1" fill="${escapeHtml(report.accent)}" stroke="#fff" stroke-width="0.8"/>`;
    svg += `<circle cx="${xAt(i)}" cy="${yComp(compliance[i] ?? 0)}" r="2.1" fill="#0d9488" stroke="#fff" stroke-width="0.8"/>`;
  });
  labels.forEach((label, i) => {
    svg += `<text x="${xAt(i)}" y="${H - 4}" text-anchor="middle" font-size="6" fill="#94a3b8" font-family="var(--num)">${escapeHtml(label)}</text>`;
  });
  svg += `<rect x="${W - 76}" y="8" width="4" height="4" rx="1" fill="${escapeHtml(report.accent)}"/><text x="${W - 69}" y="11.6" font-size="6" fill="#475569" font-family="var(--sans)">持出件数</text>`;
  svg += `<rect x="${W - 38}" y="8" width="4" height="4" rx="1" fill="#0d9488"/><text x="${W - 31}" y="11.6" font-size="6" fill="#475569" font-family="var(--sans)">返却率</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" aria-hidden="true">${svg}</svg><div class="panel-note">月別の持出件数と返却完了率の実測推移です。</div>`;
}

function pageHtml(report: LoanReportViewModel): string {
  return `
        <article class="page">
          <header class="header">
            <div class="title-row">
              <h1>持出返却レポート</h1>
              <span class="cat-badge" style="background:${escapeHtml(report.accent)}">${escapeHtml(report.category)}</span>
            </div>
            <div class="meta">
              <div class="id">${escapeHtml(report.reportId)}</div>
              <div>${escapeHtml(report.meta)}</div>
            </div>
          </header>

          ${renderMetricStrip(report.metrics)}

          <section class="eval-grid">
            <div class="hero-card">
              <div class="card-head">
                <h2>足りているか / 余っているか</h2>
                <span class="tiny-tag ${escapeHtml(report.supply.tagClass)}">${escapeHtml(report.supply.state)}</span>
              </div>
              <div class="hero-body">
                ${renderSupplyScale(report)}
              </div>
              ${renderChips(report.supply.chips)}
            </div>

            <div class="hero-card">
              <div class="card-head">
                <h2>持出返却ルールが守られているか</h2>
                <span class="tiny-tag ${escapeHtml(report.compliance.tagClass)}">${escapeHtml(report.compliance.state)}</span>
              </div>
              <div class="hero-body">
                ${renderComplianceGauge(report)}
              </div>
              ${renderChips(report.compliance.chips)}
            </div>
          </section>

          <div class="divider"><h2>アイテム軸 / 人軸 / 両軸</h2></div>

          <section class="analysis-grid">
            <section class="panel">
              <div class="card-head"><h3>アイテム軸 · 需要と在庫のギャップ</h3><span class="tiny-tag ${escapeHtml(report.supply.tagClass)}">供給</span></div>
              <div class="panel-body">
                ${renderItemBars(report)}
              </div>
            </section>

            <section class="panel">
              <div class="card-head"><h3>人軸 · 借用者別の実件数</h3><span class="tiny-tag ${escapeHtml(report.compliance.tagClass)}">遵守</span></div>
              <div class="panel-body">
                ${renderFlowBars(report)}
              </div>
            </section>

            <section class="panel">
              <div class="card-head"><h3>両軸 · 人×物の集中ヒート</h3><span class="tiny-tag ${escapeHtml(report.supply.tagClass)}">交点</span></div>
              <div class="panel-body">
                ${renderHeatmap(report)}
              </div>
            </section>

            <section class="panel">
              <div class="card-head"><h3>時系列 · 持出件数と返却完了率</h3><span class="tiny-tag ${escapeHtml(report.findings.trend.cls)}">${escapeHtml(report.findings.trend.text)}</span></div>
              <div class="panel-body">
                ${renderTrend(report)}
              </div>
            </section>
          </section>

          <section class="findings">
            <div class="head">
              <span class="dot" style="background:${escapeHtml(report.accent)}"></span>
              <h2>所見・総括</h2>
            </div>
            <div class="verdicts">
              <span class="verdict ${escapeHtml(report.findings.overall.cls)}"><strong>総合</strong>${escapeHtml(report.findings.overall.text)}</span>
              <span class="verdict ${escapeHtml(report.findings.trend.cls)}"><strong>傾向</strong>${escapeHtml(report.findings.trend.text)}</span>
            </div>
            <div class="body">${escapeHtml(report.findings.body)}</div>
          </section>

          <footer class="footer">
            <span>Generated by Admin Console</span>
            <span>${escapeHtml(report.pageLabel)}</span>
          </footer>
        </article>
      `;
}

export class LoanReportHtmlRenderer {
  renderDocument(report: LoanReportViewModel): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(report.category)} 持出返却レポート</title>
  <style>
${REPORT_STYLES}
  </style>
</head>
<body>
  <div class="pages">
    ${pageHtml(report)}
  </div>
</body>
</html>`;
  }
}
