import type { EskizCommunicationDistance, EskizCommunicationMarker } from '../types';
import type { EskizCalloutObject, EskizDimensionObject, EskizModuleObject, EskizObject, EskizProject, EskizTextObject } from './eskizPro';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, communicationDistanceText, communicationSizeText } from './eskizCommunications';

export type EskizSketchModuleMarkerMode = 'full' | 'compact' | 'hidden';

export interface EskizSketchSvgOptions {
  moduleMarkerMode?: EskizSketchModuleMarkerMode;
  communications?: EskizCommunicationMarker[];
}

export interface EskizSketchPngOptions extends EskizSketchSvgOptions {
  widthPx: number;
  heightPx: number;
  title?: string;
  subtitle?: string;
  pixelRatio?: number;
}

export interface EskizSketchPng {
  base64: string;
  extension: 'png';
  width: number;
  height: number;
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

function renderCommunication(marker: EskizCommunicationMarker, width: number, height: number) {
  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
  const size = communicationSizeText(marker);
  const distances = marker.distances ?? [];
  const label = [marker.name || meta.label, size].filter(Boolean).join(' · ');
  const labelWidth = Math.max(90, Math.min(280, label.length * 6.1 + 18));
  const labelX = marker.x + 18 > width - labelWidth ? marker.x - labelWidth - 18 : marker.x + 18;
  const labelY = clamp(marker.y - 18, 8, Math.max(8, height - 38));
  return `<g class="communication">
    ${distances.map((distance) => {
      const anchor = distanceAnchorPoint(distance, marker, width, height);
      const midX = (marker.x + anchor.x) / 2;
      const midY = (marker.y + anchor.y) / 2;
      const text = `${distance.label || COMMUNICATION_ANCHOR_LABELS[distance.anchor]}: ${communicationDistanceText(distance.valueMm)}`;
      const textWidth = Math.max(74, Math.min(250, text.length * 5.6 + 14));
      return `<g>
        <line x1="${marker.x}" y1="${marker.y}" x2="${anchor.x}" y2="${anchor.y}" stroke="${meta.color}" stroke-width="2" stroke-dasharray="7 5" opacity=".82" />
        ${distance.anchor === 'custom' ? `<line x1="${anchor.x - 8}" y1="${anchor.y}" x2="${anchor.x + 8}" y2="${anchor.y}" stroke="${meta.color}" stroke-width="2" /><line x1="${anchor.x}" y1="${anchor.y - 8}" x2="${anchor.x}" y2="${anchor.y + 8}" stroke="${meta.color}" stroke-width="2" />` : ''}
        <g transform="translate(${midX} ${midY})"><rect x="${-textWidth / 2}" y="-10" width="${textWidth}" height="20" rx="10" fill="#fff" stroke="${meta.color}" stroke-width="1" opacity=".96" /><text text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="800" fill="${meta.color}">${xml(text)}</text></g>
      </g>`;
    }).join('')}
    <line x1="${marker.x}" y1="${marker.y}" x2="${labelX < marker.x ? labelX + labelWidth : labelX}" y2="${labelY + 17}" stroke="${meta.color}" stroke-width="2" opacity=".72" />
    <circle cx="${marker.x}" cy="${marker.y}" r="10" fill="${meta.color}" stroke="#fff" stroke-width="4" />
    <text x="${marker.x}" y="${marker.y + 4}" text-anchor="middle" font-size="10" font-weight="900" fill="#fff">${xml(meta.icon)}</text>
    <g transform="translate(${labelX} ${labelY})">
      <rect width="${labelWidth}" height="34" rx="9" fill="#fff" fill-opacity=".96" stroke="${meta.color}" stroke-width="1.7" />
      <text x="9" y="13" font-size="11" font-weight="900" fill="${meta.color}">${xml(marker.name || meta.label)}</text>
      <text x="9" y="26" font-size="9.5" font-weight="650" fill="#40554b">${xml(size || (marker.note ? marker.note.slice(0, 34) : meta.label))}</text>
    </g>
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
  const communications = (options.communications ?? []).filter((marker) => marker.eskizId === project.id);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <marker id="eskizFactoryDimArrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
        <path d="M 9 5 L 1 1 M 9 5 L 1 9" fill="none" stroke="context-stroke" stroke-width="1.7" stroke-linecap="round" />
      </marker>
      <marker id="eskizFactoryDimArrowClosed" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
        <path d="M 9 5 L 1 1 L 3 5 L 1 9 Z" fill="context-stroke" />
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
    ${communications.map((marker) => renderCommunication(marker, width, height)).join('\n')}
  </svg>`;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Браузер не смог подготовить изображение Эскиз PRO для Excel'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Растеризует snapshot в PNG с белым полем и аккуратной шапкой под размер области Excel. */
export async function renderEskizSketchPng(project: EskizProject, options: EskizSketchPngOptions): Promise<EskizSketchPng> {
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

  const hasHeader = Boolean(options.title || options.subtitle);
  const headerHeight = hasHeader ? 48 : 12;
  if (hasHeader) {
    ctx.fillStyle = '#f7fbf9';
    ctx.fillRect(0, 0, displayWidth, headerHeight);
    ctx.fillStyle = '#24382f';
    ctx.font = '700 18px Arial, sans-serif';
    ctx.fillText(options.title || project.title, 16, 21);
    ctx.fillStyle = '#6b7a73';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(options.subtitle || project.image.name, 16, 39);
  }

  const margin = 12;
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

  return { base64: canvas.toDataURL('image/png'), extension: 'png', width: displayWidth, height: displayHeight };
}
