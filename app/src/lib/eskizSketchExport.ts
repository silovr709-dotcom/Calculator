import type { EskizCommunicationDistance, EskizCommunicationMarker } from '../types';
import type { EskizCalloutObject, EskizDimensionObject, EskizModuleObject, EskizObject, EskizProject, EskizTextObject } from './eskizPro';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, communicationColor, communicationCompactSizeText, communicationDistanceText, communicationElevationText, communicationSizeText, communicationSocketCount, communicationSwitchCount, communicationVisualScale } from './eskizCommunications';

export type EskizSketchModuleMarkerMode = 'full' | 'compact' | 'hidden';

export interface EskizSketchSvgOptions {
  moduleMarkerMode?: EskizSketchModuleMarkerMode;
  communications?: EskizCommunicationMarker[];
  /** false — не выводить рядом с коммуникациями плашки их габаритов/высот. Линии расстояний остаются. */
  showCommunicationSizeBadges?: boolean;
}

export interface EskizSketchPngOptions extends EskizSketchSvgOptions {
  widthPx: number;
  heightPx: number;
  title?: string;
  subtitle?: string;
  pixelRatio?: number;
  /**
   * card — белая карточка с полями/шапкой для самостоятельного PNG/PDF.
   * none — ровно сам эскиз без внутренних полей; удобно для вставки в ячейки Excel без «паспарту».
   */
  frame?: 'card' | 'none';
}

export interface EskizSketchJpegOptions extends EskizSketchPngOptions {
  quality?: number;
}

export interface EskizSketchDownloadOptions extends EskizSketchSvgOptions {
  widthPx?: number;
  heightPx?: number;
  title?: string;
  subtitle?: string;
  pixelRatio?: number;
  fileName?: string;
}

export interface EskizSketchPdfOptions extends EskizSketchSvgOptions {
  title?: string;
  subtitle?: string;
  fileName?: string;
  orientation?: 'auto' | 'portrait' | 'landscape';
  quality?: number;
}

export interface EskizSketchPng {
  base64: string;
  extension: 'png';
  width: number;
  height: number;
}

export interface EskizSketchJpeg {
  base64: string;
  extension: 'jpg';
  width: number;
  height: number;
}

export interface EskizSketchPdf {
  blob: Blob;
  extension: 'pdf';
  widthPt: number;
  heightPt: number;
}

const xml = (value: string | number | null | undefined): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function wrapLines(text: string, maxChars: number) {
  return text.split('\n').flatMap((source) => {
    if (!source) return [''];
    const words = source.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      } else if (!line) line = word;
      else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  });
}

function imageFilter(project: EskizProject) {
  const display = project.imageDisplay;
  if (!display) return '';
  return ` style="filter: opacity(${display.opacity}) brightness(${display.brightness}) contrast(${display.contrast}) saturate(${display.saturation}) grayscale(${display.grayscale ? 1 : 0});"`;
}

function dimensionLabel(object: EskizDimensionObject) {
  const tolerance = object.tolerance ? ` ±${object.tolerance.replace(/^±\s*/, '')}` : '';
  return `${object.prefix ?? ''}${object.value || '—'}${object.showUnit === false ? '' : ' мм'}${tolerance}${object.suffix ? ` ${object.suffix}` : ''}`;
}

function renderDimension(o: EskizDimensionObject) {
  const x1 = o.x;
  const y1 = o.y;
  const x2 = o.x2;
  const y2 = o.y2;
  const baseMidX = (x1 + x2) / 2;
  const baseMidY = (y1 + y2) / 2;
  const lineAngle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  let readableAngle = lineAngle;
  if (readableAngle > 90) readableAngle -= 180;
  if (readableAngle < -90) readableAngle += 180;
  const textAngle = (o.textOrientation ?? 'parallel') === 'horizontal' ? 0 : readableAngle;
  const label = dimensionLabel(o);
  const approxWidth = Math.max(68, label.length * o.fontSize * .62);
  const tick = 9;
  const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const unitNormalX = -(y2 - y1) / length;
  const unitNormalY = (x2 - x1) / length;
  const offset = o.offset ?? 0;
  const lineX1 = x1 + unitNormalX * offset;
  const lineY1 = y1 + unitNormalY * offset;
  const lineX2 = x2 + unitNormalX * offset;
  const lineY2 = y2 + unitNormalY * offset;
  const midX = baseMidX + unitNormalX * offset;
  const midY = baseMidY + unitNormalY * offset;
  const textShift = o.textPosition === 'above' ? -o.fontSize * .9 : o.textPosition === 'below' ? o.fontSize * .9 : 0;
  const textX = midX + unitNormalX * textShift;
  const textY = midY + unitNormalY * textShift;
  const normalX = unitNormalX * tick;
  const normalY = unitNormalY * tick;
  const extension = offset === 0 ? 0 : Math.sign(offset) * 7;
  const marker = o.arrowStyle === 'tick' ? '' : ` marker-start="url(#${o.arrowStyle === 'closed' ? 'eskizFactoryDimArrowClosed' : 'eskizFactoryDimArrow'})" marker-end="url(#${o.arrowStyle === 'closed' ? 'eskizFactoryDimArrowClosed' : 'eskizFactoryDimArrow'})"`;
  return `<g class="dimension">
    ${offset !== 0 ? `<line x1="${x1}" y1="${y1}" x2="${lineX1 + unitNormalX * extension}" y2="${lineY1 + unitNormalY * extension}" stroke="${xml(o.color)}" stroke-width="${Math.max(1, o.lineWidth * .7)}" opacity=".78" />
    <line x1="${x2}" y1="${y2}" x2="${lineX2 + unitNormalX * extension}" y2="${lineY2 + unitNormalY * extension}" stroke="${xml(o.color)}" stroke-width="${Math.max(1, o.lineWidth * .7)}" opacity=".78" />` : ''}
    <line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" stroke="${xml(o.color)}" stroke-width="${o.lineWidth}"${marker} />
    <line x1="${lineX1 - normalX}" y1="${lineY1 - normalY}" x2="${lineX1 + normalX}" y2="${lineY1 + normalY}" stroke="${xml(o.color)}" stroke-width="${o.lineWidth}" />
    <line x1="${lineX2 - normalX}" y1="${lineY2 - normalY}" x2="${lineX2 + normalX}" y2="${lineY2 + normalY}" stroke="${xml(o.color)}" stroke-width="${o.lineWidth}" />
    <g transform="translate(${textX} ${textY}) rotate(${textAngle})">
      <rect x="${-approxWidth / 2}" y="${-o.fontSize * .72}" width="${approxWidth}" height="${o.fontSize * 1.25}" rx="3" fill="white" opacity=".94" />
      <text text-anchor="middle" dominant-baseline="middle" font-size="${o.fontSize}" font-weight="800" fill="${xml(o.color)}">${xml(label)}</text>
    </g>
  </g>`;
}

function renderModule(o: EskizModuleObject, markerMode: EskizSketchModuleMarkerMode) {
  if (markerMode === 'hidden') return '';
  const color = o.color || '#7c3aed';
  if (markerMode === 'compact') {
    const label = (o.number || 'М').slice(0, 4);
    return `<g class="module compact" transform="translate(${o.x} ${o.y})">
      <circle r="12" fill="${xml(color)}" stroke="#fff" stroke-width="4" />
      <text y="4" text-anchor="middle" font-size="9" font-weight="900" fill="#fff">${xml(label)}</text>
      <title>${xml([o.number, o.description].filter(Boolean).join(' · '))}</title>
    </g>`;
  }
  const sourceLines = [o.number, ...o.description.split('\n').filter(Boolean)];
  const autoWidth = Math.max(72, ...sourceLines.map((text) => text.length * o.fontSize * .6)) + 22;
  const width = o.width ? Math.max(60, o.width) : autoWidth;
  const maxChars = Math.max(2, Math.floor((width - 22) / (o.fontSize * .6)));
  const lines = sourceLines.flatMap((line) => wrapLines(line, maxChars));
  const autoHeight = lines.length * (o.fontSize + 5) + 14;
  const height = Math.max(autoHeight, o.height ?? 0);
  const textBlockHeight = lines.length * (o.fontSize + 5) - 5;
  const textY = Math.max(8, (height - textBlockHeight) / 2);
  return `<g class="module label" transform="translate(${o.x} ${o.y})">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${o.borderRadius ?? 6}" fill="${xml(o.fill ?? 'white')}" fill-opacity="${o.fillOpacity ?? 1}" stroke="${xml(color)}" stroke-width="2" />
    <circle cx="0" cy="0" r="7" fill="${xml(color)}" stroke="#fff" stroke-width="3" />
    ${lines.map((line, index) => `<text x="${width / 2}" y="${textY + index * (o.fontSize + 5)}" dominant-baseline="hanging" text-anchor="middle" font-size="${o.fontSize}" font-weight="${index === 0 ? 800 : 550}" fill="${xml(o.color)}">${xml(line)}</text>`).join('')}
  </g>`;
}

function renderCallout(o: EskizCalloutObject) {
  const sourceLines = o.text.split('\n');
  const autoWidth = Math.max(120, ...sourceLines.map((text) => text.length * o.fontSize * .56)) + 24;
  const width = o.width ? Math.max(70, o.width) : autoWidth;
  const maxChars = Math.max(3, Math.floor((width - 24) / (o.fontSize * .56)));
  const lines = wrapLines(o.text, maxChars);
  const autoHeight = Math.max(48, lines.length * (o.fontSize + 5) + 18);
  const height = Math.max(autoHeight, o.height ?? 0);
  const elbowX = o.x > o.targetX ? o.x - 18 : o.x + width + 18;
  return `<g class="callout label">
    <polyline points="${o.targetX},${o.targetY} ${elbowX},${o.y + height / 2} ${o.x > o.targetX ? o.x : o.x + width},${o.y + height / 2}" fill="none" stroke="${xml(o.color)}" stroke-width="2" />
    <circle cx="${o.targetX}" cy="${o.targetY}" r="5" fill="${xml(o.color)}" />
    <rect x="${o.x}" y="${o.y}" width="${width}" height="${height}" rx="${o.borderRadius ?? 6}" fill="${xml(o.fill ?? '#fff')}" fill-opacity="${o.fillOpacity ?? 1}" stroke="${xml(o.color)}" stroke-width="2" />
    ${lines.map((line, index) => `<text x="${o.x + 12}" y="${o.y + 11 + index * (o.fontSize + 5)}" dominant-baseline="hanging" font-size="${o.fontSize}" font-weight="650" fill="${xml(o.color)}">${xml(line)}</text>`).join('')}
  </g>`;
}

function renderTextObject(o: EskizTextObject) {
  const isComment = o.type === 'comment';
  const isLink = o.type === 'link';
  const sourceLines = o.text.split('\n');
  const autoWidth = Math.max(isComment ? 160 : 100, ...sourceLines.map((text) => text.length * o.fontSize * .56)) + 28;
  const width = o.width ? Math.max(60, o.width) : autoWidth;
  const textInset = isLink ? 37 : 28;
  const maxChars = Math.max(3, Math.floor((width - textInset) / (o.fontSize * .56)));
  const lines = wrapLines(o.text, maxChars);
  const autoHeight = lines.length * (o.fontSize + 5) + 22;
  const height = Math.max(autoHeight, o.height ?? 0);
  return `<g class="text label" transform="translate(${o.x} ${o.y})">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${o.borderRadius ?? 7}" fill="${xml(o.fill ?? (isComment ? '#fff8d8' : 'white'))}" fill-opacity="${o.fillOpacity ?? 1}" stroke="${xml(o.color)}" stroke-width="1.5" />
    ${isLink ? `<text x="13" y="${height / 2 + 5}" text-anchor="middle" font-size="${o.fontSize}" font-weight="900" fill="${xml(o.color)}">↗</text>` : ''}
    ${lines.map((line, index) => `<text x="${isLink ? 31 : 14}" y="${12 + index * (o.fontSize + 5)}" dominant-baseline="hanging" font-size="${o.fontSize}" font-weight="${o.type === 'equipment' ? 750 : 550}" fill="${xml(o.color)}">${xml(line)}</text>`).join('')}
  </g>`;
}

function distanceAnchorPoint(distance: EskizCommunicationDistance, marker: EskizCommunicationMarker, width: number, height: number) {
  if (distance.anchor === 'left') return { x: 0, y: marker.y };
  if (distance.anchor === 'right') return { x: width, y: marker.y };
  if (distance.anchor === 'top') return { x: marker.x, y: 0 };
  if (distance.anchor === 'bottom') return { x: marker.x, y: height };
  return { x: distance.anchorX ?? marker.x + 120, y: distance.anchorY ?? marker.y };
}

function distanceLabelPoint(distance: EskizCommunicationDistance, marker: EskizCommunicationMarker, width: number, height: number) {
  const anchor = distanceAnchorPoint(distance, marker, width, height);
  return {
    x: distance.labelX ?? (marker.x + anchor.x) / 2,
    y: distance.labelY ?? (marker.y + anchor.y) / 2 - 5,
  };
}

function renderCommunicationIcon(marker: EskizCommunicationMarker, active = false) {
  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
  const color = communicationColor(marker);
  const sockets = communicationSocketCount(marker.kind);
  const switches = communicationSwitchCount(marker.kind);
  const frameWidth = sockets > 0 ? Math.max(30, sockets * 18 + 12) : switches > 0 ? Math.max(30, switches * 16 + 12) : 32;
  const scale = communicationVisualScale(marker);
  const socketNodes = sockets > 0 ? `<rect x="${-frameWidth / 2}" y="-14" width="${frameWidth}" height="28" rx="7" fill="#fff" stroke="${xml(color)}" stroke-width="${active ? 3 : 2.2}" />${Array.from({ length: sockets }).map((_, index) => {
    const cx = (index - (sockets - 1) / 2) * 18;
    return `<g transform="translate(${cx} 0)"><circle r="6.2" fill="#eff6ff" stroke="${xml(color)}" stroke-width="1.8" /><circle cx="-2.2" cy="0" r="1.05" fill="${xml(color)}" /><circle cx="2.2" cy="0" r="1.05" fill="${xml(color)}" /></g>`;
  }).join('')}` : '';
  const switchNodes = switches > 0 ? `<rect x="${-frameWidth / 2}" y="-14" width="${frameWidth}" height="28" rx="7" fill="#fff" stroke="${xml(color)}" stroke-width="${active ? 3 : 2.2}" />${Array.from({ length: switches }).map((_, index) => {
    const cx = (index - (switches - 1) / 2) * 16;
    return `<g transform="translate(${cx} 0)"><line x1="-5" y1="5" x2="5" y2="-5" stroke="${xml(color)}" stroke-width="2.4" stroke-linecap="round" /><circle cx="-5" cy="5" r="1.9" fill="${xml(color)}" /><circle cx="5" cy="-5" r="1.9" fill="${xml(color)}" /></g>`;
  }).join('')}` : '';
  const otherNode = sockets === 0 && switches === 0 ? `<circle r="14" fill="#fff" stroke="${xml(color)}" stroke-width="${active ? 3 : 2.4}" /><text y="4" text-anchor="middle" font-size="9" font-weight="900" fill="${xml(color)}">${xml(meta.shortLabel)}</text>` : '';
  return `<g transform="translate(${marker.x} ${marker.y})"><g transform="scale(${scale})"><circle r="${active ? 22 : 18}" fill="${xml(color)}" opacity="${active ? .18 : .1}" />${socketNodes}${switchNodes}${otherNode}</g></g>`;
}

function renderCommunicationMeasureBadges(marker: EskizCommunicationMarker, width: number, height: number, showSizeBadges: boolean) {
  if (!showSizeBadges || marker.showSizeBadge === false) return '';
  const color = communicationColor(marker);
  const values = [communicationCompactSizeText(marker), communicationElevationText(marker)].filter(Boolean);
  if (values.length === 0) return '';
  const scale = communicationVisualScale(marker);
  let y = clamp(marker.y + 20 * scale, 4, Math.max(4, height - values.length * 18 - 4));
  return values.map((value) => {
    const label = String(value);
    const w = Math.max(44, Math.min(130, label.length * 5.8 + 14));
    const x = clamp(marker.x + 18 * scale, 4, Math.max(4, width - w - 4));
    const node = `<g transform="translate(${x} ${y})"><rect width="${w}" height="16" rx="8" fill="#fff" stroke="${xml(color)}" stroke-width="1.2" fill-opacity=".96" /><text x="${w / 2}" y="11.5" text-anchor="middle" font-size="9" font-weight="850" fill="${xml(color)}">${xml(label)}</text></g>`;
    y += 18;
    return node;
  }).join('');
}

function renderCommunication(marker: EskizCommunicationMarker, width: number, height: number, showSizeBadges: boolean) {
  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
  const color = communicationColor(marker);
  const size = showSizeBadges && marker.showSizeBadge !== false ? communicationSizeText(marker) : '';
  const distances = marker.distances ?? [];
  return `<g class="communication">
    <title>${xml([marker.name || meta.label, size, marker.note].filter(Boolean).join(' · '))}</title>
    ${distances.map((distance) => {
      const anchor = distanceAnchorPoint(distance, marker, width, height);
      const labelPoint = distanceLabelPoint(distance, marker, width, height);
      const text = `${distance.label || COMMUNICATION_ANCHOR_LABELS[distance.anchor]}: ${communicationDistanceText(distance.valueMm)}`;
      const textWidth = Math.max(74, Math.min(270, text.length * 5.6 + 14));
      return `<g>
        <line x1="${marker.x}" y1="${marker.y}" x2="${anchor.x}" y2="${anchor.y}" stroke="${xml(color)}" stroke-width="2.1" stroke-dasharray="8 5" opacity=".88" marker-start="url(#eskizFactoryCommDistanceDot)" marker-end="url(#eskizFactoryCommDistanceArrow)" />
        ${distance.anchor === 'custom' ? `<line x1="${anchor.x - 8}" y1="${anchor.y}" x2="${anchor.x + 8}" y2="${anchor.y}" stroke="${xml(color)}" stroke-width="2" /><line x1="${anchor.x}" y1="${anchor.y - 8}" x2="${anchor.x}" y2="${anchor.y + 8}" stroke="${xml(color)}" stroke-width="2" />` : ''}
        <g transform="translate(${labelPoint.x} ${labelPoint.y})"><rect x="${-textWidth / 2}" y="-10" width="${textWidth}" height="20" rx="10" fill="#fff" stroke="${xml(color)}" stroke-width="1" opacity=".96" /><text text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="850" fill="${xml(color)}">${xml(text)}</text></g>
      </g>`;
    }).join('')}
    ${renderCommunicationIcon(marker)}
    ${renderCommunicationMeasureBadges(marker, width, height, showSizeBadges)}
  </g>`;
}

function renderObject(object: EskizObject, markerMode: EskizSketchModuleMarkerMode) {
  if (object.hidden) return '';
  if (object.type === 'dimension') return renderDimension(object);
  if (object.type === 'module') return renderModule(object, markerMode);
  if (object.type === 'callout') return renderCallout(object);
  if (object.type === 'comment' || object.type === 'link' || object.type === 'equipment') return renderTextObject(object);
  return '';
}

/** Строит автономный SVG snapshot Эскиз PRO: фон, размеры, сноски, модули и коммуникации. */
export function buildEskizSketchSvg(project: EskizProject, options: EskizSketchSvgOptions = {}): string {
  const width = Math.max(1, project.image.width);
  const height = Math.max(1, project.image.height);
  const markerMode = options.moduleMarkerMode ?? 'compact';
  const showCommunicationSizeBadges = options.showCommunicationSizeBadges !== false;
  const communications = (options.communications ?? []).filter((marker) => marker.eskizId === project.id);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <marker id="eskizFactoryDimArrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
        <path d="M 9 5 L 1 1 M 9 5 L 1 9" fill="none" stroke="context-stroke" stroke-width="1.7" stroke-linecap="round" />
      </marker>
      <marker id="eskizFactoryDimArrowClosed" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
        <path d="M 9 5 L 1 1 L 3 5 L 1 9 Z" fill="context-stroke" />
      </marker>
      <marker id="eskizFactoryCommDistanceArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
        <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="context-stroke" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      </marker>
      <marker id="eskizFactoryCommDistanceDot" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth">
        <circle cx="4" cy="4" r="2.3" fill="context-stroke" />
      </marker>
      <style>
        .label { filter: drop-shadow(0 2px 3px rgba(15, 23, 42, .16)); }
        .dimension text { paint-order: stroke; stroke: rgba(255,255,255,.58); stroke-width: .5px; }
        .communication { filter: drop-shadow(0 2px 3px rgba(15, 23, 42, .18)); }
      </style>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    <image href="${xml(project.image.dataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"${imageFilter(project)} />
    ${project.objects.map((object) => renderObject(object, markerMode)).join('\n')}
    ${communications.map((marker) => renderCommunication(marker, width, height, showCommunicationSizeBadges)).join('\n')}
  </svg>`;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Браузер не смог подготовить изображение Эскиз PRO для экспорта'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function defaultDownloadSize(project: EskizProject): { widthPx: number; heightPx: number } {
  const sourceWidth = Math.max(1, project.image.width);
  const sourceHeight = Math.max(1, project.image.height);
  const ratio = sourceWidth / sourceHeight;
  if (ratio >= 1) {
    const widthPx = 2200;
    return { widthPx, heightPx: Math.round(widthPx / ratio + 96) };
  }
  const heightPx = 2200;
  return { widthPx: Math.round(heightPx * ratio), heightPx };
}

function safeFilePart(value: string): string {
  return (value || 'eskiz')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'eskiz';
}

export function eskizSketchFileName(project: EskizProject, extension: 'png' | 'pdf' | 'jpg'): string {
  return `${safeFilePart(project.title || project.image.name || 'eskiz')}.${extension}`;
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function renderEskizSketchCanvas(project: EskizProject, options: EskizSketchPngOptions): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  if (typeof document === 'undefined') throw new Error('Экспорт картинки Эскиз PRO доступен только в браузере');
  const source = await loadSvgImage(buildEskizSketchSvg(project, options));
  const displayWidth = Math.max(240, Math.round(options.widthPx));
  const displayHeight = Math.max(220, Math.round(options.heightPx));
  const pixelRatio = clamp(options.pixelRatio ?? 2, 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(displayWidth * pixelRatio);
  canvas.height = Math.round(displayHeight * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог создать canvas для Эскиз PRO');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  if (options.frame === 'none') {
    ctx.drawImage(source, 0, 0, displayWidth, displayHeight);
    return { canvas, width: displayWidth, height: displayHeight };
  }

  const hasHeader = Boolean(options.title || options.subtitle);
  const headerHeight = hasHeader ? 54 : 12;
  if (hasHeader) {
    ctx.fillStyle = '#f7fbf9';
    ctx.fillRect(0, 0, displayWidth, headerHeight);
    ctx.fillStyle = '#24382f';
    ctx.font = '700 18px Arial, sans-serif';
    ctx.fillText(options.title || project.title, 16, 22);
    ctx.fillStyle = '#6b7a73';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(options.subtitle || project.image.name, 16, 42);
  }

  const margin = 14;
  const availableWidth = displayWidth - margin * 2;
  const availableHeight = displayHeight - headerHeight - margin * 1.5;
  const scale = Math.min(availableWidth / source.width, availableHeight / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const x = (displayWidth - drawWidth) / 2;
  const y = headerHeight + Math.max(6, (availableHeight - drawHeight) / 2);
  ctx.fillStyle = '#eef2ef';
  ctx.fillRect(x - 1, y - 1, drawWidth + 2, drawHeight + 2);
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
  ctx.strokeStyle = '#1f2f29';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, drawWidth, drawHeight);
  ctx.strokeStyle = '#d8e5df';
  ctx.strokeRect(.5, .5, displayWidth - 1, displayHeight - 1);

  return { canvas, width: displayWidth, height: displayHeight };
}

/** Растеризует snapshot в PNG с белым полем и аккуратной шапкой под размер области Excel/экспорта. */
export async function renderEskizSketchPng(project: EskizProject, options: EskizSketchPngOptions): Promise<EskizSketchPng> {
  const { canvas, width, height } = await renderEskizSketchCanvas(project, options);
  return { base64: canvas.toDataURL('image/png'), extension: 'png', width, height };
}

export async function renderEskizSketchJpeg(project: EskizProject, options: EskizSketchJpegOptions): Promise<EskizSketchJpeg> {
  const { canvas, width, height } = await renderEskizSketchCanvas(project, options);
  return { base64: canvas.toDataURL('image/jpeg', clamp(options.quality ?? .92, .5, .98)), extension: 'jpg', width, height };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function buildSingleImagePdf(jpegBytes: Uint8Array, imageWidth: number, imageHeight: number, pageWidthPt: number, pageHeightPt: number): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;
  const pushString = (value: string) => {
    const bytes = encoder.encode(value);
    parts.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    parts.push(bytes);
    offset += bytes.length;
  };
  const startObject = (id: number) => {
    offsets[id] = offset;
    pushString(`${id} 0 obj\n`);
  };

  pushString('%PDF-1.4\n');
  startObject(1);
  pushString('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObject(2);
  pushString('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  startObject(3);
  pushString(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  startObject(4);
  pushString(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  pushBytes(jpegBytes);
  pushString('\nendstream\nendobj\n');
  const content = `q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n/Im1 Do\nQ\n`;
  const contentLength = encoder.encode(content).length;
  startObject(5);
  pushString(`<< /Length ${contentLength} >>\nstream\n${content}endstream\nendobj\n`);
  const xrefOffset = offset;
  pushString(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((id) => `${String(offsets[id]).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob([bytesToArrayBuffer(concatBytes(parts))], { type: 'application/pdf' });
}

export async function renderEskizSketchPdf(project: EskizProject, options: EskizSketchPdfOptions = {}): Promise<EskizSketchPdf> {
  if (typeof document === 'undefined') throw new Error('Экспорт PDF Эскиз PRO доступен только в браузере');
  const sourceRatio = project.image.width / Math.max(1, project.image.height);
  const orientation = options.orientation === 'portrait' || options.orientation === 'landscape'
    ? options.orientation
    : sourceRatio > 1.12 ? 'landscape' : 'portrait';
  const page = orientation === 'landscape'
    ? { widthPt: 841.89, heightPt: 595.28 }
    : { widthPt: 595.28, heightPt: 841.89 };
  const pxScale = 3;
  const image = await renderEskizSketchJpeg(project, {
    ...options,
    widthPx: Math.round(page.widthPt * pxScale),
    heightPx: Math.round(page.heightPt * pxScale),
    pixelRatio: 1,
    quality: options.quality ?? .92,
  });
  const blob = buildSingleImagePdf(dataUrlToBytes(image.base64), image.width, image.height, page.widthPt, page.heightPt);
  return { blob, extension: 'pdf', widthPt: page.widthPt, heightPt: page.heightPt };
}

export async function downloadEskizSketchPng(project: EskizProject, options: EskizSketchDownloadOptions = {}): Promise<EskizSketchPng> {
  const size = options.widthPx && options.heightPx ? { widthPx: options.widthPx, heightPx: options.heightPx } : defaultDownloadSize(project);
  const image = await renderEskizSketchPng(project, { ...options, ...size, pixelRatio: options.pixelRatio ?? 2 });
  downloadDataUrl(image.base64, options.fileName ?? eskizSketchFileName(project, 'png'));
  return image;
}

export async function downloadEskizSketchPdf(project: EskizProject, options: EskizSketchPdfOptions = {}): Promise<EskizSketchPdf> {
  const pdf = await renderEskizSketchPdf(project, options);
  downloadBlob(pdf.blob, options.fileName ?? eskizSketchFileName(project, 'pdf'));
  return pdf;
}
