// Rects and pointer coordinates are visual pixels; style lengths and scrolling use layout CSS pixels.
export function pageZoom(): number {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}
