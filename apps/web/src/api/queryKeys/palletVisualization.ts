export const palletVisualizationQueryKeys = {
  boardAll: ['tools-pallet-viz-board'] as const,
  kioskBoard: (clientKey: string | undefined) => ['kiosk-pallet-viz-board', clientKey] as const,
};
