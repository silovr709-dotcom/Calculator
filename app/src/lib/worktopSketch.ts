import type { WorktopEdgeKind, WorktopPiece } from '../types';

export type WorktopSketchLayoutMode = 'line' | 'corner' | 'u';
export type WorktopEdgeSide = 'front' | 'back' | 'left' | 'right';

export const WORKTOP_EDGE_SYMBOLS: Record<WorktopEdgeKind, string> = {
  pvc: 'Х',
  v: 'V',
  pf: 'ПФ',
  eurozapil: '//',
  eurostyk: '≈',
};

export const WORKTOP_EDGE_SHORT_LABELS: Record<WorktopEdgeKind, string> = {
  pvc: 'кромка ПВХ',
  v: 'кромка в цвет',
  pf: 'постформинг',
  eurozapil: 'еврозапил',
  eurostyk: 'евростык',
};

export const WORKTOP_EDGE_CYCLE: (WorktopEdgeKind | null)[] = [null, 'pvc', 'v', 'pf', 'eurozapil', 'eurostyk'];

export interface WorktopSketchPieceLayout {
  piece: WorktopPiece;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}

export interface WorktopSketchMetrics {
  layouts: WorktopSketchPieceLayout[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  contentWidth: number;
  contentHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  widthPx: number;
  heightPx: number;
}

export interface WorktopSketchOptions {
  widthPx: number;
  heightPx: number;
  showLegend?: boolean;
  title?: string;
}

export interface WorktopSnapResult {
  x: number;
  y: number;
  snapX?: 'left' | 'center' | 'right';
  snapY?: 'top' | 'center' | 'bottom';
}

export interface WorktopSketchPng {
  base64: string;
  extension: 'png';
  width?: number;
  height?: number;
}

const xml = (value: string | number | null | undefined): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const num = (value: number | null | undefined, fallback: number) => Number.isFinite(value) && value && value > 0 ? value : fallback;
const pos = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : null;

export function worktopEdgeSymbol(kind: WorktopEdgeKind | null | undefined): string {
  return kind ? WORKTOP_EDGE_SYMBOLS[kind] ?? kind : '';
}

export function nextWorktopEdgeKind(kind: WorktopEdgeKind | null | undefined): WorktopEdgeKind | null {
  const index = WORKTOP_EDGE_CYCLE.indexOf(kind ?? null);
  return WORKTOP_EDGE_CYCLE[(index + 1) % WORKTOP_EDGE_CYCLE.length];
}

export function worktopPieceVisualSize(piece: WorktopPiece): { width: number; height: number; rotated: boolean } {
  const length = num(piece.lengthMm, 1200);
  const width = num(piece.widthMm, 600);
  const rotated = Boolean(piece.rotated);
  return { width: rotated ? width : length, height: rotated ? length : width, rotated };
}

export function layoutWorktopPieces(pieces: WorktopPiece[]): WorktopSketchPieceLayout[] {
  let cursorX = 0;
  return pieces.map((piece) => {
    const size = worktopPieceVisualSize(piece);
    const x = pos(piece.layoutXmm) ?? cursorX;
    const y = pos(piece.layoutYmm) ?? 0;
    if (piece.layoutXmm == null) cursorX += size.width + 90;
    return { piece, x, y, width: size.width, height: size.height, rotated: size.rotated };
  });
}

function roundLayoutMm(value: number) {
  return Math.round(value / 10) * 10;
}

export function snapWorktopPiecePosition(layouts: WorktopSketchPieceLayout[], pieceId: string, x: number, y: number, thresholdMm = 45): WorktopSnapResult {
  const moving = layouts.find((layout) => layout.piece.id === pieceId);
  if (!moving) return { x: roundLayoutMm(Math.max(0, x)), y: roundLayoutMm(Math.max(0, y)) };
  let bestDx = 0;
  let bestDy = 0;
  let bestX = thresholdMm + 1;
  let bestY = thresholdMm + 1;
  let snapX: WorktopSnapResult['snapX'];
  let snapY: WorktopSnapResult['snapY'];
  const movingX = [
    { edge: 'left' as const, value: x, offset: 0 },
    { edge: 'center' as const, value: x + moving.width / 2, offset: moving.width / 2 },
    { edge: 'right' as const, value: x + moving.width, offset: moving.width },
  ];
  const movingY = [
    { edge: 'top' as const, value: y, offset: 0 },
    { edge: 'center' as const, value: y + moving.height / 2, offset: moving.height / 2 },
    { edge: 'bottom' as const, value: y + moving.height, offset: moving.height },
  ];
  const targetX = [0, ...layouts.filter((layout) => layout.piece.id !== pieceId).flatMap((layout) => [layout.x, layout.x + layout.width / 2, layout.x + layout.width])];
  const targetY = [0, ...layouts.filter((layout) => layout.piece.id !== pieceId).flatMap((layout) => [layout.y, layout.y + layout.height / 2, layout.y + layout.height])];
  for (const source of movingX) {
    for (const target of targetX) {
      const distance = Math.abs(source.value - target);
      if (distance <= thresholdMm && distance < bestX) {
        bestX = distance;
        bestDx = target - source.value;
        snapX = source.edge;
      }
    }
  }
  for (const source of movingY) {
    for (const target of targetY) {
      const distance = Math.abs(source.value - target);
      if (distance <= thresholdMm && distance < bestY) {
        bestY = distance;
        bestDy = target - source.value;
        snapY = source.edge;
      }
    }
  }
  return {
    x: roundLayoutMm(Math.max(0, x + bestDx)),
    y: roundLayoutMm(Math.max(0, y + bestDy)),
    ...(snapX ? { snapX } : {}),
    ...(snapY ? { snapY } : {}),
  };
}


export interface WorktopScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface WorktopLabelPlacement {
  x: number;
  y: number;
  rotate?: number;
}

export interface WorktopDimensionPlacement {
  horizontalValue: number | null | undefined;
  horizontal: WorktopLabelPlacement;
  verticalValue: number | null | undefined;
  vertical: WorktopLabelPlacement;
  verticalSide: 'left' | 'right' | 'inside';
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function rangesOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

export function worktopScreenRect(layout: WorktopSketchPieceLayout, metrics: WorktopSketchMetrics): WorktopScreenRect {
  const x = metrics.offsetX + layout.x * metrics.scale;
  const y = metrics.offsetY + layout.y * metrics.scale;
  const width = layout.width * metrics.scale;
  const height = layout.height * metrics.scale;
  return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

export function worktopSideHasNeighbor(layout: WorktopSketchPieceLayout, layouts: WorktopSketchPieceLayout[], side: WorktopEdgeSide, toleranceMm = 35): boolean {
  return layouts.some((other) => {
    if (other.piece.id === layout.piece.id) return false;
    if (side === 'back') {
      return Math.abs((other.y + other.height) - layout.y) <= toleranceMm && rangesOverlap(layout.x, layout.x + layout.width, other.x, other.x + other.width) > 40;
    }
    if (side === 'front') {
      return Math.abs(other.y - (layout.y + layout.height)) <= toleranceMm && rangesOverlap(layout.x, layout.x + layout.width, other.x, other.x + other.width) > 40;
    }
    if (side === 'left') {
      return Math.abs((other.x + other.width) - layout.x) <= toleranceMm && rangesOverlap(layout.y, layout.y + layout.height, other.y, other.y + other.height) > 40;
    }
    return Math.abs(other.x - (layout.x + layout.width)) <= toleranceMm && rangesOverlap(layout.y, layout.y + layout.height, other.y, other.y + other.height) > 40;
  });
}

export function worktopEdgeLabelPlacement(
  layout: WorktopSketchPieceLayout,
  metrics: WorktopSketchMetrics,
  side: WorktopEdgeSide,
  svgWidth = metrics.widthPx,
  svgHeight = metrics.heightPx,
): WorktopLabelPlacement {
  const rect = worktopScreenRect(layout, metrics);
  const joined = worktopSideHasNeighbor(layout, metrics.layouts, side);
  const labelOffset = 20;
  if (side === 'back') {
    const inside = joined || rect.y - labelOffset < 26;
    return { x: clamp(rect.centerX, 26, svgWidth - 26), y: clamp(inside ? rect.y + labelOffset : rect.y - labelOffset, 18, svgHeight - 18), rotate: 0 };
  }
  if (side === 'front') {
    const inside = joined || rect.y + rect.height + labelOffset > svgHeight - 50;
    return { x: clamp(rect.centerX, 26, svgWidth - 26), y: clamp(inside ? rect.y + rect.height - labelOffset : rect.y + rect.height + labelOffset, 18, svgHeight - 18), rotate: 0 };
  }
  if (side === 'left') {
    const inside = joined || rect.x - labelOffset < 26;
    return { x: clamp(inside ? rect.x + labelOffset : rect.x - labelOffset, 18, svgWidth - 18), y: clamp(rect.centerY, 26, svgHeight - 56), rotate: -90 };
  }
  const inside = joined || rect.x + rect.width + labelOffset > svgWidth - 26;
  return { x: clamp(inside ? rect.x + rect.width - labelOffset : rect.x + rect.width + labelOffset, 18, svgWidth - 18), y: clamp(rect.centerY, 26, svgHeight - 56), rotate: 90 };
}

export function worktopDimensionPlacement(
  layout: WorktopSketchPieceLayout,
  metrics: WorktopSketchMetrics,
  svgWidth = metrics.widthPx,
  svgHeight = metrics.heightPx,
): WorktopDimensionPlacement {
  const rect = worktopScreenRect(layout, metrics);
  const topBusy = worktopSideHasNeighbor(layout, metrics.layouts, 'back') || Boolean(layout.piece.back);
  const bottomBusy = worktopSideHasNeighbor(layout, metrics.layouts, 'front') || Boolean(layout.piece.front);
  const horizontalInside = topBusy || rect.y < 52;
  const horizontalY = horizontalInside
    ? (bottomBusy ? rect.y + 24 : rect.y + rect.height + 34 > svgHeight - 50 ? rect.y + 24 : rect.y + rect.height + 24)
    : rect.y - 34;
  const rightBusy = worktopSideHasNeighbor(layout, metrics.layouts, 'right') || Boolean(layout.piece.right);
  const leftBusy = worktopSideHasNeighbor(layout, metrics.layouts, 'left') || Boolean(layout.piece.left);
  let verticalSide: WorktopDimensionPlacement['verticalSide'] = 'right';
  let verticalX = rect.x + rect.width + 52;
  if (rightBusy || verticalX > svgWidth - 46) {
    verticalSide = 'left';
    verticalX = rect.x - 52;
  }
  if (leftBusy || verticalX < 46) {
    verticalSide = 'inside';
    verticalX = rect.x + rect.width - 32;
  }
  return {
    horizontalValue: layout.rotated ? layout.piece.widthMm : layout.piece.lengthMm,
    horizontal: { x: clamp(rect.centerX, 42, svgWidth - 42), y: clamp(horizontalY, 18, svgHeight - 60), rotate: 0 },
    verticalValue: layout.rotated ? layout.piece.lengthMm : layout.piece.widthMm,
    // Вертикальный размер ставим читаемой горизонтальной плашкой рядом со свободной стороной,
    // а не повернутым текстом на стыке — так длинные вертикальные детали не перекрывают соседей.
    vertical: { x: clamp(verticalX, 42, svgWidth - 42), y: clamp(rect.centerY, 32, svgHeight - 62), rotate: 0 },
    verticalSide,
  };
}

export function autoArrangeWorktopPieces(pieces: WorktopPiece[], mode: WorktopSketchLayoutMode): WorktopPiece[] {
  if (pieces.length === 0) return pieces;
  const gap = 80;
  if (mode === 'line') {
    let x = 0;
    return pieces.map((piece) => {
      const length = num(piece.lengthMm, 1200);
      const next = { ...piece, layoutXmm: x, layoutYmm: 0, rotated: false };
      x += length + gap;
      return next;
    });
  }
  if (mode === 'u' && pieces.length >= 3) {
    const first = pieces[0];
    const second = pieces[1];
    const third = pieces[2];
    const leftSize = { width: num(first.widthMm, 600), height: num(first.lengthMm, 1600) };
    const topSize = { width: num(second.lengthMm, 1800), height: num(second.widthMm, 600) };
    const next = pieces.map((piece, index) => {
      if (index === 0) return { ...piece, layoutXmm: 0, layoutYmm: topSize.height + gap, rotated: true };
      if (index === 1) return { ...piece, layoutXmm: leftSize.width + gap, layoutYmm: 0, rotated: false };
      if (index === 2) return { ...piece, layoutXmm: leftSize.width + gap + Math.max(0, topSize.width - num(third.widthMm, 600)), layoutYmm: topSize.height + gap, rotated: true };
      return { ...piece, layoutXmm: leftSize.width + gap + (index - 2) * 240, layoutYmm: topSize.height + gap + leftSize.height + gap, rotated: false };
    });
    return next;
  }
  const base = pieces[0];
  const baseLength = num(base.lengthMm, 1600);
  const baseWidth = num(base.widthMm, 600);
  return pieces.map((piece, index) => {
    if (index === 0) return { ...piece, layoutXmm: 0, layoutYmm: 0, rotated: false };
    if (index === 1) return { ...piece, layoutXmm: Math.max(0, baseLength - num(piece.widthMm, 600)), layoutYmm: baseWidth + gap, rotated: true };
    return { ...piece, layoutXmm: (index - 1) * (num(piece.lengthMm, 1200) + gap), layoutYmm: baseWidth + gap + num(pieces[1]?.lengthMm, 1200) + gap, rotated: false };
  });
}

export function worktopSketchMetrics(pieces: WorktopPiece[], widthPx: number, heightPx: number, showLegend = false): WorktopSketchMetrics {
  const layouts = layoutWorktopPieces(pieces);
  const content = layouts.length > 0 ? layouts : [{ piece: { id: 'empty', name: 'Столешница', lengthMm: 1200, widthMm: 600, front: null, back: null, left: null, right: null }, x: 0, y: 0, width: 1200, height: 600, rotated: false }];
  const minX = Math.min(...content.map((item) => item.x));
  const minY = Math.min(...content.map((item) => item.y));
  const maxX = Math.max(...content.map((item) => item.x + item.width));
  const maxY = Math.max(...content.map((item) => item.y + item.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const pad = 58;
  const legendHeight = showLegend ? 58 : 0;
  const scale = Math.min((widthPx - pad * 2) / contentWidth, (heightPx - pad * 2 - legendHeight) / contentHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offsetX = (widthPx - contentWidth * safeScale) / 2 - minX * safeScale;
  const offsetY = pad - minY * safeScale;
  return { layouts, minX, minY, maxX, maxY, contentWidth, contentHeight, scale: safeScale, offsetX, offsetY, widthPx, heightPx };
}

function edgeLabel(kind: WorktopEdgeKind, x: number, y: number, rotate = 0) {
  const symbol = worktopEdgeSymbol(kind);
  const w = Math.max(24, symbol.length * 8 + 12);
  return `<g transform="translate(${x} ${y}) rotate(${rotate})">
    <rect x="${-w / 2}" y="-12" width="${w}" height="24" rx="6" fill="#fff" stroke="#1f6feb" stroke-width="1.4" />
    <text text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="900" fill="#184f9e">${xml(symbol)}</text>
  </g>`;
}

function dimensionLabel(value: number | null | undefined, placement: WorktopLabelPlacement) {
  if (!value) return '';
  const text = `${value} мм`;
  const w = Math.max(48, text.length * 6.6 + 14);
  return `<g transform="translate(${placement.x} ${placement.y}) rotate(${placement.rotate ?? 0})">
    <rect x="${-w / 2}" y="-10" width="${w}" height="20" rx="5" fill="#ffffff" stroke="#c9d8ea" stroke-width="1" />
    <text text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="800" fill="#111827">${xml(text)}</text>
  </g>`;
}

function edgeLine(x1: number, y1: number, x2: number, y2: number) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1f6feb" stroke-width="3.2" stroke-linecap="round" />`;
}

export function buildWorktopPlanSvg(pieces: WorktopPiece[], options: WorktopSketchOptions): string {
  const width = Math.max(240, Math.round(options.widthPx));
  const height = Math.max(180, Math.round(options.heightPx));
  const showLegend = options.showLegend !== false;
  const metrics = worktopSketchMetrics(pieces, width, height, showLegend);
  const parts = metrics.layouts.map((layout, index) => {
    const p = layout.piece;
    const rect = worktopScreenRect(layout, metrics);
    const name = p.name || `Деталь ${index + 1}`;
    const size = `${p.lengthMm ?? '—'}×${p.widthMm ?? '—'} мм${layout.rotated ? ' · повернута' : ''}`;
    const dim = worktopDimensionPlacement(layout, metrics, width, height);
    const labels = [
      p.back ? edgeLine(rect.x, rect.y, rect.x + rect.width, rect.y) + edgeLabel(p.back, worktopEdgeLabelPlacement(layout, metrics, 'back', width, height).x, worktopEdgeLabelPlacement(layout, metrics, 'back', width, height).y, worktopEdgeLabelPlacement(layout, metrics, 'back', width, height).rotate) : '',
      p.front ? edgeLine(rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height) + edgeLabel(p.front, worktopEdgeLabelPlacement(layout, metrics, 'front', width, height).x, worktopEdgeLabelPlacement(layout, metrics, 'front', width, height).y, worktopEdgeLabelPlacement(layout, metrics, 'front', width, height).rotate) : '',
      p.left ? edgeLine(rect.x, rect.y, rect.x, rect.y + rect.height) + edgeLabel(p.left, worktopEdgeLabelPlacement(layout, metrics, 'left', width, height).x, worktopEdgeLabelPlacement(layout, metrics, 'left', width, height).y, worktopEdgeLabelPlacement(layout, metrics, 'left', width, height).rotate) : '',
      p.right ? edgeLine(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height) + edgeLabel(p.right, worktopEdgeLabelPlacement(layout, metrics, 'right', width, height).x, worktopEdgeLabelPlacement(layout, metrics, 'right', width, height).y, worktopEdgeLabelPlacement(layout, metrics, 'right', width, height).rotate) : '',
    ].join('');
    return `<g>
      <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#ffffff" stroke="#7a8380" stroke-width="1.8" stroke-dasharray="9 6" />
      <text x="${rect.centerX}" y="${rect.centerY - 8}" text-anchor="middle" font-size="13" font-weight="900" fill="#1f2f29">${xml(name)}</text>
      <text x="${rect.centerX}" y="${rect.centerY + 10}" text-anchor="middle" font-size="11" font-weight="700" fill="#55685d">${xml(size)}</text>
      ${dimensionLabel(dim.horizontalValue, dim.horizontal)}
      ${dimensionLabel(dim.verticalValue, dim.vertical)}
      ${labels}
    </g>`;
  }).join('\n');
  const legendY = height - 44;
  const legend = showLegend ? `<g transform="translate(14 ${legendY})">
    <rect x="0" y="0" width="${width - 28}" height="34" rx="8" fill="#f7fbf9" stroke="#d8e5df" />
    <text x="12" y="22" font-size="11" font-weight="900" fill="#24382f">V — кромка в цвет</text>
    <text x="155" y="22" font-size="11" font-weight="900" fill="#24382f">Х — кромка ПВХ</text>
    <text x="292" y="22" font-size="11" font-weight="900" fill="#24382f">ПФ — постформинг</text>
    <text x="448" y="22" font-size="11" font-weight="900" fill="#24382f">// — еврозапил</text>
    <text x="575" y="22" font-size="11" font-weight="900" fill="#24382f">≈ — евростык</text>
  </g>` : '';
  const empty = pieces.length === 0 ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="14" font-weight="800" fill="#81918a">Добавьте деталь столешницы</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    ${options.title ? `<text x="14" y="22" font-size="13" font-weight="900" fill="#24382f">${xml(options.title)}</text>` : ''}
    ${parts}
    ${empty}
    ${legend}
  </svg>`;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Браузер не смог подготовить схему столешницы для экспорта'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function renderWorktopPlanPng(pieces: WorktopPiece[], options: WorktopSketchOptions): Promise<WorktopSketchPng> {
  if (typeof document === 'undefined') throw new Error('Экспорт схемы столешницы доступен только в браузере');
  const width = Math.max(240, Math.round(options.widthPx));
  const height = Math.max(180, Math.round(options.heightPx));
  const svg = buildWorktopPlanSvg(pieces, { ...options, widthPx: width, heightPx: height });
  const image = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог создать canvas для схемы столешницы');
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { base64: canvas.toDataURL('image/png'), extension: 'png', width, height };
}
