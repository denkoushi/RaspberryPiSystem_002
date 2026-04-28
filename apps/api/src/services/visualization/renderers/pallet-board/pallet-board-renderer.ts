import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { PalletBoardVisualizationData, RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens, escapeSvgText } from '../_design-system/index.js';
import { mergeMd3TokensForPalletBoardSignage } from './pallet-board-appearance.js';
import { getPalletCardThumbnailDataUri } from './pallet-card-thumbnail-data-uri.js';
import { resolvePalletMachineIllustrationDataUri } from './pallet-board-illustration-data-uri.js';
import { buildMultiMachinePalletBoardSvg } from './pallet-board-multi-layout.js';
import { buildSingleMachinePalletBoardSvg } from './pallet-board-single-layout.js';

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function buildMessageSvg(message: string, width: number, height: number): string {
  const t = createMd3Tokens({ width, height });
  const fontSize = Math.max(24, Math.round(width / 40));
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-size="${fontSize}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
        ${escapeSvgText(message)}
      </text>
    </svg>
  `;
}

export class PalletBoardRenderer implements Renderer {
  readonly type = 'pallet_visualization_board';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'pallet_board') {
      const svg = buildMessageSvg('データ形式が不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const palletData = data as PalletBoardVisualizationData;
    const width = config.width;
    const height = config.height;
    const tRaw = createMd3Tokens({ width, height });
    const t = mergeMd3TokensForPalletBoardSignage(tRaw);

    const pageIndex = Math.max(0, Math.floor(toNumber(config.pageIndex, 0)));
    const machinesPerPage = Math.max(1, Math.min(12, Math.floor(toNumber(config.machinesPerPage, width < 960 ? 2 : width < 1400 ? 4 : 6))));

    const machines = palletData.machines;
    const totalPages = Math.max(1, Math.ceil(machines.length / machinesPerPage));
    const safePage = Math.min(pageIndex, totalPages - 1);
    const pageMachines = machines.slice(safePage * machinesPerPage, safePage * machinesPerPage + machinesPerPage);

    const title = typeof config.title === 'string' && config.title.trim().length > 0 ? config.title.trim() : 'パレット可視化';
    const subtitle = totalPages > 1 ? `${safePage + 1} / ${totalPages}` : '';

    let svg: string;
    if (pageMachines.length === 0) {
      svg = buildMessageSvg('表示対象の加工機がありません', width, height);
    } else if (pageMachines.length === 1) {
      const machine = pageMachines[0]!;
      const leftPanelImageDataUri = await resolvePalletMachineIllustrationDataUri(machine.illustrationUrl);
      const cardThumbDataUri = getPalletCardThumbnailDataUri();
      svg = buildSingleMachinePalletBoardSvg({
        width,
        height,
        t,
        title,
        subtitle,
        machine,
        leftPanelImageDataUri,
        cardThumbDataUri,
      });
    } else {
      svg = buildMultiMachinePalletBoardSvg({
        width,
        height,
        t,
        title,
        subtitle,
        pageMachines,
      });
    }

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
