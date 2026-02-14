import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';

import type { TableVisualizationData } from '../src/services/visualization/visualization.types.js';
import {
  createMd3Tokens,
  renderCssVars,
  tokensToCssVars,
} from '../src/services/visualization/renderers/_design-system/index.js';
import { computeSplitPaneGeometry } from '../src/services/signage/signage-layout-math.js';
import { UninspectedMachinesRenderer } from '../src/services/visualization/renderers/uninspected-machines/uninspected-machines-renderer.js';

type PreviewConfig = {
  width: number;
  height: number;
};

function repoRootFromCwd(cwd: string): string {
  // Expected cwd: .../apps/api
  return path.resolve(cwd, '..', '..');
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function sampleUninspectedTable(): TableVisualizationData {
  const machineTypes = ['NC旋盤', 'マシニング', 'フライス', '研削盤', 'ボール盤', '旋盤'];
  const suffixes = ['A型', 'B型', 'C型', 'D型', 'E型', 'F型', 'G型', 'H型', 'I型', 'J型'];
  
  const rows = [];
  for (let i = 1; i <= 49; i++) {
    const machineNum = `M-${String(i).padStart(3, '0')}`;
    const typeIndex = (i - 1) % machineTypes.length;
    const suffixIndex = Math.floor((i - 1) / machineTypes.length) % suffixes.length;
    const machineName = `${machineTypes[typeIndex]} ${suffixes[suffixIndex]}`;
    
    // 点検結果の生成（バリエーションを持たせる）
    let inspectionResult: string;
    if (i % 7 === 0) {
      inspectionResult = '未使用';
    } else if (i % 5 === 0) {
      const abnormal = Math.floor(Math.random() * 3) + 1;
      const normal = Math.floor(Math.random() * 10) + 1;
      inspectionResult = `正常${normal}/異常${abnormal}`;
    } else {
      const normal = Math.floor(Math.random() * 15) + 1;
      inspectionResult = `正常${normal}/異常0`;
    }
    
    rows.push({
      設備管理番号: machineNum,
      加工機名称: machineName,
      点検結果: inspectionResult,
    });
  }
  
  return {
    kind: 'table',
    columns: ['設備管理番号', '加工機名称', '点検結果'],
    rows,
    metadata: {
      date: '2026-02-13',
      totalRunningMachines: 49,
      inspectedRunningCount: 25,
      uninspectedCount: 24,
    },
  };
}

function buildHtmlPreview(tokensCss: string): string {
  // NOTE:
  // - HTML preview uses CSS vars generated from MD3 tokens.
  // - It is still not identical to server-side SVG->JPEG because of font rendering,
  //   but the intention is to align design decisions on the same token source.
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Design Preview (MD3 tokens)</title>
  <style>
${tokensCss}

    :root {
      --bg: var(--rps-md3-color-surface-background);
      --panel: var(--rps-md3-color-surface-container);
      --panelHigh: var(--rps-md3-color-surface-container-high);
      --text: var(--rps-md3-color-text-primary);
      --muted: var(--rps-md3-color-text-secondary);
      --grid: var(--rps-md3-color-grid);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, 'Noto Sans JP', 'Roboto', sans-serif;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      padding: var(--rps-md3-spacing-md);
    }

    h1 {
      margin: 0 0 var(--rps-md3-spacing-md) 0;
      font-size: var(--rps-md3-typography-title-size);
      font-weight: 700;
    }

    .kpiRow {
      display: flex;
      gap: var(--rps-md3-spacing-md);
      margin-bottom: var(--rps-md3-spacing-md);
      width: 50%;
    }
    .kpiCard {
      flex: 1;
      background: var(--panel);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--rps-md3-shape-radius-lg);
      padding: var(--rps-md3-spacing-lg);
    }
    .kpiLabel {
      color: var(--muted);
      font-size: 16px;
      font-weight: 600;
    }
    .kpiValue {
      margin-top: 10px;
      font-size: 34px;
      font-weight: 800;
    }
    .kpiValueSuccess { color: var(--rps-md3-color-status-success); }
    .kpiValueError { color: var(--rps-md3-color-status-error); }

    .tables {
      display: flex;
      gap: var(--rps-md3-spacing-md);
    }
    .panel {
      flex: 1;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--rps-md3-shape-radius-lg);
      overflow: hidden;
      background: var(--panelHigh);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead th {
      text-align: left;
      padding: 14px 16px;
      font-size: 15.75px;
      color: var(--text);
      background: var(--panelHigh);
      border-bottom: 1px solid rgba(255,255,255,0.10);
    }
    tbody tr:nth-child(even) { background: var(--panel); }
    tbody td {
      padding: 14px 16px;
      font-size: 31.5px;
      color: var(--text);
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .chip {
      display: inline-block;
      padding: 4px 8px;
      border-radius: var(--rps-md3-shape-radius-sm);
      font-weight: 600;
    }
    .chipNormal {
      background: var(--rps-md3-color-status-success-container);
      color: var(--rps-md3-color-status-on-success-container);
    }
    .chipAbnormal {
      background: var(--rps-md3-color-status-error-container);
      color: var(--rps-md3-color-status-on-error-container);
    }
    .chipInfo {
      background: var(--rps-md3-color-status-info-container);
      color: var(--rps-md3-color-status-on-info-container);
    }
  </style>
</head>
<body>
  <h1>加工機点検状況</h1>
  <div class="kpiRow">
    <div class="kpiCard"><div class="kpiLabel">対象日</div><div class="kpiValue" style="color:var(--muted)">2026-02-13</div></div>
    <div class="kpiCard"><div class="kpiLabel">稼働中</div><div class="kpiValue">49</div></div>
    <div class="kpiCard"><div class="kpiLabel">点検済み</div><div class="kpiValue kpiValueSuccess">25</div></div>
    <div class="kpiCard"><div class="kpiLabel">未点検</div><div class="kpiValue kpiValueError">24</div></div>
  </div>

  <div class="tables">
    <div class="panel">
      <table>
        <thead><tr><th>設備管理番号</th><th>加工機名称</th><th>点検結果</th></tr></thead>
        <tbody>
          <tr><td>M-001</td><td>NC旋盤 A型</td><td><span class="chip chipInfo">正常12/異常0</span></td></tr>
          <tr><td>M-002</td><td>NC旋盤 B型</td><td><span class="chip chipInfo">正常8/異常0</span></td></tr>
          <tr><td>M-003</td><td>マシニング C型</td><td><span class="chip chipAbnormal">正常5/異常1</span></td></tr>
          <tr><td>M-004</td><td>フライス D型</td><td>未使用</td></tr>
          <tr><td>M-005</td><td>研削盤 E型</td><td><span class="chip chipInfo">正常3/異常0</span></td></tr>
          <tr><td>M-006</td><td>ボール盤 F型</td><td><span class="chip chipAbnormal">正常0/異常2</span></td></tr>
        </tbody>
      </table>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>設備管理番号</th><th>加工機名称</th><th>点検結果</th></tr></thead>
        <tbody>
          <tr><td>M-007</td><td>旋盤 G型</td><td><span class="chip chipInfo">正常10/異常0</span></td></tr>
          <tr><td>M-008</td><td>旋盤 H型</td><td>未使用</td></tr>
          <tr><td>M-009</td><td>研削盤 I型</td><td><span class="chip chipAbnormal">正常2/異常1</span></td></tr>
          <tr><td>M-010</td><td>研削盤 J型</td><td><span class="chip chipInfo">正常6/異常0</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
`;
}

function buildSplitCompositeSvg(options: {
  width: number;
  height: number;
  leftTitle: string;
  rightTitle: string;
  leftImageBase64?: string | null;
  rightImageBase64?: string | null;
}): string {
  const t = createMd3Tokens({ width: options.width, height: options.height });
  const g = computeSplitPaneGeometry({ width: options.width, height: options.height });

  const contentY = g.outerPadding + g.innerPadding + g.headerHeight;
  const imageHeight = g.panelHeight - g.innerPadding * 2 - g.headerHeight;

  const leftImage = options.leftImageBase64
    ? `<image x="${g.leftX + g.innerPadding}" y="${contentY}" width="${g.leftWidth - g.innerPadding * 2}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" href="${options.leftImageBase64}" />`
    : `<text x="${g.leftX + g.leftWidth / 2}" y="${g.outerPadding + g.panelHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(18, Math.round(22 * g.scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">LEFT PANE (placeholder)</text>`;

  const rightImage = options.rightImageBase64
    ? `<image x="${g.rightX + g.innerPadding}" y="${contentY}" width="${g.rightWidth - g.innerPadding * 2}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" href="${options.rightImageBase64}" />`
    : `<text x="${g.rightX + g.rightWidth / 2}" y="${g.outerPadding + g.panelHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(18, Math.round(22 * g.scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">RIGHT PANE (placeholder)</text>`;

  const titleY = g.outerPadding + g.innerPadding + Math.round(22 * g.scale);

  return `
    <svg width="${options.width}" height="${options.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
      <g>
        <rect x="${g.leftX}" y="${g.outerPadding}" width="${g.leftWidth}" height="${g.panelHeight}"
          rx="${Math.round(10 * g.scale)}" ry="${Math.round(10 * g.scale)}"
          fill="${t.colors.surface.container}" stroke="rgba(255,255,255,0.08)" />
        <text x="${g.leftX + g.innerPadding}" y="${titleY}"
          font-size="${Math.max(16, Math.round(20 * g.scale))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${options.leftTitle}
        </text>
        ${leftImage}
      </g>
      <g>
        <rect x="${g.rightX}" y="${g.outerPadding}" width="${g.rightWidth}" height="${g.panelHeight}"
          rx="${Math.round(10 * g.scale)}" ry="${Math.round(10 * g.scale)}"
          fill="${t.colors.surface.container}" stroke="rgba(255,255,255,0.08)" />
        <text x="${g.rightX + g.innerPadding}" y="${titleY}"
          font-size="${Math.max(16, Math.round(20 * g.scale))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${options.rightTitle}
        </text>
        ${rightImage}
      </g>
    </svg>
  `;
}

async function writeBuffer(filePath: string, buffer: Buffer): Promise<void> {
  await fs.writeFile(filePath, buffer);
}

async function main(): Promise<void> {
  const repoRoot = repoRootFromCwd(process.cwd());
  const outDir = path.join(repoRoot, 'tmp', 'design-preview');
  await ensureDir(outDir);

  const full: PreviewConfig = { width: 1920, height: 1080 };
  const g = computeSplitPaneGeometry(full);

  const fullTokens = createMd3Tokens(full);
  const cssVars = tokensToCssVars(fullTokens);
  const tokensCss = renderCssVars(':root', cssVars);

  const htmlPreviewPath = path.join(outDir, 'html-preview.html');
  await fs.writeFile(htmlPreviewPath, buildHtmlPreview(tokensCss), 'utf8');

  const renderer = new UninspectedMachinesRenderer();
  const table = sampleUninspectedTable();

  const fullOut = await renderer.render(table, {
    width: full.width,
    height: full.height,
    title: '加工機点検状況',
  });
  const vizFullPath = path.join(outDir, 'viz-full.jpg');
  await writeBuffer(vizFullPath, fullOut.buffer);

  const paneOut = await renderer.render(table, {
    width: g.rightPaneContentWidth,
    height: g.paneContentHeight,
    title: '加工機点検状況 (pane)',
  });
  const vizPanePath = path.join(outDir, 'viz-pane.jpg');
  await writeBuffer(vizPanePath, paneOut.buffer);

  const rightImageBase64 = `data:image/jpeg;base64,${paneOut.buffer.toString('base64')}`;
  const splitSvg = buildSplitCompositeSvg({
    width: full.width,
    height: full.height,
    leftTitle: 'LEFT (placeholder)',
    rightTitle: 'RIGHT (uninspected_machines @ pane size)',
    leftImageBase64: null,
    rightImageBase64,
  });
  const signageSplitJpg = await sharp(Buffer.from(splitSvg))
    .resize(full.width, full.height, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const splitPath = path.join(outDir, 'signage-split.jpg');
  await writeBuffer(splitPath, signageSplitJpg);

  // カード形式のSVG出力を生成
  const cardFullOut = await renderer.render(table, {
    width: full.width,
    height: full.height,
    title: '加工機点検状況',
  });
  const vizCardFullPath = path.join(outDir, 'viz-card-full.jpg');
  await writeBuffer(vizCardFullPath, cardFullOut.buffer);

  const cardPaneOut = await renderer.render(table, {
    width: g.rightPaneContentWidth,
    height: g.paneContentHeight,
    title: '加工機点検状況 (pane)',
  });
  const vizCardPanePath = path.join(outDir, 'viz-card-pane.jpg');
  await writeBuffer(vizCardPanePath, cardPaneOut.buffer);

  const cardRightImageBase64 = `data:image/jpeg;base64,${cardPaneOut.buffer.toString('base64')}`;
  const cardSplitSvg = buildSplitCompositeSvg({
    width: full.width,
    height: full.height,
    leftTitle: 'LEFT (placeholder)',
    rightTitle: 'RIGHT (uninspected_machines card layout @ pane size)',
    leftImageBase64: null,
    rightImageBase64: cardRightImageBase64,
  });
  const cardSignageSplitJpg = await sharp(Buffer.from(cardSplitSvg))
    .resize(full.width, full.height, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const cardSplitPath = path.join(outDir, 'signage-card-split.jpg');
  await writeBuffer(cardSplitPath, cardSignageSplitJpg);

  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Design Alignment Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; }
    .title { font-size: 16px; font-weight: 700; margin: 0 0 10px 0; }
    .note { color: #444; font-size: 13px; margin: 8px 0 0 0; }
    img { width: 100%; height: auto; border-radius: 8px; background: #000; }
    iframe { width: 100%; height: 560px; border: 0; border-radius: 8px; }
    code { background: #f6f6f6; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Design Alignment Preview</h1>
  <p>出力先: <code>${outDir}</code></p>
  <p class="note">目的: HTML(事前合意) と SVG→JPEG(実装) と サイネージSPLIT(実機経路) を同じトークン前提で並べて差分要因を見える化する。</p>
  <div class="grid">
    <div class="card">
      <div class="title">HTML preview (1920x1080 fixed)</div>
      <iframe src="./html-preview.html"></iframe>
      <p class="note">CSS vars are generated from MD3 tokens (server-side).</p>
    </div>
    <div class="card">
      <div class="title">SVG renderer output (FULL ${full.width}x${full.height})</div>
      <img src="./viz-full.jpg" alt="viz full" />
      <p class="note">Rendered by <code>UninspectedMachinesRenderer</code> on server-side.</p>
    </div>
    <div class="card">
      <div class="title">SVG renderer output (pane ${g.rightPaneContentWidth}x${g.paneContentHeight})</div>
      <img src="./viz-pane.jpg" alt="viz pane" />
      <p class="note">Simulates SPLIT pane rendering (font scale changes).</p>
    </div>
    <div class="card">
      <div class="title">Signage SPLIT composite preview (${full.width}x${full.height})</div>
      <img src="./signage-split.jpg" alt="signage split" />
      <p class="note">Uses <code>computeSplitPaneGeometry</code> to match SPLIT geometry.</p>
    </div>
    <div class="card">
      <div class="title">カード形式 SVG renderer output (FULL ${full.width}x${full.height})</div>
      <img src="./viz-card-full.jpg" alt="viz card full" />
      <p class="note">カード形式のSVGレンダラー出力（4列グリッド、49件表示）。</p>
    </div>
    <div class="card">
      <div class="title">カード形式 SVG renderer output (pane ${g.rightPaneContentWidth}x${g.paneContentHeight})</div>
      <img src="./viz-card-pane.jpg" alt="viz card pane" />
      <p class="note">SPLIT paneサイズでのカード形式SVGレンダラー出力。</p>
    </div>
    <div class="card">
      <div class="title">カード形式 Signage SPLIT composite preview (${full.width}x${full.height})</div>
      <img src="./signage-card-split.jpg" alt="signage card split" />
      <p class="note">SPLITレイアウトでのカード形式SVGレンダラー出力（右側パネル）。</p>
    </div>
  </div>
</body>
</html>
`;
  await fs.writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');

  const summary = {
    outDir,
    full,
    pane: { width: g.rightPaneContentWidth, height: g.paneContentHeight },
    files: {
      index: 'tmp/design-preview/index.html',
      html: 'tmp/design-preview/html-preview.html',
      vizFull: 'tmp/design-preview/viz-full.jpg',
      vizPane: 'tmp/design-preview/viz-pane.jpg',
      signageSplit: 'tmp/design-preview/signage-split.jpg',
    },
  };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Design preview generated: ${path.join(outDir, 'index.html')}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

